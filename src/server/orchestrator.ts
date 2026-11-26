/**
 * Vast.ai GPU Orchestrator & Webhook Receiver
 *
 * Koordinator utama (Main VPS) untuk pekerjaan render GPU di Vast.ai:
 *   1. memilih penyedia object storage (S3-compatible pool) aktif.
 *   2. mempresign GET untuk import media sumber via PoolManager.
 *   3. mengirim job ke GPU worker (Vast.ai container) pada POST /jobs.
 *   4. memonitor worker (heartbeat) + timeout job agar container tidak
 *      "teralek" (tidak pernah leak container).
 *   5. menerima webhook "job.completed" | "job.failed" dari worker,
 *      diverifikasi HMAC-SHA256, lalu memperbarui status job di in-memory map.
 *      (Persisted DB masuk fase selanjutnya.)
 *
 * Kontraksi HTTP: hanya tipe `node:http` (IncomingMessage / ServerResponse),
 * tanpa Express. Deps tambahan: tidak ada (built-in `node:crypto` saja).
 *
 * Verifikasi:
 *   npx tsc --noEmit -p tsconfig.node.json
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  PoolManager,
  StorageProvider,
  PresignedGetUrl,
  PresignedPutUrl,
} from "./storage/pool-manager";
import {
  BOOT_TIMEOUT_MS,
  type VastInstanceBlocklist,
  type VastManager,
} from "./vast-client";
import { emitLog } from "./pipeline-log";
import type { PublicClipRow, PublicStoreDriver } from "./public-store";

/**
 * Opsi provisioning Vast.ai untuk `Orchestrator#provisionAndDispatch`.
 * `attempts` disediakan agar pemanggil bisa melakukan retry bertahap tanpa
 * melewati batas `maxAttempts` internal.
 */
export interface VastProvisionOptions {
  maxAttempts?: number;
  attempts?: number;
}

export interface JobPayload {
  id: string;
  sourceUrl?: string;
  sourceFile?: string;
  sourceBucket?: string;
  sourceRegion?: string;
  modelsRoot?: string;
  cacheDir?: string;
  maxClips?: number;
  /**
   * Instance Vast.ai yang menjalankan job ini (opsional). Dipakai untuk
   * cleanup saat timeout: release instance + blocklist 24 jam bila boot
   * melewati 180 detik.
   */
  vastInstanceId?: string;
}

export interface DispatchResult {
  jobId: string;
  status: "queued" | "running" | "timeout" | "error";
  workerUrl?: string;
  error?: string;
}

/**
 * Handler HTTP webhook (Node built-in, tanpa Express): `req` adalah
 * `IncomingMessage` (badan JSON + header `x-signature`) dan `res` adalah
 * `ServerResponse` (respons `ok: true/false` balik ke worker).
 */
export type WebhookHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

export class Orchestrator {
  private readonly workerBase: string;
  private readonly jobs = new Map<string, DispatchResult>();
  private readonly jobTimers = new Map<
    string,
    { interval: NodeJS.Timeout; timeout: NodeJS.Timeout }
  >();
  /** Waktu dispatch per job (dipakai untuk menghitung boot timeout Vast.ai). */
  private readonly jobStartedAt = new Map<string, number>();
  /** Fungsi stop watchdog log per job (dipasang saat dispatch Vast.ai). */
  private readonly jobWatchdogs = new Map<string, () => void>();
  /**
   * Instance Vast.ai aktif per job — dipakai untuk auto-destroy saat job
   * selesai/gagal lewat webhook agar billing GPU berhenti.
   */
  private readonly jobVastInstances = new Map<string, string>();
  private vastManager?: VastManager;
  private vastBlocklist?: VastInstanceBlocklist;
  /**
   * Store publik studio — bila terpasang, laporan worker (webhook) langsung
   * di-persist ke `jobs` + `clips` sehingga galeri terisi tanpa polling khusus.
   */
  private publicStore?: PublicStoreDriver;

