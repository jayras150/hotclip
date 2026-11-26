/**
 * HotClip GPU Worker Server — Vast.ai ephemeral container compute node.
 *
 * HTTP/1.1 server (Node built-in, no framework dependency):
 *   GET  /healthz  — liveness/readiness probe for the orchestrator.
 *   POST /jobs     — accept a job payload from the Main VPS.
 *
 * Job lifecycle:
 *   1. Validate the payload; resolve the source media (`job.sourceUrl` → yt-dlp
 *      import, `job.sourceFile` → direct use) into a job-local working dir.
 *   2. Run the shared pipeline (`src/shared/pipeline/autoClip`) with the
 *      `vast` strategy. The pipeline is strategy-agnostic by construction;
 *      the only strategy-specific seams are the `PipelineDeps` injection
 *      contract and the env contract below, which the orchestrator fills from
 *      the Vast.ai instance (ffmpeg/cuDNN/NVENC in the image, models in
 *      /app/models, S3 pool + webhook for the result).
 *   3. Upload every exported clip + result manifest to the S3-compatible pool
 *      via a presigned PUT (aws CLI v2), so the Main VPS never needs
 *      long-lived object-store credentials.
 *   4. POST { jobId, status: "completed", exported } to the VPS webhook;
 *      on failure POST { jobId, status: "failed", error } — the HTTP
 *      response carries `ok: false`, which is what the orchestrator uses to
 *      tear down the ephemeral container.
 *
 * Run with:  tsx src/worker/gpu-server.ts
 * Env:       see the `ensureEnvContract` section.
 */

import { createServer } from "http";
import { createHmac } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";

import { autoClip, type AutoClipConfig } from "../shared/pipeline";
import type { ExportedClip, PerformanceEntry, LlmConfig } from "../shared/api-types";
import type { ReviewRecord } from "../core/review-memory";

/* ------------------------------------------------------------------------ */
/* Environment contract (injected by the Main VPS / docker-compose)         */
/* ------------------------------------------------------------------------ */

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
const MODEL_DIR = process.env.MODEL_DIR ?? "/app/models";
const SOURCE_BUCKET = process.env.SOURCE_BUCKET ?? "";
const SOURCE_REGION = process.env.SOURCE_REGION ?? "";
const RESULT_BUCKET = process.env.RESULT_BUCKET ?? "";
const RESULT_WEBHOOK = process.env.RESULT_WEBHOOK ?? "";
/** Secret HMAC untuk header `x-signature` (di-inject orchestrator). */
const WEBHOOK_SECRET = process.env.VAST_WEBHOOK_SECRET ?? "";
/**
 * Mode IoC: seluruh konfigurasi job di-inject lewat env saat create_instance
 * (HOTCLIP_JOB = JSON payload). Bila terisi, worker langsung menjalankan job
 * saat boot tanpa menunggu POST /jobs dari orchestrator.
 */
const HOTCLIP_JOB_ENV = process.env.HOTCLIP_JOB ?? "";
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 3600_000);
const JOB_CACHE_DIR = process.env.JOB_CACHE_DIR ?? "/data/work/cache";
const RENDER_CACHE_DIR = process.env.RENDER_CACHE_DIR ?? "/data/work/render";
const NO_PIP_INSTALL = process.env.NO_PIP_INSTALL === "true";

// The orchestrator always boots this image with the GPU/NVENC path on PATH
// (nvidia-container-toolkit) plus an Ubuntu ffmpeg providing NVENC. The
// strategy label is carried here for the pipeline's adapter surface
// (`runtime: "local" | "vast"`) and is never relied upon for correctness.
process.env.HOTCLIP_STRATEGY = "vast";
process.env.HOTCLIP_GPU = "true";
process.env.MODEL_DIR = MODEL_DIR;

/* ------------------------------------------------------------------------ */
/* Environment contract (injected by Main VPS / vast-manager create_instance)*/
/* ------------------------------------------------------------------------ */

export interface EnvContract {
  jobId: string;
  webhookSecret: string;
  resultWebhook: string;
  httpPort: number;
  sourceBucket: string;
  sourceRegion: string;
  resultBucket: string;
  jobTimeoutMs: number;
}

