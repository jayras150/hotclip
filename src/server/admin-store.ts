/**
 * Admin store — user management + `admin_audit_logs` audit trail.
 *
 * Mirrors the `DataStore` pattern in `./store.ts`: an in-memory driver for
 * dev/tests and a PostgREST (Supabase) driver for production, selected by
 * `createAdminStore(env)`.
 *
 * Env yang dibaca:
 *   - `SUPABASE_URL`              (wajib untuk PostgrestAdminStore)
 *   - `SUPABASE_SERVICE_ROLE_KEY` (wajib untuk PostgrestAdminStore)
 *
 * Bila salah satu tidak diset → `InMemoryAdminStore`.
 *
 * Verifikasi: `pnpm typecheck && pnpm test`
 */

import { randomUUID } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type AdminUserStatus = "active" | "suspended" | "disabled";
export type AdminUserRole = "member" | "admin";

export interface AdminUser {
  id: string;
  email: string;
  role: AdminUserRole;
  status: AdminUserStatus;
  createdAt: string;
  /** ISO timestamp when the user was banned; `undefined` if active. */
  bannedAt?: string;
  /** Reason supplied by the banning admin. */
  banReason?: string;
  /** Credits balance (0 when the wallet row is missing). */
  creditsBalance?: number;
  localBalance?: number;
  currencyCode?: string;
}

export interface AdminAuditLogInput {
  action: string;
  entity: string;
  entityId?: string;
  userId?: string;
  adminEmail?: string;
  ip?: string;
  userAgent?: string;
  details?: unknown;
}

export interface AdminAuditLogEntry extends AdminAuditLogInput {
  id: string;
  createdAt: string;
}

export interface AdminUserPatch {
  status: AdminUserStatus;
  bannedAt?: string | null;
  banReason?: string | null;
}

/** A purchasable credit package (pricing tier), priced in USD. */
export interface AdminPackage {
  id: string;
  name: string;
  /** Slug used by the public pricing page / Clerk plan lookup. */
  slug: string;
  /** Price in US dollars (e.g. 9, 19, 49). */
  priceUsd: number;
  /** Credits granted when the package is purchased. */
  credits: number;
  /** Short marketing blurb. */
  description?: string;
  /** Ordered from cheapest to most expensive. */
  sortOrder: number;
  isActive: boolean;
  isPopular: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPackageInput {
  name: string;
  slug: string;
  priceUsd: number;
  credits: number;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  isPopular?: boolean;
}

export type AdminPackagePatch = Partial<AdminPackageInput>;

/** Append-only record of every manual credit adjustment. */
export interface AdminCreditAdjustment {
  [key: string]: unknown;

  id: string;
  userId: string;
  /** "topup" | "deduct" | "set" | "reset" */
  kind: AdminCreditKind;
  /** Signed delta applied to the balance (0 for "set"). */
  delta: number;
  /** Balance before/after the adjustment. */
  previousBalance: number;
  balance: number;
  reason: string;
  adminEmail?: string;
  createdAt: string;
}

export type AdminCreditKind = "topup" | "deduct" | "set" | "reset";

export interface AdminCreditAdjustInput {
  kind: AdminCreditKind;
  amount?: number;
  reason: string;
  adminEmail?: string;
}

export interface AdminStore {
  /** List every tenant user (bounded by `limit`, default 100). */
  listAdminUsers(limit?: number): Promise<AdminUser[]>;
  /** Ban a user (status → suspended + `bannedAt`). Returns the updated row. */
  banUser(id: string, reason?: string): Promise<AdminUser | null>;
  /** Unban a user (status → active, clears `bannedAt`/`banReason`). */
  unbanUser(id: string): Promise<AdminUser | null>;
  /** Reset the user's credit balance to zero. Returns the updated row. */
  resetUserQuota(id: string): Promise<AdminUser | null>;

  /* ---------------------- packages & pricing ---------------------- */
  /** List every credit package (active first, then by `sortOrder`). */
  listPackages(includeInactive?: boolean): Promise<AdminPackage[]>;
  /** Create a package. Returns the persisted row, or `null` if the request
   *  returned nothing (e.g. PostgREST upsert skipped a duplicate). */
  createPackage(input: AdminPackageInput): Promise<AdminPackage | null>;
  /** Patch an existing package. Returns `null` when it does not exist. */
  updatePackage(id: string, patch: AdminPackagePatch): Promise<AdminPackage | null>;
  /** Soft-disable a package (kept for order history). */
  deletePackage(id: string): Promise<AdminPackage | null>;

