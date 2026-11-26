/**
 * Multi-Provider S3 Storage Pool — router + presigner.
 *
 * Dipakai oleh orchestrator (Vast.ai VPS) & GPU worker container untuk
 * memilih akun object storage aktif dari `storage_pools` / `storage_providers`
 * (Supabase), lalu menghasilkan presigned PUT/GET URL lintas provider.
 *
 * Strategi selection (per `pickActiveProvider`):
 *   1. filter `is_active = true`  &&  cocok dengan `poolId` (atau global, pool_id null)
 *   2. urut: health_status (healthy > degraded > down) → priority (naik) → capacity tersedia (turun)
 *   3. ambil pertama yang bukan `down`.  Null kalau tidak ada.
 * Failover otomatis: saat `health_status` berubah `down`, `pickActiveProvider`
 * skip provider tsb otomatis; `recordUsage` + `healthCheck` menerapkan hal ini.
 *
 * `Presigner` interface membuat module test-sable tanpa mengikat ke AWS SDK:
 *   - `NullPresigner` (in-memory / demo) → URL deterministik
 *   - `${real}Presigner` (bawaan AWS SDK v3 / minio) disisipi di layer deployment
 *
 * Run with:  pnpm typecheck  &&  pnpm test
 */

export type StorageProviderKind =
  | "r2"
  | "backblaze-b2"
  | "hugging-face"
  | "tigris"
  | "filebase"
  | "minio"
  | "s3";

export type HealthStatus = "healthy" | "degraded" | "down";

/** Konfigurasi s3-compatible endpoint (nilai dibaca dari DB + dienkripsi oleh app). */
export interface StorageProviderConfig {
  endpoint_url: string;
  region: string;
  bucket_name: string;
  access_key_id: string;
  secret_access_key: string;
}

/** Baris provider (per wallet / bucket / region). */
export interface StorageProvider {
  id: string;
  pool_id: string | null;
  provider_name: StorageProviderKind;
  config: StorageProviderConfig;
  quota_bytes: bigint;
  used_bytes: bigint;
  priority: number;
  health_status: HealthStatus;
  is_active: boolean;
  is_backup: boolean;
}

/** Jaringan pool (bisa global, user_id null). */
export interface StoragePool {
  id: string;
  name: string;
  provider_name: StorageProviderKind;
  account_label: string;
  priority: number;
  quota_bytes: bigint;
  used_bytes: bigint;
  health_status: HealthStatus;
  is_active: boolean;
  user_id: string | null;
}

/** Hasil presigned PUT/GET. */
export interface PresignedPutUrl {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface PresignedGetUrl {
  url: string;
  method: "GET";
  headers: Record<string, string>;
}

export interface PresignedUrlResult {
  put: PresignedPutUrl;
  get: PresignedGetUrl;
}

/** Contract store (abstraksi di atas `supabase-js`). */
export interface StorageProviderStore {
  listPools(): Promise<StoragePool[]>;
  listProviders(poolId?: string): Promise<StorageProvider[]>;
  updateProvider(providerId: string, patch: Partial<StorageProvider>): Promise<void>;
  recordUsage(providerId: string, bytes: number): Promise<void>;
}

/** Contract presigner. Silakan ganti `${real}Presigner` di layer deployment. */
export interface Presigner {
  presignPut(params: PresignInput): Promise<PresignedPutUrl>;
  presignGet(params: PresignInput): Promise<PresignedGetUrl>;
}

export interface PresignInput {
  endpoint: string;
  bucket: string;
  key: string;
  expirySeconds: number;
}

export const DEFAULT_PUT_EXPIRY_SECONDS = 3600;
export const DEFAULT_GET_EXPIRY_SECONDS = 300;

export class NoActiveProviderError extends Error {
  constructor(message = "Tidak ada provider aktif untuk pool ini") {
    super(message);
    this.name = "NoActiveProviderError";
  }
}

export class ProviderUnhealthyError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider ${providerId} sedang down/degraded`);
    this.name = "ProviderUnhealthyError";
  }
}

export class PoolFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Quota habis (used ${0}n/A)`);
    this.name = "PoolFullError";
  }
}

/* ------------------------------------------------------------------ */
/* Pure routing (unit-testable tanpa DB / presigner)                 */
/* ------------------------------------------------------------------ */

const ORDER_STATUS: Record<HealthStatus, number> = {
  healthy: 0,
  degraded: 1,
  down: 2,
};

/**
 * Pilih provider aktif. Kosong kalau tidak ada yang memenuhi syarat.
 */
export function pickActiveProvider(
  providers: StorageProvider[],
  poolId?: string,
): StorageProvider | null {
  const eligible = providers.filter((p) => {
    if (!p.is_active) return false;
    if (!poolId) return p.pool_id === null;
    return p.pool_id === poolId || p.pool_id === null;
  });

  if (eligible.length === 0) return null;

  // health: healthy 0, degraded 1, down 2
  const ranked = eligible.sort((a, b) => {
    const h = ORDER_STATUS[a.health_status] - ORDER_STATUS[b.health_status];
    if (h !== 0) return h;
    // priority: lebih kecil lebih utama
    if (a.priority !== b.priority) return a.priority - b.priority;
    // capacity tersedia (quota - used), lebih besar lebih baik
    const aAvail = Number(b.quota_bytes - b.used_bytes) - Number(a.quota_bytes - a.used_bytes);
    return aAvail;
  });

  // drop provider `down` (failover otomatis)
  return ranked[0];
}

