/**
 * Data store abstraction — in-memory untuk dev/test, PostgREST (Supabase)
 * untuk produksi.
 *
 * Tidak memakai `@supabase/supabase-js`: adapter PostgREST hanya memakai
 * `fetch` bawaan Node 18+ sehingga kontrak HTTP tetap sama dan typecheck
 * tidak menambah dependency baru.
 *
 * Env yang dibaca oleh `createStore()`:
 *   - `SUPABASE_URL`              (wajib untuk PostgresRestStore)
 *   - `SUPABASE_SERVICE_ROLE_KEY` (wajib untuk PostgresRestStore)
 *
 * Bila salah satu tidak diset, fallback ke `InMemoryStore`.
 *
 * Verifikasi: `pnpm typecheck` dan `pnpm test`
 */

import { randomUUID } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";

/** null = tenant job (legacy API); set = public studio job. */
export interface JobRow {
  id: string;
  userId: string;
  status: JobStatus;
  pipeline: string;
  params: unknown;
  sourceUrl?: string;
  mediaUrl?: string;
  progress: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  priority: number;
  clientSessionId?: string | null;
}

export interface MediaRow {
  id: string;
  jobId: string;
  providerId?: string;
  bucket: string;
  objectKey: string;
  mediaUrl: string;
  sizeBytes: number;
  createdAt: string;
}

export interface WalletRow {
  userId: string;
  credits_balance: number;
  local_balance: number;
  currency_code: string;
  exchange_rate: number;
  is_active: boolean;
}

export interface TransactionRow {
  id: string;
  userId: string;
  amountLocal: number;
  currency: string;
  creditsAdded: number;
  gateway: string;
  externalTxId?: string;
  status: string;
}

export interface VastRow {
  id: string;
  instanceId: string;
  status: string;
  createdAt: string;
  deletedAt?: string;
  blockedUntil?: string;
}

/** Audit write input (mirrors `audit_logs`). */
export interface AuditEntryInput {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: unknown;
  ip?: string;
  userAgent?: string;
}

export interface LogEntry extends LogEntryInput {
  id: number;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: unknown;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export interface CreateJobInput {
  id?: string;
  userId: string;
  status?: JobStatus;
  pipeline: string;
  params?: unknown;
  sourceUrl?: string;
  mediaUrl?: string;
  progress?: number;
  error?: string;
  priority?: number;
  createdAt?: string;
  updatedAt?: string;
  clientSessionId?: string | null;
}

export type JobPatch = Partial<
  Pick<
    JobRow,
    | 'userId'
    | 'clientSessionId'
    | 'status'
    | 'pipeline'
    | 'params'
    | 'sourceUrl'
    | 'mediaUrl'
    | 'progress'
    | 'error'
    | 'priority'
    | 'updatedAt'
  >
>;

export interface TopupInput {
  amountLocal: number;
  currency: string;
  gateway: string;
}

/** Append-only worker log row (mirrors `worker_logs`). */
export interface LogEntryInput {
  jobId: string;
  userId?: string;
  clientSessionId?: string | null;
  level: string;
  stage?: string | null;
  message: string;
  instanceId?: string | null;
}

/** Lightweight GPU/instance telemetry (mirrors `gpu_instances`). */
export interface GpuRow {
  id: string;
  jobId: string;
  instanceId?: string;
  status: string;
  bootStartedAt?: string;
  readyAt?: string;
  blockedUntil?: string;
  createdAt?: string;
}

export interface DataStore {
  health(): Promise<boolean>;
  listJobs(userId?: string): Promise<JobRow[]>;
  getJob(id: string): Promise<JobRow | null>;
  createJob(input: CreateJobInput): Promise<JobRow>;
  updateJob(id: string, patch: JobPatch): Promise<JobRow | null>;
  listClips(jobId: string): Promise<MediaRow[]>;
  getWallet(userId: string): Promise<WalletRow>;
  /**
   * Admin/system-only: settle a top-up immediately (credits the wallet).
   * Public callers must go through {@link recordPendingTopup} instead.
   */
  applyTopup(userId: string, input: TopupInput): Promise<TransactionRow>;
  /**
   * Public/session caller: record a *pending* top-up intent. No wallet is
   * created or credited — the balance only changes once the payment gateway
   * confirms the payment and an admin/system path calls `applyTopup`.
   */
  recordPendingTopup(userId: string, input: TopupInput): Promise<TransactionRow>;
  listTransactions(userId: string): Promise<TransactionRow[]>;
  listVastInstances(): Promise<VastRow[]>;
  getVastInstance(id: string): Promise<VastRow | null>;
  addVastInstance(row: VastRow): Promise<VastRow>;
  deleteVastInstance(id: string): Promise<VastRow | null>;
  appendLog(entry: LogEntryInput): Promise<void>;
  getGpu(jobId: string): Promise<GpuRow | null>;
  countJobsSince(userId: string | undefined, sinceMs: number): Promise<number>;
  countRunningJobs(userId?: string): Promise<number>;
  countRunningGpuInstances(): Promise<number>;
  audit(entry: AuditEntryInput): Promise<void>;
}

export type Env = Record<string, string | undefined>;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_EXCHANGE_RATE = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const VAST_BLOCK_MS = 24 * 60 * 60 * 1000;

const TABLES = {
  jobs: "jobs",
  media: "jobs_media",
  wallets: "user_wallets",
  transactions: "credit_transactions",
  vast: "vast_instances",
  audit: "audit_logs",
  gpu: "gpu_instances",
  worker_logs: "worker_logs",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string")
    return value.length > 0 ? [value] : undefined;
  return undefined;
}

function toIso(value: unknown, fallback: string): string {
  const parsed = asString(value);
  return parsed && !Number.isNaN(Date.parse(parsed)) ? parsed : fallback;
}

/* ------------------------------------------------------------------ */
/* InMemoryStore — dev/test, tanpa dependency                           */
/* ------------------------------------------------------------------ */

/** In-memory (Map-based) untuk dev lokal dan unit test. */
export class InMemoryStore implements DataStore {
  private readonly jobs = new Map<string, JobRow>();
  private readonly clips = new Map<string, MediaRow[]>();
  private readonly wallets = new Map<string, WalletRow>();
  private readonly transactions = new Map<string, TransactionRow[]>();
  private readonly vastInstances = new Map<string, VastRow>();
  private readonly audits: AuditRow[] = [];
  private readonly logs: LogEntry[] = [];
  private readonly gpus = new Map<string, GpuRow>();

