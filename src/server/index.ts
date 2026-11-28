/**
 * Main HTTP server — menyatukan legacy API router, admin API extension,
 * log stream (`/logs/stream`), background poller, Vast.ai orchestration,
 * dan graceful shutdown.
 *
 * Node built-in `http` saja; tidak ada framework. Handler lama di `./api`
 * TIDAK diubah — server ini hanya men-delegasikan request.
 */

import { createServer as httpCreateServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { createApiRouter, type ApiRouterOptions } from "./api";
import { createApiExtRouter } from "./api-ext";
import type { PoolManager } from "./storage/pool-manager";
import { Orchestrator } from "./orchestrator";
import { VastInstanceBlocklist, VastManager } from "./vast-client";
import { createStore, type DataStore } from "./store";
import { createAdminStore } from "./admin-store";
import { createPublicApiRouter } from "./public-api";
import { createPublicStore, type PublicStoreDriver } from "./public-store";
import { JobQueue } from "./queue";
import { AuditLogger } from "./audit";
import { createManagedPool } from "./storage/managed-pool";
import { handleClerkWebhook } from "./webhook-clerk";
import { enforceAdminSessionResult } from "./admin-auth";

export type { DataStore } from "./store";

export interface MainServerOptions {
  hostname?: string;
  port?: number;
  /** Token Bearer untuk legacy API dan admin API. */
  authToken?: string;
  /** Pool manager opsional untuk endpoint admin storage & presign upload. */
  poolManager?: PoolManager;
  /** Presigner S3 nyata (biasanya `poolManager.presignPut`). */
  presigner?: (
    key: string,
  ) => Promise<{ url: string; method: string; headers: Record<string, string> }>;
  /** Interval background poller (ms). Default 5000. */
  pollIntervalMs?: number;
  /** Aktifkan log tick ringkas ke console. Default false. */
  logStream?: boolean;
  /** Store persisten opsional (job/audit/queue). */
  store?: DataStore;
  /** Orchestrator Vast.ai optional (di-wire dari `main()`). */
  orchestrator?: Orchestrator;
  /** Bridge Vast.ai untuk provisioning otomatis saat job masuk. */
  vastManager?: VastManager;
  /** Blocklist instance Vast.ai (dipakai watchdog & timeout cleanup). */
  vastBlocklist?: VastInstanceBlocklist;
  /** Secret sesi untuk cookie/session (diteruskan ke api router). */
  sessionSecret?: string;
  /**
   * Store publik studio (PostgREST bila Supabase diset, selain itu in-memory).
   * Diinjeksi oleh test; `main()` membiarkannya agar `createMainServer`
   * memilih adapter dari env.
   */
  publicStore?: PublicStoreDriver;
}

export interface MainServerHandle {
  server: ReturnType<typeof httpCreateServer>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Membuat server utama. `start()` mendengarkan `port`/`hostname`,
 * `stop()` menutup semua timer & koneksi secara graceful.
 */
export function createMainServer(opts: MainServerOptions = {}): MainServerHandle {
  const hostname = opts.hostname ?? "0.0.0.0";
  const port = opts.port ?? 8080;
  const authToken = opts.authToken;
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const sessionSecret = opts.sessionSecret ?? process.env.SESSION_SECRET;

  // Wiring Vast.ai: orchestrator memakai bridge yang sama dengan server agar
  // provisioning otomatis (bukan hanya cleanup) berjalan saat job masuk.
  if (opts.orchestrator && opts.vastManager) {
    opts.orchestrator.attachVastManager(opts.vastManager, opts.vastBlocklist);
  }

  const auditLogger = new AuditLogger(opts.store);
  const queue = new JobQueue({ store: opts.store });

  // Guard admin untuk SEMUA permukaan `/api/admin/*` (router legacy maupun
  // router v1). `enforceAdminSessionResult()` menolak request bila tidak ada
  // satu pun kredensial admin dikonfigurasi, jadi konsol selalu fail-closed
  // dan tidak pernah jatuh ke "hanya AUTH_TOKEN" (yang bisa kosong).
  type AdminGuard = NonNullable<ApiRouterOptions["adminGuard"]>;
  const adminGuard: AdminGuard = async (req) => {
      const outcome = await enforceAdminSessionResult(req);
      if (outcome.ok && outcome.identity) {
        return {
          ok: true as const,
          userId: outcome.identity.userId,
          email: outcome.identity.email,
        };
      }
      return {
        ok: false as const,
        status: outcome.status,
        error: outcome.reason || "admin session check failed",
      };
    };

  const legacyRouter = createApiRouter({
    apiToken: authToken,
    store: opts.store,
    orchestrator: opts.orchestrator,
    queue,
    audit: auditLogger,
    sessionSecret,
    presigner: opts.presigner,
    adminGuard,
  });
  // Peringatan saja: guard di atas sudah fail-closed tanpa konfigurasi admin.
  const adminConfigured = Boolean(
    process.env.ADMIN_EMAILS?.trim() ||
      process.env.ADMIN_CLERK_USER_IDS?.trim() ||
      process.env.ADMIN_2FA_SECRET?.trim() ||
      process.env.CLERK_SECRET_KEY?.trim(),
  );
  if (!adminConfigured) {
    console.warn(
      "[main] admin security layers NOT configured (ADMIN_EMAILS/ADMIN_CLERK_USER_IDS/ADMIN_2FA_SECRET/CLERK_SECRET_KEY kosong) — /api/admin/* menolak semua request (fail-closed)",
    );
  }
  const adminStore = createAdminStore();
  const adminRouter = createApiExtRouter({
    apiToken: authToken,
    poolManager: opts.poolManager,
    adminStore,
    // Always-on guard shared with the v1 router (see `adminGuard` above).
    adminGuard,
  });

  // Public studio API (/api/v1/public/* + SSE /logs/:jobId) — identitas
  // anonim, tanpa token. Dispatch bridge: provisionAndDispatch bila Vast.ai
  // aktif, jalur dispatchJob lama bila tidak.
  const publicStore = opts.publicStore ?? createPublicStore();
  const publicRouter = createPublicApiRouter({
    store: publicStore,
    presigner: opts.presigner,
    ...(opts.orchestrator
      ? {
          dispatchJob: (job) => opts.orchestrator!.provisionAndDispatch(job),
        }
      : {}),
  });
  // Laporan worker (webhook) langsung di-persist: status job + klip ke
  // tabel `clips` sehingga galeri studio terisi otomatis.
  opts.orchestrator?.attachPublicStore(publicStore);

  // Webhook worker GPU: POST /api/v1/worker/webhook (HMAC-SHA256).
  const workerWebhook = opts.orchestrator
    ? Orchestrator.createWebhookHandler(opts.orchestrator)
    : null;

  const server: Server = httpCreateServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("[main] request error:", error);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "internal error" }));
      }
    });
  });

  const startedAt = Date.now();
  let requestCount = 0;
  let started = false;
  let stopped = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let stopPromise: Promise<void> | null = null;

  /** Cleanup function untuk setiap stream SSE yang masih terbuka. */
  const streamCleanups = new Set<() => void>();

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requestCount += 1;
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/logs/stream") {
      handleLogStream(req, res, url);
      return;
    }

    // Router admin juga melayani katalog harga publik (`/api/packages`),
    // yang dibaca halaman `/pricing` sebelum ada sesi apa pun.
    if (
      url.pathname === "/api/admin" ||
      url.pathname.startsWith("/api/admin/") ||
      (req.method === "GET" && url.pathname === "/api/packages")
    ) {
      await adminRouter(req, res);
      return;
    }

    // Webhook Clerk (signature svix) — harus sebelum router lain agar
    // tidak tertelan handler fallback.
    if (req.method === "POST" && url.pathname === "/api/webhooks/clerk") {
      await handleClerkWebhook(req, res);
      return;
    }

    // Webhook worker GPU (HMAC) — sebelum router publik agar tidak tertelan.
    if (workerWebhook && url.pathname === "/api/v1/worker/webhook") {
      await workerWebhook(req, res);
      return;
    }

    // Public studio API: `/api/v1/public/*` + SSE `/logs/:jobId`.
    // `/logs/stream` sudah ditangani di atas, jadi cabang `/logs/` di sini
    // hanya untuk stream log per-job (EventSource tidak mengirim header).
    if (
      url.pathname === "/api/v1/public" ||
      url.pathname.startsWith("/api/v1/public/") ||
      url.pathname.startsWith("/logs/")
    ) {
      await publicRouter(req, res);
      return;
    }

    await legacyRouter(req, res);
  }

  /**
   * Log stream ala SSE/NDJSON:
   *   - `?instance=<id>` + `vastManager` tersedia -> baris `instance-logs`
   *     setiap 5 detik (isi `vastManager.logs(id, 120)`).
   *   - selain itu -> heartbeat setiap 2 detik (perilaku lama).
   * Tanpa auth wajib; bila `authToken` diset dan query `?token=` dikirim,
   * token tersebut harus cocok.
   */
  function handleLogStream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const queryToken = url.searchParams.get("token");
    if (authToken && queryToken !== null && queryToken !== authToken) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const instanceId = url.searchParams.get("instance");
    const vastManager = opts.vastManager;
    const streamInstance = Boolean(instanceId && vastManager);

    const writeLine = (record: Record<string, unknown>): void => {
      if (res.writableEnded) return;
      res.write(JSON.stringify(record) + "\n");
    };

    const writeHeartbeat = (): void => {
      writeLine({ type: "heartbeat", at: new Date().toISOString() });
    };

    const writeInstanceLogs = (): void => {
      if (!instanceId || !vastManager) {
        writeHeartbeat();
        return;
      }
      void vastManager
        .logs(instanceId, 120)
        .then((output) => {
          writeLine({
            type: "instance-logs",
            at: new Date().toISOString(),
            instanceId,
            lines: typeof output === "string" ? output.split(/\r?\n/) : [],
          });
        })
        .catch((error: unknown) => {
          writeLine({
            type: "instance-logs",
            at: new Date().toISOString(),
            instanceId,
            lines: [],
            error: error instanceof Error ? error.message : String(error),
          });
        });
    };

    if (streamInstance) {
      writeInstanceLogs();
    } else {
      writeHeartbeat();
    }
    const timer = setInterval(
      streamInstance ? writeInstanceLogs : writeHeartbeat,
      streamInstance ? 5000 : 2000,
    );
    // Jangan menahan event loop hanya karena stream ini.
    timer.unref?.();

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(timer);
      streamCleanups.delete(cleanup);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          // Koneksi sudah tertutup; abaikan.
        }
      }
    };

    streamCleanups.add(cleanup);
    res.on("close", cleanup);
    // `req` 'close' pada Node bisa berarti request selesai dibaca; hanya
    // bersihkan lewat jalur ini bila koneksi benar-benar putus.
    req.on("close", () => {
      if (res.destroyed || res.writableEnded) cleanup();
    });
  }

  /** Background poller ringkas (unref agar tidak menahan proses exit). */
  pollTimer = setInterval(() => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    console.log(`[main] tick uptime=${uptimeSec}s requests=${requestCount}`);
  }, pollIntervalMs);
  pollTimer.unref?.();

  async function start(): Promise<void> {
    if (started && server.listening) return;
    if (stopped) {
      throw new Error("server already stopped");
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, hostname);
    });

    started = true;
    console.log(`[main] listening on http://${hostname}:${port}`);
  }

  const onSignal = (): void => {
    void stop().then(() => process.exit(0));
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  async function stop(): Promise<void> {
    if (stopPromise) return stopPromise;

    stopPromise = (async () => {
      stopped = true;

      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      for (const cleanup of [...streamCleanups]) {
        cleanup();
      }
      streamCleanups.clear();

      // Hentikan worker queue & watchdog Vast.ai sebelum koneksi ditutup.
      try {
        queue.stop();
      } catch {
        // Best-effort: queue legacy tidak punya stop().
      }
      try {
        opts.orchestrator?.stopAllWatchdogs();
      } catch {
        // Best-effort.
      }

      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);

      if (server.listening) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }

      console.log("[main] shutdown complete");
    })();

    return stopPromise;
  }

  return { server, start, stop };
}

