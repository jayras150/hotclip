/**
 * Public studio API — `/api/v1/public/*` plus the SSE log stream `/logs/:jobId`.
 *
 * Zero-friction contract (no login, no API key):
 *   POST   /api/v1/public/session              -> { sessionId, limits }
 *   POST   /api/v1/public/preview              -> SourcePreview
 *   POST   /api/v1/public/uploads              -> PublicUploadTarget
 *   POST   /api/v1/public/jobs                 -> PublicJob
 *   GET    /api/v1/public/jobs                 -> PublicJob[]
 *   GET    /api/v1/public/jobs/:id             -> PublicJobDetail
 *   DELETE /api/v1/public/jobs/:id             -> { deleted: true }
 *   GET    /api/v1/public/jobs/:id/clips       -> PublicClip[]
 *   GET    /api/v1/public/jobs/:id/logs?after=N -> WorkerLogEntry[]
 *   GET    /logs/:id?after=N                   -> text/event-stream
 *
 * Every response is the shared envelope `{ ok: true, data }` /
 * `{ ok: false, error }` (see `src/shared/studio-contract.ts`), which is what
 * `web/src/lib/public-api.ts` unwraps.
 *
 * Verification: `pnpm typecheck && pnpm test`
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AiModules,
  AspectRatio,
  CreatePublicJobRequest,
  PipelineStage,
  PublicClip,
  PublicJob,
  PublicJobDetail,
  PublicLimits,
  PublicUploadTarget,
  SourcePreview,
  WorkerLogEntry,
} from "../shared/studio-contract";
import {
  DEFAULT_AI_MODULES,
  clampClipCount,
  isAspectRatio,
} from "../shared/studio-contract";
import type { RouteHandler } from "./api";
import { createRateLimiter } from "./audit";
import { emitLog } from "./pipeline-log";
import {
  createPublicStore,
  type PublicClipRow,
  type PublicJobRow,
  type PublicStoreDriver,
} from "./public-store";
import { resolvePublicSession, setSessionCookie } from "./public-session";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface PublicLimitsConfig {
  maxClips: number;
  minClips: number;
  maxUploadBytes: number;
  jobsPerHour: number;
}

export const DEFAULT_PUBLIC_LIMITS: PublicLimitsConfig = {
  maxClips: 10,
  minClips: 1,
  maxUploadBytes: 2 * 1024 ** 3, // 2 GB
  jobsPerHour: 10,
};

/** How long a presigned PUT stays valid. */
const UPLOAD_TTL_SECONDS = 3600;
const MAX_BODY_BYTES = 256 * 1024; // every public body is tiny JSON
const ONE_HOUR_MS = 60 * 60 * 1000;
const PREVIEW_TIMEOUT_MS = 8000;

export interface PublicApiOptions {
  /** Defaults to `createPublicStore()` (PostgREST when Supabase is set). */
  store?: PublicStoreDriver;
  /** Dispatches the job to the GPU pipeline (orchestrator bridge). */
  dispatchJob?: (job: {
    id: string;
    sourceUrl?: string;
    sourceFile?: string;
    maxClips?: number;
  }) => Promise<unknown>;
  /** Real S3 presigner; without it uploads degrade to a demo URL. */
  presigner?: (
    key: string,
  ) => Promise<{ url: string; method: string; headers: Record<string, string> }>;
  limits?: Partial<PublicLimitsConfig>;
}

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */

class PublicHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicHttpError";
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  // Same-origin behind nginx needs nothing; this only helps local dev where
  // the web app (3000) talks to the API (8080) directly.
  res.setHeader(
    "Access-Control-Allow-Origin",
    typeof origin === "string" && origin.length > 0 ? origin : "*",
  );
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-client-session");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendData(res: ServerResponse, status: number, data: unknown): void {
  sendJson(res, status, { ok: true, data });
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new PublicHttpError(413, "PAYLOAD_TOO_LARGE", "Body terlalu besar.");
    }
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new PublicHttpError(400, "INVALID_JSON", "Body JSON tidak valid.");
  }
}

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

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