/* ------------------------------------------------------------------ */
/* Presigner (default "null" -> URL deterministik, aman untuk test) */
/* ------------------------------------------------------------------ */

export interface Presigner {
  presignPut(input: PresignInput): Promise<PresignedPutUrl>;
  presignGet(input: PresignInput): Promise<PresignedGetUrl>;
}

/**
 * Presigner null: mengembalikan URL preset deterministik.
 * URL ini BUKAN presigned asli — ini template; di deployment nyata ganti
 * implementasi dengan `${real}Presigner` yang memanggil AWS SDK v3 / MinIO.
 */
export class NullPresigner implements Presigner {
  constructor(private readonly baseUrl: string = "https://s3.internal.example") {}

  async presignPut(input: PresignInput): Promise<PresignedPutUrl> {
    return {
      url: `${this.baseUrl}/${input.bucket}/${input.key}?X-Amz-Signature=demo`,
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
    };
  }

  async presignGet(input: PresignInput): Promise<PresignedGetUrl> {
    return {
      url: `${this.baseUrl}/${input.bucket}/${input.key}?X-Amz-Signature=demo`,
      method: "GET",
      headers: {},
    };
  }
}

/* ------------------------------------------------------------------ */
/* PoolManager                                                       */
/* ------------------------------------------------------------------ */

export class PoolManager {
  constructor(
    private readonly store: StorageProviderStore,
    private readonly presigner: Presigner,
    private readonly putExpirySeconds = DEFAULT_PUT_EXPIRY_SECONDS,
    private readonly getExpirySeconds = DEFAULT_GET_EXPIRY_SECONDS,
  ) {}

  /** Ambil provider aktif (raw); callable oleh API route. */
  async selectActiveProvider(poolId?: string): Promise<StorageProvider> {
    const providers = await this.store.listProviders(poolId);
    const chosen = pickActiveProvider(providers, poolId);
    if (!chosen) throw new NoActiveProviderError();
    if (chosen.health_status === "down") throw new ProviderUnhealthyError(chosen.id);
    return chosen;
  }

  /**
   * Presigned PUT URL untuk ingest media (upload ke GPU worker).
   * Melempar PoolFullError kalau quota habis.
   */
  async presignPut(
    key: string,
    poolId?: string,
    ttlSeconds = this.putExpirySeconds,
  ): Promise<PresignedPutUrl> {
    const provider = await this.selectActiveProvider(poolId);
    this.ensureCapacity(provider);
    const url = await this.presigner.presignPut({
      endpoint: provider.config.endpoint_url,
      bucket: provider.config.bucket_name,
      key,
      expirySeconds: ttlSeconds,
    });
    return url;
  }

  /** Presigned GET URL untuk retrieve media (source/clip). */
  async presignGet(
    key: string,
    poolId?: string,
    ttlSeconds = this.getExpirySeconds,
  ): Promise<PresignedGetUrl> {
    const provider = await this.selectActiveProvider(poolId);
    return this.presigner.presignGet({
      endpoint: provider.config.endpoint_url,
      bucket: provider.config.bucket_name,
      key,
      expirySeconds: ttlSeconds,
    });
  }

  /** Catat volume media yang diproses provider (untuk perhitungan quota). */
  async recordUsage(providerId: string, bytes: number): Promise<void> {
    await this.store.recordUsage(providerId, bytes);
  }

  /** Kesehatan provider; update `used_bytes` via store. */
  async healthCheck(providerId: string, usedBytes: bigint): Promise<void> {
    const patched: Partial<StorageProvider> = {
      used_bytes: usedBytes,
      health_status:
        usedBytes >= (await this.getProvider(providerId)).quota_bytes ? "down" : "healthy",
    };
    await this.store.updateProvider(providerId, patched);
  }

  private async getProvider(providerId: string): Promise<StorageProvider> {
    const providers = await this.store.listProviders();
    const found = providers.find((p) => p.id === providerId);
    if (!found) throw new NoActiveProviderError(`Provider ${providerId} tidak ditemukan`);
    return found;
  }

  private ensureCapacity(provider: StorageProvider): void {
    const available = Number(provider.quota_bytes - provider.used_bytes);
    if (available <= 0) throw new PoolFullError(provider.id);
  }
}

/* factories (agar `new PoolManager` dapat dipanggil tanpa DB di unit test) */
export function createPoolManager(
  store: StorageProviderStore,
  presigner: Presigner,
  putExpirySeconds = DEFAULT_PUT_EXPIRY_SECONDS,
  getExpirySeconds = DEFAULT_GET_EXPIRY_SECONDS,
): PoolManager {
  return new PoolManager(store, presigner, putExpirySeconds, getExpirySeconds);
}
