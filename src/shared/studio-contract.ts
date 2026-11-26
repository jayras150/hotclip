/**
 * Public + admin API contract shared by backend (`src/server`) and frontend
 * (`web`). Both sides import these types so a shape change breaks compilation
 * on the side that forgot to update — the single source of truth for Fase 5
 * integration.
 *
 * Mirrors migration 0004 (`supabase/migrations/0004_public_studio.sql`).
 */

/** Aspect ratios the studio renders and the worker crops to. */
export type AspectRatio = '9:16' | '4:5' | '1:1' | '16:9';

export const ASPECT_RATIOS: readonly AspectRatio[] = [
  '9:16',
  '4:5',
  '1:1',
  '16:9',
] as const;

export type PublicJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type PipelineStage =
  | 'queued'
  | 'provisioning'
  | 'downloading'
  | 'transcribing'
  | 'analyzing'
  | 'rendering'
  | 'uploading'
  | 'completed'
  | 'failed';

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'queued',
  'provisioning',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
  'uploading',
  'completed',
] as const;

/** AI module toggles surfaced in the studio. */
export interface AiModules {
  faceTracking: boolean;
  karaokeAss: boolean;
  hookScore: boolean;
}

export const DEFAULT_AI_MODULES: AiModules = {
  faceTracking: true,
  karaokeAss: true,
  hookScore: true,
};

/** `POST /api/v1/public/jobs` request body. */
export interface CreatePublicJobRequest {
  /** YouTube (or any yt-dlp supported) URL. Mutually exclusive with uploadKey. */
  sourceUrl?: string;
  /** Object key returned by `POST /api/v1/public/uploads`. */
  uploadKey?: string;
  /** Human-readable title for the UI when the source is an upload. */
  sourceTitle?: string;
  clipCount: number;
  aspectRatio: AspectRatio;
  modules: AiModules;
}

export interface PublicClip {
  id: string;
  jobId: string;
  title: string;
  caption: string;
  hashtags: string[];
  startSec: number;
  endSec: number;
  durationSec: number;
  /** 0-100 virality / hook score. */
  score: number;
  aspectRatio: AspectRatio;
  /** Playable/downloadable MP4. */
  mediaUrl: string;
  /** Optional lighter preview used in the grid. */
  previewUrl?: string;
  thumbnailUrl?: string;
  sizeBytes: number;
  status: 'processing' | 'ready' | 'failed';
  createdAt: string;
}

export interface PublicJob {
  id: string;
  status: PublicJobStatus;
  stage: PipelineStage | null;
  /** 0-100. */
  progress: number;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceThumb?: string;
  clipCount: number;
  aspectRatio: AspectRatio;
  modules: AiModules;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/v1/public/jobs/:id` — job plus clips plus GPU telemetry. */
export interface PublicJobDetail {
  job: PublicJob;
  clips: PublicClip[];
  gpu: GpuTelemetry | null;
}

export interface GpuTelemetry {
  vastInstanceId: string | null;
  gpuName: string | null;
  /** USD per hour. */
  dphTotal: number | null;
  status:
    | 'provisioning'
    | 'booting'
    | 'running'
    | 'completed'
    | 'failed'
    | 'destroyed'
    | 'blocked';
  bootStartedAt: string | null;
  readyAt: string | null;
  /** Seconds from boot start to ready; null while still booting. */
  bootSeconds: number | null;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'stage';

export interface WorkerLogEntry {
  /** Monotonic row id — clients send it back as `?after=`. */
  id: number;
  jobId: string;
  level: LogLevel;
  stage: PipelineStage | null;
  message: string;
  createdAt: string;
}

/** Envelope used by every `/api/v1/public/*` response. */
export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

/** `POST /api/v1/public/uploads` response. */
export interface PublicUploadTarget {
  uploadUrl: string;
  uploadKey: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
}

/** Rate-limit headroom echoed on public responses. */
export interface PublicLimits {
  maxClips: number;
  minClips: number;
  maxUploadBytes: number;
  jobsPerHour: number;
  jobsRemainingThisHour: number;
}

/** Metadata scraped for a pasted YouTube URL. */
export interface SourcePreview {
  url: string;
  title: string;
  thumbnail: string;
  durationSec: number;
  author?: string;
  provider: 'youtube' | 'other';
}

/**
 * Request header carrying the anonymous studio session id. The browser
 * generates it once and it must match a `client_sessions.session_token` row.
 */
export const CLIENT_SESSION_HEADER = 'x-client-session';

/** Route prefixes that must never be reachable from the public studio UI. */
export const ADMIN_ROUTE_PREFIX = '/admin';

export function isAspectRatio(value: unknown): value is AspectRatio {
  return (
    typeof value === 'string' &&
    (ASPECT_RATIOS as readonly string[]).includes(value)
  );
}

export function clampClipCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(10, Math.max(1, Math.round(n)));
}