/** Worker client HTTP untuk `Orchestrator`: POST JSON ke worker Vast.ai. */
function createFetchWorkerClient(): {
  post(url: string, body: unknown): Promise<unknown>;
} {
  return {
    async post(url: string, body: unknown): Promise<unknown> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) {
        throw new Error(`worker POST ${url} failed: HTTP ${response.status}`);
      }
      const text = await response.text();
      if (text.trim().length === 0) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  };
}

/**
 * Entry point programatik: baca env `HOST`, `PORT`, `AUTH_TOKEN`,
 * `POLL_INTERVAL_MS`, `LOG_STREAM`, plus env Vast.ai (`VAST_API_KEY`,
 * `VAST_PYTHON_PATH`, `VAST_SCRIPT_PATH`, `VAST_WEBHOOK_SECRET`,
 * `VAST_JOB_TIMEOUT_MS`, `WORKER_WEBHOOK_BASE_URL`), lalu jalankan server.
 * Semua wiring Vast.ai best-effort: env kosong -> server tetap jalan.
 */
export async function main(): Promise<void> {
  const hostname = process.env.HOST ?? "0.0.0.0";
  const parsedPort = Number.parseInt(process.env.PORT ?? "8080", 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8080;
  const authToken = process.env.AUTH_TOKEN;
  const parsedPoll = Number.parseInt(process.env.POLL_INTERVAL_MS ?? "5000", 10);
  const pollIntervalMs =
    Number.isFinite(parsedPoll) && parsedPoll > 0 ? parsedPoll : 5000;
  const logStream = (process.env.LOG_STREAM ?? "false").toLowerCase() === "true";
  const sessionSecret = process.env.SESSION_SECRET;
  const workerBase =
    process.env.WORKER_WEBHOOK_BASE_URL ?? "http://localhost:8080";

  // Store persisten: PostgREST bila env Supabase tersedia, selain itu
  // InMemoryStore (dev lokal).
  const store = createStore();

  // PoolManager nyata: membaca `storage_providers` aktif dari Supabase
  // (fallback env `S3_*` bila tabel kosong), menghasilkan presigned URL
  // SigV4 asli, dan memilih bucket dengan ruang kosong terbesar.
  const managedPool = createManagedPool();

  // Bridge Vast.ai opsional — hanya dibuat bila API key tersedia.
  const vastApiKey = process.env.VAST_API_KEY;
  let vastManager: VastManager | undefined;
  let vastBlocklist: VastInstanceBlocklist | undefined;
  let orchestrator: Orchestrator | undefined;

  if (vastApiKey) {
    vastBlocklist = new VastInstanceBlocklist();
    vastManager = new VastManager({
      apiKey: vastApiKey,
      pythonPath: process.env.VAST_PYTHON_PATH,
      scriptPath: process.env.VAST_SCRIPT_PATH,
      blocklist: vastBlocklist,
    });

    const parsedTimeout = Number.parseInt(
      process.env.VAST_JOB_TIMEOUT_MS ?? "3600000",
      10,
    );
    const jobTimeoutMs =
      Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 3_600_000;

    orchestrator = new Orchestrator(
      managedPool.poolManager,
      createFetchWorkerClient(),
      process.env.VAST_WEBHOOK_SECRET ?? "",
      jobTimeoutMs,
      15_000,
      vastManager,
      vastBlocklist,
    );
  }

  const instance = createMainServer({
    hostname,
    port,
    authToken,
    pollIntervalMs,
    logStream,
    store,
    orchestrator,
    vastManager,
    vastBlocklist,
    sessionSecret,
    poolManager: managedPool.poolManager,
    presigner: async (key) => {
      const presigned = await managedPool.poolManager.presignPut(key);
      return {
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
      };
    },
  });

  // Health-check periodik provider storage (endpoint reachability + kapasitas)
  // lalu persist health_status ke `storage_providers` (best-effort).
  const poolHealthTimer = setInterval(() => {
    void managedPool
      .refreshHealth()
      .catch((error) =>
        console.warn(
          "[main] storage pool health refresh failed:",
          error instanceof Error ? error.message : error,
        ),
      );
  }, 60_000);
  poolHealthTimer.unref?.();

  // `workerBase` sengaja dibaca dari env pada waktu konstruksi Orchestrator;
  // logging agar operator tahu target worker aktif.
  if (orchestrator) {
    console.log(`[main] vast orchestrator enabled (worker base ${workerBase})`);
  }

  await instance.start();
}

/**
 * Entrypoint modul: jalankan server ketika file ini dieksekusi langsung
 * (`tsx src/server/index.ts`, `node dist/server/index.js`) — bukan saat
 * di-import oleh test. Tanpa ini container produksi keluar diam-diam.
 */
if (isDirectExecution()) {
  main().catch((error: unknown) => {
    console.error(
      "[main] fatal:",
      error instanceof Error ? error.stack ?? error.message : error,
    );
    process.exitCode = 1;
  });
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    if (import.meta.url === pathToFileURL(entry).href) return true;
  } catch {
    // Bukan file path (bundler/VM) — jatuh ke heuristik di bawah.
  }
  return /(?:^|[\\/])src[\\/]server[\\/]index\.(?:ts|js)$/.test(entry);
}