  /** Port worker di dalam instance (docker -p) — default 8080 sesuai gpu-server. */
  private readonly vastWorkerPort: number;
  /** onstart_cmd untuk menjalankan worker di instance (mis. image custom). */
  private readonly vastOnstartCmd?: string;
  /** Batas waktu instance ready (running + healthcheck) sebelum di-destroy. */
  private readonly vastReadyTimeoutMs: number;
  private readonly vastHealthPath: string;
  /**
   * Mode inbound (default mati): healthcheck HTTP langsung ke instance.
   * `show_instance` Vast tidak memetakan port ke host yang bisa dihubungi
   * (`ports` kosong, `direct_port_start` = -1), jadi mode default adalah IoC:
   * konfigurasi job diinject lewat env saat create_instance dan worker
   * melapor balik ke webhook publik.
   */
  private readonly vastInbound: boolean;
  /** Waiter `worker.ready` per job (mode IoC: worker melapor balik). */
  private readonly jobReadyWaiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly poolManager: PoolManager,
    private readonly workerClient: {
      post(url: string, body: unknown): Promise<unknown>;
    },
    private readonly webhookSecret: string,
    private readonly timeoutMs: number,
    private readonly heartbeatMs: number,
    vastManager?: VastManager,
    vastBlocklist?: VastInstanceBlocklist,
  ) {
    this.workerBase = process.env.WORKER_WEBHOOK_BASE_URL ?? "http://localhost:8080";
    this.vastManager = vastManager;
    this.vastBlocklist = vastBlocklist;
    const parsedPort = Number.parseInt(process.env.VAST_WORKER_PORT ?? "8080", 10);
    this.vastWorkerPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8080;
    this.vastOnstartCmd = process.env.VAST_ONSTART_CMD?.trim() || undefined;
    const parsedReady = Number.parseInt(
      process.env.VAST_READY_TIMEOUT_MS ?? "480000",
      10,
    );
    this.vastReadyTimeoutMs =
      Number.isFinite(parsedReady) && parsedReady > 0 ? parsedReady : 480_000;
    this.vastHealthPath = process.env.VAST_WORKER_HEALTH_PATH?.trim() || "/healthz";
    this.vastInbound = process.env.VAST_INBOUND === "1";
  }

  /**
   * Sambungkan (atau ganti) bridge lifecycle Vast.ai setelah konstruksi.
   * Dipakai oleh `src/server/index.ts` saat wiring runtime.
   */
  attachVastManager(
    vastManager: VastManager,
    vastBlocklist?: VastInstanceBlocklist,
  ): void {
    this.vastManager = vastManager;
    this.vastBlocklist = vastBlocklist ?? this.vastBlocklist;
  }

  /**
   * Pasang store publik agar `handleWebhook` bisa mem-persist status job dan
   * daftar klip hasil render (galeri studio membaca dari tabel `clips`).
   */
  attachPublicStore(store: PublicStoreDriver): void {
    this.publicStore = store;
  }

  /**
   * Environment yang diinject saat `create_instance` (mode IoC): worker
   * membaca konfigurasi job dari env ini lalu melapor balik ke
   * `RESULT_WEBHOOK` dengan HMAC — tidak ada port masuk yang dibutuhkan.
   */
  private buildWorkerEnv(job: JobPayload): Record<string, string> {
    const webhookBase = this.workerBase.replace(/\/+$/, "");
    const env: Record<string, string> = {
      JOB_ID: job.id,
      HOTCLIP_JOB: JSON.stringify(job),
      RESULT_WEBHOOK: `${webhookBase}/api/v1/worker/webhook`,
      VAST_WEBHOOK_SECRET: this.webhookSecret,
      HTTP_PORT: String(this.vastWorkerPort || 8080),
      NO_PIP_INSTALL: "true",
      NO_APT_INSTALL: "true",
    };
    if (process.env.S3_ENDPOINT) env.S3_ENDPOINT = process.env.S3_ENDPOINT;
    if (process.env.S3_BUCKET) env.S3_BUCKET = process.env.S3_BUCKET;
    if (process.env.S3_REGION) env.S3_REGION = process.env.S3_REGION;
    if (process.env.S3_ACCESS_KEY_ID) {
      env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
    }
    if (process.env.S3_SECRET_ACCESS_KEY) {
      env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
    }
    if (process.env.RESULT_BUCKET) env.RESULT_BUCKET = process.env.RESULT_BUCKET;
    return env;
  }

  /**
   * Mode IoC: tunggu worker melapor `ready` ke webhook publik. Reject saat
   * `vastReadyTimeoutMs` terlampaui — pemanggil (provisionAndDispatch) akan
   * destroy instance dan fail-fast.
   */
  private waitForWorkerReady(jobId: string): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.jobReadyWaiters.delete(jobId);
        rejectPromise(
          new Error(
            `worker tidak melapor ready dalam ${Math.round(this.vastReadyTimeoutMs / 1000)}s (webhook worker.ready)`,
          ),
        );
      }, this.vastReadyTimeoutMs);
      timer.unref?.();
      this.jobReadyWaiters.set(jobId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
    });
  }

  private settleWorkerReady(jobId: string, error?: Error): void {
    const waiter = this.jobReadyWaiters.get(jobId);
    if (!waiter) return;
    this.jobReadyWaiters.delete(jobId);
    clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }

  /**
   * Provision instance Vast.ai termurah yang lolos hard filter, lalu dispatch
   * job ke worker pada instance tersebut. Bila bridge Vast.ai tidak terpasang,
   * perilaku identik dengan `dispatchJob(job)` (jalur lama).
   *
   * Setiap percobaan yang gagal akan me-release instance (best-effort) dan
   * mem-blocklist instance tersebut bila boot melewati `BOOT_TIMEOUT_MS`.
   */
  async provisionAndDispatch(
    job: JobPayload,
    options: { maxAttempts?: number } = {},
  ): Promise<DispatchResult & { vastInstanceId?: string }> {
    const vastManager = this.vastManager;
    if (!vastManager) {
      return this.dispatchJob(job);
    }

    const requested = options.maxAttempts ?? 3;
    const maxAttempts =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 3;
    let lastError = "Vast.ai provisioning failed";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      let instanceId: string | undefined;

      try {
        // `search()` sudah menyaring hard limits & blocklist, termurah dulu.
        const candidates = await vastManager.search();
        const candidate = candidates[0];
        if (!candidate) {
          lastError = "no Vast.ai offer matches the hard limits";
          continue;
        }

        const instance = await vastManager.requestInstance(candidate.id, {
          workspaceDir: "/data/work",
          // Mode IoC (default): seluruh konfigurasi job diinject lewat env;
          // worker melapor balik ke RESULT_WEBHOOK, tidak perlu di-hit dari luar.
          env: this.buildWorkerEnv(job),
          ...(this.vastInbound && this.vastWorkerPort > 0
            ? {
                port: this.vastWorkerPort,
                // Direct connection wajib: tanpa ini Vast tidak memetakan port
                // ke host (`show_instance` punya direct_port_* saja, tanpa `ports`).
                direct: true,
                ...(this.vastOnstartCmd ? { onstartCmd: this.vastOnstartCmd } : {}),
              }
            : {
                ...(this.vastOnstartCmd ? { onstartCmd: this.vastOnstartCmd } : {}),
              }),
        });
        instanceId = instance.id;

        if (this.vastInbound) {
          // Opsi 1 (inbound): tunggu instance running + healthcheck HTTP, lalu
          // dispatch ke endpoint instance — bukan lagi ke workerBase statis.
          const endpoint = await this.waitForWorkerEndpoint(vastManager, instance.id);

          const dispatched = await this.dispatchJob(
            { ...job, vastInstanceId: instance.id },
            endpoint,
          );
          if (dispatched.status !== "error") {
            return { ...dispatched, vastInstanceId: instance.id };
          }
          lastError = dispatched.error ?? "worker dispatch failed";
        } else {
          // Opsi 3 (inversion of control): worker membaca HOTCLIP_JOB lalu
          // melapor `ready` ke webhook; konfigurasi sudah lengkap sejak boot.
          await this.waitForWorkerReady(job.id);
          const running: DispatchResult & { vastInstanceId?: string } = {
            jobId: job.id,
            status: "running",
            vastInstanceId: instance.id,
          };
          this.jobs.set(job.id, running);
          return running;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (instanceId) {
        this.releaseVastInstanceBestEffort(vastManager, instanceId);
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > BOOT_TIMEOUT_MS) {
          this.vastBlocklist?.blockOnBootTimeout(instanceId, elapsedMs);
        }
      }

      // Kegagalan "worker tidak siap" bersifat deterministik (mis. image tidak
      // menjalankan worker di port tsb) — retry hanya menyewa instance GPU
      // berbayar tambahan tanpa peluang sukses. Berhenti di percobaan pertama.
      if (
        lastError.startsWith("worker GPU tidak siap") ||
        lastError.startsWith("worker tidak melapor ready") ||
        lastError.startsWith("worker gagal sebelum ready")
      ) {
        break;
      }
    }

    const failure: DispatchResult = {
      jobId: job.id,
      status: "error",
      error: lastError,
    };
    this.jobs.set(job.id, failure);
    return failure;
  }

  /**
   * Watchdog log instance Vast.ai: memanggil `logs()` tiap `intervalMs`.
   * Bila gagal / tanpa output 3 kali berturut-turut, instance di-release,
   * di-blocklist (bila boot melewati batas), job ditandai `error`, dan timer
   * dihentikan. Mengembalikan fungsi stop (idempoten).
   */
  startVastWatchdog(
    instanceId: string,
    jobId: string,
    opts: { intervalMs?: number } = {},
  ): () => void {
    const intervalMs = opts.intervalMs ?? 15_000;
    let failures = 0;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      if (this.jobWatchdogs.get(jobId) === stop) {
        this.jobWatchdogs.delete(jobId);
      }
    };

    const registerFailure = (): void => {
      failures += 1;
      if (failures < 3 || stopped) return;
      this.handleWatchdogFailure(instanceId, jobId, stop);
    };

    timer = setInterval(() => {
      const vastManager = this.vastManager;
      if (!vastManager) {
        stop();
        return;
      }
      void vastManager
        .logs(instanceId, 100)
        .then((output) => {
          if (typeof output === "string" && output.trim().length > 0) {
            failures = 0;
            return;
          }
          registerFailure();
        })
        .catch(() => {
          registerFailure();
        });
    }, intervalMs);
    // Jangan menahan event loop hanya karena watchdog ini.
    timer.unref?.();

    // Ganti watchdog lama untuk job yang sama, bila ada.
    const previous = this.jobWatchdogs.get(jobId);
    this.jobWatchdogs.set(jobId, stop);
    if (previous && previous !== stop) previous();

    return stop;
  }

  /** Hentikan semua watchdog (dipakai saat graceful shutdown). */
  stopAllWatchdogs(): void {
    for (const stop of [...this.jobWatchdogs.values()]) {
      stop();
    }
    this.jobWatchdogs.clear();
  }

  // Dispatcher: pilih penyedia storage -> presign GET (import sumber) ->
  // POST ke worker `/jobs` -> heartbeat setiap `heartbeatMs` -> timeout
  // setelah `timeoutMs` -> tandai `timeout`, cabut container worker.
  async dispatchJob(job: JobPayload, workerBaseOverride?: string): Promise<DispatchResult> {
    // Jalur Vast.ai mengoverride target ke endpoint instance
    // (http://<public_ip>:<host_port>); jalur lama tetap pakai env workerBase.
    const workerBase = workerBaseOverride ?? this.workerBase;

    // 1) pilih penyedia storage aktif (global bila payload tidak memberikan poolId)
    const provider = await this.poolManager.selectActiveProvider();

    // 2) presign GET untuk import media sumber
    const sourceKey = this.resolveSourceKey(job);
    const presigned = await this.poolManager.presignGet(sourceKey, provider.id);

    // 2b) presign PUT untuk hasil klip: worker mengunggah hasil langsung ke
    // bucket yang sama tanpa pernah menerima kredensial S3 mentah.
    let resultUpload: PresignedPutUrl | undefined;
    try {
      resultUpload = await this.poolManager.presignPut(
        `clips/${job.id}/result.mp4`,
        provider.id,
      );
    } catch {
      resultUpload = undefined;
    }

    // 3) payload dispatch ke worker (tambahkan konfigurasi storage)
    const payload = this.buildDispatchPayload(job, provider, presigned, resultUpload);

    const result: DispatchResult = {
      jobId: job.id,
      status: "queued",
      workerUrl: `${workerBase}/jobs`,
    };
    this.jobs.set(job.id, result);
    this.jobStartedAt.set(job.id, Date.now());
    if (job.vastInstanceId) {
      this.jobVastInstances.set(job.id, job.vastInstanceId);
    }

    let workerResponse: unknown = null;
    try {
      workerResponse = await this.workerClient.post(`${workerBase}/jobs`, payload);
    } catch (error) {
      // POST gagal: belum ada container worker yang hidup, hence tidak ada
      // aborter yang perlu dipanggil (no-op).
      result.status = "error";
      result.error = error instanceof Error ? error.message : String(error);
      this.jobs.set(job.id, result);
      return result;
    }

    this.applyWorkerResponse(workerResponse, result);
    if (result.status === "queued") {
      result.status = "running";
    }
    this.jobs.set(job.id, result);

    // 4) monitor: heartbeat setiap heartbeatMs + timeout setelah timeoutMs.
    const interval = setInterval(() => {
      void this.workerClient
        .post(`${workerBase}/heartbeat`, { jobId: job.id, ping: true })
        .catch(() => undefined);
    }, this.heartbeatMs);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      result.status = "timeout";
      result.error = `job ${job.id} timeout setelah ${this.timeoutMs}ms`;
      this.jobTimers.delete(job.id);
      this.jobs.set(job.id, result);
      this.stopWatchdogForJob(job.id);
      this.releaseVastInstanceOnTimeout(job);
      this.abortJobIfAvailable(job.id);
    }, this.timeoutMs);

    this.jobTimers.set(job.id, { interval, timeout });

    // 5) watchdog log Vast.ai (hanya bila job berjalan di instance Vast.ai).
    if (job.vastInstanceId) {
      this.startVastWatchdog(job.vastInstanceId, job.id);
    }

    return result;
  }

  // Verifikasi HMAC-SHA256 dari webhook: `hex(HMAC-SHA256(secret, payload))`
  // harus sama dengan `signature`. Komparasi dengan timing-safe agar tidak
  // rentan timing attack.
  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    const expected = createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex");

    if (signature.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  }

  // Penerima webhook: menerima dua bentuk payload —
  //   1) `event: "job.completed" | "job.failed"` (kontrak lama/bridges)
  //   2) `status: "completed" | "failed"`        (format worker gpu-server)
  // Signature HMAC valid + jobId wajib. Setelah itu status job + klip
  // di-persist ke public store (bila terpasang) sehingga galeri terisi.
  async handleWebhook(payload: unknown, signature: string): Promise<boolean> {
    const raw = this.toBuffer(payload);
    if (!this.verifyWebhookSignature(raw, signature)) {
      return false;
    }

    const record = payload as Record<string, unknown>;
    const jobId = record.jobId;

    if (typeof jobId !== "string" || jobId.length === 0) {
      return false;
    }

    // Mode IoC: worker melapor siap (image custom) sebelum menerima job.
    if (record.event === "worker.ready" || record.status === "ready") {
      this.settleWorkerReady(jobId);
      return true;
    }

    // Terima kedua bentuk nama event; tanpa ini webhook worker asli
    // (`status`) akan selalu ditolak dan job macet di `running`.
    const failed = record.event === "job.failed" || record.status === "failed";
    const completed = record.event === "job.completed" || record.status === "completed";
    if (!failed && !completed) {
      return false;
    }

    const status: DispatchResult["status"] = failed ? "error" : "running";

    const existing = this.jobs.get(jobId);
    const entry: DispatchResult = {
      jobId,
      status,
      workerUrl: existing?.workerUrl,
      error: failed && typeof record.error === "string" && record.error.length > 0
        ? record.error
        : existing?.error,
    };
    this.jobs.set(jobId, entry);

    // Hapus timer monitor agar webhook yang tiba tidak kena timeout watchdog.
    const timers = this.jobTimers.get(jobId);
    if (timers) {
      clearTimeout(timers.timeout);
      clearInterval(timers.interval);
      this.jobTimers.delete(jobId);
    }
    this.stopWatchdogForJob(jobId);
    this.jobStartedAt.delete(jobId);

    // Auto-destroy: job sudah berakhir (completed/failed) — release instance
    // Vast.ai sekarang juga agar tidak menagih biaya GPU sampai timeout.
    this.releaseVastInstanceForJob(jobId);

    // Bila worker melapor gagal sebelum sempat `ready`, bangunkan waiter agar
    // provisioning langsung gagal (bukan menunggu timeout penuh).
    if (failed) {
      this.settleWorkerReady(
        jobId,
        new Error(
          typeof entry.error === "string" && entry.error.length > 0
            ? `worker gagal sebelum ready: ${entry.error}`
            : "worker gagal sebelum ready",
        ),
      );
    }

    // Persist status + klip ke public store (galeri studio).
    await this.persistWorkerReport(jobId, record, failed);

    return true;
  }

  /**
   * Persist laporan worker ke public store: patch status job lalu tulis klip
   * hasil render ke tabel `clips` (metadata dikirim worker sebagai `clips[]`
   * berisi `objectKey`; `mediaUrl` dibuat dari presigned GET — best-effort).
   */
  private async persistWorkerReport(
    jobId: string,
    record: Record<string, unknown>,
    failed: boolean,
  ): Promise<void> {
    const store = this.publicStore;
    if (!store) return;

    const errorMessage =
      typeof record.error === "string" && record.error.length > 0
        ? record.error
        : undefined;

    try {
      await store.patchJob(jobId, {
        status: failed ? "failed" : "completed",
        stage: failed ? "failed" : "completed",
        progress: 100,
        ...(errorMessage ? { error: errorMessage } : {}),
      });
    } catch (error) {
      console.warn(
        `[orchestrator] patchJob(${jobId}) gagal:`,
        error instanceof Error ? error.message : error,
      );
      return;
    }

    if (failed) return;

    const job = await store.getJob(jobId).catch(() => null);
    if (!job) return;

    const rawClips = Array.isArray(record.clips)
      ? record.clips
      : Array.isArray(record.exported)
        ? record.exported
        : [];

    const clips: PublicClipRow[] = [];
    for (const raw of rawClips) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      const clipId =
        typeof entry.id === "string" && entry.id.length > 0
          ? entry.id
          : typeof entry.id === "number"
            ? String(entry.id)
            : null;
      if (!clipId) continue;

      const objectKey =
        typeof entry.objectKey === "string" && entry.objectKey.length > 0
          ? entry.objectKey
          : `clips/${jobId}/${clipId}.mp4`;

      let mediaUrl = "";
      try {
        const presigned = await this.poolManager.presignGet(
          objectKey,
          undefined,
          7 * 24 * 3600, // 7 hari — cukup untuk masa unduh galeri
        );
        mediaUrl = presigned.url;
      } catch {
        continue; // tanpa mediaUrl klip tidak bisa diputar — lewati
      }

      const createdAt =
        typeof entry.createdAt === "string" && entry.createdAt.length > 0
          ? entry.createdAt
          : new Date().toISOString();

      const clip: PublicClipRow = {
        id: clipId.includes("-") ? clipId : crypto.randomUUID(),
        jobId,
        clientSessionId: job.clientSessionId,
        title:
          typeof entry.title === "string" && entry.title.length > 0
            ? entry.title
            : `Klip ${clips.length + 1}`,
        caption: typeof entry.caption === "string" ? entry.caption : "",
        hashtags: Array.isArray(entry.hashtags)
          ? entry.hashtags.filter(
              (tag): tag is string => typeof tag === "string",
            )
          : [],
        startSec:
          typeof entry.startSec === "number" ? entry.startSec : 0,
        endSec: typeof entry.endSec === "number" ? entry.endSec : 0,
        durationSec:
          typeof entry.durationSec === "number" ? entry.durationSec : 0,
        score: typeof entry.score === "number" ? entry.score : 0,
        aspectRatio: job.aspectRatio,
        mediaUrl,
        sizeBytes: typeof entry.sizeBytes === "number" ? entry.sizeBytes : 0,
        status: "ready",
        createdAt,
      };
      clips.push(clip);
    }

    if (clips.length === 0) return;

    try {
      await store.replaceClips(jobId, job.clientSessionId, clips);
    } catch (error) {
      console.warn(
        `[orchestrator] replaceClips(${jobId}) gagal:`,
        error instanceof Error ? error.message : error,
      );
      return;
    }

    await emitLog(
      jobId,
      job.clientSessionId,
      "stage",
      "completed",
      `${clips.length} klip siap di galeri.`,
      { sink: store },
    );
  }

  /**
   * Membuat HTTP request handler (Node built-in `http`, tanpa Express) yang
   * menerima POST webhook dari GPU worker, memverifikasi signature, lalu
   * meneruskan payload ke `Orchestrator#handleWebhook`.
   */
  static createWebhookHandler(orchestrator: Orchestrator): WebhookHandler {
    return async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array),
        );
      }
      const body = Buffer.concat(chunks);

      const signature =
        req.headers["x-signature"] as string | undefined;
      if (typeof signature !== "string" || signature.length === 0) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "missing signature" }));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "invalid json" }));
        return;
      }

      const accepted = await orchestrator.handleWebhook(parsed, signature);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: accepted }));
    };
  }

  /* ------------------------------------------------------------------ */
  /* Pembantu internal                                                   */
  /* ------------------------------------------------------------------ */

  private buildDispatchPayload(
    job: JobPayload,
    provider: StorageProvider,
    presigned: PresignedGetUrl,
    resultUpload?: PresignedPutUrl,
  ): Record<string, unknown> {
    return {
      ...job,
      sourceBucket: job.sourceBucket ?? provider.config.bucket_name,
      sourceRegion: job.sourceRegion ?? provider.config.region,
      sourcePresignUrl: presigned.url,
      sourceMethod: presigned.method,
      sourceHeaders: presigned.headers,
      // End-to-end upload: worker memakai presigned PUT ini untuk menulis
      // hasil klip; tidak ada kredensial S3 yang dikirim ke container.
      ...(resultUpload
        ? {
            resultBucket: provider.config.bucket_name,
            resultKey: `clips/${job.id}/result.mp4`,
            resultPresignUrl: resultUpload.url,
            resultMethod: resultUpload.method,
            resultHeaders: resultUpload.headers,
          }
        : {}),
    };
  }

  private applyWorkerResponse(response: unknown, result: DispatchResult): void {
    if (response == null || typeof response !== "object" || Array.isArray(response)) {
      return;
    }
    const record = response as Record<string, unknown>;
    if (typeof record.jobId === "string" && record.jobId.length > 0) {
      result.jobId = record.jobId;
    }
    if (typeof record.ok === "boolean") {
      result.status = record.ok ? "running" : "error";
      if (record.ok === false && typeof record.error === "string" && record.error.length > 0) {
        result.error = record.error;
      }
    }
  }

  private abortJobIfAvailable(jobId: string): void {
    // `store#abortJob` (job store) belum wired di fase ini. Best-effort:
    // panggil `abortJob` jika ada di PoolManager / workerClient, selaku
    // "if available". Jika tidak ada, no-op (tidak membuang error).
    const manager = this.poolManager as { abortJob?: (jobId: string) => void };
    const abort = manager.abortJob;
    if (typeof abort === "function") {
      void Promise.resolve(abort(jobId)).catch(() => undefined);
    }

    const worker = this.workerClient as { abortJob?: (jobId: string) => void };
    const workerAbort = worker.abortJob;
    if (typeof workerAbort === "function") {
      void Promise.resolve(workerAbort(jobId)).catch(() => undefined);
    }
  }

  /** Hentikan watchdog job (bila ada) tanpa melempar error. */
  private stopWatchdogForJob(jobId: string): void {
    const stop = this.jobWatchdogs.get(jobId);
    if (!stop) return;
    stop();
    this.jobWatchdogs.delete(jobId);
  }

  /**
   * Aksi saat watchdog menyimpulkan instance tidak sehat: release instance,
   * blocklist bila boot melewati batas, tandai job `error`, hentikan timer
   * monitor & watchdog.
   */
  private handleWatchdogFailure(
    instanceId: string,
    jobId: string,
    stop: () => void,
  ): void {
    const startedAt = this.jobStartedAt.get(jobId);
    this.jobStartedAt.delete(jobId);

    if (startedAt !== undefined) {
      this.vastBlocklist?.blockOnBootTimeout(instanceId, Date.now() - startedAt);
    }

    const vastManager = this.vastManager;
    if (vastManager) {
      this.releaseVastInstanceBestEffort(vastManager, instanceId);
    }

    const existing = this.jobs.get(jobId);
    this.jobs.set(jobId, {
      jobId,
      status: "error",
      workerUrl: existing?.workerUrl,
      error: `Vast.ai instance ${instanceId} tidak merespons (3 probe log gagal)`,
    });

    const timers = this.jobTimers.get(jobId);
    if (timers) {
      clearTimeout(timers.timeout);
      clearInterval(timers.interval);
      this.jobTimers.delete(jobId);
    }

    stop();
    this.jobWatchdogs.delete(jobId);
  }

  private releaseVastInstanceBestEffort(
    vastManager: VastManager,
    instanceId: string,
  ): void {
    void vastManager.releaseInstance(instanceId).catch(() => undefined);
  }

  /**
   * Tunggu instance Vast.ai running + worker siap: polling detail instance
   * sampai `public_ipaddr` + mapped HostPort muncul, lalu healthcheck
   * `GET http://<ip>:<port>/healthz` sampai 200. Melempar Error saat deadline
   * tercapai — pemanggil (provisionAndDispatch) akan destroy instance.
   */
  private async waitForWorkerEndpoint(
    vastManager: VastManager,
    instanceId: string,
  ): Promise<string> {
    const startedAt = Date.now();
    const deadline = startedAt + this.vastReadyTimeoutMs;
    let lastReason = "instance belum running";
    let lastStatus: string | null = null;

    while (Date.now() < deadline) {
      const detail = await vastManager.getInstance(instanceId).catch(() => null);
      if (detail) {
        lastStatus = detail.status;
        const hostPort = this.resolveHostPort(detail);
        if (detail.publicIp && hostPort) {
          const base = `http://${detail.publicIp}:${hostPort}`;
          if (await this.healthcheckWorker(base)) {
            // Boot timing: dipakai untuk mengukur waktu boot rata-rata nyata.
            const bootMs = Date.now() - startedAt;
            console.log(
              `[vast] worker ready instance=${instanceId} endpoint=${base} ` +
                `bootMs=${bootMs} (${(bootMs / 1000).toFixed(1)}s)`,
            );
            return base;
          }
          lastReason = `healthcheck ${base}${this.vastHealthPath} belum siap`;
        } else {
          lastReason =
            `menunggu ip/port (status ${detail.status ?? "unknown"}, ` +
            `ip=${detail.publicIp ?? "-"}, directPort=${detail.directPortStart ?? "-"})`;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(
      `worker GPU tidak siap dalam ${Math.round(this.vastReadyTimeoutMs / 1000)}s ` +
        `(status terakhir: ${lastStatus ?? "unknown"}): ${lastReason}`,
    );
  }

  /**
   * Ambil mapped HostPort untuk port worker.
   *
   * `show_instance` tidak mengembalikan map `ports` untuk instance docker
   * (diverifikasi lewat probe: RAW_KEYS tidak memuat `ports`), melainkan
   * `direct_port_start` + `direct_port_count` — port container yang
   * dipublikasikan (`docker -p`) dipetakan ke port host pertama di rentang itu.
   */
  private resolveHostPort(detail: {
    hostPorts: Record<string, number>;
    directPortStart: number | null;
    directPortCount: number | null;
  }): number | null {
    const direct = detail.hostPorts[`${this.vastWorkerPort}/tcp`];
    if (direct) return direct;

    // Fallback 1: satu-satunya mapping (Vast kadang menormalisasi key).
    const entries = Object.entries(detail.hostPorts);
    if (entries.length === 1) return entries[0]![1];
    const anyPort = entries.find(([key]) => key.startsWith(`${this.vastWorkerPort}/`));
    if (anyPort) return anyPort[1];

    // Fallback 2: direct-port range (kasus normal untuk instance docker).
    if (
      detail.directPortStart &&
      detail.directPortStart > 0 &&
      (detail.directPortCount ?? 0) > 0
    ) {
      return detail.directPortStart;
    }
    return null;
  }

  /** GET /healthz worker; true hanya bila HTTP 2xx (timeout 4 dtk per cobaan). */
  private async healthcheckWorker(base: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(`${base}${this.vastHealthPath}`, {
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Auto-destroy instance Vast.ai milik job (webhook job.completed/failed):
   * billing GPU berhenti begitu job berakhir, bukan menunggu timeout.
   * Best-effort — kegagalan release tidak boleh menggagalkan webhook.
   */
  private releaseVastInstanceForJob(jobId: string): void {
    const instanceId = this.jobVastInstances.get(jobId);
    this.jobVastInstances.delete(jobId);
    if (!instanceId) return;
    const vastManager = this.vastManager;
    if (!vastManager) return;
    this.releaseVastInstanceBestEffort(vastManager, instanceId);
  }

  /**
   * Cleanup Vast.ai saat job timeout:
   *   - blokir instance 24 jam bila boot melewati `BOOT_TIMEOUT_MS` (180 dtk)
   *   - release instance agar tidak menagih biaya GPU terus-menerus
   * Semua bersifat best-effort & aman bila bridge tidak terpasang.
   */
  private releaseVastInstanceOnTimeout(job: JobPayload): void {
    const instanceId = job.vastInstanceId;
    const startedAt = this.jobStartedAt.get(job.id);
    this.jobStartedAt.delete(job.id);
    this.jobVastInstances.delete(job.id);
    if (!instanceId) return;

    if (startedAt !== undefined) {
      this.vastBlocklist?.blockOnBootTimeout(instanceId, Date.now() - startedAt);
    }

    const vastManager = this.vastManager;
    if (vastManager) {
      void vastManager.releaseInstance(instanceId).catch(() => undefined);
    }
  }

  private resolveSourceKey(job: JobPayload): string {
    return `source/${job.id}/media.${this.resolveSourceExt(job)}`;
  }

  private resolveSourceExt(job: JobPayload): string {
    if (typeof job.sourceUrl === "string" && job.sourceUrl.length > 0) {
      const cleaned = job.sourceUrl.split(/[?#]/)[0];
      const dot = cleaned.lastIndexOf(".");
      if (dot >= 0) return cleaned.slice(dot + 1).toLowerCase();
    }
    if (typeof job.sourceFile === "string" && job.sourceFile.length > 0) {
      const dot = job.sourceFile.lastIndexOf(".");
      if (dot >= 0) return job.sourceFile.slice(dot + 1).toLowerCase();
    }
    return "mp4";
  }

  private toBuffer(payload: unknown): Buffer {
    if (payload == null) return Buffer.alloc(0);
    if (typeof payload === "string") return Buffer.from(payload, "utf8");
    if (typeof payload === "boolean" || typeof payload === "number") {
      return Buffer.from(JSON.stringify(payload), "utf8");
    }
    if (Buffer.isBuffer(payload)) return payload;
    return Buffer.from(JSON.stringify(payload), "utf8");
  }
}