  /* --------------------- user credit management ------------------- */
  /** Find a user by exact id, or case-insensitive email. */
  findUser(query: string): Promise<AdminUser | null>;
  /** Apply a manual credit adjustment and record it. */
  adjustCredits(
    userId: string,
    input: AdminCreditAdjustInput,
  ): Promise<{ user: AdminUser; adjustment: AdminCreditAdjustment } | null>;
  /** Credit adjustment history (newest first), optionally per user. */
  listCreditAdjustments(userId?: string, limit?: number): Promise<AdminCreditAdjustment[]>;

  /** Insert one audit row into `admin_audit_logs`. */
  writeAdminAuditLog(entry: AdminAuditLogInput): Promise<void>;
  /** Read the audit trail, newest first. */
  listAdminAuditLogs(limit?: number): Promise<AdminAuditLogEntry[]>;
  /** Health probe (used by `/api/admin/health`). */
  health(): Promise<boolean>;
}

export type AdminEnv = Record<string, string | undefined>;

const DEFAULT_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 10_000;

export const TABLES = {
  users: "users",
  wallets: "user_wallets",
  audit: "admin_audit_logs",
  packages: "admin_packages",
  adjustments: "admin_credit_adjustments",
} as const;

/** Broadest dict shape the PostgREST layer accepts (no strict index signature
 * required). `removeNulls` strips `null` values before a row is written. */
type Dict = Record<string, unknown>;

/** ISO timestamp helper used across the admin API. */
export function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** True when `value` is a non-null plain object (not array, string, number, boolean, or null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `value` is a boolean or the string "true"/"false". */
function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function asStatus(value: unknown): AdminUserStatus {
  return value === "suspended" || value === "disabled" ? value : "active";
}

/**
 * Default USD pricing tiers (Free / Starter / Pro / Studio), seeded into the
 * in-memory AdminStore. Free / Starter / Pro. These match the in-app defaults
 * in `@shared/pkg-contract.ts`; they are used to populate the admin store
 * catalog so the `/api/packages` and `/api/admin/packages` endpoints are
 * populated even before the PostgREST table is loaded.
 */
export function DEFAULT_PACKAGES(): AdminPackage[] {
  return DEFAULT_PACKAGES_SEED();
}

/** Re-export the shared in-memory seed so the admin store can use it. */
import { DEFAULT_PACKAGES as seedPackages } from "../../src/shared/pkg-contract";
export { seedPackages as DEFAULT_PACKAGES_SEED };

function asRole(value: unknown): AdminUserRole {
  return value === "admin" ? "admin" : "member";
}

/* ------------------------------------------------------------------ */
/* InMemoryAdminStore — dev/test, tanpa dependency                     */
/* ------------------------------------------------------------------ */

interface MemoryWallet {
  credits: number;
  local: number;
  currency: string;
}

/** In-memory driver untuk dev lokal dan unit test. */
export class InMemoryAdminStore implements AdminStore {
  private readonly users = new Map<string, AdminUser>();
  private readonly wallets = new Map<string, MemoryWallet>();
  private readonly audits: AdminAuditLogEntry[] = [];
  private readonly packages = new Map<string, AdminPackage>();
  private readonly adjustments: AdminCreditAdjustment[] = [];

  constructor(seed: AdminUser[] = []) {
    for (const user of seed) {
      this.users.set(user.id, { ...user });
    }
    for (const pkg of DEFAULT_PACKAGES()) {
      this.packages.set(pkg.id, pkg);
    }
  }

  /** Test helper: seed a user row. */
  seedUser(user: Partial<AdminUser> & { id: string; email: string }): AdminUser {
    const row: AdminUser = {
      id: user.id,
      email: user.email,
      role: user.role ?? "member",
      status: user.status ?? "active",
      createdAt: user.createdAt ?? nowIso(),
      bannedAt: user.bannedAt,
      banReason: user.banReason,
      creditsBalance: user.creditsBalance ?? 0,
      localBalance: user.localBalance ?? 0,
      currencyCode: user.currencyCode ?? "IDR",
    };
    this.users.set(row.id, row);
    return { ...row };
  }

  /** Test helper: inspect the audit trail without an HTTP round-trip. */
  debugAuditLogs(): AdminAuditLogEntry[] {
    return this.audits.map((entry) => ({ ...entry }));
  }

  async health(): Promise<boolean> {
    return true;
  }

  async listAdminUsers(limit = DEFAULT_LIMIT): Promise<AdminUser[]> {
    return [...this.users.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit))
      .map((row) => ({ ...row }));
  }

  async banUser(id: string, reason?: string): Promise<AdminUser | null> {
    const existing = this.users.get(id);
    if (!existing) return null;
    const next: AdminUser = {
      ...existing,
      status: "suspended",
      bannedAt: nowIso(),
      banReason: reason,
    };
    this.users.set(id, next);
    return { ...next };
  }

  async unbanUser(id: string): Promise<AdminUser | null> {
    const existing = this.users.get(id);
    if (!existing) return null;
    const next: AdminUser = {
      ...existing,
      status: "active",
      bannedAt: undefined,
      banReason: undefined,
    };
    this.users.set(id, next);
    return { ...next };
  }

  async resetUserQuota(id: string): Promise<AdminUser | null> {
    const existing = this.users.get(id);
    if (!existing) return null;
    this.wallets.set(id, { credits: 0, local: 0, currency: existing.currencyCode ?? "IDR" });
    const next: AdminUser = { ...existing, creditsBalance: 0, localBalance: 0 };
    this.users.set(id, next);
    return { ...next };
  }

  async writeAdminAuditLog(entry: AdminAuditLogInput): Promise<void> {
    this.audits.push({ id: randomUUID(), createdAt: nowIso(), ...entry });
  }

  async listAdminAuditLogs(limit = DEFAULT_LIMIT): Promise<AdminAuditLogEntry[]> {
    return [...this.audits]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit))
      .map((row) => ({ ...row }));
  }

  /* ------------------------------ packages ----------------------------- */
  async listPackages(includeInactive = false): Promise<AdminPackage[]> {
    const rows = [...this.packages.values()];
    if (!includeInactive) rows.sort((a, b) => Number(b.isActive) - Number(a.isActive));
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createPackage(input: AdminPackageInput): Promise<AdminPackage | null> {
    const pkg: AdminPackage = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      priceUsd: input.priceUsd,
      credits: input.credits,
      description: input.description,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      isPopular: input.isPopular ?? false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.packages.set(pkg.id, pkg);
    return { ...pkg };
  }

  async updatePackage(id: string, patch: AdminPackagePatch): Promise<AdminPackage | null> {
    const existing = this.packages.get(id);
    if (!existing) return null;
    const updated: AdminPackage = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    this.packages.set(id, updated);
    return { ...updated };
  }

  async deletePackage(id: string): Promise<AdminPackage | null> {
    const existing = this.packages.get(id);
    if (!existing) return null;
    const deleted = { ...existing, isActive: false, updatedAt: nowIso() };
    this.packages.set(id, deleted);
    return { ...deleted };
  }

  /* ---------------------- user credit management --------------------- */
  async findUser(query: string): Promise<AdminUser | null> {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    for (const user of this.users.values()) {
      if (user.id === q) return { ...user };
      if (user.email.toLowerCase() === q) return { ...user };
      if (user.email.split("@")[0].toLowerCase() === q) return { ...user };
    }
    // Also check wallets (a user may be credit-only, no profile row).
    for (const [userId] of this.wallets) {
      if (userId === q) {
        const row = this.users.get(userId);
        if (row) return { ...row };
      }
    }
    return null;
  }

  async adjustCredits(
    userId: string,
    input: AdminCreditAdjustInput,
  ): Promise<{ user: AdminUser; adjustment: AdminCreditAdjustment } | null> {
    const existing = this.users.get(userId);
    if (!existing) return null;
    const previousBalance = existing.creditsBalance ?? 0;
    const now = nowIso();

    let balance: number;
    if (input.kind === "reset") {
      balance = 0;
    } else if (input.kind === "set") {
      balance = Math.max(0, input.amount ?? 0);
    } else {
      balance = Math.max(0, previousBalance + (input.amount ?? 0));
    }

    const next: AdminUser = { ...existing, creditsBalance: balance };
    this.users.set(userId, next);
    const adjustment: AdminCreditAdjustment = {
      id: randomUUID(),
      userId,
      kind: input.kind,
      delta: input.kind === "set" ? 0 : (balance - previousBalance),
      previousBalance,
      balance,
      reason: input.reason || "no reason given",
      adminEmail: input.adminEmail,
      createdAt: now,
    };
    this.adjustments.unshift(adjustment);
    return { user: { ...next }, adjustment };
  }

  async listCreditAdjustments(
    userId?: string,
    limit = DEFAULT_LIMIT,
  ): Promise<AdminCreditAdjustment[]> {
    let rows = [...this.adjustments];
    if (userId) rows = rows.filter((a) => a.userId === userId);
    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit));
  }
}