/**
 * Validasi contract env yang diinjeksikan oleh Main VPS / Vast.ai saat
 * `create_instance` (mode IoC). Dipanggil di `runJobAtBoot` sebelum job
 * dieksekusi. Bila kosong, worker tetap berjalan sebagai HTTP server biasa
 * (menerima POST /jobs dari orchestrator tanpa konfigurasi job).
 */
export function ensureEnvContract(): EnvContract {
  const jobId = process.env.JOB_ID ?? "";
  const webhook = process.env.RESULT_WEBHOOK ?? "";
  const secret = process.env.VAST_WEBHOOK_SECRET ?? "";
  const httpPort = Number(process.env.HTTP_PORT ?? "8080");
  const sourceBucket = process.env.SOURCE_BUCKET ?? "";
  const sourceRegion = process.env.SOURCE_REGION ?? "";
  const resultBucket = process.env.RESULT_BUCKET ?? "";
  const jobTimeoutMs = Number(process.env.JOB_TIMEOUT_MS ?? 3600_000);

  if (!jobId) {
    throw new Error("job contract invalid: JOB_ID / HOTCLIP_JOB missing");
  }
  if (!webhook) {
    throw new Error("job contract invalid: RESULT_WEBHOOK missing");
  }
  if (!secret) {
    throw new Error("job contract invalid: VAST_WEBHOOK_SECRET missing");
  }
  if (!Number.isFinite(httpPort) || httpPort <= 0 || httpPort > 65535) {
    throw new Error(`job contract invalid: HTTP_PORT=${httpPort}`);
  }

  return {
    jobId,
    webhookSecret: secret,
    resultWebhook: webhook,
    httpPort,
    sourceBucket,
    sourceRegion,
    resultBucket,
    jobTimeoutMs,
  };
}

/**
 * Laporkan worker `ready` ke webhook publik (mode IoC). Penanda agar
 * orchestrator melewati `waitForWorkerReady` — worker siap menerima/mengerjakan
 * job.
 */
function reportReady(jobId: string): void {
  if (!RESULT_WEBHOOK) {
    console.log(`[worker] job=${jobId} webhook URL not configured; skipping ready report`);
    return;
  }
  postWebhook({ jobId, status: "ready" });
}

/**
 * Jalankan job yang di-load dari env (mode IoC) tanpa menunggu dispatch
 * `POST /jobs`. Dipanggil saat worker booting (onstart) — tidak ada
 * orchestrator yang meneruskan payload.
 */
