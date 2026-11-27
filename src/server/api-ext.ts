/**
 * Extended admin HTTP API (`/api/admin/*`) — Node built-in `http`, no framework.
 *
 * Fase ini memakai in-memory stub store agar seluruh endpoint dapat diuji
 * tanpa Supabase. Store dapat diganti implementasi Supabase pada fase berikutnya
 * tanpa mengubah kontrak HTTP.
 *
 * Semua route:
 *   - opsional Bearer auth (`apiToken`)
 *   - rate limit in-memory per-IP sliding window (default 60 req / 60 detik)
 *
 * Response envelope: `{ ok: boolean, data?: ..., error?: string }`.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteHandler } from "./api";
import type { HealthStatus, PoolManager, StorageProviderKind } from "./storage/pool-manager";
import { createAdminStore, type AdminStore } from "./admin-store";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface ApiExtRouterOptions {
  /** Jika diset, semua `/api/admin/*` memerlukan `Authorization: Bearer <token>`. */
  apiToken?: string;
  /** Konfigurasi rate limit in-memory per-IP. Default 60 request / 60 detik. */
  rateLimit?: { maxRequests: number; windowMs: number };
  /** Pool manager opsional untuk ringkasan provider aktif (best-effort). */
  poolManager?: PoolManager;
  /**
   * Guard sesi admin (defense-in-depth). Bila diset, dijalankan SEBELUM
   * rate limit pada semua path `/api/admin/*` KECUALI `/api/admin/health`
   * (tetap publik untuk probe). Biasanya di-wire ke
   * `enforceAdminSession()` dari `./admin-auth.ts`.
   */
  adminGuard?: (
    req: IncomingMessage,
  ) => Promise<
    | { ok: true; userId: string; email: string }
    | { ok: false; status: 401 | 403; error: string }
  >;
}

/**
 * Server-side model for the admin package + credit management API.
 * Priced entirely in USD.
 */
export interface AdminPackage {
  id: string;
  name: string;
  slug: string;
  priceUsd: number; // USD, e.g. 9, 19, 49
  credits: number; // credits granted on purchase
  description?: string;
  sortOrder: number;
  isActive: boolean;
  isPopular: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AdminCreditKind = "topup" | "deduct" | "set" | "reset";

export interface AdminCreditAdjustment {
  id: string;
  userId: string;
  kind: AdminCreditKind;
  /** Signed delta in credits. 0 for "set". */
  delta: number;
  previousBalance: number;
  balance: number;
  reason: string;
  adminEmail?: string;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "suspended";
  createdAt: string;
  bannedAt?: string;
  banReason?: string;
  creditsBalance: number;
  localBalance: number;
  currencyCode: string;
}

export interface AdminUserSearchResult {
  user: AdminUser;
  foundVia: "profile" | "wallet";
  walletBalance?: number;
}

export type PaymentGatewayName = "midtrans" | "xendit" | "tripay" | "manual";

const PAYMENT_GATEWAYS: readonly PaymentGatewayName[] = [
  "midtrans",
  "xendit",
  "tripay",
  "manual",
];

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const VERSION = process.env.HOTCLIP_VERSION ?? process.env.npm_package_version ?? "0.1.0";

/* ------------------------------------------------------------------ */
/* Body parsing helpers                                               */
/* ------------------------------------------------------------------ */

class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds 1 MB");
    this.name = "BodyTooLargeError";
  }
}

class InvalidBodyError extends Error {
  constructor(message = "invalid JSON body") {
    super(message);
    this.name = "InvalidBodyError";
  }
}

/** Baca body JSON dengan batas 1 MB. `undefined` jika body kosong. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }

  if (size === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidBodyError();
  }
}

/* ------------------------------------------------------------------ */
/* In-memory seed data                                                */
/* ------------------------------------------------------------------ */

interface ProviderSummary {
  id: string;
  pool_id: string;
  provider_name: StorageProviderKind;
  account_label: string;
  quota_bytes: number;
  used_bytes: number;
  health_status: HealthStatus;
  priority: number;
  is_active: boolean;
}

interface PoolSummary {
  id: string;
  name: string;
  provider_name: StorageProviderKind;
  account_label: string;
  priority: number;
  quota_bytes: number;
  used_bytes: number;
  health_status: HealthStatus;
  is_active: boolean;
  providers: ProviderSummary[];
}

