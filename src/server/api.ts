/**
 * Internal HTTP API router (Node built-in `http`, no framework).
 *
 * Routes:
 *   GET  /api/health        -> 200 { ok: true }  (no auth)
 *   POST /api/v1/jobs       -> 201 { jobId }     (Bearer token required)
 *   GET  /api/v1/jobs/:id   -> 200 / 404
 *
 * Rate limiting: `POST /api/v1/jobs` is capped per client IP.
 *
 * Run with:  pnpm typecheck && pnpm test
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomUUID } from "crypto";
import { createApiExtRouter } from "./api-ext";
import { createApiV1Router } from "./api-v1";
import type { AuditLogger } from "./audit";
import type { JobQueue } from "./queue";
import type { DataStore } from "./store";
import { verifyClerkSession } from "./clerk-auth";

export interface JobRecord {
  id: string;
  payload: unknown;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed";
}

export interface ApiRouterOptions {
  /**
   * Guard sesi admin untuk `/api/admin/*`. Bila tidak diset, router memakai
   * guard deny-all (fail-closed) — jadi melupakan wiring akan menutup akses,
   * bukan membukanya. Lihat `enforceAdminSessionResult()` di `admin-auth.ts`.
   */
  adminGuard?: (req: IncomingMessage) => Promise<
    | { ok: true; userId: string; email: string }
    | { ok: false; status: 401 | 403; error: string }
  >;

  /** If set, every `/api/v1/*` route requires `Authorization: Bearer <token>`. */
  apiToken?: string;
  /** Rate limiter config. */
  rateLimit?: {
    maxRequests: number; // default 5
    windowMs: number; // default 60_000
  };
  /**
   * Bila diset, router v1 (`api-v1.ts`) diaktifkan dan path v1/alias web
   * didelegasikan ke sana. Tanpa `store`, perilaku legacy tidak berubah.
   */
  store?: DataStore;
  orchestrator?: {
    dispatchJob(job: {
      id: string;
      sourceUrl?: string;
      sourceFile?: string;
      maxClips?: number;
    }): Promise<unknown>;
  };
  queue?: JobQueue;
  audit?: AuditLogger;
  sessionSecret?: string;
  /** Presigner S3 nyata untuk upload langsung (wired ke `api-v1`). */
  presigner?: (
    key: string,
  ) => Promise<{ url: string; method: string; headers: Record<string, string> }>;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void>;

/**
 * Builds an HTTP request handler that dispatches to the registered routes.
 * The returned handler is compatible with `http.createServer(router)`.
 */
/**
 * Fail-closed default for `/api/admin/*`: when no session guard is wired the
 * console answers 403 instead of relying on a possibly-empty `AUTH_TOKEN`.
 */
const denyAllAdmin: NonNullable<ApiRouterOptions["adminGuard"]> = async () => ({
  ok: false,
  status: 403,
  error: "admin access disabled (no admin guard configured)",
});