function runJobAtBoot(): void {
  const jobId = process.env.JOB_ID ?? "";
  const hasJob = HOTCLIP_JOB_ENV.trim().length > 0;

  if (!hasJob) {
    console.log("[worker] HOTCLIP_JOB tidak terdeteksi; berjalan sebagai HTTP server biasa");
    server.listen(HTTP_PORT, () => {
      console.log(`[worker] listening on :${HTTP_PORT} (strategy=vast, modelDir=${MODEL_DIR})`);
    });
    return;
  }

  // 1) Validasi env contract (injected by Main VPS / Vast.ai).
  const contract = ensureEnvContract();

  // 2) Laporkan ready → orchestrator melewati waitForWorkerReady.
  reportReady(contract.jobId);

  // 3) Parse payload + eksekusi pipeline.
  let job: JobPayload;
  try {
    job = resolveJobPayload(JSON.parse(HOTCLIP_JOB_ENV));
  } catch (error) {
    const failure: WebhookReport = {
      jobId: contract.jobId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    postWebhook(failure);
    console.error(`[worker] job=${contract.jobId} failed di-boot: ${failure.error}`);
    process.exit(1);
  }

  console.log(`[worker] job=${contract.jobId} boot-run (IoC mode) mulai`);
  void runPipeline(job).then((outcome) => {
    if (outcome.error) {
      console.error(`[worker] job=${contract.jobId} failed: ${outcome.error}`);
    } else {
      console.log(`[worker] job=${contract.jobId} boot-run selesai: ${outcome.exported.length} klip(s) diupload`);
    }
    reportWebhook(job, outcome);
  }).catch((error) => {
    console.error(`[worker] job=${contract.jobId} boot-run gagal: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/* ------------------------------------------------------------------------ */
/* Job payload contract (Main VPS → worker)                                 */
/* ------------------------------------------------------------------------ */

export interface JobPayload {
  id: string;
  sourceUrl?: string;
  sourceFile?: string;
  sourceBucket?: string;
  sourceRegion?: string;
  modelsRoot?: string;
  cacheDir?: string;
  renderCacheDir?: string;
  llm: { provider: string; config: Record<string, string> };
  maxClips?: number;
  clipLength?: "short" | "standard" | "long" | "extended";
  genre?: { id?: string; custom?: string };
  asr?: { engineId?: string; restart?: boolean; localServiceUrl?: string };
  glossary?: { wrong: string; right: string }[];
  subtitlePath?: string;
  vertical?: boolean;
  captions?: boolean;
  autoEnhance?: boolean;
  denoiseMode?: "basic" | "smart";
  reference?: unknown;
  reviewMemory?: unknown[];
  performanceMemory?: unknown[];
  timeout?: number;
  webhook?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
}

function resolveJobPayload(raw: unknown): JobPayload {
  if (!isRecord(raw)) throw new Error("job payload must be a JSON object");
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    throw new Error("job payload missing 'id'");
  }
  if (candidate.llm === undefined || candidate.llm === null || !isRecord(candidate.llm)) {
    throw new Error("job payload missing 'llm'");
  }
  return candidate as unknown as JobPayload;
}

/* ------------------------------------------------------------------------ */
/* Source media resolution (S3 pool or remote URL via yt-dlp)               */
/* ------------------------------------------------------------------------ */

function resolveSourceDir(job: JobPayload): string {
  return join(JOB_CACHE_DIR, job.id);
}

function extOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/")).split("?")[0];
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1) : "mp4";
}

function importSource(job: JobPayload, cwd: string): string {
  const target = resolveSourceDir(job);
  mkdirSync(target, { recursive: true });

  if (job.sourceFile && existsSync(job.sourceFile)) {
    const dest = join(target, `source-${Date.now()}.${extOf(job.sourceFile)}`);
    execFileSync("cp", ["-f", job.sourceFile, dest], { stdio: "pipe" });
    return dest;
  }

  if (job.sourceUrl) {
    const cmd = [
      "yt-dlp", "--no-part", "--no-cache-dir",
      "-o", join(target, "%(id)s.%(ext)s"),
      job.sourceUrl,
    ];
    execFileSync(cmd[0], cmd.slice(1), { cwd, stdio: "pipe" });
    const files = readDirFiles(target).filter((f) => /\.(mp4|mkv|mov|webm|m4v)$/i.test(f));
    if (files.length === 0) throw new Error("yt-dlp produced no media file");
    return join(target, files[0]);
  }

  throw new Error("no source media resolved (missing sourceUrl/sourceFile)");
}

function readDirFiles(dir: string): string[] {
  // Minimal readdir-walker used by the worker without adding a dependency.
  const out: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry);
      const st = statSync(entryPath);
      if (st.isDirectory()) out.push(...readDirFiles(entryPath));
      else if (st.isFile()) out.push(entryPath);
    }
  } catch {
    /* empty directory */
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Pipeline runner (shared src/shared/pipeline, strategy=vast)              */
/* ------------------------------------------------------------------------ */

interface PipelineOutcome {
  jobId: string;
  exported: ExportedClip[];
  outDir: string;
  error?: string;
}

function mapLlmConfig(job: JobPayload): LlmConfig {
  const cfg = job.llm as Record<string, unknown>;
  const baseUrl = (cfg.config as Record<string, unknown>)?.baseUrl;
  const apiKey = (cfg.config as Record<string, unknown>)?.apiKey;
  const model = (cfg.config as Record<string, unknown>)?.model;
  return {
    baseUrl: typeof baseUrl === "string" ? baseUrl : "http://localhost:11434/v1",
    apiKey: typeof apiKey === "string" ? apiKey : "",
    model: typeof model === "string" ? model : "default",
  };
}

function buildPipelineConfig(job: JobPayload): AutoClipConfig {
  return {
    modelsRoot: job.modelsRoot ?? MODEL_DIR,
    cacheDir: job.cacheDir ?? join(JOB_CACHE_DIR, job.id),
    renderCacheDir: job.renderCacheDir,
    llm: mapLlmConfig(job),
    maxClips: job.maxClips ?? 6,
    clipLength: job.clipLength,
    genre: job.genre,
    asr: job.asr ?? { engineId: "sensevoice", restart: false },
    glossary: job.glossary ?? [],
    subtitlePath: job.subtitlePath,
    vertical: job.vertical ?? true,
    captions: job.captions ?? true,
    autoEnhance: job.autoEnhance ?? true,
    denoiseMode: job.denoiseMode ?? "basic",
    reviewMemory: (job.reviewMemory ?? []) as ReviewRecord[],
    performanceMemory: (job.performanceMemory ?? []) as PerformanceEntry[],
    onStage: (stage: "transcribing" | "detecting" | "exporting") =>
      console.log(`[worker] job=${job.id} stage=${stage} strategy=vast`),
  };
}

async function runPipeline(job: JobPayload): Promise<PipelineOutcome> {
  // Repo checkout root (mounted read-only by the Main VPS). The pipeline,
  // model registry and output defaults resolve against this directory.
  const repoRoot = join(__dirname, "..", "..");
  const videoPath = importSource(job, repoRoot);
  const cfg = buildPipelineConfig(job);
  const started = Date.now();

  // Timeout aborts the whole clip flow (transcribe + detect + export).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);
  cfg.signal = controller.signal;

  try {
    const result = await autoClip(videoPath, cfg);
    return { jobId: job.id, exported: result.exported ?? [], outDir: result.outDir, error: undefined };
  } catch (error) {
    return {
      jobId: job.id,
      exported: [],
      outDir: cfg.cacheDir,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------ */
/* S3 upload (presigned PUT via AWS CLI v2)                                 */
/* ------------------------------------------------------------------------ */

function uploadExports(job: JobPayload, outcome: PipelineOutcome): Promise<void> {
  if (!RESULT_BUCKET) {
    console.log(`[worker] job=${job.id} no RESULT_BUCKET configured; skipping S3 upload`);
    return Promise.resolve();
  }
  return Promise.all(
    outcome.exported.map((clip) => {
      const key = `clips/${job.id}/${clip.id}.mp4`;
      return new Promise<void>((resolve, reject) => {
        try {
          const url = execFileSync(
            "aws",
            [
              "s3api", "create-presigned-url",
              "--bucket", RESULT_BUCKET,
              "--key", key,
              "--http-method", "PUT",
              "--expires-in", "600",
            ],
            { encoding: "utf8" }
          ).trim();
          execFileSync("curl", ["-X", "PUT", "--upload-file", clip.path, url], {
            stdio: ["ignore", "ignore", "pipe"],
          });
          console.log(`[worker] job=${job.id} uploaded s3://${RESULT_BUCKET}/${key}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    })
  ).then(() => undefined);
}

function uploadManifest(job: JobPayload, outcome: PipelineOutcome): Promise<void> {
  if (!RESULT_BUCKET) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    try {
      const key = `manifests/${job.id}.json`;
      const body = JSON.stringify(
        { jobId: job.id, exported: outcome.exported.length, strategy: "vast", outDir: outcome.outDir },
        null,
        2
      );
      const url = execFileSync(
        "aws",
        [
          "s3api", "create-presigned-url",
          "--bucket", RESULT_BUCKET,
          "--key", key,
          "--http-method", "PUT",
          "--expires-in", "600",
        ],
        { encoding: "utf8" }
      ).trim();
      execFileSync("curl", ["-X", "PUT", "--upload-file", "-", url], {
        input: body,
        stdio: ["ignore", "ignore", "pipe"],
      });
      console.log(`[worker] job=${job.id} uploaded s3://${RESULT_BUCKET}/${key}`);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * HMAC-SHA256 hex atas body persis yang dikirim (verifikasi server memakai
 * timing-safe compare, jadi body yang ditandatangani harus byte-identik).
 */
function signBody(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

interface WebhookReport {
  jobId: string;
  status: "ready" | "completed" | "failed";
  exported?: number;
  result?: string;
  error?: string;
  /** Metadata klip — orchestrator mem-presign `objectKey` untuk galeri. */
  clips?: {
    id: string;
    title: string;
    objectKey: string;
    sizeBytes: number;
    durationSec: number;
  }[];
}

function postWebhook(report: WebhookReport): void {
  if (!RESULT_WEBHOOK) {
    console.log(`[worker] job=${report.jobId} webhook URL not configured; skipping ${report.status} report`);
    return;
  }
  const body = JSON.stringify(report);
  fetch(RESULT_WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Wajib: handler webhook menolak 401 request tanpa signature.
      ...(WEBHOOK_SECRET ? { "x-signature": signBody(body) } : {}),
    },
    body,
  })
    .then((r) => {
      if (!r.ok) throw new Error(`webhook HTTP ${r.status}`);
      console.log(`[worker] job=${report.jobId} webhook reported ${report.status}`);
    })
    .catch((error) => console.error(`[worker] job=${report.jobId} webhook failed: ${error.message}`));
}

function reportWebhook(job: JobPayload, outcome: PipelineOutcome): void {
  if (!outcome.error && !RESULT_WEBHOOK) return;
  postWebhook({
    jobId: outcome.jobId,
    status: outcome.error ? "failed" : "completed",
    exported: outcome.exported.length,
    result: `s3://${RESULT_BUCKET}/clips/${outcome.jobId}`,
    error: outcome.error,
    // Metadata lengkap agar galeri terisi: `objectKey` sesuai pola upload
    // `clips/<jobId>/<clipId>.mp4` yang dipakai uploadExports().
    ...(outcome.error
      ? {}
      : {
          clips: outcome.exported.map((clip) => ({
            id: String(clip.id),
            title: clip.title,
            objectKey: `clips/${outcome.jobId}/${clip.id}.mp4`,
            sizeBytes: clip.sizeBytes,
            durationSec: clip.durationSec,
          })),
        }),
  });
}

/* ------------------------------------------------------------------------ */
/* HTTP server                                                              */
/* ------------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        strategy: process.env.HOTCLIP_STRATEGY,
        gpu: process.env.HOTCLIP_GPU,
        modelDir: MODEL_DIR,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/jobs") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let job: JobPayload;
    try {
      job = resolveJobPayload(JSON.parse(body));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return;
    }

    console.error(`[worker] received job ${job.id} (strategy=vast)`);
    let outcome: PipelineOutcome;
    try {
      outcome = await runPipeline(job);
    } catch (error) {
      outcome = { jobId: job.id, exported: [], outDir: "", error: error instanceof Error ? error.message : String(error) };
    }

    if (outcome.error) {
      console.error(`[worker] job ${job.id} failed: ${outcome.error}`);
    }

    // 1. upload exports → S3 pool
    uploadExports(job, outcome).catch((error) =>
      console.error(`[worker] job=${job.id} S3 upload failed: ${error.message}`)
    );

    // 2. upload manifest
    uploadManifest(job, outcome).catch((error) =>
      console.error(`[worker] job=${job.id} manifest upload failed: ${error.message}`)
    );

    // 3. webhook status
    reportWebhook(job, outcome);

    // 4. respond to the orchestrator
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: !outcome.error,
        jobId: outcome.jobId,
        exported: outcome.exported.length,
        error: outcome.error,
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

// Entry point. In IoC mode (VAST_INBOUND=1 / HOTCLIP_JOB set) the worker boots
// directly into the job: report `ready` to the orchestrator, then run the
// pipeline and POST `completed`/`failed` to the webhook. Otherwise it stays as
// a plain HTTP server (accepting `POST /jobs` from the orchestrator).
if (HOTCLIP_JOB_ENV.trim().length > 0) {
  runJobAtBoot();
} else {
  server.listen(HTTP_PORT, () => {
    console.log(`[worker] listening on :${HTTP_PORT} (strategy=vast, modelDir=${MODEL_DIR})`);
  });

  server.on("error", (error) => {
    console.error(`[worker] server error: ${error.message}`);
    process.exit(1);
  });
}