function createSeedPools(): PoolSummary[] {
  const gb = 1024 * 1024 * 1024;
  const seed: Array<{
    id: string;
    name: string;
    provider: StorageProviderKind;
    account: string;
    quota: number;
    used: number;
    health: HealthStatus;
    priority: number;
  }> = [
    {
      id: "pool-r2-primary",
      name: "Cloudflare R2 — Primary",
      provider: "r2",
      account: "r2-hotclip-main",
      quota: 500 * gb,
      used: 120 * gb,
      health: "healthy",
      priority: 1,
    },
    {
      id: "pool-b2-backup",
      name: "Backblaze B2 — Backup",
      provider: "backblaze-b2",
      account: "b2-hotclip-backup",
      quota: 1000 * gb,
      used: 340 * gb,
      health: "healthy",
      priority: 2,
    },
    {
      id: "pool-hf-free",
      name: "Hugging Face — Free Tier",
      provider: "hugging-face",
      account: "hf-hotclip-free",
      quota: 100 * gb,
      used: 92 * gb,
      health: "degraded",
      priority: 3,
    },
  ];

  return seed.map((item) => ({
    id: item.id,
    name: item.name,
    provider_name: item.provider,
    account_label: item.account,
    priority: item.priority,
    quota_bytes: item.quota,
    used_bytes: item.used,
    health_status: item.health,
    is_active: true,
    providers: [
      {
        id: `${item.id}-provider`,
        pool_id: item.id,
        provider_name: item.provider,
        account_label: item.account,
        quota_bytes: item.quota,
        used_bytes: item.used,
        health_status: item.health,
        priority: item.priority,
        is_active: true,
      },
    ],
  }));
}

type VastInstanceStatus = "pending" | "active" | "stopped" | "cancelled";

interface VastInstanceRecord {
  id: string;
  instanceId?: string;
  offerId?: string;
  workspaceId?: string;
  status: VastInstanceStatus;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  blockedUntil?: string;
}

interface WalletRecord {
  userId: string;
  credits_balance: number;
  local_balance: number;
  currency_code: string;
  exchange_rate: number;
  is_active: boolean;
}

interface ProfileRecord {
  userId: string;
  displayName: string;
  timezone: string;
  currencyCode: string;
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                    */
/* ------------------------------------------------------------------ */

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { ok: false, error });
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
/* Persisted admin state                                              */
/* ------------------------------------------------------------------ */