  async health(): Promise<boolean> {
    return true;
  }

  async listJobs(userId?: string): Promise<JobRow[]> {
    const rows = [...this.jobs.values()]
      .filter((row) => (userId === undefined ? true : row.userId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows.map((row) => ({ ...row }));
  }

  async getJob(id: string): Promise<JobRow | null> {
    const row = this.jobs.get(id);
    return row ? { ...row } : null;
  }

  async createJob(input: CreateJobInput): Promise<JobRow> {
    const timestamp = nowIso();
    const row: JobRow = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      status: input.status ?? "queued",
      pipeline: input.pipeline,
      params: input.params ?? null,
      sourceUrl: input.sourceUrl,
      mediaUrl: input.mediaUrl,
      progress: input.progress ?? 0,
      error: input.error,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
      priority: input.priority ?? 0,
      clientSessionId: input.clientSessionId ?? null,
    };
    this.jobs.set(row.id, row);
    return { ...row };
  }

  async updateJob(id: string, patch: JobPatch): Promise<JobRow | null> {
    const existing = this.jobs.get(id);
    if (!existing) return null;

    const next: JobRow = { ...existing, updatedAt: patch.updatedAt ?? nowIso() };
    if (patch.userId !== undefined) next.userId = patch.userId;
    if (patch.clientSessionId !== undefined) next.clientSessionId = patch.clientSessionId;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.pipeline !== undefined) next.pipeline = patch.pipeline;
    if (patch.params !== undefined) next.params = patch.params;
    if (patch.sourceUrl !== undefined) next.sourceUrl = patch.sourceUrl;
    if (patch.mediaUrl !== undefined) next.mediaUrl = patch.mediaUrl;
    if (patch.progress !== undefined) next.progress = patch.progress;
    if (patch.error !== undefined) next.error = patch.error;
    if (patch.priority !== undefined) next.priority = patch.priority;

    this.jobs.set(id, next);
    return { ...next };
  }

  async listClips(jobId: string): Promise<MediaRow[]> {
    return (this.clips.get(jobId) ?? []).map((row) => ({ ...row }));
  }

