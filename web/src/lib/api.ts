import type {
  Clip,
  DnsCheckResult,
  Job,
  JobStatus,
  PaginatedResponse,
  PresignResult,
  TopupTransaction,
  User,
  VastInstance,
  Wallet,
} from './types';

// Next.js injects this at build time. Declared locally so isolated typechecks
// (`--noResolve`, without `@types/node`) stay clean as well.
declare const process: {
  env: Record<string, string | undefined>;
};

const TOKEN_KEY = 'hotclip_token';
/**
 * Legacy dev fallback. Not used at runtime: with `NEXT_PUBLIC_API_URL` unset
 * the web app talks to its own origin (nginx proxies `/api/` to the API),
 * which also keeps cookies and CORS out of the picture.
 */
export const DEFAULT_API_BASE = 'http://localhost:8080';

/**
 * Base URL for every direct fetch in the web app. `NEXT_PUBLIC_API_URL` is a
 * **build-time** value in Next.js and the deployment sets it to the app's
 * public HTTPS origin (e.g. `https://app.example.com`), not to the API
 * container. Falling back to the same-origin prefix keeps the browser working
 * when the variable is unset (nginx routes `/api/` to the API container).
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? ''
).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Input accepted by {@link ApiClient.createJob}. */
export interface CreateJobInput {
  sourceUrl?: string;
  sourceFile?: string;
  presignedUrl?: string;
  ratio?: string;
  subtitlePreset?: string;
  maxClips?: number;
  [key: string]: unknown;
}

/** Storage pool summary returned by `GET /api/admin/storage-pools`. */
export interface AdminStoragePool {
  id: string;
  name?: string;
  provider_name?: string;
  account_label?: string;
  priority?: number;
  quota_bytes?: number;
  used_bytes?: number;
  health_status?: string;
  is_active?: boolean;
  active_provider_id?: string;
  providers?: AdminStoragePool[];
  [key: string]: unknown;
}

/** Health payload returned by `GET /api/admin/health`. */
export interface AdminHealth {
  ok?: boolean;
  uptime?: number;
  version?: string;
  [key: string]: unknown;
}

export interface AuthResult {
  user: User;
  token: string;
}

/* ------------------------------------------------------------------ */
/* Response normalization helpers                                      */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function statusCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'RATE_LIMITED';
    case 501:
      return 'NOT_IMPLEMENTED';
    default:
      return 'API_ERROR';
  }
}

function errorFromEnvelope(
  payload: Record<string, unknown>,
  status: number,
): ApiError {
  const raw = payload.error;
  let message = 'Request failed';
  let code = statusCode(status);
  let details: Record<string, unknown> | undefined;

  if (typeof raw === 'string') {
    message = raw;
  } else if (isRecord(raw)) {
    message =
      asString(raw.message) ??
      asString(raw.error) ??
      message;
    code = asString(raw.code) ?? code;
    if (isRecord(raw.details)) details = raw.details;
  }

  return new ApiError(status, message, code, details);
}

/**
 * Unwraps `{ ok, data?, error? }` envelopes. Legacy payloads (plain objects,
 * arrays, `{ jobId, status }`, etc.) are returned untouched.
 */
function unwrapPayload<T>(payload: unknown, status: number): T {
  if (isRecord(payload) && typeof payload.ok === 'boolean') {
    if (!payload.ok) {
      throw errorFromEnvelope(payload, status);
    }
    if ('data' in payload) {
      return payload.data as T;
    }
  }
  return payload as T;
}

function normalizeList<T>(
  payload: T[] | { data?: T[]; total?: number } | null | undefined,
): { data: T[]; total: number } {
  if (Array.isArray(payload)) {
    return { data: payload, total: payload.length };
  }
  const data = Array.isArray(payload?.data) ? (payload.data as T[]) : [];
  const total = typeof payload?.total === 'number' ? payload.total : data.length;
  return { data, total };
}