/** Drops the session scope — it must never reach the browser. */
export function toPublicJob(row: PublicJobRow): PublicJob {
  const job: PublicJob = {
    id: row.id,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    clipCount: row.clipCount,
    aspectRatio: row.aspectRatio,
    modules: row.modules,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.sourceUrl !== undefined) job.sourceUrl = row.sourceUrl;
  if (row.sourceTitle !== undefined) job.sourceTitle = row.sourceTitle;
  if (row.sourceThumb !== undefined) job.sourceThumb = row.sourceThumb;
  if (row.error !== undefined) job.error = row.error;
  return job;
}

export function toPublicClip(row: PublicClipRow): PublicClip {
  const clip: PublicClip = {
    id: row.id,
    jobId: row.jobId,
    title: row.title,
    caption: row.caption,
    hashtags: row.hashtags,
    startSec: row.startSec,
    endSec: row.endSec,
    durationSec: row.durationSec,
    score: row.score,
    aspectRatio: row.aspectRatio,
    mediaUrl: row.mediaUrl,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt,
  };
  if (row.previewUrl !== undefined) clip.previewUrl = row.previewUrl;
  if (row.thumbnailUrl !== undefined) clip.thumbnailUrl = row.thumbnailUrl;
  return clip;
}

/* ------------------------------------------------------------------ */
/* Source preview (YouTube oEmbed + best-effort duration)              */
/* ------------------------------------------------------------------ */

function youtubeVideoId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return id || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const v = url.searchParams.get("v");
      if (v) return v;
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      return match?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; HookClipBot/1.0; +https://hookclip.pro)",
        "Accept-Language": "id,en;q=0.8",
        ...headers,
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function youtubePreview(videoId: string, raw: string): Promise<SourcePreview> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let title = "";
  let author = "";
  let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let durationSec = 0;

  try {
    const oembed = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      PREVIEW_TIMEOUT_MS,
    );
    if (oembed.ok) {
      const meta = (await oembed.json()) as Record<string, unknown>;
      if (typeof meta.title === "string") title = meta.title;
      if (typeof meta.author_name === "string") author = meta.author_name;
      if (typeof meta.thumbnail_url === "string" && meta.thumbnail_url.length > 0) {
        thumbnail = meta.thumbnail_url;
      }
    }
  } catch {
    /* fall through to the watch-page scrape */
  }

  try {
    const page = await fetchWithTimeout(watchUrl, PREVIEW_TIMEOUT_MS);
    if (page.ok) {
      const html = await page.text();
      const durationMatch = html.match(/"lengthSeconds":"(\d+)"/);
      if (durationMatch) durationSec = Number(durationMatch[1]) || 0;
      if (!title) {
        const titleMatch = html.match(/<meta name="title" content="([^"]+)"/);
        if (titleMatch) title = titleMatch[1];
      }
    }
  } catch {
    /* duration stays 0 — the UI shows 0:00 but the job still works */
  }

  return {
    url: raw,
    title: title || "Video YouTube",
    thumbnail,
    durationSec,
    provider: "youtube",
    ...(author ? { author } : {}),
  };
}

async function genericPreview(raw: string): Promise<SourcePreview> {
  let title = "Video";
  let thumbnail = "";
  let author: string | undefined;

  try {
    const page = await fetchWithTimeout(raw, PREVIEW_TIMEOUT_MS);
    if (page.ok) {
      const html = (await page.text()).slice(0, 400_000);
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
      const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (ogTitle) title = ogTitle[1]!;
      else if (titleTag) title = titleTag[1]!.trim();
      if (ogImage) thumbnail = ogImage[1]!;
      if (ogSite) author = ogSite[1]!;
    }
  } catch {
    /* preview is best-effort */
  }

  return {
    url: raw,
    title: title.slice(0, 200),
    thumbnail,
    durationSec: 0,
    provider: "other",
    ...(author ? { author } : {}),
  };
}