  async getWallet(userId: string): Promise<WalletRow> {
    const existing = this.wallets.get(userId);
    if (existing) return { ...existing };
    const wallet = defaultWallet(userId);
    this.wallets.set(userId, wallet);
    return { ...wallet };
  }

  async applyTopup(userId: string, input: TopupInput): Promise<TransactionRow> {
    const wallet = await this.getWallet(userId);
    const creditsAdded = computeCredits(input.amountLocal, wallet.exchange_rate);

    const updatedWallet: WalletRow = {
      ...wallet,
      credits_balance: wallet.credits_balance + creditsAdded,
      local_balance: wallet.local_balance + input.amountLocal,
    };
    this.wallets.set(userId, updatedWallet);

    const row: TransactionRow = {
      id: randomUUID(),
      userId,
      amountLocal: input.amountLocal,
      currency: input.currency,
      creditsAdded,
      gateway: input.gateway,
      status: "settled",
    };
    const list = this.transactions.get(userId) ?? [];
    list.push(row);
    this.transactions.set(userId, list);
    return { ...row };
  }

  async recordPendingTopup(userId: string, input: TopupInput): Promise<TransactionRow> {
    // Intentionally does NOT call getWallet(): a pending intent must never
    // provision (much less credit) a wallet on its own.
    const expectedCredits = computeCredits(input.amountLocal, DEFAULT_EXCHANGE_RATE);
    const row: TransactionRow = {
      id: randomUUID(),
      userId,
      amountLocal: input.amountLocal,
      currency: input.currency,
      creditsAdded: expectedCredits,
      gateway: input.gateway,
      status: "pending",
    };
    const list = this.transactions.get(userId) ?? [];
    list.push(row);
    this.transactions.set(userId, list);
    return { ...row };
  }

  async listTransactions(userId: string): Promise<TransactionRow[]> {
    return (this.transactions.get(userId) ?? []).map((row) => ({ ...row }));
  }

  async listVastInstances(): Promise<VastRow[]> {
    return [...this.vastInstances.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ ...row }));
  }

  async getVastInstance(id: string): Promise<VastRow | null> {
    const row = this.vastInstances.get(id);
    return row ? { ...row } : null;
  }

  async addVastInstance(row: VastRow): Promise<VastRow> {
    this.vastInstances.set(row.id, { ...row });
    return { ...row };
  }

  async deleteVastInstance(id: string): Promise<VastRow | null> {
    const existing = await this.getVastInstance(id);
    if (!existing || existing.deletedAt) return null;

    const deletedAt = nowIso();
    const blockedUntil = new Date(Date.parse(deletedAt) + VAST_BLOCK_MS).toISOString();
    this.vastInstances.set(id, {
      ...existing,
      deletedAt,
      blockedUntil,
      status: "cancelled",
    });
    return { ...(this.vastInstances.get(id) as VastRow) };
  }

  async appendLog(entry: LogEntryInput): Promise<void> {
    this.logs.push({ id: this.logs.length + 1, createdAt: nowIso(), ...entry });
  }

  async getGpu(jobId: string): Promise<GpuRow | null> {
    const row = this.gpus.get(jobId);
    return row ? { ...row } : null;
  }

  async addGpu(row: GpuRow): Promise<GpuRow> {
    // Keyed by jobId: satu job hanya punya satu instance aktif.
    this.gpus.set(row.jobId, { ...row });
    return { ...row };
  }

  async countJobsSince(userId: string | undefined, sinceMs: number): Promise<number> {
    const since = Date.now() - sinceMs;
    return [...this.jobs.values()].filter((row) => {
      const created = Date.parse(row.createdAt);
      return (userId === undefined || row.userId === userId) && created >= since;
    }).length;
  }

  async countRunningJobs(userId?: string): Promise<number> {
    return [...this.jobs.values()].filter(
      (row) => row.status === "running" && (userId === undefined || row.userId === userId),
    ).length;
  }

  async countRunningVastInstances(): Promise<number> {
    return [...this.vastInstances.values()].filter(
      (row) => row.status !== "cancelled" && row.status !== "destroyed",
    ).length;
  }

  async countRunningGpuInstances(): Promise<number> {
    return [...this.gpus.values()].filter(
      (row) => row.status === "provisioning" || row.status === "booting" || row.status === "running",
    ).length;
  }

  async audit(entry: AuditEntryInput): Promise<void> {
    this.audits.push({ id: randomUUID(), createdAt: nowIso(), ...entry });
  }

  /** Test/debug helper â€” bukan bagian dari DataStore public. */
  debugLogCount(): number {
    return this.logs.length;
  }

  debugVastCount(): number {
    return this.vastInstances.size;
  }
}