interface PackageRecord {
  id: string;
  name: string;
  slug: string;
  priceUsd: number;
  credits: number;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  isPopular: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreditAdjustmentRecord {
  id: string;
  userId: string;
  kind: AdminCreditKind;
  delta: number;
  previousBalance: number;
  balance: number;
  reason: string;
  adminEmail?: string;
  createdAt: string;
}

/* In-memory fallback seeded from the default USD package list. */
interface SeedPackage {
  id: string;
  name: string;
  slug: string;
  priceUsd: number;
  credits: number;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  isPopular: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Default USD pricing tiers (Free / Starter / Pro / Studio), seeded into the
 * in-memory admin store. Premium plan is the most popular. */
const DEFAULT_PACKAGES_SEED: SeedPackage[] = [
  {
    id: "pkg-free",
    name: "Free",
    slug: "free",
    priceUsd: 0,
    credits: 10,
    description: "Try HookClip with a one-time starter credit grant.",
    sortOrder: 0,
    isActive: true,
    isPopular: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "pkg-starter",
    name: "Starter",
    slug: "starter",
    priceUsd: 9,
    credits: 60,
    description: "For creators publishing a few shorts per week.",
    sortOrder: 1,
    isActive: true,
    isPopular: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "pkg-pro",
    name: "Pro",
    slug: "pro",
    priceUsd: 19,
    credits: 150,
    description: "For daily posting with priority GPU rendering.",
    sortOrder: 2,
    isActive: true,
    isPopular: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: "pkg-studio",
    name: "Studio",
    slug: "studio",
    priceUsd: 49,
    credits: 450,
    description: "For teams and agencies producing clips at scale.",
    sortOrder: 3,
    isActive: true,
    isPopular: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

const packages = new Map<string, PackageRecord>();
const adjustments = new Map<string, CreditAdjustmentRecord[]>();

const populatePackages = () => {
  for (const p of DEFAULT_PACKAGES_SEED) {
    packages.set(p.id, {
      id: p.id,
      name: p.name,
      slug: p.slug,
      priceUsd: p.priceUsd,
      credits: p.credits,
      description: p.description,
      sortOrder: p.sortOrder,
      isActive: p.isActive,
      isPopular: p.isPopular,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  }
};

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

/**
 * Membuat handler HTTP untuk seluruh endpoint `/api/admin/*`.
 * Handler kompatibel dengan `http.createServer(handler)`.
 */
export function createApiExtRouter(opts: ApiExtRouterOptions = {}): RouteHandler {
  const apiToken = opts.apiToken ?? "";
  const maxRequests = opts.rateLimit?.maxRequests ?? 60;
  const windowMs = opts.rateLimit?.windowMs ?? 60_000;
  const poolManager = opts.poolManager;
  const adminGuard = opts.adminGuard;

  // Store in-memory (stub; akan diganti Supabase pada fase berikutnya).
  const pools = createSeedPools();
  const vastInstances = new Map<string, VastInstanceRecord>();
  const wallets = new Map<string, WalletRecord>();
  const profiles = new Map<string, ProfileRecord>();

  const rateLimits = new Map<string, number[]>();

  function clientKey(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? "unknown";
  }

  function isRateLimited(req: IncomingMessage): boolean {
    const key = clientKey(req);
    const now = Date.now();
    const cutOff = now - windowMs;
    const recent = (rateLimits.get(key) ?? []).filter((t) => t > cutOff);

    if (recent.length >= maxRequests) {
      rateLimits.set(key, recent);
      return true;
    }
    recent.push(now);
    rateLimits.set(key, recent);
    return false;
  }

  function isAuthorized(req: IncomingMessage): boolean {
    if (!apiToken) return true;
    const auth = req.headers.authorization;
    return Boolean(auth?.startsWith("Bearer ") && auth.slice(7) === apiToken);
  }

  function getWallet(userId: string): WalletRecord {
    const existing = wallets.get(userId);
    if (existing) return existing;
    const wallet: WalletRecord = {
      userId,
      credits_balance: 0,
      local_balance: 0,
      currency_code: "IDR",
      exchange_rate: 15000,
      is_active: true,
    };
    wallets.set(userId, wallet);
    return wallet;
  }

  function getProfile(userId: string): ProfileRecord {
    const existing = profiles.get(userId);
    if (existing) return existing;
    const profile: ProfileRecord = {
      userId,
      displayName: "",
      timezone: "UTC",
      currencyCode: "IDR",
    };
    profiles.set(userId, profile);
    return profile;
  }

  async function withActiveProvider(pool: PoolSummary): Promise<PoolSummary> {
    if (!poolManager) return pool;
    try {
      const provider = await poolManager.selectActiveProvider(pool.id);
      const providers = pool.providers.map((item) =>
        item.provider_name === provider.provider_name
          ? {
              ...item,
              health_status: provider.health_status,
              priority: provider.priority,
              quota_bytes: Number(provider.quota_bytes),
              used_bytes: Number(provider.used_bytes),
              is_active: provider.is_active,
            }
          : item,
      );
      return { ...pool, providers, active_provider_id: provider.id } as PoolSummary & {
        active_provider_id: string;
      };
    } catch {
      // Best-effort: pool manager boleh tidak punya provider / store belum siap.
      return pool;
    }
  }

  /* --------------------------- handlers --------------------------- */

  async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    sendJson(res, 200, {
      ok: true,
      uptime: Math.floor(process.uptime()),
      version: VERSION,
    });
  }

  async function handleStoragePools(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const data = await Promise.all(pools.map((pool) => withActiveProvider(pool)));
    sendJson(res, 200, { ok: true, data });
  }

  async function handleStoragePoolProviders(
    _req: IncomingMessage,
    res: ServerResponse,
    poolId: string,
  ): Promise<void> {
    const pool = pools.find((item) => item.id === poolId);
    if (!pool) {
      sendError(res, 404, "storage pool not found");
      return;
    }
    const enriched = await withActiveProvider(pool);
    sendJson(res, 200, { ok: true, data: enriched.providers });
  }

  async function handleVastInstancesGet(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const data = [...vastInstances.values()];
    sendJson(res, 200, { ok: true, data });
  }

  async function handleVastInstancesPost(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (body !== undefined && !isRecord(body)) {
      sendError(res, 400, "invalid body");
      return;
    }
    const input = (body ?? {}) as Record<string, unknown>;
    const instanceId = typeof input.instanceId === "string" ? input.instanceId : undefined;
    const offerId = typeof input.offerId === "string" ? input.offerId : undefined;
    const workspaceId =
      typeof input.workspaceId === "string" ? input.workspaceId : undefined;

    // Blokir 24 jam setelah soft-delete untuk instanceId yang sama.
    if (instanceId) {
      const now = Date.now();
      const blocked = [...vastInstances.values()].find(
        (record) =>
          record.instanceId === instanceId &&
          record.blockedUntil !== undefined &&
          Date.parse(record.blockedUntil) > now,
      );
      if (blocked) {
        sendError(res, 409, `instance blocked until ${blocked.blockedUntil}`);
        return;
      }
    }

    const record: VastInstanceRecord = {
      id: randomUUID(),
      instanceId,
      offerId,
      workspaceId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    vastInstances.set(record.id, record);
    sendJson(res, 201, { ok: true, data: record });
  }

  async function handleVastLifecycle(
    res: ServerResponse,
    id: string,
    action: "start" | "stop" | "cancel",
  ): Promise<void> {
    const record = vastInstances.get(id);
    if (!record || record.deletedAt) {
      sendError(res, 404, "vast instance not found");
      return;
    }
    record.status =
      action === "start" ? "active" : action === "stop" ? "stopped" : "cancelled";
    record.updatedAt = new Date().toISOString();
    sendJson(res, 200, { ok: true, data: record });
  }

  async function handleVastDelete(
    res: ServerResponse,
    id: string,
  ): Promise<void> {
    const record = vastInstances.get(id);
    if (!record || record.deletedAt) {
      sendError(res, 404, "vast instance not found");
      return;
    }
    const now = new Date();
    record.deletedAt = now.toISOString();
    record.updatedAt = now.toISOString();
    record.status = "cancelled";
    record.blockedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    sendJson(res, 200, {
      ok: true,
      data: record,
      blockedUntil: record.blockedUntil,
    });
  }

  async function handleWalletGet(
    res: ServerResponse,
    userId: string,
  ): Promise<void> {
    const wallet = getWallet(userId);
    sendJson(res, 200, {
      ok: true,
      data: {
        userId: wallet.userId,
        credits_balance: wallet.credits_balance,
        local_balance: wallet.local_balance,
        currency_code: wallet.currency_code,
        exchange_rate: wallet.exchange_rate,
        is_active: wallet.is_active,
      },
    });
  }

  async function handleWalletTopup(
    req: IncomingMessage,
    res: ServerResponse,
    userId: string,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (!isRecord(body)) {
      sendError(res, 400, "invalid body");
      return;
    }

    const amountLocal = body.amountLocal;
    const currency = body.currency;
    const gateway = body.gateway;

    if (typeof amountLocal !== "number" || !Number.isFinite(amountLocal) || amountLocal <= 0) {
      sendError(res, 400, "amountLocal must be a positive number");
      return;
    }
    if (typeof currency !== "string" || currency.trim().length === 0) {
      sendError(res, 400, "currency is required");
      return;
    }
    if (
      typeof gateway !== "string" ||
      !PAYMENT_GATEWAYS.includes(gateway as PaymentGatewayName)
    ) {
      sendError(res, 400, "gateway must be one of midtrans, xendit, tripay, manual");
      return;
    }

    getWallet(userId); // pastikan wallet ada
    const txId = randomUUID();
    sendJson(res, 201, {
      ok: true,
      data: {
        txId,
        status: "pending",
        amountLocal,
        currency,
        gateway,
      },
    });
  }

  async function handleProfileGet(
    res: ServerResponse,
    userId: string,
  ): Promise<void> {
    sendJson(res, 200, { ok: true, data: getProfile(userId) });
  }

  async function handleProfilePut(
    req: IncomingMessage,
    res: ServerResponse,
    userId: string,
  ): Promise<void> {
    const body = await readJsonBody(req);
    if (body !== undefined && !isRecord(body)) {
      sendError(res, 400, "invalid body");
      return;
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const profile = getProfile(userId);
    for (const key of ["displayName", "timezone", "currencyCode"] as const) {
      if (input[key] === undefined) continue;
      if (typeof input[key] !== "string") {
        sendError(res, 400, `${key} must be a string`);
        return;
      }
      profile[key] = input[key];
    }

    sendJson(res, 200, { ok: true, data: profile });
  }

  /* ------------------------------ packages ----------------------------- */
  async function handlePackagesGet(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const adminStore = createAdminStore();
    const packages = await adminStore.listPackages(/* includeInactive */ false);
    sendJson(res, 200, { ok: true, data: packages });
  }

  /* --------------------------- dispatch --------------------------- */

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    // Hanya menangani namespace `/api/admin/*`; sisanya 404 JSON.
    if (pathname !== "/api/admin" && !pathname.startsWith("/api/admin/")) {
      sendError(res, 404, "not found");
      return;
    }

    // Admin session guard (defense-in-depth). `/api/admin/health` tetap
    // publik supaya liveness probe tidak butuh kredensial.
    const isAdminPath = pathname === "/api/admin" || pathname.startsWith("/api/admin/");
    const isHealthPath = pathname === "/api/admin/health";
    if (adminGuard && isAdminPath && !isHealthPath) {
      try {
        const outcome = await adminGuard(req);
        if (!outcome.ok) {
          sendError(res, outcome.status, outcome.error);
          return;
        }
      } catch (error) {
        console.error("[api-ext] admin guard error:", error);
        if (!res.writableEnded) {
          sendError(res, 403, "admin session check failed");
        }
        return;
      }
    }

    if (isRateLimited(req)) {
      sendError(res, 429, "rate limit exceeded");
      return;
    }

    if (!isAuthorized(req)) {
      sendError(res, 401, "unauthorized");
      return;
    }

    try {
      const method = req.method ?? "GET";

      if (method === "GET" && pathname === "/api/admin/health") {
        return await handleHealth(req, res);
      }

      if (method === "GET" && pathname === "/api/admin/storage-pools") {
        return await handleStoragePools(req, res);
      }

      const poolProvidersMatch = pathname.match(
        /^\/api\/admin\/storage-pools\/([^/]+)\/providers$/,
      );
      if (method === "GET" && poolProvidersMatch) {
        return await handleStoragePoolProviders(
          req,
          res,
          decodeParam(poolProvidersMatch[1]),
        );
      }

      if (pathname === "/api/admin/vast-instances") {
        if (method === "GET") return await handleVastInstancesGet(req, res);
        if (method === "POST") return await handleVastInstancesPost(req, res);
      }

      const vastLifecycleMatch = pathname.match(
        /^\/api\/admin\/vast-instances\/([^/]+)\/(start|stop|cancel)$/,
      );
      if (method === "POST" && vastLifecycleMatch) {
        return await handleVastLifecycle(
          res,
          decodeParam(vastLifecycleMatch[1]),
          vastLifecycleMatch[2] as "start" | "stop" | "cancel",
        );
      }

      const vastItemMatch = pathname.match(/^\/api\/admin\/vast-instances\/([^/]+)$/);
      if (method === "DELETE" && vastItemMatch) {
        return await handleVastDelete(res, decodeParam(vastItemMatch[1]));
      }

      const topupMatch = pathname.match(/^\/api\/admin\/wallets\/([^/]+)\/topup$/);
      if (method === "POST" && topupMatch) {
        return await handleWalletTopup(req, res, decodeParam(topupMatch[1]));
      }

      const walletMatch = pathname.match(/^\/api\/admin\/wallets\/([^/]+)$/);
      if (method === "GET" && walletMatch) {
        return await handleWalletGet(res, decodeParam(walletMatch[1]));
      }

      const profileMatch = pathname.match(/^\/api\/admin\/profiles\/([^/]+)$/);
      if (profileMatch) {
        const userId = decodeParam(profileMatch[1]);
        if (method === "GET") return await handleProfileGet(res, userId);
        if (method === "PUT") return await handleProfilePut(req, res, userId);
      }

      const packageMatch = pathname.match(/^\/api\/admin\/packages$/);
      if (packageMatch && method === "GET") {
        return await handlePackagesGet(req, res);
      }

      // Public pricing packages endpoint — consumed by the public `/pricing`
      // page. No admin auth required.
      if (pathname === "/api/packages" && method === "GET") {
        const adminStore = createAdminStore();
        const packages = await adminStore.listPackages(/* includeInactive */ false);
        sendJson(res, 200, { ok: true, data: packages });
        return;
      }

      sendError(res, 404, "not found");
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendError(res, 413, "payload too large");
        return;
      }
      if (error instanceof InvalidBodyError) {
        sendError(res, 400, "invalid JSON body");
        return;
      }
      console.error("[api-ext] route error:", error);
      if (!res.writableEnded) {
        sendError(res, 500, "internal error");
      }
    }
  };
}