export async function buildSourcePreview(raw: string): Promise<SourcePreview> {
  const videoId = youtubeVideoId(raw);
  if (videoId) return youtubePreview(videoId, raw);
  return genericPreview(raw);
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function parseJobRequest(body: unknown): CreatePublicJobRequest {
  if (!isRecord(body)) {
    throw new PublicHttpError(400, "INVALID_BODY", "Body permintaan tidak valid.");
  }

  const sourceUrl =
    typeof body.sourceUrl === "string" && body.sourceUrl.trim().length > 0
      ? body.sourceUrl.trim()
      : undefined;
  const uploadKey =
    typeof body.uploadKey === "string" && body.uploadKey.trim().length > 0
      ? body.uploadKey.trim()
      : undefined;

  if (!sourceUrl && !uploadKey) {
    throw new PublicHttpError(
      400,
      "MISSING_SOURCE",
      "Sertakan sourceUrl atau uploadKey.",
    );
  }
  if (sourceUrl && uploadKey) {
    throw new PublicHttpError(
      400,
      "AMBIGUOUS_SOURCE",
      "Pilih salah satu: sourceUrl atau uploadKey.",
    );
  }
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    throw new PublicHttpError(400, "INVALID_URL", "URL harus http atau https.");
  }

  if (!isAspectRatio(body.aspectRatio)) {
    throw new PublicHttpError(
      400,
      "INVALID_ASPECT_RATIO",
      "aspectRatio harus 9:16, 4:5, 1:1, atau 16:9.",
    );
  }

  const modulesRaw = isRecord(body.modules) ? body.modules : {};
  const modules: AiModules = {
    faceTracking:
      typeof modulesRaw.faceTracking === "boolean"
        ? modulesRaw.faceTracking
        : DEFAULT_AI_MODULES.faceTracking,
    karaokeAss:
      typeof modulesRaw.karaokeAss === "boolean"
        ? modulesRaw.karaokeAss
        : DEFAULT_AI_MODULES.karaokeAss,
    hookScore:
      typeof modulesRaw.hookScore === "boolean"
        ? modulesRaw.hookScore
        : DEFAULT_AI_MODULES.hookScore,
  };

  const request: CreatePublicJobRequest = {
    clipCount: clampClipCount(body.clipCount),
    aspectRatio: body.aspectRatio as AspectRatio,
    modules,
  };
  if (sourceUrl) request.sourceUrl = sourceUrl;
  if (uploadKey) request.uploadKey = uploadKey;
  if (typeof body.sourceTitle === "string" && body.sourceTitle.trim().length > 0) {
    request.sourceTitle = body.sourceTitle.trim().slice(0, 200);
  }
  return request;
}

const TERMINAL_STATUSES: readonly string[] = [
  "completed",
  "failed",
  "cancelled",
  "timeout",
];