/* ------------------------------------------------------------------ */
/* PostgresRestStore (Supabase PostgREST)                              */
/* ------------------------------------------------------------------ */

type RawRow = Record<string, unknown>;

function defaultWallet(userId: string): WalletRow {
  return {
    userId,
    credits_balance: 0,
    local_balance: 0,
    currency_code: "idr",
    exchange_rate: DEFAULT_EXCHANGE_RATE,
    is_active: true,
  };
}

function computeCredits(amountLocal: number, exchangeRate: number): number {
  const rate =
    Number.isFinite(exchangeRate) && exchangeRate > 0
      ? exchangeRate
      : DEFAULT_EXCHANGE_RATE;
  return Math.round(amountLocal / rate);
}

/** PostgREST adapter — tidak ada Supabase SDK, hanya `fetch` bawaan. */
export class PostgresRestStore implements DataStore {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(env: Env = process.env) {
    const url = env.SUPABASE_URL?.trim();
    const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      throw new Error(
        "PostgresRestStore: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diset",
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
            (text.slice(0, 500) || response.statusText),
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
      await this.request<RawRow[]>("GET", `${TABLES.jobs}?select=id&limit=1`);
      return true;
    } catch {
      return false;
    }
  }

  async listJobs(userId?: string): Promise<JobRow[]> {
    const filter = userId === undefined ? "" : `&user_id=eq.${encodeFilter(userId)}`;
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.jobs}?select=*&order=created_at.desc${filter}`,
    );
    return (rows ?? [])
      .map((row) => mapJobRow(row))
      .filter((row): row is JobRow => row !== null);
  }

  async getJob(id: string): Promise<JobRow | null> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.jobs}?select=*&id=eq.${encodeFilter(id)}&limit=1`,
    );
    return mapJobRow(rows?.[0]);
  }

  async createJob(input: CreateJobInput): Promise<JobRow> {
    const timestamp = nowIso();
    const body: RawRow = {
      id: input.id ?? randomUUID(),
      user_id: input.userId,
      status: input.status ?? "queued",
      pipeline: input.pipeline,
      params: input.params ?? null,
      progress: input.progress ?? 0,
      priority: input.priority ?? 0,
      created_at: input.createdAt ?? timestamp,
      updated_at: input.updatedAt ?? timestamp,
    };
    if (input.sourceUrl !== undefined) body.source_url = input.sourceUrl;
    if (input.mediaUrl !== undefined) body.media_url = input.mediaUrl;
    if (input.error !== undefined) body.error = input.error;
    if (input.clientSessionId !== undefined) {
      body.client_session_id = input.clientSessionId;
    }

    const rows = await this.request<RawRow[]>("POST", TABLES.jobs, {
      body,
      prefer: "return=representation",
    });
    const mapped = mapJobRow(rows?.[0]);
    if (!mapped) throw new Error("createJob: Supabase tidak mengembalikan row");
    return mapped;
  }

  async updateJob(id: string, patch: JobPatch): Promise<JobRow | null> {
    const body: RawRow = { updated_at: patch.updatedAt ?? nowIso() };
    if (patch.userId !== undefined) body.user_id = patch.userId;
    if (patch.clientSessionId !== undefined) body.client_session_id = patch.clientSessionId;
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.pipeline !== undefined) body.pipeline = patch.pipeline;
    if (patch.params !== undefined) body.params = patch.params;
    if (patch.sourceUrl !== undefined) body.source_url = patch.sourceUrl;
    if (patch.mediaUrl !== undefined) body.media_url = patch.mediaUrl;
    if (patch.progress !== undefined) body.progress = patch.progress;
    if (patch.error !== undefined) body.error = patch.error;
    if (patch.priority !== undefined) body.priority = patch.priority;

    const rows = await this.request<RawRow[]>(
      "PATCH",
      `${TABLES.jobs}?id=eq.${encodeFilter(id)}`,
      { body, prefer: "return=representation" },
    );
    return mapJobRow(rows?.[0]);
  }

  async listClips(jobId: string): Promise<MediaRow[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.media}?job_id=eq.${encodeFilter(jobId)}&order=created_at.asc`,
    );
    return (rows ?? [])
      .map((row) => mapMediaRow(row))
      .filter((row): row is MediaRow => row !== null);
  }

  async getWallet(userId: string): Promise<WalletRow> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.wallets}?user_id=eq.${encodeFilter(userId)}&limit=1`,
    );
    if ((rows?.length ?? 0) > 0) return mapWalletRow(rows![0], userId);
    return this.ensureWallet(userId);
  }

  /**
   * Mengembalikan row wallet. Jika `user_wallets` tidak punya baris untuk
   * `userId`, sisipkan row default secara idempoten (`INSERT ... ON CONFLICT
   * DO NOTHING`) lalu baca ulang; hal ini menangani race condition saat dua
   * request masuk bersamaan. Baris yang lolos konflik diabaikan (ignore-
   * duplicates), dan re-select selalu mengembalikan row yang ada.
   *
   * Catatan: kalau tabel `user_wallets` belum diprovisioning (mis. deployment
   * pertama), sisip DB gagal — kita tidak melempar 500, melainkan jatuh ke
   * row default (tidak ada wallet dalam DB), jadi endpoint tetap merespons
   * 200. Admin tetap harus membuat migration `user_wallets` di DB (tugas ini
   * tidak menambahkan migration sendiri).
   */
  async ensureWallet(userId: string): Promise<WalletRow> {
    // Insert with snake_case keys (PostgREST expects them) and
    // `resolution=ignore-duplicates` so a concurrent insert is a no-op.
    try {
      await this.request<RawRow[]>(
        "POST",
        `${TABLES.wallets}?on_conflict=user_id`,
        {
          body: {
            user_id: userId,
            credits_balance: 0,
            local_balance: 0,
            currency_code: "idr",
            exchange_rate: DEFAULT_EXCHANGE_RATE,
            is_active: true,
          },
          prefer: "resolution=ignore-duplicates,return=representation",
        },
      );
    } catch (error) {
      // Transient / tabel belum diprovisioning. Jangan 500 — selesaikan dengan
      // row default. Log per-request supaya admin bisa lihat tanpa spam.
      if (error instanceof Error) {
        console.warn(
          `[api-v1] wallet auto-provision untuk user "${userId}" di-skip: ${error.message}`,
        );
      }
    }

    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.wallets}?user_id=eq.${encodeFilter(userId)}&limit=1`,
    );
    if ((rows?.length ?? 0) > 0) return mapWalletRow(rows![0], userId);
    return defaultWallet(userId);
  }

  async applyTopup(userId: string, input: TopupInput): Promise<TransactionRow> {
    const wallet = await this.getWallet(userId);
    const exchangeRate =
      wallet.exchange_rate > 0 ? wallet.exchange_rate : DEFAULT_EXCHANGE_RATE;
    const creditsAdded = computeCredits(input.amountLocal, exchangeRate);
    const txId = randomUUID();

    await this.request<RawRow[]>(
      "POST",
      `${TABLES.wallets}?on_conflict=user_id`,
      {
        body: {
          user_id: userId,
          credits_balance: wallet.credits_balance + creditsAdded,
          local_balance: wallet.local_balance + input.amountLocal,
          currency_code: input.currency,
          exchange_rate: exchangeRate,
          is_active: true,
        },
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );

    const rows = await this.request<RawRow[]>("POST", TABLES.transactions, {
      body: {
        id: txId,
        user_id: userId,
        amount_local: input.amountLocal,
        currency: input.currency,
        credits_added: creditsAdded,
        gateway: input.gateway,
        status: "settled",
      },
      prefer: "return=representation",
    });

    return (
      mapTransactionRow(rows?.[0]) ?? {
        id: txId,
        userId,
        amountLocal: input.amountLocal,
        currency: input.currency,
        creditsAdded,
        gateway: input.gateway,
        status: "settled",
      }
    );
  }

  async recordPendingTopup(userId: string, input: TopupInput): Promise<TransactionRow> {
    // Pending intent only: writes a transaction row, never the wallet table.
    const txId = randomUUID();
    const expectedCredits = computeCredits(input.amountLocal, DEFAULT_EXCHANGE_RATE);

    const rows = await this.request<RawRow[]>("POST", TABLES.transactions, {
      body: {
        id: txId,
        user_id: userId,
        amount_local: input.amountLocal,
        currency: input.currency,
        credits_added: expectedCredits,
        gateway: input.gateway,
        status: "pending",
      },
      prefer: "return=representation",
    });

    return (
      mapTransactionRow(rows?.[0]) ?? {
        id: txId,
        userId,
        amountLocal: input.amountLocal,
        currency: input.currency,
        creditsAdded: expectedCredits,
        gateway: input.gateway,
        status: "pending",
      }
    );
  }

  async listTransactions(userId: string): Promise<TransactionRow[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.transactions}?user_id=eq.${encodeFilter(userId)}` +
        "&order=created_at.desc",
    );
    return (rows ?? [])
      .map((row) => mapTransactionRow(row))
      .filter((row): row is TransactionRow => row !== null);
  }

  async listVastInstances(): Promise<VastRow[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.vast}?select=*&order=created_at.desc`,
    );
    return (rows ?? [])
      .map((row) => mapVastRow(row))
      .filter((row): row is VastRow => row !== null);
  }

  async getVastInstance(id: string): Promise<VastRow | null> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.vast}?select=*&id=eq.${encodeFilter(id)}&limit=1`,
    );
    return mapVastRow(rows?.[0]);
  }

  async addVastInstance(row: VastRow): Promise<VastRow> {
    const body: RawRow = {
      id: row.id || randomUUID(),
      instance_id: row.instanceId,
      status: row.status,
      created_at: row.createdAt || nowIso(),
    };
    if (row.deletedAt !== undefined) body.deleted_at = row.deletedAt;
    if (row.blockedUntil !== undefined) body.blocked_until = row.blockedUntil;

    const rows = await this.request<RawRow[]>("POST", TABLES.vast, {
      body,
      prefer: "return=representation",
    });
    const mapped = mapVastRow(rows?.[0]);
    if (!mapped) throw new Error("addVastInstance: Supabase tidak mengembalikan row");
    return mapped;
  }

  async deleteVastInstance(id: string): Promise<VastRow | null> {
    const existing = await this.getVastInstance(id);
    if (!existing || existing.deletedAt) return null;

    const deletedAt = nowIso();
    const blockedUntil = new Date(Date.parse(deletedAt) + VAST_BLOCK_MS).toISOString();
    const rows = await this.request<RawRow[]>(
      "PATCH",
      `${TABLES.vast}?id=eq.${encodeFilter(id)}`,
      {
        body: {
          deleted_at: deletedAt,
          blocked_until: blockedUntil,
          status: "cancelled",
        },
        prefer: "return=representation",
      },
    );
    return mapVastRow(rows?.[0]);
  }

  async appendLog(entry: LogEntryInput): Promise<void> {
    // `worker_logs.id` adalah `bigint generated always as identity` (0004) dan
    // tabel ini tidak punya kolom `user_id` — mengirim keduanya akan ditolak
    // PostgREST (400). Identitas sesi publik ada di `client_session_id`.
    const body: RawRow = {
      job_id: entry.jobId,
      client_session_id: entry.clientSessionId ?? null,
      instance_id: entry.instanceId ?? null,
      level: entry.level,
      stage: entry.stage ?? null,
      message: entry.message,
      created_at: nowIso(),
    };
    await this.request<RawRow[]>("POST", TABLES.worker_logs, { body });
  }

  async getGpu(jobId: string): Promise<GpuRow | null> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.gpu}?select=*&job_id=eq.${encodeFilter(jobId)}&limit=1`,
    );
    if (!rows || rows.length === 0) return null;
    const raw = rows[0];
    const row: GpuRow = {
      id: asString(raw.id) ?? randomUUID(),
      jobId,
      instanceId: asString(raw.vast_instance_id),
      status: asString(raw.status) ?? "provisioning",
      bootStartedAt: asString(raw.boot_started_at),
      readyAt: asString(raw.ready_at),
      blockedUntil: asString(raw.blocked_until),
      createdAt: asString(raw.created_at),
    };
    return row;
  }

  async countRunningGpuInstances(): Promise<number> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.gpu}?select=id&status=in.(provisioning,booting,running)`,
    );
    return (rows ?? []).length;
  }

  async countJobsSince(userId: string | undefined, sinceMs: number): Promise<number> {
    const since = new Date(nowIsoMs() - sinceMs);
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.jobs}?select=id&created_at=gte.${encodeFilter(since.toISOString())}` +
        (userId === undefined ? "" : `&user_id=eq.${encodeFilter(userId)}`),
    );
    return (rows ?? []).length;
  }

  async countRunningJobs(userId?: string): Promise<number> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.jobs}?select=id&status=eq.running` +
        (userId === undefined ? "" : `&user_id=eq.${encodeFilter(userId)}`),
    );
    return (rows ?? []).length;
  }

  async countRunningVastInstances(): Promise<number> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.vast}?select=id&status=eq.running`,
    );
    return (rows ?? []).length;
  }

  async audit(entry: AuditEntryInput): Promise<void> {
    await this.request<RawRow[]>("POST", TABLES.audit, {
      body: {
        id: randomUUID(),
        user_id: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        details: entry.details ?? null,
        ip: entry.ip ?? null,
        user_agent: entry.userAgent ?? null,
        created_at: nowIso(),
      },
      prefer: "return=minimal",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pilih adapter berdasarkan env. PostgREST dipakai hanya bila
 * `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sama-sama diset.
 */
