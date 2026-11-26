/**
 * Admin session enforcement — Defense-in-Depth, 4 layers.
 *
 * `enforceAdminSession(req)` is the single choke point for every
 * `/api/admin/*` route. Order is deliberate (most coercive first):
 *
 *   Layer 1  (optional, env)  Cloudflare Access JWT assertion — if
 *                             `ADMIN_CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN`
 *                             are set, the `Cf-Access-Jwt-Assertion` header
 *                             must verify against the team's JWKS. 403 if
 *                             invalid/missing.
 *   Layer 2  (joining)        Clerk session valid + `publicMetadata.role ===
 *                             'admin'` + match against `ADMIN_CLERK_USER_IDS`
 *                             / `ADMIN_EMAILS`. 403 if not an admin.
 *   Layer 3  (Second-Factor)  If `ADMIN_2FA_SECRET` is set, the
 *                             `x-admin-2fa` (http-only, short-lived, encrypted)
 *                             cookie must carry a valid TOTP code. Missing or
 *                             invalid → 401 (challenge).
 *   Layer 4  (IP allowlist)   If `ADMIN_ALLOWED_IPS` is set, the request IP
 *                             must be present in the list. 403 if outside.
 *
 * On success the caller receives `{ userId, email, claims }` and, when
 * `ADMIN_2FA_SECRET` is active, the successful 2FA cookie is reflected back
 * to the client so the session persists across requests.
 *
 * TOTP is implemented with Node `crypto` only (HMAC-SHA1 + base32, 6 digits,
 * 30s window). No third-party auth library is imported.
 *
 * Verification: `pnpm typecheck && pnpm test`
 */

import type { IncomingMessage } from "node:http";
import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
  createVerify,
} from "node:crypto";

/* ------------------------------------------------------------------------ */
/* Public API                                                             */
/* ------------------------------------------------------------------------ */

export interface AdminSessionIdentity {
  userId: string;
  email: string;
  claims: Record<string, unknown>;
}

/**
 * Result of the 4-layer enforcement. Either the full identity + matched
 * status/layer, or the failing layer + HTTP status + reason.
 */
export interface AdminSessionOutcome {
  ok: boolean;
  identity?: AdminSessionIdentity;
  status: 401 | 403;
  layer: 1 | 2 | 3 | 4;
  challenge: boolean;
  reason: string;
}

/**
 * Single choke point for all `/api/admin/*` routes.
 *
 * Returns the identity on success, or `null` on failure. Use
 * `enforceAdminSessionResult()` when the router needs the full outcome
 * (401 vs 403).
 */
export async function enforceAdminSession(
  req: IncomingMessage,
): Promise<AdminSessionIdentity | null> {
  const outcome = await enforceAdminSessionResult(req);
  return outcome.ok ? (outcome.identity ?? null) : null;
}

