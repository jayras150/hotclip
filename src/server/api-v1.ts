/**
 * API v1 — auth sesi, uploads presign, jobs, wallet/topups, Vast.ai.
 *
 * Envelope respons: `{ ok: boolean, data?: ..., error?: string }`.
 * Router menerima path ber-prefix `/api/v1/...` maupun alias tanpa prefix
 * (`/auth/...`, `/jobs...`, `/wallet/...`, `/topups...`,
 * `/vast-instances...`) untuk kompatibilitas web lama.
 *
 * Node built-in `http` saja. Token sesi = HMAC-SHA256(base64url payload).
 *
 * Verifikasi: `npx tsc --noEmit -p tsconfig.node.json`
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteHandler } from "./api";
import { AuditLogger, createRateLimiter } from "./audit";
import type { JobQueue } from "./queue";
import type { DataStore, JobRow, JobStatus } from "./store";
import { verifyClerkSession, type ClerkSession } from "./clerk-auth";
import { verifyTurnstile } from "./turnstile";
import { createUserRateLimiter, type UserRateLimiter } from "./rate-limiter";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface ApiV1Options {
  store: DataStore;
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
  apiToken?: string;
  sessionSecret?: string;
  /**
   * Presigner S3 nyata untuk upload langsung (dari `PoolManager.presignPut`).
   * Bila tidak diset / gagal, endpoint memakai URL demo agar tetap responsif.
   */
  presigner?: (
    key: string,
  ) => Promise<{ url: string; method: string; headers: Record<string, string> }>;
}

interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

interface StoredUser extends SessionUser {
  passwordHash: string;
}

interface TokenClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PAYMENT_GATEWAYS = ["midtrans", "xendit", "tripay", "manual"] as const;
const JOB_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timeout",
];

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

function normalizePath(pathname: string): string {
  if (pathname === "/api/v1" || pathname === "/api/v1/") return "/";
  if (pathname.startsWith("/api/v1/")) return pathname.slice("/api/v1".length);
  return pathname;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { ok: false, error });
}

function sendData(res: ServerResponse, status: number, data: unknown): void {
  sendJson(res, status, { ok: true, data });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "payload too large");
    }
    chunks.push(buf);
  }

  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

function userAgent(req: IncomingMessage): string | undefined {
  const header = req.headers["user-agent"];
  return typeof header === "string" ? header : undefined;
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
}

