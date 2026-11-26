/**
 * Public studio store — PostgREST (Supabase) for production, in-memory for
 * dev/tests.
 *
 * The public studio is deliberately decoupled from the tenant `DataStore`:
 * identity is an anonymous `client_sessions.session_token` (sent as
 * `x-client-session`), and every query is scoped by `client_session_id` so the
 * service-role key cannot be tricked into returning another browser's rows.
 *
 * Mirrors migration 0004 (`supabase/migrations/0004_public_studio.sql`).
 *
 * Verification: `pnpm typecheck && pnpm test`
 */

import { randomUUID } from "node:crypto";
import type {
  AiModules,
  AspectRatio,
  GpuTelemetry,
  LogLevel,
  PipelineStage,
  PublicClip,
  PublicJob,
  PublicJobStatus,
  WorkerLogEntry,
} from "../shared/studio-contract";
import {
  DEFAULT_AI_MODULES,
  PIPELINE_STAGES,
  isAspectRatio,
} from "../shared/studio-contract";

export type Env = Record<string, string | undefined>;

const REQUEST_TIMEOUT_MS = 10_000;

const TABLES = {
  sessions: "client_sessions",
  jobs: "jobs",
  clips: "clips",
  gpu: "gpu_instances",
  logs: "worker_logs",
} as const;

/* ------------------------------------------------------------------ */
/* Row types                                                          */
/* ------------------------------------------------------------------ */

export interface ClientSessionRow {
  id: string;
  sessionToken: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  jobCount: number;
  createdAt: string;
  lastSeenAt: string;
}

/** Public job plus the session scope (never sent to the browser). */
export interface PublicJobRow extends PublicJob {
  clientSessionId: string | null;
}

export interface PublicClipRow extends PublicClip {
  clientSessionId: string | null;
}

export interface PublicJobPatch {
  status?: PublicJobStatus;
  stage?: PipelineStage | null;
  progress?: number;
  error?: string | null;
  sourceTitle?: string;
  sourceThumb?: string;
  clipCount?: number;
  modules?: AiModules;
}

export interface CreatePublicJobInput {
  id?: string;
  clientSessionId: string;
  status?: PublicJobStatus;
  stage?: PipelineStage | null;
  progress?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceThumb?: string;
  clipCount: number;
  aspectRatio: AspectRatio;
  modules: AiModules;
}

export interface AppendPublicLogInput {
  jobId: string;
  clientSessionId: string | null;
  level: LogLevel;
  stage: PipelineStage | null;
  message: string;
  instanceId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Driver contract                                                    */
/* ------------------------------------------------------------------ */

export interface PublicStoreDriver {
  health(): Promise<boolean>;

