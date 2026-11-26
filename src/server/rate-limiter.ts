/**
 * Rate limiting ketat per-IP **dan** per-userId (anti-spam / anti-abuse).
 *
 * - `createRateLimiter({ maxRequests, windowMs, key? })` — sliding window
 *   generik dengan key string. Default key = alamat IP socket; kirim
 *   `key(req)` untuk memakai userId / API token / kombinasi apa pun.
 * - `createUserRateLimiter({ maxPerMinute, maxPerDay })` — kuota per userId
 *   dengan `check(userId)` -> `{ allowed, reason? }`.
 *
 * Semua state in-memory (tanpa dependency eksternal) sehingga cepat dan
 * mudah dites; entri kedaluwarsa dipangkas setiap kali bucket disentuh.
 *
 * Verifikasi: `npx tsc --noEmit -p tsconfig.node.json`
 */

import type { IncomingMessage } from "node:http";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Sliding window generik                                             */
/* ------------------------------------------------------------------ */

export interface RateLimiterOptions {
  /** Jumlah request maksimum per window. */
  maxRequests: number;
  /** Durasi window dalam ms. */
  windowMs: number;
  /** Resolver key opsional; default memakai alamat IP socket. */
  key?: (req: IncomingMessage) => string;
  /** Batas jumlah key di memori (default 10_000). */
  maxKeys?: number;
  /** Sumber waktu (ms), bisa di-override untuk test. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Sisa kuota setelah request ini dihitung. */
  remaining: number;
  /** Batas kuota per window. */
  limit: number;
  /** Epoch ms saat slot paling tua kedaluwarsa. */
  resetAt: number;
}

export interface RateLimiter {
  /** Cek + catat satu request. */
  check: (req: IncomingMessage) => RateLimitDecision;
  /** Cek tanpa mencatat (untuk observability). */
  peek: (req: IncomingMessage) => RateLimitDecision;
  /** Hapus seluruh state, atau satu key tertentu. */
  reset: (key?: string) => void;
}

/** Key default: alamat IP socket, fallback `"unknown"`. */
export function ipKey(req: IncomingMessage): string {
  const address = req.socket?.remoteAddress;
  return typeof address === "string" && address.length > 0 ? address : "unknown";
}

/**
 * Membuat sliding-window limiter per key.
 *
 * Request pertama..ke-`maxRequests` diizinkan; request ke-`maxRequests + 1`
 * dalam window yang sama ditolak (`allowed: false`).
 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const maxRequests = Math.max(1, Math.floor(opts.maxRequests) || 1);
  const windowMs = Math.max(1, Math.floor(opts.windowMs) || 1);
  const maxKeys = Math.max(1, Math.floor(opts.maxKeys ?? 10_000));
  const resolveKey = opts.key ?? ipKey;
  const clock = opts.now ?? (() => Date.now());

  const buckets = new Map<string, number[]>();

  function prune(timestamps: number[], now: number, cutoff: number): number[] {
    return timestamps.filter((ts) => ts > cutoff && ts <= now + windowMs);
  }

  function decide(key: string, record: boolean): RateLimitDecision {
    const now = clock();
    const cutoff = now - windowMs;

    let timestamps = prune(buckets.get(key) ?? [], now, cutoff);

    // Keputusan dihitung SEBELUM push: request yang mengisi slot ke-N
    // (timestamps.length < maxRequests) diizinkan; slot ke-N+1 ditolak.
    const allowed = timestamps.length < maxRequests;
    if (record && allowed) {
      timestamps.push(now);
    }
    buckets.set(key, timestamps);

    if (buckets.size > maxKeys) {
      for (const [entryKey, entry] of buckets) {
        if (entry.every((ts) => ts <= cutoff)) buckets.delete(entryKey);
        if (buckets.size <= maxKeys) break;
      }
    }

    const oldest = timestamps.length > 0 ? timestamps[0] : now;
    return {
      allowed,
      remaining: Math.max(0, maxRequests - timestamps.length),
      limit: maxRequests,
      resetAt: oldest + windowMs,
    };
  }

  return {
    check(req: IncomingMessage): RateLimitDecision {
      return decide(resolveKey(req), true);
    },
    peek(req: IncomingMessage): RateLimitDecision {
      return decide(resolveKey(req), false);
    },
    reset(key?: string): void {
      if (typeof key === "string") buckets.delete(key);
      else buckets.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Per-user: per menit + per hari                                     */
/* ------------------------------------------------------------------ */

export interface UserRateLimiterOptions {
  /** Kuota per 60 detik (default 5). */
  maxPerMinute?: number;
  /** Kuota per 24 jam (default 50). */
  maxPerDay?: number;
  /** Sumber waktu (ms), bisa di-override untuk test. */
  now?: () => number;
}

export interface UserRateLimitResult {
  allowed: boolean;
  reason?: "minute" | "day";
  /** Sisa kuota per menit. */
  minuteRemaining?: number;
  /** Sisa kuota per hari. */
  dayRemaining?: number;
}

export interface UserRateLimiter {
  check: (userId: string) => UserRateLimitResult;
  reset: (userId?: string) => void;
}

const DEFAULT_MAX_PER_MINUTE = 5;
const DEFAULT_MAX_PER_DAY = 50;

/**
 * Limiter kuota per userId: `maxPerMinute` lalu `maxPerDay`.
 *
 * `check()` yang ditolak **tidak** menambah hitungan, sehingga pengguna
 * tetap bisa lanjut setelah window bergulir.
 */
export function createUserRateLimiter(opts: UserRateLimiterOptions = {}): UserRateLimiter {
  const maxPerMinute = Math.max(1, Math.floor(opts.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE) || 1);
  const maxPerDay = Math.max(1, Math.floor(opts.maxPerDay ?? DEFAULT_MAX_PER_DAY) || 1);
  const clock = opts.now ?? (() => Date.now());

  const minuteHits = new Map<string, number[]>();
  const dayHits = new Map<string, number[]>();

  function pruned(map: Map<string, number[]>, userId: string, now: number, windowMs: number): number[] {
    const recent = (map.get(userId) ?? []).filter((ts) => ts > now - windowMs && ts <= now);
    map.set(userId, recent);
    return recent;
  }

  return {
    check(userId: string): UserRateLimitResult {
      const key = typeof userId === "string" && userId.length > 0 ? userId : "anonymous";
      const now = clock();

      const minute = pruned(minuteHits, key, now, 60_000);
      if (minute.length >= maxPerMinute) {
        return {
          allowed: false,
          reason: "minute",
          minuteRemaining: 0,
          dayRemaining: Math.max(0, maxPerDay - pruned(dayHits, key, now, DAY_MS).length),
        };
      }

      const day = pruned(dayHits, key, now, DAY_MS);
      if (day.length >= maxPerDay) {
        return {
          allowed: false,
          reason: "day",
          minuteRemaining: Math.max(0, maxPerMinute - minute.length),
          dayRemaining: 0,
        };
      }

      minute.push(now);
      day.push(now);
      minuteHits.set(key, minute);
      dayHits.set(key, day);

      return {
        allowed: true,
        minuteRemaining: Math.max(0, maxPerMinute - minute.length),
        dayRemaining: Math.max(0, maxPerDay - day.length),
      };
    },
    reset(userId?: string): void {
      if (typeof userId === "string") {
        minuteHits.delete(userId);
        dayHits.delete(userId);
        return;
      }
      minuteHits.clear();
      dayHits.clear();
    },
  };
}