function storageEndpoint(): string {
  const raw =
    process.env.STORAGE_ENDPOINT ??
    process.env.S3_ENDPOINT ??
    "storage.local";
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function storageBucket(): string {
  return process.env.STORAGE_BUCKET ?? process.env.S3_BUCKET ?? "hotclip-media";
}

function demoDownloadUrl(bucket: string, objectKey: string): string {
  return `https://${storageEndpoint()}/${bucket}/${objectKey}?X-Amz-Signature=demo`;
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

/**
 * Membuat handler HTTP untuk API v1. Handler kompatibel dengan
 * `http.createServer(handler)`.
 */
export function createApiV1Router(opts: ApiV1Options): RouteHandler {
  const store = opts.store;
  const orchestrator = opts.orchestrator;
  const queue = opts.queue;
  const audit = opts.audit ?? new AuditLogger(store);
  const apiToken = opts.apiToken ?? "";
  const sessionSecret =
    opts.sessionSecret ?? process.env.AUTH_TOKEN ?? "dev-secret";
  const isRateLimited = createRateLimiter({ maxRequests: 60, windowMs: 60_000 });

  // Rate limit ketat per userId (anti-spam) — aktif bila env diset.
  // Default 5/menit, 50/hari; env menimpa nilainya.
  const userRateLimiter: UserRateLimiter | null =
    process.env.RATE_LIMIT_USER_PER_MINUTE || process.env.RATE_LIMIT_USER_PER_DAY
      ? createUserRateLimiter({
          maxPerMinute: parseEnvInt("RATE_LIMIT_USER_PER_MINUTE", 5),
          maxPerDay: parseEnvInt("RATE_LIMIT_USER_PER_DAY", 50),
        })
      : null;

  /** Clerk session hasil verifikasi di dispatch, dipakai handler jobs. */
  const clerkSessions = new WeakMap<IncomingMessage, ClerkSession>();

  /** email -> user (in-memory, cukup untuk fase API ini). */
  const users = new Map<string, StoredUser>();
  /** token -> user (sesi aktif). */
  const sessions = new Map<string, SessionUser>();

  /* --------------------------- token --------------------------- */

  function hashPassword(email: string, password: string): string {
    return createHash("sha256")
      .update(`${email}:${password}:${sessionSecret}`)
      .digest("hex");
  }

  function issueToken(user: SessionUser): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: TokenClaims = {
      sub: user.id,
      email: user.email,
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
    };
    const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signature = createHmac("sha256", sessionSecret)
      .update(body)
      .digest("base64url");
    return `${body}.${signature}`;
  }

  function verifyToken(token: string): TokenClaims | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, signature] = parts;
    if (!body || !signature) return null;

    const expected = createHmac("sha256", sessionSecret)
      .update(body)
      .digest("base64url");
    const givenBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (givenBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(givenBuffer, expectedBuffer)) return null;

    try {
      const claims = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as Partial<TokenClaims>;
      if (
        typeof claims.sub !== "string" ||
        typeof claims.email !== "string" ||
        typeof claims.exp !== "number"
      ) {
        return null;
      }
      if (claims.exp * 1000 <= Date.now()) return null;
      return {
        sub: claims.sub,
        email: claims.email,
        iat: typeof claims.iat === "number" ? claims.iat : 0,
        exp: claims.exp,
      };
    } catch {
      return null;
    }
  }

  function currentUser(req: IncomingMessage): SessionUser | null {
    const token = bearerToken(req);
    if (!token) return null;

    const session = sessions.get(token);
    if (session) return session;

    if (apiToken && token === apiToken) {
      return { id: "admin", email: "admin@local" };
    }

    const claims = verifyToken(token);
    if (!claims) return null;
    return { id: claims.sub, email: claims.email };
  }

  function currentUserId(req: IncomingMessage): string {
    // Sesi Clerk diprioritaskan di atas token legacy, lalu anonymous.
    return clerkSessions.get(req)?.userId ?? currentUser(req)?.id ?? "anonymous";
  }

  async function auditEvent(
    req: IncomingMessage,
    action: string,
    entity: string,
    entityId?: string,
    details?: unknown,
    userId?: string,
  ): Promise<void> {
    await audit.log({
      action,
      entity,
      entityId,
      userId: userId ?? currentUser(req)?.id,
      ip: req.socket.remoteAddress,
      userAgent: userAgent(req),
      details,
    });
  }

  /* --------------------------- handlers --------------------------- */

  async function handleRegister(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) throw new HttpError(400, "invalid body");

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email.includes("@")) throw new HttpError(400, "a valid email is required");

    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) {
      throw new HttpError(400, "password must be at least 8 characters");
    }
    if (users.has(email)) throw new HttpError(400, "email already registered");

    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : email.split("@")[0];

    const user: StoredUser = {
      id: randomUUID(),
      email,
      name,
      passwordHash: hashPassword(email, password),
    };
    users.set(email, user);

    const publicUser: SessionUser = { id: user.id, email: user.email, name: user.name };
    const token = issueToken(publicUser);
    sessions.set(token, publicUser);

    await auditEvent(req, "auth.register", "user", user.id, undefined, user.id);
    sendData(res, 201, { user: publicUser, token });
  }

  async function handleLogin(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) throw new HttpError(400, "invalid body");

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) throw new HttpError(400, "email and password are required");

    const user = users.get(email);
    if (!user || user.passwordHash !== hashPassword(email, password)) {
      throw new HttpError(401, "invalid email or password");
    }

    const publicUser: SessionUser = { id: user.id, email: user.email, name: user.name };
    const token = issueToken(publicUser);
    sessions.set(token, publicUser);

    await auditEvent(req, "auth.login", "user", user.id, undefined, user.id);
    sendData(res, 200, { user: publicUser, token });
  }

  async function handleOAuth(
    req: IncomingMessage,
    res: ServerResponse,
    provider: "google" | "github",
  ): Promise<void> {
    const configured =
      provider === "google"
        ? process.env.GOOGLE_CLIENT_ID ?? process.env.OAUTH_GOOGLE_CLIENT_ID
        : process.env.GITHUB_CLIENT_ID ?? process.env.OAUTH_GITHUB_CLIENT_ID;

    if (!configured) {
      sendError(res, 501, "oauth provider not configured");
      return;
    }

    const user: SessionUser = {
      id: randomUUID(),
      email: `${provider}-${randomUUID().slice(0, 8)}@oauth.local`,
      name: provider === "google" ? "Google User" : "GitHub User",
    };
    const token = issueToken(user);
    sessions.set(token, user);

    await auditEvent(req, `auth.oauth.${provider}`, "user", user.id, undefined, user.id);
    sendData(res, 200, { user, token });
  }

  async function handleSignOut(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const token = bearerToken(req);
    if (token) sessions.delete(token);
    await auditEvent(req, "auth.sign-out", "session", token ? token.slice(0, 8) : undefined);
    sendData(res, 200, { signedOut: true });
  }

  async function handleMe(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "unauthorized");
    sendData(res, 200, { user });
  }

  async function handlePresign(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) throw new HttpError(400, "invalid body");

    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    if (fileName.trim().length === 0) throw new HttpError(400, "fileName is required");

    const contentType =
      typeof body.contentType === "string" && body.contentType.length > 0
        ? body.contentType
        : "application/octet-stream";

    const userId = currentUserId(req);
    const objectKey = `uploads/${userId}/${randomUUID()}-${sanitizeFileName(fileName)}`;

    // Presigned URL nyata dari storage pool (S3-compatible SigV4). Fallback ke
    // URL demo bila pool belum dikonfigurasi, agar endpoint tetap 200.
    let presigned: { url: string; method: string; headers: Record<string, string> } | null =
      null;
    if (opts.presigner) {
      try {
        presigned = await opts.presigner(objectKey);
      } catch (error) {
        console.warn(
          "[api-v1] presign upload fallback:",
          error instanceof Error ? error.message : error,
        );
      }
    }
    const uploadUrl = presigned?.url ?? demoDownloadUrl(storageBucket(), objectKey);
    const method = presigned?.method ?? "PUT";

    await auditEvent(req, "uploads.presign", "upload", objectKey, { contentType });
    sendData(res, 200, {
      uploadUrl,
      objectKey,
      method,
      headers: presigned?.headers ?? {},
    });
  }

  async function handleJobsList(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const session = clerkSessions.get(req);
    const user = currentUser(req);
    const sessionUser = bearerToken(req) ? sessions.get(bearerToken(req) as string) : undefined;
    const scopedUserId =
      session?.userId ??
      sessionUser?.id ??
      (user && user.id !== "admin" ? user.id : undefined);

    let jobs = await store.listJobs(scopedUserId);
    const statusFilter = url.searchParams.get("status");
    if (statusFilter && isJobStatus(statusFilter)) {
      jobs = jobs.filter((job) => job.status === statusFilter);
    }
    sendData(res, 200, jobs);
  }

  async function handleJobsCreate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // 1) Clerk session WAJIB sebelum job dibuat. Dispatch sudah memverifikasi
    //    dan menyimpan hasilnya; guard ini melindungi pemanggilan langsung.
    const session = clerkSessions.get(req) ?? null;
    if (!session) throw new HttpError(401, "unauthorized");

    // 2) Rate limit ketat per userId (aktif bila env diset).
    if (userRateLimiter) {
      const decision = userRateLimiter.check(session.userId);
      if (!decision.allowed) {
        await auditEvent(
          req,
          "jobs.rate_limited",
          "user",
          session.userId,
          { reason: decision.reason },
          session.userId,
        );
        res.setHeader("Retry-After", decision.reason === "day" ? "86400" : "60");
        sendError(
          res,
          429,
          decision.reason === "day"
            ? "daily quota exceeded"
            : "per-minute quota exceeded",
        );
        return;
      }
    }

    // 3) Turnstile hanya bila klien mengirim header `x-turnstile-token`.
    const turnstileToken = req.headers["x-turnstile-token"];
    if (typeof turnstileToken === "string" && turnstileToken.length > 0) {
      const verification = await verifyTurnstile(turnstileToken);
      if (!verification.success) {
        await auditEvent(
          req,
          "jobs.turnstile_failed",
          "user",
          session.userId,
          { error: verification.error },
          session.userId,
        );
        throw new HttpError(403, "turnstile verification failed");
      }
    }

    const raw = await readJsonBody(req);
    if (raw !== undefined && !isRecord(raw)) throw new HttpError(400, "invalid body");
    const body = (raw ?? {}) as Record<string, unknown>;

    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;
    const sourceFile = typeof body.sourceFile === "string" ? body.sourceFile : undefined;
    const maxClips = typeof body.maxClips === "number" ? body.maxClips : undefined;
    const priority = typeof body.priority === "number" ? body.priority : 0;
    const pipeline = typeof body.pipeline === "string" && body.pipeline.length > 0
      ? body.pipeline
      : "auto";
    const params = isRecord(body.params)
      ? body.params
      : {
          ratio: body.ratio,
          subtitlePreset: body.subtitlePreset,
          maxClips,
        };

    // userId terverifikasi Clerk dipakai sebagai pemilik job.
    const userId = session.userId;
    const job = await store.createJob({
      userId,
      status: "queued",
      pipeline,
      params,
      sourceUrl,
      progress: 0,
      priority,
    });

    if (queue) {
      await queue.enqueue(job.id, { priority, userId });
    }

    if (orchestrator) {
      const dispatch = orchestrator;
      void Promise.resolve()
        .then(() =>
          dispatch.dispatchJob({
            id: job.id,
            sourceUrl,
            sourceFile,
            maxClips,
          }),
        )
        .catch(() => undefined);
    }

    await auditEvent(req, "jobs.create", "job", job.id, { pipeline, priority });
    sendData(res, 201, job);
  }

  async function handleJobGet(
    res: ServerResponse,
    jobId: string,
  ): Promise<void> {
    const job = await store.getJob(jobId);
    if (!job) throw new HttpError(404, "job not found");
    sendData(res, 200, job);
  }

  async function handleJobStatusUpdate(
    req: IncomingMessage,
    res: ServerResponse,
    jobId: string,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) throw new HttpError(400, "invalid body");
    if (!isJobStatus(body.status)) {
      throw new HttpError(400, `status must be one of ${JOB_STATUSES.join(", ")}`);
    }

    const patch: Parameters<DataStore["updateJob"]>[1] = { status: body.status };
    if (typeof body.progress === "number") patch.progress = body.progress;
    if (typeof body.error === "string") patch.error = body.error;

    const job = await store.updateJob(jobId, patch);
    if (!job) throw new HttpError(404, "job not found");

    await auditEvent(req, "jobs.status", "job", jobId, { status: body.status });
    sendData(res, 200, job);
  }

  async function handleJobClips(
    res: ServerResponse,
    jobId: string,
  ): Promise<void> {
    const job = await store.getJob(jobId);
    if (!job) throw new HttpError(404, "job not found");
    const clips = await store.listClips(jobId);
    sendData(res, 200, clips);
  }

  async function handleClipDownload(
    res: ServerResponse,
    jobId: string,
    clipId: string,
  ): Promise<void> {
    const clips = await store.listClips(jobId);
    const clip = clips.find((item) => item.id === clipId);
    if (!clip) throw new HttpError(404, "clip not found");

    const downloadUrl = clip.mediaUrl.length > 0
      ? clip.mediaUrl
      : demoDownloadUrl(clip.bucket, clip.objectKey);
    sendData(res, 200, { downloadUrl });
  }

  async function handleWalletBalance(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const userId = currentUserId(req);
    try {
      const wallet = await store.getWallet(userId);
      // `balance` adalah creds utama yang dibaca frontend (SiteHeader,
      // CreditGuard, TopupDialog, AppShell, billing page: src/shared
      // tidak punya type wallet, jadi kontraknya di web/src/lib/types.ts).
      sendData(res, 200, { ...wallet, balance: wallet.credits_balance });
    } catch (error) {
      // Barang wallet hilang sudah ditangani store (auto-provision), jadi
      // di sini hanya error yang benar-benar tak terduga (DB down, jaringan)
      // yang sampai. Log sekali dengan konteks user + route, buka envelope
      // convention yang sudah ada ({ok:false, error}), kembalikan 500.
      console.error(
        `[api-v1] GET /wallet/balance: lookup gagal untuk user "${userId}":`,
        error,
      );
      sendError(res, 500, "internal error");
    }
  }

  async function handleTopupsList(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const transactions = await store.listTransactions(currentUserId(req));
    sendData(res, 200, transactions);
  }

  async function handleTopupCreate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) throw new HttpError(400, "invalid body");

    const amountLocal = body.amountLocal ?? body.amount;
    if (
      typeof amountLocal !== "number" ||
      !Number.isFinite(amountLocal) ||
      amountLocal <= 0
    ) {
      throw new HttpError(400, "amountLocal must be a positive number");
    }

    if (
      typeof body.gateway !== "string" ||
      !(PAYMENT_GATEWAYS as readonly string[]).includes(body.gateway)
    ) {
      throw new HttpError(
        400,
        "gateway must be one of midtrans, xendit, tripay, manual",
      );
    }

    const currency =
      typeof body.currency === "string" && body.currency.trim().length > 0
        ? body.currency.trim().toUpperCase()
        : "IDR";

    const userId = currentUserId(req);
    const transaction = await store.applyTopup(userId, {
      amountLocal,
      currency,
      gateway: body.gateway,
    });

    await auditEvent(req, "topups.create", "transaction", transaction.id, {
      amountLocal,
      currency,
      gateway: body.gateway,
    });
    sendData(res, 201, transaction);
  }

  async function handleVastList(res: ServerResponse): Promise<void> {
    const rows = await store.listVastInstances();
    sendData(res, 200, rows);
  }

  async function handleVastGet(
    res: ServerResponse,
    id: string,
  ): Promise<void> {
    const row = await store.getVastInstance(id);
    if (!row) throw new HttpError(404, "vast instance not found");
    sendData(res, 200, row);
  }

  /* --------------------------- dispatch --------------------------- */

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (isRateLimited(req)) {
        sendError(res, 429, "rate limit exceeded");
        return;
      }

      // Best-effort Clerk identity untuk route non-jobs (mis. /wallet/*):
      // bila Bearer token ada dan CLERK_SECRET_KEY diset, verifikasi Clerk
      // supaya currentUserId() memakai identitas Clerk (bukan "anonymous").
      if (
        process.env.CLERK_SECRET_KEY &&
        bearerToken(req) &&
        !clerkSessions.get(req)
      ) {
        const clerk = await verifyClerkSession(req);
        if (clerk) clerkSessions.set(req, clerk);
      }

      // Clerk session boundary for jobs + workspace routes.
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;
      const path = normalizePath(pathname);
      const method = req.method ?? "GET";

      const jobPath = path === "/jobs" || path.startsWith("/jobs/");
      const workspacePath = path === "/workspace" || path.startsWith("/workspace/");
      if (jobPath || workspacePath) {
        const clerk = await verifyClerkSession(req);
        if (!clerk) {
          sendError(res, 401, "unauthorized");
          return;
        }
        clerkSessions.set(req, clerk);
      }

      if (method === "POST" && (path === "/auth/register" || path === "/auth/signup")) {
        return await handleRegister(req, res);
      }
      if (method === "POST" && path === "/auth/login") {
        return await handleLogin(req, res);
      }
      if (method === "POST" && (path === "/auth/google" || path === "/auth/github")) {
        return await handleOAuth(req, res, path === "/auth/google" ? "google" : "github");
      }
      if (method === "POST" && path === "/auth/sign-out") {
        return await handleSignOut(req, res);
      }
      if (method === "GET" && path === "/auth/me") {
        return await handleMe(req, res);
      }

      if (method === "POST" && path === "/uploads/presign") {
        return await handlePresign(req, res);
      }

      if (method === "GET" && path === "/jobs") {
        return await handleJobsList(req, res, url);
      }
      if (method === "POST" && path === "/jobs") {
        return await handleJobsCreate(req, res);
      }

      const statusMatch = path.match(/^\/jobs\/([^/]+)\/status$/);
      if (method === "PUT" && statusMatch) {
        return await handleJobStatusUpdate(req, res, decodeParam(statusMatch[1]));
      }

      const clipsMatch = path.match(/^\/jobs\/([^/]+)\/clips$/);
      if (method === "GET" && clipsMatch) {
        return await handleJobClips(res, decodeParam(clipsMatch[1]));
      }

      const downloadMatch = path.match(/^\/jobs\/([^/]+)\/clips\/([^/]+)\/download$/);
      if (method === "GET" && downloadMatch) {
        return await handleClipDownload(
          res,
          decodeParam(downloadMatch[1]),
          decodeParam(downloadMatch[2]),
        );
      }

      const jobMatch = path.match(/^\/jobs\/([^/]+)$/);
      if (method === "GET" && jobMatch) {
        return await handleJobGet(res, decodeParam(jobMatch[1]));
      }

      if (method === "GET" && (path === "/wallet/balance" || path === "/wallet")) {
        return await handleWalletBalance(req, res);
      }

      if (method === "GET" && path === "/topups") {
        return await handleTopupsList(req, res);
      }
      if (method === "POST" && path === "/topups") {
        return await handleTopupCreate(req, res);
      }

      if (method === "GET" && path === "/vast-instances") {
        return await handleVastList(res);
      }

      const vastMatch = path.match(/^\/vast-instances\/([^/]+)$/);
      if (method === "GET" && vastMatch) {
        return await handleVastGet(res, decodeParam(vastMatch[1]));
      }

      sendError(res, 404, "not found");
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(res, error.status, error.message);
        return;
      }
      console.error("[api-v1] route error:", error);
      sendError(res, 500, "internal error");
    }
  };
}