  createSession(input: {
    sessionToken: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<ClientSessionRow>;
  findSessionByToken(token: string): Promise<ClientSessionRow | null>;
  touchSession(id: string): Promise<void>;
  incrementSessionJobCount(id: string): Promise<void>;
  countJobsSince(clientSessionId: string, sinceMs: number): Promise<number>;

  createJob(input: CreatePublicJobInput): Promise<PublicJobRow>;
  getJob(id: string): Promise<PublicJobRow | null>;
  listJobs(clientSessionId: string, limit?: number): Promise<PublicJobRow[]>;
  patchJob(id: string, patch: PublicJobPatch): Promise<void>;
  deleteJob(id: string): Promise<boolean>;

  listClips(jobId: string): Promise<PublicClipRow[]>;
  replaceClips(
    jobId: string,
    clientSessionId: string | null,
    clips: PublicClipRow[],
  ): Promise<void>;

  appendLog(entry: AppendPublicLogInput): Promise<void>;
  listLogs(jobId: string, after: number, limit?: number): Promise<WorkerLogEntry[]>;

  getGpu(jobId: string): Promise<GpuTelemetry | null>;
  upsertGpu(
    jobId: string,
    clientSessionId: string | null,
    gpu: Partial<GpuTelemetry>,
  ): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function nowIso(): string {
  return new Date().toISOString();
}

function encodeFilter(value: string): string {
  return encodeURIComponent(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIso(value: unknown, fallback = nowIso()): string {
  const parsed = asString(value);
  return parsed && !Number.isNaN(Date.parse(parsed)) ? parsed : fallback;
}

function toNullableIso(value: unknown): string | null {
  const parsed = asString(value);
  return parsed && !Number.isNaN(Date.parse(parsed)) ? parsed : null;
}

const JOB_STATUSES: readonly PublicJobStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timeout",
];

function asJobStatus(value: unknown): PublicJobStatus {
  return JOB_STATUSES.includes(value as PublicJobStatus)
    ? (value as PublicJobStatus)
    : "queued";
}

function asStage(value: unknown): PipelineStage | null {
  return PIPELINE_STAGES.includes(value as PipelineStage)
    ? (value as PipelineStage)
    : null;
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error", "stage"];

function asLogLevel(value: unknown): LogLevel {
  return LOG_LEVELS.includes(value as LogLevel) ? (value as LogLevel) : "info";
}

function asAspectRatio(value: unknown): AspectRatio {
  return isAspectRatio(value) ? value : "9:16";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function asModules(value: unknown): AiModules {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_AI_MODULES };
  const raw = value as Record<string, unknown>;
  return {
    faceTracking:
      typeof raw.faceTracking === "boolean"
        ? raw.faceTracking
        : DEFAULT_AI_MODULES.faceTracking,
    karaokeAss:
      typeof raw.karaokeAss === "boolean"
        ? raw.karaokeAss
        : DEFAULT_AI_MODULES.karaokeAss,
    hookScore:
      typeof raw.hookScore === "boolean"
        ? raw.hookScore
        : DEFAULT_AI_MODULES.hookScore,
  };
}

type RawRow = Record<string, unknown>;

export function mapSessionRow(raw?: RawRow): ClientSessionRow | null {
  if (!raw) return null;
  const id = asString(raw.id);
  const sessionToken = asString(raw.session_token);
  if (!id || !sessionToken) return null;
  return {
    id,
    sessionToken,
    userAgent: asNullableString(raw.user_agent),
    ipAddress: asNullableString(raw.ip_address),
    jobCount: asNumber(raw.job_count, 0),
    createdAt: toIso(raw.created_at),
    lastSeenAt: toIso(raw.last_seen_at),
  };
}

export function mapPublicJobRow(raw?: RawRow): PublicJobRow | null {
  if (!raw) return null;
  const id = asString(raw.id);
  if (!id) return null;

  const params =
    typeof raw.params === "object" && raw.params !== null
      ? (raw.params as Record<string, unknown>)
      : typeof raw.params_json === "object" && raw.params_json !== null
        ? (raw.params_json as Record<string, unknown>)
        : {};

  return {
    id,
    clientSessionId: asNullableString(raw.client_session_id),
    status: asJobStatus(raw.status),
    stage: asStage(raw.stage),
    progress: asNumber(raw.progress, 0),
    sourceUrl: asString(raw.source_url),
    sourceTitle: asString(raw.source_title),
    sourceThumb: asString(raw.source_thumb),
    clipCount: asNumber(raw.clip_count, 0),
    aspectRatio: asAspectRatio(raw.aspect_ratio),
    modules: asModules(params.modules),
    error: asString(raw.error),
    createdAt: toIso(raw.created_at),
    updatedAt: toIso(raw.updated_at),
  };
}

export function mapPublicClipRow(raw?: RawRow): PublicClipRow | null {
  if (!raw) return null;
  const id = asString(raw.id);
  const jobId = asString(raw.job_id);
  if (!id || !jobId) return null;
  return {
    id,
    jobId,
    clientSessionId: asNullableString(raw.client_session_id),
    title: asString(raw.title) ?? "",
    caption: asString(raw.caption) ?? "",
    hashtags: asStringArray(raw.hashtags),
    startSec: asNumber(raw.start_sec, 0),
    endSec: asNumber(raw.end_sec, 0),
    durationSec: asNumber(raw.duration_sec, 0),
    score: asNumber(raw.score, 0),
    aspectRatio: asAspectRatio(raw.aspect_ratio),
    mediaUrl: asString(raw.media_url) ?? "",
    previewUrl: asString(raw.preview_url),
    thumbnailUrl: asString(raw.thumbnail_url),
    sizeBytes: asNumber(raw.size_bytes, 0),
    status:
      raw.status === "processing" || raw.status === "failed" ? raw.status : "ready",
    createdAt: toIso(raw.created_at),
  };
}

export function mapGpuRow(raw?: RawRow): GpuTelemetry | null {
  if (!raw) return null;
  const bootStartedAt = toNullableIso(raw.boot_started_at);
  const readyAt = toNullableIso(raw.ready_at);
  const bootSeconds =
    bootStartedAt && readyAt
      ? Math.max(0, Math.round((Date.parse(readyAt) - Date.parse(bootStartedAt)) / 1000))
      : null;
  const status = asString(raw.status);
  const allowed: readonly GpuTelemetry["status"][] = [
    "provisioning",
    "booting",
    "running",
    "completed",
    "failed",
    "destroyed",
    "blocked",
  ];
  return {
    vastInstanceId: asString(raw.vast_instance_id) ?? null,
    gpuName: asString(raw.gpu_name) ?? null,
    dphTotal: asNullableNumber(raw.dph_total),
    status: allowed.includes(status as GpuTelemetry["status"])
      ? (status as GpuTelemetry["status"])
      : "provisioning",
    bootStartedAt,
    readyAt,
    bootSeconds,
  };
}

/* ------------------------------------------------------------------ */
/* In-memory driver (dev + unit tests)                                */
/* ------------------------------------------------------------------ */

export class InMemoryPublicStore implements PublicStoreDriver {
  private readonly sessions = new Map<string, ClientSessionRow>();
  private readonly jobsById = new Map<string, PublicJobRow>();
  private readonly clipsByJob = new Map<string, PublicClipRow[]>();
  private readonly logsByJob = new Map<string, WorkerLogEntry[]>();
  private readonly gpuByJob = new Map<string, GpuTelemetry>();
  private logSeq = 0;

  async health(): Promise<boolean> {
    return true;
  }

  async createSession(input: {
    sessionToken: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<ClientSessionRow> {
    const existing = await this.findSessionByToken(input.sessionToken);
    if (existing) return existing;
    const timestamp = nowIso();
    const row: ClientSessionRow = {
      id: randomUUID(),
      sessionToken: input.sessionToken,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      jobCount: 0,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    };
    this.sessions.set(row.id, row);
    return { ...row };
  }

  async findSessionByToken(token: string): Promise<ClientSessionRow | null> {
    for (const row of this.sessions.values()) {
      if (row.sessionToken === token) return { ...row };
    }
    return null;
  }

  async touchSession(id: string): Promise<void> {
    const row = this.sessions.get(id);
    if (row) row.lastSeenAt = nowIso();
  }

  async incrementSessionJobCount(id: string): Promise<void> {
    const row = this.sessions.get(id);
    if (row) {
      row.jobCount += 1;
      row.lastSeenAt = nowIso();
    }
  }

  async countJobsSince(clientSessionId: string, sinceMs: number): Promise<number> {
    const cutoff = Date.now() - sinceMs;
    return [...this.jobsById.values()].filter(
      (row) =>
        row.clientSessionId === clientSessionId &&
        Date.parse(row.createdAt) >= cutoff,
    ).length;
  }

  async createJob(input: CreatePublicJobInput): Promise<PublicJobRow> {
    const timestamp = nowIso();
    const row: PublicJobRow = {
      id: input.id ?? randomUUID(),
      clientSessionId: input.clientSessionId,
      status: input.status ?? "queued",
      stage: input.stage ?? null,
      progress: input.progress ?? 0,
      sourceUrl: input.sourceUrl,
      sourceTitle: input.sourceTitle,
      sourceThumb: input.sourceThumb,
      clipCount: input.clipCount,
      aspectRatio: input.aspectRatio,
      modules: { ...input.modules },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.jobsById.set(row.id, row);
    return { ...row };
  }

  async getJob(id: string): Promise<PublicJobRow | null> {
    const row = this.jobsById.get(id);
    return row ? { ...row } : null;
  }

  async listJobs(clientSessionId: string, limit = 20): Promise<PublicJobRow[]> {
    return [...this.jobsById.values()]
      .filter((row) => row.clientSessionId === clientSessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit))
      .map((row) => ({ ...row }));
  }

  async patchJob(id: string, patch: PublicJobPatch): Promise<void> {
    const row = this.jobsById.get(id);
    if (!row) return;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.stage !== undefined) row.stage = patch.stage;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.error !== undefined) row.error = patch.error ?? undefined;
    if (patch.sourceTitle !== undefined) row.sourceTitle = patch.sourceTitle;
    if (patch.sourceThumb !== undefined) row.sourceThumb = patch.sourceThumb;
    if (patch.clipCount !== undefined) row.clipCount = patch.clipCount;
    if (patch.modules !== undefined) row.modules = { ...patch.modules };
    row.updatedAt = nowIso();
  }

  async deleteJob(id: string): Promise<boolean> {
    this.clipsByJob.delete(id);
    this.logsByJob.delete(id);
    this.gpuByJob.delete(id);
    return this.jobsById.delete(id);
  }

  async listClips(jobId: string): Promise<PublicClipRow[]> {
    return (this.clipsByJob.get(jobId) ?? []).map((row) => ({ ...row }));
  }

  async replaceClips(
    jobId: string,
    clientSessionId: string | null,
    clips: PublicClipRow[],
  ): Promise<void> {
    this.clipsByJob.set(
      jobId,
      clips.map((clip) => ({ ...clip, jobId, clientSessionId })),
    );
  }

  async appendLog(entry: AppendPublicLogInput): Promise<void> {
    this.logSeq += 1;
    const list = this.logsByJob.get(entry.jobId) ?? [];
    list.push({
      id: this.logSeq,
      jobId: entry.jobId,
      level: entry.level,
      stage: entry.stage,
      message: entry.message,
      createdAt: nowIso(),
    });
    this.logsByJob.set(entry.jobId, list);
  }

  async listLogs(jobId: string, after: number, limit = 200): Promise<WorkerLogEntry[]> {
    return (this.logsByJob.get(jobId) ?? [])
      .filter((row) => row.id > after)
      .slice(0, Math.max(1, limit))
      .map((row) => ({ ...row }));
  }

  async getGpu(jobId: string): Promise<GpuTelemetry | null> {
    const row = this.gpuByJob.get(jobId);
    return row ? { ...row } : null;
  }

  async upsertGpu(
    jobId: string,
    _clientSessionId: string | null,
    gpu: Partial<GpuTelemetry>,
  ): Promise<void> {
    const current = this.gpuByJob.get(jobId) ?? {
      vastInstanceId: null,
      gpuName: null,
      dphTotal: null,
      status: "provisioning" as const,
      bootStartedAt: null,
      readyAt: null,
      bootSeconds: null,
    };
    this.gpuByJob.set(jobId, { ...current, ...gpu });
  }
}

/* ------------------------------------------------------------------ */
/* PostgREST driver                                                   */
/* ------------------------------------------------------------------ */

export class PublicStore implements PublicStoreDriver {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(env: Env = process.env) {
    const url = env.SUPABASE_URL?.trim();
    const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      throw new Error(
        "PublicStore: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diset",
      );
    }
    this.baseUrl = url.replace(/\/+$/, "");
    this.apiKey = key;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; prefer?: string } = {},
  ): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        apikey: this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      };
      if (options.prefer) headers.Prefer = options.prefer;

      const init: RequestInit = { method, headers, signal: controller.signal };
      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }

      const response = await fetch(`${this.baseUrl}/rest/v1/${path}`, init);
      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `Supabase REST ${response.status} ${method} ${path}: ` +
            (text.slice(0, 400) || response.statusText),
        );
      }
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Supabase REST request timed out after ${REQUEST_TIMEOUT_MS}ms (${method} ${path})`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.request<RawRow[]>(
        "GET",
        `${TABLES.sessions}?select=id&limit=1`,
      );
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------ sessions ------------------------------ */

  async createSession(input: {
    sessionToken: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<ClientSessionRow> {
    const rows = await this.request<RawRow[]>("POST", TABLES.sessions, {
      body: {
        session_token: input.sessionToken,
        user_agent: input.userAgent ?? null,
        ip_address: input.ipAddress ?? null,
        created_at: nowIso(),
        last_seen_at: nowIso(),
      },
      prefer: "return=representation",
    });
    const mapped = mapSessionRow(rows?.[0]);
    if (mapped) return mapped;

    const existing = await this.findSessionByToken(input.sessionToken);
    if (existing) return existing;
    throw new Error("createSession: Supabase tidak mengembalikan row");
  }

  async findSessionByToken(token: string): Promise<ClientSessionRow | null> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.sessions}?select=*&session_token=eq.${encodeFilter(token)}&limit=1`,
    );
    return mapSessionRow(rows?.[0]);
  }

  async touchSession(id: string): Promise<void> {
    await this.request<RawRow[]>(
      "PATCH",
      `${TABLES.sessions}?id=eq.${encodeFilter(id)}`,
      {
        body: { last_seen_at: nowIso() },
        prefer: "return=minimal",
      },
    );
  }

  async incrementSessionJobCount(id: string): Promise<void> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.sessions}?select=job_count&id=eq.${encodeFilter(id)}&limit=1`,
    );
    const current = asNumber(rows?.[0]?.job_count, 0);
    await this.request<RawRow[]>(
      "PATCH",
      `${TABLES.sessions}?id=eq.${encodeFilter(id)}`,
      {
        body: { job_count: current + 1, last_seen_at: nowIso() },
        prefer: "return=minimal",
      },
    );
  }

  async countJobsSince(clientSessionId: string, sinceMs: number): Promise<number> {
    const since = new Date(Date.now() - sinceMs).toISOString();
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.jobs}?select=id&client_session_id=eq.${encodeFilter(clientSessionId)}` +
        `&created_at=gte.${encodeFilter(since)}`,
    );
    return (rows ?? []).length;
  }

  /* -------------------------------- jobs -------------------------------- */

  async createJob(input: CreatePublicJobInput): Promise<PublicJobRow> {
    const timestamp = nowIso();
    const params = { modules: input.modules };
    const body: RawRow = {
      id: input.id ?? randomUUID(),
      client_session_id: input.clientSessionId,
      status: input.status ?? "queued",
      pipeline: "public-studio",
      stage: input.stage ?? null,
      progress: input.progress ?? 0,
      source_url: input.sourceUrl ?? null,
      source_title: input.sourceTitle ?? null,
      source_thumb: input.sourceThumb ?? null,
      clip_count: input.clipCount,
      aspect_ratio: input.aspectRatio,
      params,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const rows = await this.request<RawRow[]>("POST", TABLES.jobs, {
      body,
      prefer: "return=representation",
    });
    const mapped = mapPublicJobRow(rows?.[0]);
    if (!mapped) throw new Error("createJob: Supabase tidak mengembalikan row");
    return mapped;
  }

  async getJob(id: string): Promise<PublicJobRow | null> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.jobs}?select=*&id=eq.${encodeFilter(id)}&limit=1`,
    );
    return mapPublicJobRow(rows?.[0]);
  }

  async listJobs(clientSessionId: string, limit = 20): Promise<PublicJobRow[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.jobs}?select=*&client_session_id=eq.${encodeFilter(clientSessionId)}` +
        `&order=created_at.desc&limit=${Math.max(1, limit)}`,
    );
    return (rows ?? [])
      .map((row) => mapPublicJobRow(row))
      .filter((row): row is PublicJobRow => row !== null);
  }

  async patchJob(id: string, patch: PublicJobPatch): Promise<void> {
    const body: RawRow = { updated_at: nowIso() };
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.stage !== undefined) body.stage = patch.stage;
    if (patch.progress !== undefined) body.progress = patch.progress;
    if (patch.error !== undefined) body.error = patch.error;
    if (patch.sourceTitle !== undefined) body.source_title = patch.sourceTitle;
    if (patch.sourceThumb !== undefined) body.source_thumb = patch.sourceThumb;
    if (patch.clipCount !== undefined) body.clip_count = patch.clipCount;
    if (patch.modules !== undefined) body.params = { modules: patch.modules };

    await this.request<RawRow[]>(
      "PATCH",
      `${TABLES.jobs}?id=eq.${encodeFilter(id)}`,
      { body, prefer: "return=minimal" },
    );
  }

  async deleteJob(id: string): Promise<boolean> {
    const rows = await this.request<RawRow[]>(
      "DELETE",
      `${TABLES.jobs}?id=eq.${encodeFilter(id)}`,
      { prefer: "return=representation" },
    );
    return (rows ?? []).length > 0;
  }

  /* -------------------------------- clips ------------------------------- */

  async listClips(jobId: string): Promise<PublicClipRow[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.clips}?select=*&job_id=eq.${encodeFilter(jobId)}&order=created_at.asc`,
    );
    return (rows ?? [])
      .map((row) => mapPublicClipRow(row))
      .filter((row): row is PublicClipRow => row !== null);
  }

  async replaceClips(
    jobId: string,
    clientSessionId: string | null,
    clips: PublicClipRow[],
  ): Promise<void> {
    await this.request<RawRow[]>(
      "DELETE",
      `${TABLES.clips}?job_id=eq.${encodeFilter(jobId)}`,
      { prefer: "return=minimal" },
    );
    if (clips.length === 0) return;

    const body = clips.map((clip) => ({
      id: clip.id || randomUUID(),
      job_id: jobId,
      client_session_id: clientSessionId,
      title: clip.title,
      caption: clip.caption,
      hashtags: clip.hashtags,
      start_sec: clip.startSec,
      end_sec: clip.endSec,
      duration_sec: clip.durationSec,
      score: clip.score,
      aspect_ratio: clip.aspectRatio,
      media_url: clip.mediaUrl,
      preview_url: clip.previewUrl ?? null,
      thumbnail_url: clip.thumbnailUrl ?? null,
      size_bytes: clip.sizeBytes,
      status: clip.status,
      created_at: clip.createdAt || nowIso(),
    }));

    await this.request<RawRow[]>("POST", TABLES.clips, {
      body,
      prefer: "return=minimal",
    });
  }

  /* --------------------------------- logs ------------------------------- */

  async appendLog(entry: AppendPublicLogInput): Promise<void> {
    await this.request<RawRow[]>("POST", TABLES.logs, {
      body: {
        job_id: entry.jobId,
        client_session_id: entry.clientSessionId,
        instance_id: entry.instanceId ?? null,
        level: entry.level,
        stage: entry.stage,
        message: entry.message,
      },
      prefer: "return=minimal",
    });
  }

  async listLogs(jobId: string, after: number, limit = 200): Promise<WorkerLogEntry[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.logs}?select=id,job_id,level,stage,message,created_at` +
        `&job_id=eq.${encodeFilter(jobId)}&id=gt.${Math.max(0, Math.floor(after))}` +
        `&order=id.asc&limit=${Math.max(1, limit)}`,
    );
    return (rows ?? []).map((row) => ({
      id: asNumber(row.id, 0),
      jobId: asString(row.job_id) ?? jobId,
      level: asLogLevel(row.level),
      stage: asStage(row.stage),
      message: asString(row.message) ?? "",
      createdAt: toIso(row.created_at),
    }));
  }

  /* --------------------------------- gpu -------------------------------- */

  async getGpu(jobId: string): Promise<GpuTelemetry | null> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.gpu}?select=*&job_id=eq.${encodeFilter(jobId)}` +
        `&order=created_at.desc&limit=1`,
    );
    return mapGpuRow(rows?.[0]);
  }

  async upsertGpu(
    jobId: string,
    clientSessionId: string | null,
    gpu: Partial<GpuTelemetry>,
  ): Promise<void> {
    const existing = await this.request<RawRow[]>(
      "GET",
      `${TABLES.gpu}?select=id&job_id=eq.${encodeFilter(jobId)}&limit=1`,
    );
    const body: RawRow = {};
    if (gpu.vastInstanceId !== undefined) body.vast_instance_id = gpu.vastInstanceId;
    if (gpu.gpuName !== undefined) body.gpu_name = gpu.gpuName;
    if (gpu.dphTotal !== undefined) body.dph_total = gpu.dphTotal;
    if (gpu.status !== undefined) body.status = gpu.status;
    if (gpu.bootStartedAt !== undefined) body.boot_started_at = gpu.bootStartedAt;
    if (gpu.readyAt !== undefined) body.ready_at = gpu.readyAt;

    const existingId = asString(existing?.[0]?.id);
    if (existingId) {
      await this.request<RawRow[]>(
        "PATCH",
        `${TABLES.gpu}?id=eq.${encodeFilter(existingId)}`,
        { body, prefer: "return=minimal" },
      );
      return;
    }

    await this.request<RawRow[]>("POST", TABLES.gpu, {
      body: { job_id: jobId, client_session_id: clientSessionId, ...body },
      prefer: "return=minimal",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                            */
/* ------------------------------------------------------------------ */

/** Returns the PostgREST driver when Supabase is configured, else in-memory. */
export function createPublicStore(env: Env = process.env): PublicStoreDriver {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new PublicStore(env);
  }
  return new InMemoryPublicStore();
}
