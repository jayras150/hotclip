/**
 * Managed S3 storage pool for the production VPS.
 *
 * Wiring:
 *   - `ManagedProviderStore` reads active `storage_pools` + `storage_providers`
 *     from Supabase via PostgREST (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).
 *     When the table is empty (or Supabase is not configured) it falls back to a
 *     single provider described by `S3_*` environment variables.
 *   - `SigV4Presigner` produces real presigned PUT/GET URLs (AWS SigV4 query
 *     authentication) for any S3-compatible endpoint (R2, Backblaze B2,
 *     Hugging Face, Tigris, Filebase, MinIO, S3).
 *   - `createManagedPool()` returns a ready `PoolManager` plus a `refreshHealth`
 *     helper (endpoint reachability + capacity) for the background poller.
 *
 * Bucket selection is delegated to `pickActiveProvider` inside `PoolManager`:
 * healthy > degraded > down, then lowest priority, then the bucket with the
 * largest free capacity (quota_bytes - used_bytes).
 */

import { createHash, createHmac } from "node:crypto";
import {
  PoolManager,
  type PresignedGetUrl,
  type PresignedPutUrl,
  type PresignInput,
  type Presigner,
  type StoragePool,
  type StorageProvider,
  type StorageProviderConfig,
  type StorageProviderKind,
  type StorageProviderStore,
  type HealthStatus,
} from "./pool-manager";

/* ------------------------------------------------------------------ */
/* Environment helpers                                                 */
/* ------------------------------------------------------------------ */

type Env = Record<string, string | undefined>;

function envValue(env: Env, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function toBigInt(value: unknown, fallback = BigInt(0)): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return BigInt(value.trim());
    } catch {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? BigInt(Math.trunc(parsed)) : fallback;
    }
  }
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toHealth(value: unknown): HealthStatus {
  return value === "healthy" || value === "degraded" || value === "down"
    ? value
    : "healthy";
}