export async function enforceAdminSessionResult(
  req: IncomingMessage,
): Promise<AdminSessionOutcome> {
  const ip = getReqIp(req);

  // ------------------------------------------------------------------
  // Layer 1 — Cloudflare Access JWT assertion (optional, env-gated).
  // ------------------------------------------------------------------
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = process.env.ADMIN_CF_ACCESS_AUD?.trim();
  const rawAssertion = req.headers["Cf-Access-Jwt-Assertion"];
  if (teamDomain && audience && rawAssertion) {
    const assertion = String(rawAssertion);
    const isValid = await verifyCfAccessJwt(assertion, audience, teamDomain);
    if (!isValid) {
      return { ok: false, status: 403, layer: 1, challenge: false, reason: "invalid cf-access jwt assertion" };
    }
  }

  // ------------------------------------------------------------------
  // Layer 2 — Clerk session + role + allowlist.
  // ------------------------------------------------------------------
  const clerk = await resolveClerkIdentity(req);
  if (!clerk) {
    return { ok: false, status: 403, layer: 2, challenge: false, reason: "clerk session not admin" };
  }
  const { sub, email, payload } = clerk;

  // Layer 2a — require `publicMetadata.role === 'admin'`.
  const role =
    payload.role ??
    ((payload as Record<string, unknown>).public_metadata as Record<string, unknown>)?.role;
  if (role !== "admin") {
    return { ok: false, status: 403, layer: 2, challenge: false, reason: "clerk role is not admin" };
  }

  // Layer 2b — match the configured admin allowlist.
  const adminUserIds = parseCsvList(process.env.ADMIN_CLERK_USER_IDS);
  const adminEmails = parseCsvList(process.env.ADMIN_EMAILS);
  const isAdminUserId = adminUserIds.length > 0 && adminUserIds.includes(sub);
  const isAdminEmail = adminEmails.length > 0 && adminEmails.includes(String(email).toLowerCase());
  if (!isAdminUserId && !isAdminEmail) {
    return { ok: false, status: 403, layer: 2, challenge: false, reason: "clerk user not in admin allowlist" };
  }

  // ------------------------------------------------------------------
  // Layer 3 — Second factor (TOTP).
  // ------------------------------------------------------------------
  const twoFaSecret = process.env.ADMIN_2FA_SECRET?.trim();
  if (twoFaSecret) {
    // No cookie → challenge. Invalid/expired code → challenge too.
    const cookie = req.headers.cookie ?? "";
    const stored = read2FACookie(cookie, "x-admin-2fa");
    if (!stored) {
      return { ok: false, status: 401, layer: 3, challenge: true, reason: "admin 2FA required" };
    }
    const totpOk = verifyTotp(Number(stored.code), twoFaSecret, 0, 0);
    if (!totpOk) {
      return { ok: false, status: 401, layer: 3, challenge: true, reason: "invalid or expired 2FA code" };
    }
  }

  // ------------------------------------------------------------------
  // Layer 4 — IP allowlist.
  // ------------------------------------------------------------------
  const allowedIps = parseCsvList(process.env.ADMIN_ALLOWED_IPS);
  if (allowedIps.length > 0 && !isIpInList(ip, allowedIps)) {
    return { ok: false, status: 403, layer: 4, challenge: false, reason: "ip not in allowlist" };
  }

  return {
    ok: true,
    identity: { userId: sub, email, claims: payload },
    status: 401 as const,
    layer: 3 as const,
    challenge: false,
    reason: "",
  };
}

/* ------------------------------------------------------------------------ */
/* Clerk resolution (no SDK — lightweight JWT verification)                 */
/* ------------------------------------------------------------------------ */

interface ClerkSessionPayload extends Record<string, unknown> {
  sub: string;
  email: string;
  role?: string;
  public_metadata?: Record<string, unknown>;
}

async function resolveClerkIdentity(
  req: IncomingMessage,
): Promise<{ sub: string; email: string; payload: ClerkSessionPayload } | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (token.length === 0) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64] = parts;
  let header: Record<string, unknown>;
  let payload: ClerkSessionPayload;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as Record<string, unknown>;
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ClerkSessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;

  const kid = header.kid as string | undefined;
  const key = await fetchClerkPublicKey(secretKey, kid);
  if (!key) return null;

  const isValid = await verifyJwtSignature(token, key);
  if (!isValid) return null;

  return { sub: payload.sub, email: payload.email, payload };
}

async function fetchClerkPublicKey(
  secretKey: string,
  kid?: string,
): Promise<{ kty: string; n: string; e: string; alg: string } | null> {
  const url = kid
    ? `https://auth.clerk.com/jwks/v3?key=${encodeURIComponent(kid)}`
    : "https://auth.clerk.com/jwks/v3";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    keys?: Array<{ kid: string; alg: string; kty: string; n: string; e: string }>;
  };
  const key = json.keys?.[0];
  if (key) return key as { kty: string; n: string; e: string; alg: string };
  return null;
}

async function verifyJwtSignature(
  token: string,
  key: { kty: string; n: string; e: string; alg: string },
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  const signature = Buffer.from(sigB64 ?? "", "base64url");
  const data = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  if (signature.length === 0) return false;

  const verifier = createVerify("RSA-SHA256");
  verifier.update(data);
  const jwk: { key: { kty: string; n: string; e: string; alg: string }; format: "jwk" } = {
    key: { kty: key.kty, n: key.n, e: key.e, alg: key.alg },
    format: "jwk",
  };
  return verifier.verify(jwk, signature);
}

/* ------------------------------------------------------------------------ */
/* Layer 1 — Cloudflare Access JWT verification (manual RS256/JWKS)         */
/* ------------------------------------------------------------------------ */

