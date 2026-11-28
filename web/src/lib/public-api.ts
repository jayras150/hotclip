/**
 * Client for the *public* studio API (`/api/v1/public/*`).
 *
 * Zero-friction contract: there is no login and no API key. The browser owns an
 * anonymous session id (`client_sessions.session_token`) that is created on
 * first interaction via `POST /api/v1/public/session`, persisted in
 * localStorage and echoed on every request through `x-client-session`.
 * The backend also sets an `hc_session` cookie, which is what lets the SSE
 * endpoint (`GET /logs/:jobId`) authenticate — `EventSource` cannot send
 * custom headers, so never rely on the header there.
 */
import type {
  ApiEnvelope,
  CreatePublicJobRequest,
  PublicClip,
  PublicJob,
  PublicJobDetail,
  PublicLimits,
  PublicUploadTarget,
  SourcePreview,
  WorkerLogEntry,
} from "@shared/studio-contract";
import { CLIENT_SESSION_HEADER } from "@shared/studio-contract";

declare const process: {
  env: Record<string, string | undefined>;
};

/**
 * Same-origin API base. `NEXT_PUBLIC_API_URL` is a build-time value set to the
 * app's public origin by the deployment; the empty default keeps requests on
 * the origin the browser already trusts (nginx proxies `/api/` to the API).
 */
export const PUBLIC_API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(
  /\/+$/,
  "",
);

const SESSION_STORAGE_KEY = "hc_studio_session";
const SESSION_PROMISE_KEY = "__hcStudioSessionPromise";

export class PublicApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

let inMemorySessionId: string | null = null;

export function getSessionId(): string | null {
  if (inMemorySessionId) return inMemorySessionId;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) inMemorySessionId = stored;
    return stored;
  } catch {
    return null;
  }
}

function storeSessionId(sessionId: string): void {
  inMemorySessionId = sessionId;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {
    /* private mode — in-memory fallback is enough for this tab */
  }
}

export interface SessionInfo {
  sessionId: string;
  limits: PublicLimits;
}

export const FALLBACK_LIMITS: PublicLimits = {
  maxClips: 10,
  minClips: 1,
  maxUploadBytes: 2 * 1024 ** 3,
  jobsPerHour: 10,
  jobsRemainingThisHour: 10,
};

type SessionGlobal = typeof globalThis & {
  [SESSION_PROMISE_KEY]?: Promise<SessionInfo> | null;
};

/**
 * Ensures an anonymous session exists. Safe to call from every interaction:
 * concurrent callers share one in-flight request and a stored session is reused
 * without a round-trip.
 */
export async function ensureSession(): Promise<SessionInfo> {
  const existing = getSessionId();
  const store = globalThis as SessionGlobal;
  if (existing && !store[SESSION_PROMISE_KEY]) {
    return { sessionId: existing, limits: FALLBACK_LIMITS };
  }
  if (store[SESSION_PROMISE_KEY]) return store[SESSION_PROMISE_KEY];

  const promise = request<{ sessionId: string; limits?: Partial<PublicLimits> }>(
    "/api/v1/public/session",
    { method: "POST", body: {}, skipSession: true },
  )
    .then((data) => {
      storeSessionId(data.sessionId);
      return {
        sessionId: data.sessionId,
        limits: { ...FALLBACK_LIMITS, ...(data.limits ?? {}) },
      } satisfies SessionInfo;
    })
    .finally(() => {
      store[SESSION_PROMISE_KEY] = null;
    });

  store[SESSION_PROMISE_KEY] = promise;
  return promise;
}

/** Reuses the stored session (if any) without forcing a network call. */
export async function withSession(): Promise<string> {
  return (await ensureSession()).sessionId;
}

