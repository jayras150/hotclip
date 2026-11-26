/**
 * Anonymous studio session resolution.
 *
 * Identity model (no login, no API key):
 *   - The browser keeps `sessionId` in localStorage and echoes it on every
 *     request as `x-client-session`.
 *   - The server additionally sets an `hc_session` cookie. It exists purely so
 *     `EventSource` can authenticate the SSE log stream — it cannot send
 *     custom headers.
 *   - The header wins over the cookie when both are present, so a stale cookie
 *     in another tab can never hijack the active session.
 *
 * Verification: `pnpm typecheck && pnpm test`
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClientSessionRow, PublicStoreDriver } from "./public-store";

export const SESSION_COOKIE = "hc_session";
export const SESSION_HEADER = "x-client-session";
/** 30 days — long enough that returning visitors keep their clip history. */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Tokens are server-generated UUIDs; accept a slightly wider charset. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isSessionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (typeof raw === "string") return raw.trim() || undefined;
  if (Array.isArray(raw)) {
    const first = raw[0]?.trim();
    return first || undefined;
  }
  return undefined;
}

/** Parses a `Cookie` header into a plain object. Never throws. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const value = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** Reads the session token from the header first, then the cookie. */
export function sessionTokenFromRequest(req: IncomingMessage): string | null {
  const fromHeader = headerValue(req, SESSION_HEADER);
  if (isSessionToken(fromHeader)) return fromHeader;

  const fromCookie = parseCookies(headerValue(req, "cookie"))[SESSION_COOKIE];
  if (isSessionToken(fromCookie)) return fromCookie;

  return null;
}

/**
 * `HttpOnly` because only the server reads it; `SameSite=Lax` keeps the
 * EventSource GET working cross-tab while blocking cross-site posts.
 */
export function sessionCookie(token: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  const existing = res.getHeader("Set-Cookie");
  const cookie = sessionCookie(token);
  if (existing === undefined) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  const list = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

export interface ResolvedSession {
  session: ClientSessionRow;
  /** What the client should echo as `x-client-session`. */
  token: string;
  /** True when a fresh `client_sessions` row was created by this call. */
  created: boolean;
}

/**
 * Resolves (and lazily creates) the caller's anonymous session.
 *
 * Reusing the incoming token matters: two tabs with the same localStorage value
 * must map to one row, otherwise their clip history would diverge.
 */
export async function resolvePublicSession(
  req: IncomingMessage,
  store: PublicStoreDriver,
): Promise<ResolvedSession> {
  const incoming = sessionTokenFromRequest(req);

  if (incoming) {
    const found = await store.findSessionByToken(incoming);
    if (found) {
      // Best-effort heartbeat; never fail the request over telemetry.
      void store.touchSession(found.id).catch(() => undefined);
      return { session: found, token: found.sessionToken, created: false };
    }
  }

  const token = incoming ?? randomUUID();
  const created = await store.createSession({
    sessionToken: token,
    userAgent: headerValue(req, "user-agent") ?? null,
    ipAddress: req.socket.remoteAddress ?? null,
  });

  return { session: created, token: created.sessionToken, created: true };
}