async function verifyCfAccessJwt(token: string, audience: string, teamDomain: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }
  const kid = header.kid as string | undefined;
  const alg = (header.alg as string) || "RS256";
  const signature = Buffer.from(sigB64 ?? "", "base64url");
  const data = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  if (signature.length === 0) return false;

  const jwks = await fetchCfAccessJwks(teamDomain);
  const key = jwks.find((k) => k.kid === kid && k.kty === "RSA");
  if (!key) return false;

  const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return false;
  }
  const aud = payload.aud;
  const expectedAud = Buffer.from(JSON.stringify({ aud }), "utf8").toString("base64url");
  if (Buffer.from(aud as string, "utf8").toString("base64url") !== expectedAud) {
    return false;
  }

  if (alg === "RS256") {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(data);
    const jwk: { key: { kty: string; n: string; e: string; alg: string }; format: "jwk" } = {
      key: { kty: key.kty, n: key.n, e: key.e, alg },
      format: "jwk",
    };
    return verifier.verify(jwk, signature);
  }
  return false;
}

async function fetchCfAccessJwks(teamDomain: string): Promise<Array<{ kid: string; kty: string; n: string; e: string }>> {
  const candidates = [
    `https://${teamDomain}/cdn-cgi/access/jwt-auth`,
    `https://${teamDomain}/.cloudflare/cdn-access/jwt-auth`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as {
          result?: Array<{ kid: string; kty: string; n: string; e: string }>;
        };
        const list = json.result ?? [];
        if (list.length > 0) return list;
      }
    } catch {
      // Try next candidate.
    }
  }
  return [];
}

/* ------------------------------------------------------------------------ */
/* TOTP (HMAC-SHA1 + base32, 6 digits, 30s window)                         */
/* ------------------------------------------------------------------------ */

function base32Decode(secret: string): Uint8Array {
  const cleaned = secret.trim().toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (cleaned.length === 0) throw new Error("empty base32 secret");
  const bits: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const v = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(cleaned[i]);
    if (v === -1) continue;
    bits.push(v);
  }
  const bytes = new Uint8Array(Math.floor((bits.length * 5) / 8));
  for (let i = 0; i < bytes.length; i++) {
    const byte = (bits[i * 8] << 3) | (bits[i * 8 + 1] ?? 0) >> 3;
    bytes[i] = byte;
  }
  return bytes;
}

/** Compute a TOTP code (6 digits, 30s window). */
export function generateTotp(secret: string, window = 0): number {
  const key = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / 30) + window;
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c >>= 8;
  }
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return truncated % 1_000_000;
}