export function createPublicApiRouter(opts: PublicApiOptions = {}): RouteHandler {
  const store = opts.store ?? createPublicStore();
  const limits: PublicLimitsConfig = { ...DEFAULT_PUBLIC_LIMITS, ...(opts.limits ?? {}) };
  const isRateLimited = createRateLimiter({ maxRequests: 120, windowMs: 60_000 });

  /** Guards against a job being written for another browser's session. */
  async function requireJob(
    req: IncomingMessage,
    jobId: string,
  ): Promise<{ job: PublicJobRow; sessionId: string }> {
    const { session } = await resolvePublicSession(req, store);
    const job = await store.getJob(jobId);
    if (!job || job.clientSessionId !== session.id) {
      throw new PublicHttpError(404, "JOB_NOT_FOUND", "Job tidak ditemukan.");
    }
    return { job, sessionId: session.id };
  }

  async function currentLimits(sessionId: string): Promise<PublicLimits> {
    let used = 0;
    try {
      used = await store.countJobsSince(sessionId, ONE_HOUR_MS);
    } catch {
      /* a quota read failure must not block the UI */
    }
    return {
      maxClips: limits.maxClips,
      minClips: limits.minClips,
      maxUploadBytes: limits.maxUploadBytes,
      jobsPerHour: limits.jobsPerHour,
      jobsRemainingThisHour: Math.max(0, limits.jobsPerHour - used),
    };
  }

  /* ------------------------------ session ------------------------------ */

  async function handleSession(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { session, token, created } = await resolvePublicSession(req, store);
    if (created) setSessionCookie(res, token);
    sendData(res, created ? 201 : 200, {
      sessionId: session.sessionToken,
      limits: await currentLimits(session.id),
    });
  }

  /* ------------------------------ preview ------------------------------ */

  async function handlePreview(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body) || typeof body.url !== "string") {
      throw new PublicHttpError(400, "INVALID_BODY", "Sertakan url video.");
    }
    const url = body.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new PublicHttpError(400, "INVALID_URL", "URL harus http atau https.");
    }
    await resolvePublicSession(req, store); // first interaction creates the session
    sendData(res, 200, await buildSourcePreview(url));
  }

  /* ------------------------------ uploads ------------------------------ */

  function sanitizeFileName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? "video";
    const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_");
    return cleaned.length > 0 ? cleaned.slice(0, 120) : "video";
  }

  function storageEndpoint(): string {
    const raw =
      process.env.STORAGE_ENDPOINT ?? process.env.S3_ENDPOINT ?? "storage.local";
    return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  function storageBucket(): string {
    return process.env.STORAGE_BUCKET ?? process.env.S3_BUCKET ?? "hotclip-media";
  }

  async function handleUploads(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) {
      throw new PublicHttpError(400, "INVALID_BODY", "Body permintaan tidak valid.");
    }
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    if (fileName.trim().length === 0) {
      throw new PublicHttpError(400, "MISSING_FILE_NAME", "fileName wajib diisi.");
    }
    const contentType =
      typeof body.contentType === "string" && body.contentType.length > 0
        ? body.contentType
        : "video/mp4";
    const sizeBytes =
      typeof body.sizeBytes === "number" && Number.isFinite(body.sizeBytes)
        ? body.sizeBytes
        : 0;

    if (sizeBytes > limits.maxUploadBytes) {
      throw new PublicHttpError(
        413,
        "FILE_TOO_LARGE",
        `Ukuran file melebihi batas ${Math.round(limits.maxUploadBytes / 1024 ** 2)} MB.`,
      );
    }
    if (sizeBytes <= 0) {
      throw new PublicHttpError(400, "INVALID_SIZE", "sizeBytes wajib diisi.");
    }

    const { session } = await resolvePublicSession(req, store);
    const objectKey = `uploads/public/${session.id}/${randomUUID()}-${sanitizeFileName(fileName)}`;

    let presigned:
      | { url: string; method: string; headers: Record<string, string> }
      | null = null;
    if (opts.presigner) {
      try {
        presigned = await opts.presigner(objectKey);
      } catch (error) {
        console.warn(
          "[public-api] presign fallback:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    const target: PublicUploadTarget = {
      uploadUrl:
        presigned?.url ??
        `https://${storageEndpoint()}/${storageBucket()}/${objectKey}?X-Amz-Signature=demo`,
      uploadKey: objectKey,
      method: presigned?.method === "POST" ? "POST" : "PUT",
      headers: {
        ...(presigned?.headers ?? {}),
        "Content-Type": contentType,
      },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
      maxBytes: limits.maxUploadBytes,
    };

    sendData(res, 200, target);
  }

  /* -------------------------------- jobs ------------------------------- */

  async function handleJobsCreate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const request = parseJobRequest(await readJsonBody(req));
    const { session } = await resolvePublicSession(req, store);

    const used = await store.countJobsSince(session.id, ONE_HOUR_MS);
    if (used >= limits.jobsPerHour) {
      throw new PublicHttpError(
        429,
        "QUOTA_EXCEEDED",
        `Batas ${limits.jobsPerHour} job per jam tercapai. Coba lagi nanti.`,
      );
    }

    // Without a dispatcher the job would sit in `queued` forever and the UI
    // would spin indefinitely — fail honestly instead.
    if (!opts.dispatchJob) {
      throw new PublicHttpError(
        503,
        "PIPELINE_UNAVAILABLE",
        "Pipeline GPU belum aktif di server ini. Hubungi admin.",
      );
    }

    let preview: SourcePreview | null = null;
    if (request.sourceUrl) {
      try {
        preview = await buildSourcePreview(request.sourceUrl);
      } catch {
        preview = null;
      }
    }

    const job = await store.createJob({
      clientSessionId: session.id,
      status: "queued",
      stage: "queued",
      progress: 0,
      clipCount: request.clipCount,
      aspectRatio: request.aspectRatio,
      modules: request.modules,
      ...(request.sourceUrl ? { sourceUrl: request.sourceUrl } : {}),
      ...(request.sourceTitle
        ? { sourceTitle: request.sourceTitle }
        : preview?.title
          ? { sourceTitle: preview.title }
          : {}),
      ...(preview?.thumbnail ? { sourceThumb: preview.thumbnail } : {}),
    });

    await store.incrementSessionJobCount(session.id).catch(() => undefined);
    await emitLog(job.id, session.id, "info", "queued", "Job diterima studio.", {
      sink: store,
    });

    const dispatch = opts.dispatchJob;
    const dispatchPayload = {
      id: job.id,
      maxClips: request.clipCount,
      ...(request.sourceUrl ? { sourceUrl: request.sourceUrl } : {}),
      ...(request.uploadKey ? { sourceFile: request.uploadKey } : {}),
    };

    // Fire-and-forget: the browser polls `GET /jobs/:id` for progress, so the
    // HTTP response must not wait for GPU provisioning. A returned
    // `{status:"error"}` result (e.g. no Vast.ai offer matches the hard
    // limits) must fail the job too — otherwise it would spin in `queued`
    // forever with no visible error.
    void Promise.resolve()
      .then(() => dispatch(dispatchPayload))
      .then(async (result: unknown) => {
        const outcome = (
          typeof result === "object" && result !== null ? result : {}
        ) as { status?: string; error?: string };
        if (outcome.status !== "error" && outcome.status !== "timeout") return;

        const message =
          outcome.error ??
          (outcome.status === "timeout"
            ? "Provisioning GPU melewati batas waktu."
            : "Provisioning GPU gagal.");
        await store
          .patchJob(job.id, {
            status: outcome.status === "timeout" ? "timeout" : "failed",
            error: message,
          })
          .catch(() => undefined);
        await emitLog(job.id, session.id, "error", "failed", message, {
          sink: store,
        });
      })
      .catch(async (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Dispatch ke GPU gagal.";
        await store
          .patchJob(job.id, { status: "failed", error: message })
          .catch(() => undefined);
        await emitLog(job.id, session.id, "error", "failed", message, {
          sink: store,
        });
      });

    sendData(res, 201, toPublicJob(job));
  }

  async function handleJobsList(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const { session } = await resolvePublicSession(req, store);
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(50, Math.max(1, limitParam))
      : 20;
    const rows = await store.listJobs(session.id, limit);
    sendData(res, 200, rows.map(toPublicJob));
  }

  async function handleJobDetail(
    req: IncomingMessage,
    res: ServerResponse,
    jobId: string,
  ): Promise<void> {
    const { job } = await requireJob(req, jobId);
    const [clips, gpu] = await Promise.all([
      store.listClips(job.id).catch(() => [] as PublicClipRow[]),
      store.getGpu(job.id).catch(() => null),
    ]);
    const detail: PublicJobDetail = {
      job: toPublicJob(job),
      clips: clips.map(toPublicClip),
      gpu,
    };
    sendData(res, 200, detail);
  }

  async function handleJobDelete(
    req: IncomingMessage,
    res: ServerResponse,
    jobId: string,
  ): Promise<void> {
    const { job } = await requireJob(req, jobId);
    await store.deleteJob(job.id);
    sendData(res, 200, { deleted: true });
  }

  async function handleJobClips(
    req: IncomingMessage,
    res: ServerResponse,
    jobId: string,
  ): Promise<void> {
    const { job } = await requireJob(req, jobId);
    const clips = await store.listClips(job.id);
    sendData(res, 200, clips.map(toPublicClip));
  }

  async function handleJobLogs(
    req: IncomingMessage,
    res: ServerResponse,
    jobId: string,
    url: URL,
  ): Promise<void> {
    const { job } = await requireJob(req, jobId);
    const afterParam = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
    const after = Number.isFinite(afterParam) && afterParam > 0 ? afterParam : 0;
    const entries: WorkerLogEntry[] = await store.listLogs(job.id, after, 500);
    sendData(res, 200, entries);
  }

  /* ---------------------------- SSE log stream ------------------------- */

  async function handleLogStream(
    req: IncomingMessage,
    res: ServerResponse,
    jobId: string,
    url: URL,
  ): Promise<void> {
    const { job } = await requireJob(req, jobId);

    const afterParam = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
    let lastId = Number.isFinite(afterParam) && afterParam > 0 ? afterParam : 0;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering for SSE
    });
    res.write(": connected\n\n");

    let closed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (timer !== null) clearInterval(timer);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* connection already gone */
        }
      }
    };

    const pump = async (): Promise<void> => {
      if (closed) return;
      try {
        const entries = await store.listLogs(job.id, lastId, 200);
        if (entries.length > 0) {
          lastId = entries[entries.length - 1]!.id;
          for (const entry of entries) {
            if (closed) return;
            res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
          }
        }

        const current = await store.getJob(job.id);
        const finished = !current || TERMINAL_STATUSES.includes(current.status);
        if (finished) {
          // Give the client one last batch, then close so EventSource does not
          // spin forever on a completed job.
          const tail = await store.listLogs(job.id, lastId, 200);
          for (const entry of tail) {
            if (closed) return;
            res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
          }
          res.write("event: done\ndata: {}\n\n");
          cleanup();
        }
      } catch (error) {
        if (closed) return;
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : "log stream error",
          })}\n\n`,
        );
        cleanup();
      }
    };

    await pump();
    if (!closed) timer = setInterval(() => void pump(), 1500);
    timer?.unref?.();

    res.on("close", cleanup);
    req.on("close", () => {
      if (res.destroyed || res.writableEnded) cleanup();
    });
  }

  /* ------------------------------ dispatch ----------------------------- */

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (isRateLimited(req)) {
        sendError(res, 429, "RATE_LIMITED", "Terlalu banyak permintaan.");
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;
      const method = req.method ?? "GET";

      // SSE endpoint lives outside /api/v1 on purpose: nginx proxies /logs/
      // with buffering disabled.
      if (method === "GET" && pathname.startsWith("/logs/")) {
        const jobId = decodeParam(pathname.slice("/logs/".length).split("/")[0] ?? "");
        if (jobId.length === 0) {
          sendError(res, 404, "NOT_FOUND", "Endpoint tidak ditemukan.");
          return;
        }
        await handleLogStream(req, res, jobId, url);
        return;
      }

      const path = pathname.startsWith("/api/v1/public")
        ? pathname.slice("/api/v1/public".length) || "/"
        : pathname;

      if (method === "POST" && path === "/session") {
        await handleSession(req, res);
        return;
      }
      if (method === "POST" && path === "/preview") {
        await handlePreview(req, res);
        return;
      }
      if (method === "POST" && path === "/uploads") {
        await handleUploads(req, res);
        return;
      }
      if (path === "/jobs") {
        if (method === "GET") {
          await handleJobsList(req, res, url);
          return;
        }
        if (method === "POST") {
          await handleJobsCreate(req, res);
          return;
        }
      }

      const clipsMatch = path.match(/^\/jobs\/([^/]+)\/clips$/);
      if (method === "GET" && clipsMatch) {
        await handleJobClips(req, res, decodeParam(clipsMatch[1]!));
        return;
      }

      const logsMatch = path.match(/^\/jobs\/([^/]+)\/logs$/);
      if (method === "GET" && logsMatch) {
        await handleJobLogs(req, res, decodeParam(logsMatch[1]!), url);
        return;
      }

      const jobMatch = path.match(/^\/jobs\/([^/]+)$/);
      if (jobMatch) {
        const jobId = decodeParam(jobMatch[1]!);
        if (method === "GET") {
          await handleJobDetail(req, res, jobId);
          return;
        }
        if (method === "DELETE") {
          await handleJobDelete(req, res, jobId);
          return;
        }
      }

      sendError(res, 404, "NOT_FOUND", "Endpoint tidak ditemukan.");
    } catch (error) {
      if (error instanceof PublicHttpError) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      console.error("[public-api] route error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Terjadi kesalahan di server.");
    }
  };
}
