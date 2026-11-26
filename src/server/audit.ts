/**
 * Audit logger + per-IP sliding-window rate limiter.
 *
 * `AuditLogger` menulis ke `DataStore.audit` (best-effort) dan mencetak
 * satu baris JSON ke console. Tidak pernah melempar error.
 *
 * Verifikasi: `npx tsc --noEmit -p tsconfig.node.json`
 */

import type { IncomingMessage } from "node:http";
import type { DataStore } from "./store";

export interface AuditEvent {
  action: string;
  entity: string;
  entityId?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  details?: unknown;
}

export class AuditLogger {
  constructor(private readonly store?: DataStore) {}

  /** Catat event audit. Tidak pernah throw (DB/console error diabaikan). */
  async log(event: AuditEvent): Promise<void> {
    const line = {
      level: "audit",
      at: new Date().toISOString(),
      ...event,
    };

    try {
      console.log(JSON.stringify(line));
    } catch {
      // Abaikan kegagalan serialisasi (mis. details sirkular).
    }

    if (!this.store) return;
    try {
      await this.store.audit({
        userId: event.userId,
        action: event.action,
        entity: event.entity,
        entityId: event.entityId,
        details: event.details,
        ip: event.ip,
        userAgent: event.userAgent,
      });
    } catch {
      // Audit bersifat best-effort; jangan menggagalkan request.
    }
  }
}

/**
 * Membuat rate limiter in-memory per-IP (sliding window).
 * Return `true` bila request harus ditolak (429).
 */
export function createRateLimiter(opts: {
  maxRequests: number;
  windowMs: number;
}): (req: IncomingMessage) => boolean {
  const maxRequests = Math.max(1, opts.maxRequests);
  const windowMs = Math.max(1, opts.windowMs);
  const hits = new Map<string, number[]>();

  return (req: IncomingMessage): boolean => {
    const key = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const cutOff = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutOff);

    if (recent.length >= maxRequests) {
      hits.set(key, recent);
      return true;
    }

    recent.push(now);
    hits.set(key, recent);

    // Cegah pertumbuhan map tanpa batas pada trafik tinggi.
    if (hits.size > 10_000) {
      for (const [entryKey, timestamps] of hits) {
        if (timestamps.every((timestamp) => timestamp <= cutOff)) {
          hits.delete(entryKey);
        }
      }
    }

    return false;
  };
}