export function createApiRouter(opts: ApiRouterOptions = {}): RouteHandler {
  const jobs = new Map<string, JobRecord>();
  const rateLimits = new Map<string, number[]>();

  const apiToken = opts.apiToken ?? "";
  const maxRequests = opts.rateLimit?.maxRequests ?? 5;
  const windowMs = opts.rateLimit?.windowMs ?? 60_000;

  function clientKey(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? "unknown";
  }

  function isRateLimited(req: IncomingMessage): boolean {
    const key = clientKey(req);
    const now = Date.now();
    const cutOff = now - windowMs;
    const timestamps = rateLimits.get(key) ?? [];
    const recent = timestamps.filter((t) => t > cutOff);

    if (recent.length >= maxRequests) {
      rateLimits.set(key, recent);
      return true;
    }
    recent.push(now);
    rateLimits.set(key, recent);
    return false;
  }

  async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  async function handleJobsPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Clerk session boundary: bila `CLERK_SECRET_KEY` diset, /api/v1/jobs
    // wajib menyertakan session Clerk yang valid. Tanpa secret (dev/legacy)
    // perilaku lama dipertahankan agar tooling lokal tetap jalan.
    if (process.env.CLERK_SECRET_KEY) {
      const clerk = await verifyClerkSession(req);
      if (!clerk) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
    }

    // Expensive endpoint is rate-limited: 5 rapid requests -> 6th gets 429.
    if (isRateLimited(req)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "rate limit exceeded" }));
      return;
    }

    if (apiToken) {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== apiToken) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    const payload = body ? JSON.parse(body) : undefined;

    const id = randomUUID();
    const record: JobRecord = {
      id,
      payload,
      createdAt: new Date().toISOString(),
      status: "queued",
    };
    jobs.set(id, record);

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobId: id, status: record.status }));
  }

  async function handleJobsGet(
    _req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> {
    const record = jobs.get(params.id);
    if (!record) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobId: record.id, status: record.status }));
  }

  // Extended admin API (`/api/admin/*`) — wallet/topup, storage pools,
  // Vast.ai instances, dan profil user. Guard sesi admin WAJIB disuntikkan
  // oleh pemanggil (lihat `index.ts` → `enforceAdminSessionResult`); router
  // ini menolak berjalan tanpa guard agar `/api/admin/*` tidak pernah hanya
  // bergantung pada `AUTH_TOKEN` yang bisa kosong.
  const apiExtRouter = createApiExtRouter({
    apiToken: opts.apiToken,
    adminGuard: opts.adminGuard ?? denyAllAdmin,
  });

  // API v1 (persisten) hanya aktif bila store disediakan. Semua path
  // legacy di bawah tetap utuh ketika `store` tidak diset.
  const apiV1Router = opts.store
    ? createApiV1Router({
        store: opts.store,
        orchestrator: opts.orchestrator,
        queue: opts.queue,
        audit: opts.audit,
        apiToken: opts.apiToken,
        sessionSecret: opts.sessionSecret,
        presigner: opts.presigner,
      })
    : null;

  /** Path yang ditangani router v1 (termasuk alias tanpa prefix). */
  function isApiV1Path(pathname: string): boolean {
    const paths = [pathname];
    if (pathname.startsWith("/api/v1/")) {
      paths.push(pathname.slice("/api/v1".length));
    }

    return paths.some((path) => {
      if (path === "/api/v1/jobs" || path.startsWith("/api/v1/jobs/")) return true;
      if (path.startsWith("/api/v1/uploads/")) return true;
      if (path.startsWith("/api/v1/auth/")) return true;
      if (path === "/api/v1/wallet" || path.startsWith("/api/v1/wallet/")) return true;
      if (path === "/api/v1/topups" || path.startsWith("/api/v1/topups/")) return true;
      if (path === "/api/v1/vast-instances" || path.startsWith("/api/v1/vast-instances/")) {
        return true;
      }

      // Alias kompatibilitas web (tanpa prefix /api/v1).
      if (path === "/jobs" || path.startsWith("/jobs/")) return true;
      if (path.startsWith("/auth/")) return true;
      if (path === "/wallet" || path.startsWith("/wallet/")) return true;
      if (path === "/topups" || path.startsWith("/topups/")) return true;
      if (path === "/vast-instances" || path.startsWith("/vast-instances/")) return true;
      return false;
    });
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    // `/api/packages` (katalog harga publik) ditangani router admin tanpa
    // guard sesi, jadi ikut didelegasikan di sini.
    if (
      pathname === "/api/admin" ||
      pathname.startsWith("/api/admin/") ||
      (req.method === "GET" && pathname === "/api/packages")
    ) {
      return apiExtRouter(req, res);
    }

    if (req.method === "GET" && pathname === "/api/health") {
      return handleHealth(req, res);
    }

    if (apiV1Router && isApiV1Path(pathname)) {
      return apiV1Router(req, res);
    }

    if (req.method === "POST" && pathname === "/api/v1/jobs") {
      return handleJobsPost(req, res);
    }

    const jobsMatch = pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobsMatch) {
      return handleJobsGet(req, res, { id: jobsMatch[1] });
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  };
}

/**
 * Convenience: attach the router to a bare HTTP server.
 * Used by both the API route and the worker server — no framework needed.
 */
export function mountRouter(router: RouteHandler, port: number): ReturnType<typeof createServer> {
  const server = createServer(router);
  server.listen(port, () => {
    const addr = server.address();
    if (typeof addr === "number") {
      console.log(`[api] listening on :${addr}`);
    } else {
      console.log(`[api] listening on ${server.address()}`);
    }
  });
  return server;
}
