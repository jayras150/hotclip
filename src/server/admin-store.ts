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

export interface AdminStore {
  /** List every tenant user (bounded by `limit`, default 100). */
  listAdminUsers(limit?: number): Promise<AdminUser[]>;
  /** Ban a user (status → suspended + `bannedAt`). Returns the updated row. */
  banUser(id: string, reason?: string): Promise<AdminUser | null>;
  /** Unban a user (status → active, clears `bannedAt`/`banReason`). */
  unbanUser(id: string): Promise<AdminUser | null>;
  /** Reset the user's credit balance to zero. Returns the updated row. */
  resetUserQuota(id: string): Promise<AdminUser | null>;
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
const TABLES = {
  users: "users",
  wallets: "user_wallets",
  audit: "admin_audit_logs",
} as const;

function nowIso(): string {
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

function asStatus(value: unknown): AdminUserStatus {
  return value === "suspended" || value === "disabled" ? value : "active";
}

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

  constructor(seed: AdminUser[] = []) {
    for (const user of seed) {
      this.users.set(user.id, { ...user });
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
}

/* ------------------------------------------------------------------ */
/* Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Pilih driver berdasarkan env. PostgREST dipakai hanya bila
 * `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sama-sama diset.
 */
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