export function createStore(env: Env = process.env): DataStore {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new PostgresRestStore(env);
  }
  return new InMemoryStore();
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function encodeFilter(value: string): string {
  return encodeURIComponent(value);
}

function nowIsoMs(): number {
  return Date.now();
}

/* ------------------------------------------------------------------ */
/* Row mappers (snake_case PostgREST -> camelCase domain)              */
/* ------------------------------------------------------------------ */

const JOB_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timeout",
];

function asJobStatus(value: unknown): JobStatus {
  return JOB_STATUSES.includes(value as JobStatus) ? (value as JobStatus) : "queued";
}

export function mapJobRow(raw?: RawRow): JobRow | null {
  if (!raw) return null;
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    userId: asString(raw.user_id) ?? "",
    status: asJobStatus(raw.status),
    pipeline: asString(raw.pipeline) ?? "default",
    params: raw.params ?? null,
    sourceUrl: asString(raw.source_url),
    mediaUrl: asString(raw.media_url),
    progress: asNumber(raw.progress, 0),
    error: asString(raw.error),
    createdAt: toIso(raw.created_at, nowIso()),
    updatedAt: toIso(raw.updated_at, nowIso()),
    priority: asNumber(raw.priority, 0),
    clientSessionId: asString(raw.client_session_id) ?? null,
  };
}