/* ------------------------------------------------------------------ */
/* Low-level                                                           */
/* ------------------------------------------------------------------ */

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  skipSession?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!options.skipSession) {
    const sessionId = getSessionId();
    if (sessionId) headers[CLIENT_SESSION_HEADER] = sessionId;
  }

  let response: Response;
  try {
    response = await fetch(`${PUBLIC_API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      signal: options.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    throw new PublicApiError(
      0,
      "Could not reach the server. Check your connection and try again.",
      "NETWORK_ERROR",
    );
  }

  const text = await response.text();
  let payload: unknown;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const envelope = isRecord(payload) ? payload : {};
    const error = isRecord(envelope.error) ? envelope.error : {};
    throw new PublicApiError(
      response.status,
      typeof error.message === "string"
        ? error.message
        : typeof envelope.message === "string"
          ? envelope.message
          : "Request failed.",
      typeof error.code === "string" ? error.code : `HTTP_${response.status}`,
      error.details,
    );
  }

  if (response.status === 204 || payload === undefined) return undefined as T;

  if (isRecord(payload) && typeof payload.ok === "boolean") {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.ok) {
      throw new PublicApiError(
        response.status,
        envelope.error.message,
        envelope.error.code,
        envelope.error.details,
      );
    }
    return envelope.data;
  }

  return payload as T;
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export function previewSource(url: string, signal?: AbortSignal): Promise<SourcePreview> {
  return request<SourcePreview>("/api/v1/public/preview", {
    method: "POST",
    body: { url },
    signal,
  });
}

export function createUploadTarget(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<PublicUploadTarget> {
  return request<PublicUploadTarget>("/api/v1/public/uploads", {
    method: "POST",
    body: input,
  });
}

export function createJob(input: CreatePublicJobRequest): Promise<PublicJob> {
  return request<PublicJob>("/api/v1/public/jobs", { method: "POST", body: input });
}

export function listJobs(): Promise<PublicJob[]> {
  return request<PublicJob[]>("/api/v1/public/jobs");
}

export function getJob(jobId: string, signal?: AbortSignal): Promise<PublicJobDetail> {
  return request<PublicJobDetail>(`/api/v1/public/jobs/${encodeURIComponent(jobId)}`, {
    signal,
  });
}

export function deleteJob(jobId: string): Promise<void> {
  return request<void>(`/api/v1/public/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}

export function getJobClips(jobId: string, signal?: AbortSignal): Promise<PublicClip[]> {
  return request<PublicClip[]>(
    `/api/v1/public/jobs/${encodeURIComponent(jobId)}/clips`,
    { signal },
  );
}

export function getJobLogs(
  jobId: string,
  after = 0,
  signal?: AbortSignal,
): Promise<WorkerLogEntry[]> {
  return request<WorkerLogEntry[]>(
    `/api/v1/public/jobs/${encodeURIComponent(jobId)}/logs?after=${after}`,
    { signal },
  );
}

export function logsStreamUrl(jobId: string, after = 0): string {
  return `${PUBLIC_API_BASE}/logs/${encodeURIComponent(jobId)}?after=${after}`;
}

/* ------------------------------------------------------------------ */
/* Upload (XHR, so we get progress events)                             */
/* ------------------------------------------------------------------ */

export interface UploadHandle {
  promise: Promise<string>;
  abort: () => void;
}

/**
 * PUTs the file at the presigned target while reporting progress.
 * Resolves with the `uploadKey` to send to `POST /api/v1/public/jobs`.
 */
export function uploadFile(
  file: File,
  target: PublicUploadTarget,
  onProgress: (percent: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<string>((resolve, reject) => {
    xhr.open(target.method, target.uploadUrl, true);
    for (const [key, value] of Object.entries(target.headers ?? {})) {
      if (typeof value !== "string") continue;
      try {
        xhr.setRequestHeader(key, value);
      } catch {
        /* headers that the browser owns (e.g. Content-Length) are ignored */
      }
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.upload.onload = () => onProgress(100);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(target.uploadKey);
      } else {
        reject(
          new PublicApiError(
            xhr.status,
            "Upload failed. Please try a different file or check your connection.",
            `UPLOAD_${xhr.status}`,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new PublicApiError(0, "Connection lost while uploading the file.", "UPLOAD_NETWORK"),
      );
    xhr.onabort = () =>
      reject(new PublicApiError(0, "Upload cancelled.", "UPLOAD_ABORTED"));

    xhr.send(file);
  });

  return { promise, abort: () => xhr.abort() };
}

/* ------------------------------------------------------------------ */
/* Small helpers shared by studio components                           */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent < 2 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function isValidVideoUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