function normalizeJob(raw: unknown): Job {
  const job = isRecord(raw) ? raw : {};
  const inputUrl = asString(job.inputUrl) ?? asString(job.sourceUrl);
  return {
    ...(job as unknown as Job),
    // Legacy responses may use `jobId` instead of `id`.
    id: asString(job.id) ?? asString(job.jobId) ?? '',
    inputUrl,
    sourceUrl: asString(job.sourceUrl) ?? inputUrl,
    mediaUrl: asString(job.mediaUrl),
    clipCount: asNumber(job.clipCount) ?? 0,
    progress: asNumber(job.progress) ?? 0,
  };
}

function normalizeClip(raw: unknown): Clip {
  const clip = isRecord(raw) ? raw : {};
  const startTimestamp = asNumber(clip.startTimestamp);
  const endTimestamp = asNumber(clip.endTimestamp);
  const derivedDuration =
    startTimestamp !== undefined && endTimestamp !== undefined
      ? Math.max(0, endTimestamp - startTimestamp)
      : undefined;

  return {
    ...(clip as unknown as Clip),
    job: isRecord(clip.job) ? normalizeJob(clip.job) : undefined,
    mediaUrl: asString(clip.mediaUrl) ?? asString(clip.playbackUrl),
    previewUrl:
      asString(clip.previewUrl) ??
      asString(clip.mediaUrl) ??
      asString(clip.playbackUrl),
    duration: asNumber(clip.duration) ?? derivedDuration,
  };
}

function normalizeWallet(raw: unknown): Wallet {
  const wallet = isRecord(raw) ? raw : {};
  const credits = asNumber(wallet.credits_balance);
  const local = asNumber(wallet.local_balance);
  return {
    // Server envelope exposes the spendable amount as `balance`
    // (= credits_balance); `local_balance` is money, not credits.
    balance: asNumber(wallet.balance) ?? credits ?? local ?? 0,
    currency: asString(wallet.currency) ?? asString(wallet.currency_code) ?? 'IDR',
    credits_balance: credits,
    local_balance: local,
    currency_code: asString(wallet.currency_code),
    exchange_rate: asNumber(wallet.exchange_rate),
    is_active:
      typeof wallet.is_active === 'boolean' ? wallet.is_active : undefined,
  };
}

function normalizeTopup(raw: unknown): TopupTransaction {
  const tx = isRecord(raw) ? raw : {};
  return {
    ...(tx as unknown as TopupTransaction),
    id: asString(tx.id) ?? '',
    amount:
      asNumber(tx.amount) ??
      asNumber(tx.amountLocal) ??
      0,
    amountLocal: asNumber(tx.amountLocal),
    currency: asString(tx.currency) ?? 'IDR',
    status: (asString(tx.status) ?? 'pending') as TopupTransaction['status'],
    referenceId: asString(tx.referenceId) ?? asString(tx.externalTxId),
    externalTxId: asString(tx.externalTxId),
    createdAt: asString(tx.createdAt) ?? '',
    updatedAt: asString(tx.updatedAt),
  };
}

function normalizeVastInstance(raw: unknown): VastInstance {
  const instance = isRecord(raw) ? raw : {};
  return {
    ...(instance as unknown as VastInstance),
    id: asString(instance.id) ?? '',
    instanceId: asString(instance.instanceId),
    status: (asString(instance.status) ?? 'pending') as VastInstance['status'],
    createdAt: asString(instance.createdAt) ?? '',
  };
}

/* ------------------------------------------------------------------ */
/* Low-level request                                                   */
/* ------------------------------------------------------------------ */