/* ------------------------------------------------------------------ */
/* SigV4 presigner                                                     */
/* ------------------------------------------------------------------ */

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface PresignCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type CredentialLookup = (
  endpoint: string,
  bucket: string,
) => PresignCredentials | null;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function epochTimestamp(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function canonicalUri(bucket: string, key: string): string {
  const encodedKey = key
    .split("/")
    .map((segment) => rfc3986(segment))
    .join("/");
  return `/${rfc3986(bucket)}/${encodedKey}`;
}

export function presignS3Url(params: {
  method: "GET" | "PUT";
  endpoint: string;
  bucket: string;
  key: string;
  expirySeconds: number;
  credentials: PresignCredentials;
  now?: Date;
}): string {
  const endpointUrl = new URL(params.endpoint);
  const host = endpointUrl.host;
  const { amzDate, dateStamp } = epochTimestamp(params.now ?? new Date());
  const credentialScope = `${dateStamp}/${params.credentials.region}/s3/aws4_request`;
  const uri = canonicalUri(params.bucket, params.key);

  const queryPairs: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    [
      "X-Amz-Credential",
      `${params.credentials.accessKeyId}/${credentialScope}`,
    ],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(params.expirySeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = queryPairs
    .map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`)
    .sort()
    .join("&");

  const canonicalRequest = [
    params.method,
    uri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(
      hmac(
        hmac(`AWS4${params.credentials.secretAccessKey}`, dateStamp),
        params.credentials.region,
      ),
      "s3",
    ),
    "aws4_request",
  );
  const signature = hmacHex(signingKey, stringToSign);

  return `${endpointUrl.protocol}//${host}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Real S3-compatible presigner. Credentials are resolved by `(endpoint,
 * bucket)` through the lookup callback supplied by the provider store.
 */
export class SigV4Presigner implements Presigner {
  constructor(private readonly lookup: CredentialLookup) {}

  async presignPut(input: PresignInput): Promise<PresignedPutUrl> {
    return {
      url: this.build("PUT", input),
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
    };
  }

  async presignGet(input: PresignInput): Promise<PresignedGetUrl> {
    return {
      url: this.build("GET", input),
      method: "GET",
      headers: {},
    };
  }

  private build(method: "GET" | "PUT", input: PresignInput): string {
    const credentials = this.lookup(input.endpoint, input.bucket);
    if (!credentials) {
      throw new Error(
        `No S3 credentials configured for ${input.endpoint}/${input.bucket}`,
      );
    }
    return presignS3Url({
      method,
      endpoint: input.endpoint,
      bucket: input.bucket,
      key: input.key,
      expirySeconds: input.expirySeconds,
      credentials,
    });
  }
}

/* ------------------------------------------------------------------ */
/* PostgREST provider store                                            */
/* ------------------------------------------------------------------ */

const REFRESH_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 2_000;

interface RawProviderRow {
  id: string;
  pool_id: string | null;
  provider_name: string;
  endpoint_url: string;
  region: string;
  bucket_name: string;
  access_key_id: string;
  secret_access_key: string;
  quota_bytes: unknown;
  used_bytes: unknown;
  priority: unknown;
  health_status: unknown;
  is_active: unknown;
  is_backup: unknown;
}

interface RawPoolRow {
  id: string;
  name: string | null;
  provider_name: string;
  account_label: string | null;
  priority: unknown;
  quota_bytes: unknown;
  used_bytes: unknown;
  health_status: unknown;
  is_active: unknown;
  user_id: string | null;
}

/**
 * `StorageProviderStore` backed by Supabase PostgREST with an environment
 * fallback. Also exposes the credential lookup used by `SigV4Presigner`.
 */
export class ManagedProviderStore implements StorageProviderStore {
  private pools: StoragePool[] = [];
  private providers: StorageProvider[] = [];
  private byId = new Map<string, StorageProvider>();
  private credentials = new Map<string, PresignCredentials>();
  private fetchedAt = 0;

  constructor(
    private readonly env: Env = process.env,
    private readonly supabaseUrl = envValue(
      env,
      "SUPABASE_URL",
      "HOTCLIP_SUPABASE_URL",
    ),
    private readonly serviceKey = envValue(
      env,
      "SUPABASE_SERVICE_ROLE_KEY",
      "HOTCLIP_SUPABASE_SERVICE_ROLE_KEY",
    ),
  ) {}

  async listPools(): Promise<StoragePool[]> {
    await this.refresh();
    return this.pools;
  }

  async listProviders(poolId?: string): Promise<StorageProvider[]> {
    await this.refresh();
    if (!poolId) return this.providers;
    return this.providers.filter(
      (provider) => provider.pool_id === poolId || provider.pool_id === null,
    );
  }

  async updateProvider(
    providerId: string,
    patch: Partial<StorageProvider>,
  ): Promise<void> {
    const current = this.byId.get(providerId);
    if (current) {
      const next: StorageProvider = { ...current, ...patch };
      this.byId.set(providerId, next);
      this.providers = this.providers.map((provider) =>
        provider.id === providerId ? next : provider,
      );
    }

    if (!this.supabaseUrl || !this.serviceKey) return;
    const body: Record<string, unknown> = {};
    if (patch.used_bytes !== undefined) body.used_bytes = patch.used_bytes.toString();
    if (patch.health_status !== undefined) body.health_status = patch.health_status;
    if (patch.priority !== undefined) body.priority = patch.priority;
    if (patch.is_active !== undefined) body.is_active = patch.is_active;
    if (patch.is_backup !== undefined) body.is_backup = patch.is_backup;
    if (Object.keys(body).length === 0) return;

    await this.postgrest(
      `storage_providers?id=eq.${encodeURIComponent(providerId)}`,
      { method: "PATCH", body },
    ).catch(() => undefined);
  }

  async recordUsage(providerId: string, bytes: number): Promise<void> {
    const current = this.byId.get(providerId);
    if (!current) return;
    const used = current.used_bytes + BigInt(Math.max(0, Math.trunc(bytes)));
    await this.updateProvider(providerId, { used_bytes: used });
  }

  /** Resolve credentials for a bucket (used by `SigV4Presigner`). */
  lookupCredentials(endpoint: string, bucket: string): PresignCredentials | null {
    const key = this.credentialKey(endpoint, bucket);
    const found = this.credentials.get(key);
    if (found) return found;

    // Fallback: match by bucket only (different endpoint spelling).
    for (const [candidateKey, credentials] of this.credentials) {
      if (candidateKey.endsWith(`|${bucket}`)) return credentials;
    }
    return null;
  }

  /**
   * Probe every provider once: mark `down` when the endpoint is unreachable or
   * the quota is exhausted, `degraded` above 90% usage, otherwise `healthy`.
   * Best-effort: network failures never throw.
   */
  async refreshHealth(): Promise<void> {
    await this.refresh(true);
    await Promise.all(
      this.providers.map(async (provider) => {
        const reachable = await this.probeEndpoint(
          provider.config.endpoint_url,
          provider.config.bucket_name,
        );
        const quota = provider.quota_bytes;
        const used = provider.used_bytes;
        const capacity = quota - used;

        let status: HealthStatus = "healthy";
        if (!reachable || capacity <= BigInt(0)) {
          status = "down";
        } else if (quota > BigInt(0) && Number(used) / Number(quota) >= 0.9) {
          status = "degraded";
        }

        if (status !== provider.health_status) {
          await this.updateProvider(provider.id, { health_status: status });
        }
      }),
    );
  }

  private credentialKey(endpoint: string, bucket: string): string {
    return `${endpoint.replace(/\/+$/, "")}|${bucket}`;
  }

  private async probeEndpoint(endpoint: string, bucket: string): Promise<boolean> {
    if (!endpoint) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const url = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`;
      await fetch(url, { method: "HEAD", signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.fetchedAt < REFRESH_TTL_MS) return;

    if (!this.supabaseUrl || !this.serviceKey) {
      this.applyEnvironmentFallback();
      this.fetchedAt = Date.now();
      return;
    }

    try {
      const [rawPools, rawProviders] = await Promise.all([
        this.postgrest<RawPoolRow[]>(
          "storage_pools?select=*&is_active=eq.true&order=priority.asc",
        ),
        this.postgrest<RawProviderRow[]>(
          "storage_providers?select=*&is_active=eq.true&order=priority.asc",
        ),
      ]);

      if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
        this.applyEnvironmentFallback();
        this.fetchedAt = Date.now();
        return;
      }

      this.applyRows(
        Array.isArray(rawPools) ? rawPools : [],
        rawProviders,
      );
      this.fetchedAt = Date.now();
    } catch (error) {
      console.error(
        "[storage-pool] PostgREST refresh failed, using environment fallback:",
        error instanceof Error ? error.message : error,
      );
      this.applyEnvironmentFallback();
      this.fetchedAt = Date.now();
    }
  }

  private applyRows(poolRows: RawPoolRow[], providerRows: RawProviderRow[]): void {
    this.credentials = new Map();

    this.providers = providerRows.map((row) => {
      const config: StorageProviderConfig = {
        endpoint_url: row.endpoint_url,
        region: row.region || "auto",
        bucket_name: row.bucket_name,
        access_key_id: row.access_key_id,
        secret_access_key: row.secret_access_key,
      };
      this.credentials.set(this.credentialKey(config.endpoint_url, config.bucket_name), {
        region: config.region,
        accessKeyId: config.access_key_id,
        secretAccessKey: config.secret_access_key,
      });
      return {
        id: row.id,
        pool_id: row.pool_id,
        provider_name: this.providerKind(row.provider_name),
        config,
        quota_bytes: toBigInt(row.quota_bytes, BigInt(0)),
        used_bytes: toBigInt(row.used_bytes, BigInt(0)),
        priority: toNumber(row.priority, 10),
        health_status: toHealth(row.health_status),
        is_active: row.is_active !== false,
        is_backup: row.is_backup === true,
      };
    });

    this.pools = poolRows.map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      provider_name: this.providerKind(row.provider_name),
      account_label: row.account_label ?? "default",
      priority: toNumber(row.priority, 10),
      quota_bytes: toBigInt(row.quota_bytes, BigInt(0)),
      used_bytes: toBigInt(row.used_bytes, BigInt(0)),
      health_status: toHealth(row.health_status),
      is_active: row.is_active !== false,
      user_id: row.user_id,
    }));

    this.reindex();
  }

  private applyEnvironmentFallback(): void {
    const endpoint = envValue(this.env, "S3_ENDPOINT", "R2_ENDPOINT");
    const bucket = envValue(this.env, "S3_BUCKET", "R2_BUCKET");
    const accessKeyId = envValue(this.env, "S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID");
    const secretAccessKey = envValue(
      this.env,
      "S3_SECRET_ACCESS_KEY",
      "R2_SECRET_ACCESS_KEY",
    );

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      this.pools = [];
      this.providers = [];
      this.credentials = new Map();
      this.reindex();
      return;
    }

    const region = envValue(this.env, "S3_REGION", "R2_REGION") ?? "auto";
    const kind = this.providerKind(
      envValue(this.env, "S3_PROVIDER") ?? "s3",
    );
    const quota = BigInt(
      envValue(this.env, "S3_QUOTA_BYTES") ?? String(500 * 1024 * 1024 * 1024),
    );
    const used = BigInt(envValue(this.env, "S3_USED_BYTES") ?? "0");

    const provider: StorageProvider = {
      id: "env-s3-primary",
      pool_id: null,
      provider_name: kind,
      config: {
        endpoint_url: endpoint,
        region,
        bucket_name: bucket,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
      },
      quota_bytes: quota,
      used_bytes: used,
      priority: 1,
      health_status: "healthy",
      is_active: true,
      is_backup: false,
    };

    this.providers = [provider];
    this.pools = [];
    this.credentials = new Map([
      [
        this.credentialKey(endpoint, bucket),
        { region, accessKeyId, secretAccessKey },
      ],
    ]);
    this.reindex();
  }

  private reindex(): void {
    this.byId = new Map(this.providers.map((provider) => [provider.id, provider]));
  }

  private providerKind(value: string): StorageProviderKind {
    const normalized = value.trim().toLowerCase();
    const known: StorageProviderKind[] = [
      "r2",
      "backblaze-b2",
      "hugging-face",
      "tigris",
      "filebase",
      "minio",
      "s3",
    ];
    return (known as string[]).includes(normalized)
      ? (normalized as StorageProviderKind)
      : "s3";
  }

  private async postgrest<T = unknown>(
    path: string,
    options: { method?: string; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    if (!this.supabaseUrl || !this.serviceKey) {
      throw new Error("Supabase PostgREST is not configured");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        `${this.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`,
        {
          method: options.method ?? "GET",
          headers: {
            apikey: this.serviceKey,
            Authorization: `Bearer ${this.serviceKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`PostgREST ${response.status}: ${await response.text()}`);
      }
      const text = await response.text();
      return (text.trim().length === 0 ? null : JSON.parse(text)) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

export interface ManagedPool {
  poolManager: PoolManager;
  providerStore: ManagedProviderStore;
  /** Probe + persist provider health (call from the background poller). */
  refreshHealth: () => Promise<void>;
}

/**
 * Build the production `PoolManager`: real presigned URLs + DB-backed provider
 * list (`storage_providers`), env S3 fallback when the table is empty.
 */
export function createManagedPool(env: Env = process.env): ManagedPool {
  const providerStore = new ManagedProviderStore(env);
  const presigner = new SigV4Presigner((endpoint, bucket) =>
    providerStore.lookupCredentials(endpoint, bucket),
  );
  const poolManager = new PoolManager(providerStore, presigner);

  return {
    poolManager,
    providerStore,
    refreshHealth: () => providerStore.refreshHealth(),
  };
}