/* ------------------------------------------------------------------ */
/* PostgrestAdminStore (Supabase PostgREST)                           */
/* ------------------------------------------------------------------ */

type RawRow = Record<string, unknown>;

/** PostgREST adapter — no Supabase SDK, only the built-in `fetch`. */
export class PostgrestAdminStore implements AdminStore {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(env: AdminEnv = process.env) {
    const url = env.SUPABASE_URL?.trim();
    const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      throw new Error(
        "PostgrestAdminStore: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diset",
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
      await this.request<RawRow[]>("GET", `${TABLES.audit}?select=id&limit=1`);
      return true;
    } catch {
      return false;
    }
  }

  async listAdminUsers(limit = DEFAULT_LIMIT): Promise<AdminUser[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.users}?select=*&order=created_at.desc&limit=${Math.max(1, limit)}`,
    );
    const users = (rows ?? []).map((row) => mapAdminUserRow(row)).filter(isAdminUser);

    // Best-effort enrichment with wallet balances (a missing table must not
    // break the users page).
    try {
      const wallets = await this.request<RawRow[]>(
        "GET",
        `${TABLES.wallets}?select=user_id,credits_balance,local_balance,currency_code`,
      );
      const byUser = new Map<string, RawRow>();
      for (const wallet of wallets ?? []) {
        const userId = asString(wallet.user_id);
        if (userId) byUser.set(userId, wallet);
      }
      return users.map((user) => {
        const wallet = byUser.get(user.id);
        if (!wallet) return user;
        return {
          ...user,
          creditsBalance: asNumber(wallet.credits_balance, 0),
          localBalance: asNumber(wallet.local_balance, 0),
          currencyCode: asString(wallet.currency_code) ?? user.currencyCode ?? "IDR",
        };
      });
    } catch {
      return users;
    }
  }

  async banUser(id: string, reason?: string): Promise<AdminUser | null> {
    const rows = await this.request<RawRow[]>("PATCH", `${TABLES.users}?id=eq.${encodeFilter(id)}`, {
      body: {
        status: "suspended",
        banned_at: nowIso(),
        ban_reason: reason ?? null,
      },
      prefer: "return=representation",
    });
    return toAdminUser(rows?.[0]);
  }

  async unbanUser(id: string): Promise<AdminUser | null> {
    const rows = await this.request<RawRow[]>("PATCH", `${TABLES.users}?id=eq.${encodeFilter(id)}`, {
      body: {
        status: "active",
        banned_at: null,
        ban_reason: null,
      },
      prefer: "return=representation",
    });
    return toAdminUser(rows?.[0]);
  }

  async resetUserQuota(id: string): Promise<AdminUser | null> {
    await this.request<RawRow[]>(`POST`, `${TABLES.wallets}?on_conflict=user_id`, {
      body: {
        user_id: id,
        credits_balance: 0,
        local_balance: 0,
        currency_code: "idr",
        exchange_rate: 15000,
        is_active: true,
      },
      prefer: "resolution=merge-duplicates,return=representation",
    });

    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.users}?select=*&id=eq.${encodeFilter(id)}&limit=1`,
    );
    return toAdminUser(rows?.[0]);
  }

  async writeAdminAuditLog(entry: AdminAuditLogInput): Promise<void> {
    await this.request<RawRow[]>("POST", TABLES.audit, {
      body: {
        id: randomUUID(),
        admin_id: entry.userId ?? null,
        admin_email: entry.adminEmail ?? null,
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

  async listAdminAuditLogs(limit = DEFAULT_LIMIT): Promise<AdminAuditLogEntry[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.audit}?select=*&order=created_at.desc&limit=${Math.max(1, limit)}`,
    );
    return (rows ?? []).map((row) => mapAuditRow(row)).filter(isAuditEntry);
  }

  /* ------------------------------ packages ----------------------------- */
  async listPackages(includeInactive = false): Promise<AdminPackage[]> {
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.packages}?select=*&order=sort_order.asc,created_at.desc`,
    );
    const all = (rows ?? [])
      .map(mapPackageRow)
      .filter(isPackage) as AdminPackage[];
    if (!includeInactive) {
      return all.filter((p) => p.isActive);
    }
    return all;
  }

  async createPackage(input: AdminPackageInput): Promise<AdminPackage | null> {
    const now = nowIso();
    const row: RawRow = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      price_usd: Number(input.priceUsd),
      credits: Number(input.credits),
      description: input.description ?? null,
      sort_order: Number(input.sortOrder ?? 0),
      is_active: Boolean(input.isActive),
      is_popular: Boolean(input.isPopular),
      created_at: now,
      updated_at: now,
    };
    const created = await this.request<RawRow[]>("POST", TABLES.packages, {
      body: { ...row },
      prefer: "resolution=merge-duplicates,return=representation",
    });
    return created?.length ? mapPackageRow(created[0]) : null;
  }

  async updatePackage(id: string, patch: AdminPackagePatch): Promise<AdminPackage | null> {
    const existing = await this.request<RawRow[]>(
      "GET",
      `${TABLES.packages}?select=*&id=eq.${encodeFilter(id)}&limit=1`,
    );
    if (!existing?.length) return null;
    const updated: RawRow = {
      ...existing[0],
      ...mapPackagePatch(patch),
      updated_at: nowIso(),
    };
    const cleaned = removeNulls(updated) as RawRow;
    await this.request("PATCH", `${TABLES.packages}?id=eq.${encodeFilter(id)}`, {
      body: cleaned,
      prefer: "return=representation",
    });
    return mapPackageRow(cleaned);
  }

  async deletePackage(id: string): Promise<AdminPackage | null> {
    const existing = await this.request<RawRow[]>(
      "GET",
      `${TABLES.packages}?select=*&id=eq.${encodeFilter(id)}&limit=1`,
    );
    if (!existing?.length) return null;
    const now = nowIso();
    await this.request("PATCH", `${TABLES.packages}?id=eq.${encodeFilter(id)}`, {
      body: { is_active: false as const, updated_at: now },
      prefer: "return=representation",
    });
    return mapPackageRow(existing[0]);
  }

  /* -------------------- user credit management --------------------- */
  async findUser(query: string): Promise<AdminUser | null> {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const rows = await this.request<RawRow[]>(
      "GET",
      `${TABLES.users}?select=*&limit=10`,
    );
    const users = (rows ?? []).map(mapAdminUserRow).filter(isAdminUser);
    for (const user of users) {
      if (user.id === q) return { ...user };
      if (user.email.toLowerCase() === q) return { ...user };
      if (user.email.split("@")[0].toLowerCase() === q) return { ...user };
    }
    // Check wallets for a credit-only record with no profile row.
    try {
      const walletRows = await this.request<RawRow[]>(
        "GET",
        `${TABLES.wallets}?select=user_id&limit=200`,
      );
      const walletMap = new Map<string, RawRow>();
      for (const w of walletRows ?? []) {
        const uid = asString(w.user_id);
        if (uid) walletMap.set(uid, w);
      }
      for (const [uid] of walletMap) {
        if (uid === q) {
          const found = users.find((u) => u.id === uid);
          if (found) return { ...found };
        }
      }
    } catch {
      // Best-effort: a missing wallets table must not break the users search.
    }
    return null;
  }

  async adjustCredits(
    userId: string,
    input: AdminCreditAdjustInput,
  ): Promise<{ user: AdminUser; adjustment: AdminCreditAdjustment } | null> {
    const existing = await this.request<RawRow[]>(
      "GET",
      `${TABLES.users}?select=*&id=eq.${encodeFilter(userId)}&limit=1`,
    );
    if (!existing?.length) return null;
    const user = mapAdminUserRow(existing[0]);
    if (!user) return null;
    const previousBalance = user.creditsBalance ?? 0;
    const now = nowIso();

    let balance: number;
    if (input.kind === "reset") {
      balance = 0;
    } else if (input.kind === "set") {
      balance = Math.max(0, Number(input.amount ?? 0));
    } else {
      balance = Math.max(0, previousBalance + Number(input.amount ?? 0));
    }

    const updated = { ...existing[0], credits_balance: balance, updated_at: now };
    await this.request("PATCH", `${TABLES.users}?id=eq.${encodeFilter(userId)}`, {
      body: removeNulls(updated),
      prefer: "return=representation",
    });

    const adjustment: AdminCreditAdjustment = {
      id: randomUUID(),
      userId,
      kind: input.kind,
      delta: input.kind === "set" ? 0 : (balance - previousBalance),
      previousBalance,
      balance,
      reason: input.reason || "no reason given",
      adminEmail: input.adminEmail,
      createdAt: now,
    };
    await this.request("POST", TABLES.adjustments, {
      body: removeNulls(adjustment),
      prefer: "return=minimal",
    });
    const nextUser = mapAdminUserRow(updated);
    if (!nextUser) return null;
    return { user: { ...nextUser }, adjustment };
  }

  async listCreditAdjustments(
    userId?: string,
    limit = DEFAULT_LIMIT,
  ): Promise<AdminCreditAdjustment[]> {
    const conditions = [
      `${TABLES.adjustments}?select=*&order=created_at.desc&limit=${Math.max(1, limit)}`,
    ];
    if (userId) {
      conditions.push(`${TABLES.adjustments}?select=*&user_id=eq.${encodeFilter(userId)}&order=created_at.desc&limit=${Math.max(1, limit)}`);
    }
    const rows: RawRow[] = [];
    for (const q of conditions) {
      const r = await this.request<RawRow[]>("GET", q);
      rows.push(...(r ?? []));
    }
    return (rows ?? []).map(mapCreditAdjustmentRow).filter(isCreditAdjustment);
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Pilih driver berdasarkan env. PostgREST dipakai hanya bila
 * `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sama-sama diset.
 */
/** ISO timestamp helper used across the admin API. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function createAdminStore(env: AdminEnv = process.env): AdminStore {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new PostgrestAdminStore(env);
  }
  return new InMemoryAdminStore();
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function encodeFilter(value: string): string {
  return encodeURIComponent(value);
}

/** Keep only the given keys from an object. */
function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Partial<Record<K, T[K]>> {
  const out: Partial<Record<K, T[K]>> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k] as T[K];
  }
  return out;
}

/** Drop keys whose value is `null` (PostgREST `select=` payload nulls are
 * dropped server-side, so a plain `omit` helper would be ambiguous). */
function removeNulls(record: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...record };
  for (const key of Object.keys(clone)) {
    if (clone[key] === null) delete clone[key];
  }
  return clone as Record<string, unknown>;
}

/**
 * Mapping helper for `AdminPackageInput` → `RawRow`.
 * `AdminPackageInput` uses camelCase fields; the PostgREST table uses snake_case.
 */
function mapPackagePatch(input: AdminPackagePatch): Partial<Record<keyof RawRow, unknown>> {
  const out: Partial<Record<keyof RawRow, unknown>> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.priceUsd !== undefined) out.price_usd = Number(input.priceUsd);
  if (input.credits !== undefined) out.credits = Number(input.credits);
  if (input.description !== undefined) out.description = input.description;
  if (input.sortOrder !== undefined) out.sort_order = Number(input.sortOrder);
  if (input.isActive !== undefined) out.is_active = Boolean(input.isActive);
  if (input.isPopular !== undefined) out.is_popular = Boolean(input.isPopular);
  return out;
}

function isPackage(value: unknown): value is AdminPackage {
  if (!isRecord(value)) return false;
  const pkg = value as Record<string, unknown>;
  return (
    typeof pkg.id === "string" &&
    typeof pkg.name === "string" &&
    typeof pkg.slug === "string" &&
    Number.isFinite(Number(pkg.price_usd)) &&
    Number.isFinite(Number(pkg.credits)) &&
    typeof pkg.isActive === "boolean" &&
    typeof pkg.isPopular === "boolean"
  );
}

function mapPackageRow(raw?: RawRow): AdminPackage | null {
  if (!raw) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    slug: asString(raw.slug) ?? id,
    priceUsd: asNumber(raw.price_usd, 0),
    credits: asNumber(raw.credits, 0),
    description: asString(raw.description),
    sortOrder: asNumber(raw.sort_order, 0),
    isActive: asBoolean(raw.is_active, true),
    isPopular: asBoolean(raw.is_popular, false),
    createdAt: asString(raw.created_at) ?? nowIso(),
    updatedAt: asString(raw.updated_at) ?? nowIso(),
  };
}

function isCreditAdjustment(value: unknown): value is AdminCreditAdjustment {
  if (!isRecord(value)) return false;
  const adj = value as Record<string, unknown>;
  return (
    typeof adj.id === "string" &&
    typeof adj.userId === "string" &&
    (adj.kind === "topup" || adj.kind === "deduct" || adj.kind === "set" || adj.kind === "reset") &&
    Number.isFinite(Number(adj.delta)) &&
    Number.isFinite(Number(adj.previousBalance)) &&
    Number.isFinite(Number(adj.balance)) &&
    typeof adj.reason === "string" &&
    typeof adj.createdAt === "string"
  );
}

function mapCreditAdjustmentRow(raw?: RawRow): AdminCreditAdjustment | null {
  if (!raw) return null;
  const id = asString(raw.id);
  const userId = asString(raw.user_id);
  if (!id || !userId) return null;
  return {
    id,
    userId,
    kind: asString(raw.kind) === "topup" ||
      asString(raw.kind) === "deduct" ||
      asString(raw.kind) === "set" ||
      asString(raw.kind) === "reset"
      ? (asString(raw.kind) as AdminCreditKind)
      : "topup",
    delta: asNumber(raw.delta, 0),
    previousBalance: asNumber(raw.previous_balance, 0),
    balance: asNumber(raw.balance, 0),
    reason: asString(raw.reason) ?? "—",
    adminEmail: asString(raw.admin_email),
    createdAt: asString(raw.created_at) ?? nowIso(),
  };
}

function isAdminUser(row: AdminUser | null): row is AdminUser {
  return row !== null;
}

function isAuditEntry(row: AdminAuditLogEntry | null): row is AdminAuditLogEntry {
  return row !== null;
}

function mapAdminUserRow(raw?: RawRow): AdminUser | null {
  if (!raw) return null;
  const id = asString(raw.id);
  const email = asString(raw.email);
  if (!id || !email) return null;
  return {
    id,
    email,
    role: asRole(raw.role),
    status: asStatus(raw.status),
    createdAt: asString(raw.created_at) ?? nowIso(),
    bannedAt: asString(raw.banned_at),
    banReason: asString(raw.ban_reason),
    creditsBalance: asNumber(raw.credits_balance, 0),
    localBalance: asNumber(raw.local_balance, 0),
    currencyCode: asString(raw.currency_code) ?? "IDR",
  };
}

function toAdminUser(raw?: RawRow): AdminUser | null {
  return mapAdminUserRow(raw);
}

function mapAuditRow(raw: RawRow): AdminAuditLogEntry | null {
  const id = asString(raw.id);
  const action = asString(raw.action);
  const entity = asString(raw.entity);
  if (!id || !action || !entity) return null;
  return {
    id,
    action,
    entity,
    entityId: asString(raw.entity_id),
    userId: asString(raw.admin_id),
    adminEmail: asString(raw.admin_email),
    ip: asString(raw.ip),
    userAgent: asString(raw.user_agent),
    details: raw.details ?? undefined,
    createdAt: asString(raw.created_at) ?? nowIso(),
  };
}