async function request<T>(
  path: string,
  options: RequestOptions = {},
  tokenProvider?: (() => Promise<string | null>) | null,
): Promise<T> {
  // Prefer the injected async credential (Clerk session) over the legacy
  // localStorage token; never send both.
  let token: string | null = null;
  if (tokenProvider) {
    try {
      token = await tokenProvider();
    } catch {
      token = null;
    }
  }
  if (!token) {
    token =
      typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  const url = `${API_BASE_URL}${path}`;
  const body = options.body ?? undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
  } catch {
    throw new ApiError(
      0,
      'Network error: failed to reach the server',
      'NETWORK_ERROR',
      undefined,
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
    if (response.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
    }

    if (isRecord(payload) && payload.ok === false) {
      throw errorFromEnvelope(payload, response.status);
    }

    // Legacy error body: `{ code, message, details }`.
    if (isRecord(payload)) {
      const details = isRecord(payload.details) ? payload.details : undefined;
      throw new ApiError(
        response.status,
        asString(payload.message) ?? asString(payload.error) ?? 'Request failed',
        asString(payload.code) ?? statusCode(response.status),
        details,
      );
    }

    throw new ApiError(
      response.status,
      typeof payload === 'string' && payload.length > 0
        ? payload
        : 'Request failed',
      statusCode(response.status),
    );
  }

  if (response.status === 204 || payload === undefined) {
    return undefined as T;
  }

  return unwrapPayload<T>(payload, response.status);
}

function buildQuery(params?: Record<string, string>): string {
  if (!params) return '';
  const search = new URLSearchParams(params).toString();
  return search.length > 0 ? `?${search}` : '';
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export class ApiClient {
  private static instance: ApiClient;

  /**
   * Optional async credential source (Clerk session token). When set it wins
   * over the legacy localStorage token, so admin calls never fall back to a
   * stale/absent legacy credential.
   */
  private tokenProvider: (() => Promise<string | null>) | null = null;

  private constructor() {}

  /** Register the async credential source used by protected routes. */
  setTokenProvider(provider: (() => Promise<string | null>) | null): void {
    this.tokenProvider = provider;
  }

  public static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>(path, { ...opts, method: 'GET' }, this.tokenProvider);
  }

  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>(path, { ...opts, method: 'POST', body }, this.tokenProvider);
  }

  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>(path, { ...opts, method: 'PUT', body }, this.tokenProvider);
  }

  del<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>(path, { ...opts, method: 'DELETE' }, this.tokenProvider);
  }

  /* ------------------------------ auth ------------------------------ */

  async signInEmail(email: string, password: string): Promise<AuthResult> {
    return this.post<AuthResult>('/api/v1/auth/login', { email, password });
  }

  async registerEmail(
    email: string,
    password: string,
    name: string,
  ): Promise<AuthResult> {
    return this.post<AuthResult>('/api/v1/auth/register', {
      email,
      password,
      name,
    });
  }

  async auth(provider: 'google' | 'github'): Promise<AuthResult> {
    const data = await this.post<AuthResult>(`/api/v1/auth/${provider}`);
    if (data?.token) {
      this.setToken(data.token);
    }
    return data;
  }

  async signOut(): Promise<void> {
    try {
      await this.post('/api/v1/auth/sign-out');
    } finally {
      this.setToken(null);
    }
  }

  setToken(token: string | null): void {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    }
  }

  getToken(): string | null {
    return typeof window !== 'undefined'
      ? localStorage.getItem(TOKEN_KEY)
      : null;
  }

  async me(): Promise<User> {
    const data = await this.get<User | { user: User }>('/api/v1/auth/me');
    if (isRecord(data) && isRecord(data.user)) {
      return data.user as User;
    }
    return data as User;
  }

  /* ------------------------------ uploads --------------------------- */

  async presignUpload(input: {
    fileName: string;
    contentType: string;
  }): Promise<PresignResult> {
    return this.post<PresignResult>('/api/v1/uploads/presign', input);
  }

  /* ------------------------------- jobs ----------------------------- */

  async jobs(
    params?: Record<string, string>,
  ): Promise<{ data: Job[]; total: number }> {
    const result = await this.get<
      Job[] | ({ data?: Job[]; total?: number } & Partial<PaginatedResponse<Job>>)
    >(`/api/v1/jobs${buildQuery(params)}`);
    const list = normalizeList<Job>(result);
    return { data: list.data.map(normalizeJob), total: list.total };
  }

  async job(id: string): Promise<Job> {
    const job = await this.get<Job>(`/api/v1/jobs/${encodeURIComponent(id)}`);
    return normalizeJob(job);
  }

  async createJob(input: string | CreateJobInput): Promise<Job> {
    const payload: CreateJobInput =
      typeof input === 'string'
        ? { sourceUrl: input, inputUrl: input }
        : { ...input };
    const job = await this.post<Job>('/api/v1/jobs', payload);
    return normalizeJob(job);
  }

  async updateJobStatus(id: string, status: JobStatus): Promise<Job> {
    const job = await this.put<Job>(
      `/api/v1/jobs/${encodeURIComponent(id)}/status`,
      { status },
    );
    return normalizeJob(job);
  }

  async clips(
    jobId: string,
    params?: Record<string, string>,
  ): Promise<{ data: Clip[]; total: number }> {
    const result = await this.get<
      Clip[] | ({ data?: Clip[]; total?: number } & Partial<PaginatedResponse<Clip>>)
    >(`/api/v1/jobs/${encodeURIComponent(jobId)}/clips${buildQuery(params)}`);
    const list = normalizeList<Clip>(result);
    return { data: list.data.map(normalizeClip), total: list.total };
  }

  async downloadClip(
    jobId: string,
    clipId: string,
  ): Promise<{ downloadUrl: string }> {
    return this.get<{ downloadUrl: string }>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(
        clipId,
      )}/download`,
    );
  }

  /* --------------------------- billing ------------------------------ */

  async wallet(): Promise<{ data: Wallet }> {
    const raw = await this.get<unknown>('/api/v1/wallet/balance');
    return { data: normalizeWallet(raw) };
  }

  async topups(
    params?: Record<string, string>,
  ): Promise<{ data: TopupTransaction[]; total: number }> {
    const result = await this.get<TopupTransaction[] | { data?: TopupTransaction[]; total?: number }>(
      `/api/v1/topups${buildQuery(params)}`,
    );
    const list = normalizeList<TopupTransaction>(result);
    return { data: list.data.map(normalizeTopup), total: list.total };
  }

  /**
   * Creates a **pending** top-up intent. `manual` is rejected by the API on
   * this route (it settles with no payment proof), so a real gateway is
   * required — see `TopupDialog`, which passes the user's choice explicitly.
   */
  async createTopup(
    amount: number,
    gateway: 'midtrans' | 'xendit' | 'tripay' = 'midtrans',
    currency = 'IDR',
  ): Promise<TopupTransaction> {
    const tx = await this.post<unknown>('/api/v1/topups', {
      amountLocal: Math.trunc(amount),
      currency,
      gateway,
    });
    return normalizeTopup(tx);
  }

  /* ----------------------------- vast.ai ---------------------------- */

  async vastInstances(
    params?: Record<string, string>,
  ): Promise<{ data: VastInstance[]; total: number }> {
    const result = await this.get<VastInstance[] | { data?: VastInstance[]; total?: number }>(
      `/api/v1/vast-instances${buildQuery(params)}`,
    );
    const list = normalizeList<VastInstance>(result);
    return { data: list.data.map(normalizeVastInstance), total: list.total };
  }

  async vastInstance(id: string): Promise<VastInstance> {
    const instance = await this.get<VastInstance>(
      `/api/v1/vast-instances/${encodeURIComponent(id)}`,
    );
    return normalizeVastInstance(instance);
  }

  async createVastInstance(url: string): Promise<VastInstance> {
    const instance = await this.post<VastInstance>('/api/v1/vast-instances', {
      url,
    });
    return normalizeVastInstance(instance);
  }

  /* ------------------------------ admin ----------------------------- */

  async adminStoragePools(): Promise<AdminStoragePool[]> {
    const pools = await this.get<AdminStoragePool[]>('/api/admin/storage-pools');
    return Array.isArray(pools) ? pools : [];
  }

  async adminVastInstances(): Promise<VastInstance[]> {
    const instances = await this.get<VastInstance[]>(
      '/api/admin/vast-instances',
    );
    return Array.isArray(instances)
      ? instances.map(normalizeVastInstance)
      : [];
  }

  async adminHealth(): Promise<AdminHealth> {
    return this.get<AdminHealth>('/api/admin/health');
  }

  async dnsCheck(domain: string, ip: string): Promise<DnsCheckResult> {
    const query = new URLSearchParams({ domain, ip }).toString();
    try {
      return await this.get<DnsCheckResult>(`/api/admin/dns/check?${query}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(
          404,
          'DNS check is not implemented',
          'NOT_IMPLEMENTED',
        );
      }
      throw error;
    }
  }
}

export const apiClient = ApiClient.getInstance();