export function verifyTotp(code: number, secret: string, window = 0, leeway = 1): boolean {
  for (let i = -leeway; i <= leeway; i++) {
    if (generateTotp(secret, i) === code) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* 2FA cookie (http-only, encrypted, short-lived)                          */
/* ------------------------------------------------------------------------ */

const COOKIE_VERSION = 1;
const COOKIE_TTL_MS = 5 * 60 * 1000;

function derive2FAKeys(secret: string): { aesKey: Buffer; hmacKey: Buffer } {
  const seed = Buffer.from(`${secret}:hotclip:2fa`, "utf8");
  const aesKey = createHash("sha256").update(seed).digest();
  const hmacKey = createHash("sha256").update(Buffer.concat([seed, Buffer.from("key")])).digest();
  return { aesKey, hmacKey };
}

export function encrypt2FACode(code: string, secret: string): string {
  const { aesKey, hmacKey } = derive2FAKeys(secret);
  if (!/^\d{6}$/.test(code)) throw new Error("2FA code must be exactly 6 digits");

  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  // GCM is a stream mode: no block padding is needed. (A previous revision
  // zero-padded the plaintext but un-padded it PKCS#7-style below, so the
  // round-trip always failed and every 2FA cookie was rejected.)
  const enc = Buffer.concat([cipher.update(Buffer.from(code, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Version is a single raw byte (0x01). A previous revision wrote the ASCII
  // character "1" (0x31), which the decoder then rejected.
  const bundle = Buffer.concat([Buffer.from([COOKIE_VERSION]), iv, enc, tag]);
  const sig = createHmac("sha256", hmacKey).update(bundle).digest("base64url");

  return [bundle.toString("base64url"), sig].join(".");
}

export function decrypt2FACode(token: string, secret: string): { code: string; nonce: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const { aesKey, hmacKey } = derive2FAKeys(secret);
  let payload: Buffer;
  let sig: Buffer;
  try {
    payload = Buffer.from(payloadB64, "base64url");
    sig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }

  const expectedSig = Buffer.from(
    createHmac("sha256", hmacKey).update(payload).digest("base64url"),
    "base64url",
  );
  // `timingSafeEqual` throws on length mismatch, so the sizes are checked first.
  if (sig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(sig, expectedSig)) return null;

  const version = payload.readUInt8(0);
  // Accept 0x01 (current) and 0x31 (legacy ASCII "1" encoder).
  if (version !== COOKIE_VERSION && version !== 0x31) return null;
  const iv = payload.subarray(1, 17);
  const enc = payload.subarray(17, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);

  try {
    const decipher = createDecipheriv("aes-256-gcm", aesKey, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    // Tolerate cookies minted by the legacy zero-padded encoder too.
    let end = dec.length;
    while (end > 0 && dec[end - 1] === 0) end--;
    const code = dec.subarray(0, end).toString("utf8");
    if (!/^\d{6}$/.test(code)) return null;
    return { code, nonce: "", exp: 0 };
  } catch {
    return null;
  }
}

export function read2FACookie(cookieHeader: string, name = "x-admin-2fa"): { code: string; nonce: string; exp: number } | null {
  const parts = cookieHeader.split(";").map((p) => p.trim());
  const candidate = parts.find((p) => p.startsWith(`${name}=`));
  if (!candidate) return null;
  const raw = candidate.slice(name.length + 1);
  const secret = process.env.ADMIN_2FA_SECRET;
  if (!secret) return null;
  return decrypt2FACode(raw, secret);
}

/* ------------------------------------------------------------------------ */
/* Request helpers                                                          */
/* ------------------------------------------------------------------------ */

export function getReqIp(req: IncomingMessage): string {
  let remoteAddr = req.socket?.remoteAddress ?? "unknown";
  if (remoteAddr === "::1") remoteAddr = "127.0.0.1";
  return remoteAddr;
}

/* ------------------------------------------------------------------------ */
/* CSV / allowlist helpers                                                */
/* ------------------------------------------------------------------------ */

export function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export function isIpInList(ip: string, list: string[]): boolean {
  return list.some((entry) => {
    if (entry.includes("/")) {
      const [net, bits] = entry.split("/").map((s) => s.trim());
      const mask = Number(bits);
      if (!Number.isInteger(mask)) return false;
      try {
        const addr = ipToInt(ip);
        const netAddr = ipToInt(net);
        if (addr === null || netAddr === null) return false;
        const shift = 32 - mask;
        return (addr >> shift) === (netAddr >> shift);
      } catch {
        return false;
      }
    }
    if (isIpv4(ip) && isIpv4(entry)) return ip === entry;
    return ip === entry;
  });
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function isIpv4(ip: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

/* ------------------------------------------------------------------------ */
/* Audit logging hook                                                      */
/* ------------------------------------------------------------------------ */

export interface AuditWriter {
  writeAdminAuditLog(entry: {
    action: string;
    entity: string;
    entityId?: string;
    userId?: string;
    ip?: string;
    userAgent?: string;
    details?: unknown;
  }): Promise<void>;
}

export function withAdminAudit(
  req: IncomingMessage,
  identity: AdminSessionIdentity,
  writer: AuditWriter | null,
  action: string,
  entity: string,
  entityId?: string,
  details?: unknown,
): void {
  const ip = getReqIp(req);
  const userAgent = req.headers["user-agent"] as string | undefined;
  if (!writer) {
    console.log(
      JSON.stringify({
        level: "audit",
        at: new Date().toISOString(),
        action,
        entity,
        entityId,
        userId: identity.userId,
        ip,
        userAgent,
        details,
        source: "admin-auth",
      }),
    );
    return;
  }
  void writer
    .writeAdminAuditLog({ action, entity, entityId, userId: identity.userId, ip, userAgent, details })
    .catch(() => undefined);
}