export function mapMediaRow(raw?: RawRow): MediaRow | null {
  if (!raw) return null;
  const id = asString(raw.id);
  const jobId = asString(raw.job_id);
  if (!id || !jobId) return null;
  return {
    id,
    jobId,
    providerId: asString(raw.provider_id),
    bucket: asString(raw.bucket) ?? "",
    objectKey: asString(raw.object_key) ?? "",
    mediaUrl: asString(raw.media_url) ?? "",
    sizeBytes: asNumber(raw.size_bytes, 0),
    createdAt: toIso(raw.created_at, nowIso()),
  };
}

export function mapWalletRow(raw?: RawRow, userId?: string): WalletRow {
  const fallback = defaultWallet(userId ?? asString(raw?.user_id) ?? "");
  if (!raw) return fallback;
  return {
    userId: asString(raw.user_id) ?? fallback.userId,
    credits_balance: asNumber(raw.credits_balance, fallback.credits_balance),
    local_balance: asNumber(raw.local_balance, fallback.local_balance),
    currency_code: asString(raw.currency_code) ?? fallback.currency_code,
    exchange_rate: asNumber(raw.exchange_rate, fallback.exchange_rate),
    is_active: asBoolean(raw.is_active, fallback.is_active),
  };
}

export function mapTransactionRow(raw?: RawRow): TransactionRow | null {
  if (!raw) return null;
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    userId: asString(raw.user_id) ?? "",
    amountLocal: asNumber(raw.amount_local, 0),
    currency: asString(raw.currency) ?? "idr",
    creditsAdded: asNumber(raw.credits_added, 0),
    gateway: asString(raw.gateway) ?? "",
    externalTxId: asString(raw.external_tx_id),
    status: asString(raw.status) ?? "settled",
  };
}

export function mapVastRow(raw?: RawRow): VastRow | null {
  if (!raw) return null;
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    instanceId: asString(raw.instance_id) ?? "",
    status: asString(raw.status) ?? "unknown",
    createdAt: toIso(raw.created_at, nowIso()),
    deletedAt: asString(raw.deleted_at),
    blockedUntil: asString(raw.blocked_until),
  };
}
