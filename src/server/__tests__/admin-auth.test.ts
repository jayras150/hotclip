import { afterEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  encrypt2FACode,
  enforceAdminSessionResult,
  generateTotp,
  isIpInList,
  parseCsvList,
} from "../admin-auth";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

interface MockRequestInit {
  headers?: Record<string, string>;
  remoteAddress?: string;
}

/**
 * Minimal IncomingMessage stand-in: admin-auth only touches `headers` and
 * `socket.remoteAddress`, so a plain object is enough and avoids opening a
 * real socket.
 */
function makeReq(opts: MockRequestInit = {}): IncomingMessage {
  return {
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress ?? "127.0.0.1" },
  } as unknown as IncomingMessage;
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64url");

/** Sign an RS256 JWT whose public half is served by the mocked Clerk JWKS. */
function signAdminJwt(claims: Record<string, unknown>): string {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const kid = "test-key-id";

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        keys: [{ kid, kty: "RSA", alg: "RS256", n: jwk.n, e: jwk.e }],
      }),
    })),
  );

  const header = b64url(JSON.stringify({ alg: "RS256", kid }));
  const payload = b64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(Buffer.from(`${header}.${payload}`, "utf8"));
  const signature = signer.sign(privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                       */
/* ------------------------------------------------------------------ */

describe("parseCsvList", () => {
  it("splits, trims and drops empties", () => {
    expect(parseCsvList(" a , b,,  c ")).toEqual(["a", "b", "c"]);
    expect(parseCsvList(undefined)).toEqual([]);
    expect(parseCsvList("")).toEqual([]);
  });
});

describe("isIpInList", () => {
  it("matches exact IPs", () => {
    expect(isIpInList("203.0.113.7", ["203.0.113.7"])).toBe(true);
    expect(isIpInList("203.0.113.8", ["203.0.113.7"])).toBe(false);
  });

  it("matches CIDR ranges", () => {
    expect(isIpInList("203.0.113.99", ["203.0.113.0/24"])).toBe(true);
    expect(isIpInList("203.0.114.1", ["203.0.113.0/24"])).toBe(false);
  });

  it("rejects malformed entries without throwing", () => {
    expect(isIpInList("1.2.3.4", ["not-an-ip/abc"])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* enforceAdminSessionResult — 4 layers                               */
/* ------------------------------------------------------------------ */

describe("enforceAdminSessionResult — Layer 2 (joining)", () => {
  it("returns 403 when there is no Clerk session at all", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy");
    const outcome = await enforceAdminSessionResult(makeReq({ headers: {} }));
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.layer).toBe(2);
    expect(outcome.reason).toBe("clerk session not admin");
  });

  it("returns 403 for a valid admin JWT whose email is NOT allowlisted", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("ADMIN_EMAILS", "root@example.com");
    const token = signAdminJwt({ sub: "user_x", email: "intruder@example.com", role: "admin" });
    const outcome = await enforceAdminSessionResult(
      makeReq({ headers: { authorization: `Bearer ${token}` } }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.layer).toBe(2);
    expect(outcome.reason).toBe("clerk user not in admin allowlist");
  });

  it("returns 403 when the JWT role is not 'admin'", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("ADMIN_EMAILS", "root@example.com");
    const token = signAdminJwt({ sub: "user_1", email: "root@example.com", role: "member" });
    const outcome = await enforceAdminSessionResult(
      makeReq({ headers: { authorization: `Bearer ${token}` } }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.layer).toBe(2);
  });
});

const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

/**
 * Stub env for a fully valid Layer-2 identity and return the `Authorization`
 * value for it. The JWT is self-signed and the matching JWKS is served by the
 * mocked `fetch`, so signature verification runs for real.
 */
function stubValidAdminEnv(): { authz: string } {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy");
  vi.stubEnv("ADMIN_EMAILS", "root@example.com");
  vi.stubEnv("ADMIN_ALLOWED_IPS", "");
  vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "");
  vi.stubEnv("ADMIN_CF_ACCESS_AUD", "");
  const token = signAdminJwt({ sub: "user_1", email: "root@example.com", role: "admin" });
  return { authz: `Bearer ${token}` };
}

describe("enforceAdminSessionResult — Layer 3 (2FA challenge)", () => {
  it("challenges with 401 when the 2FA cookie is missing", async () => {
    const { authz } = stubValidAdminEnv();
    vi.stubEnv("ADMIN_2FA_SECRET", TOTP_SECRET);
    const outcome = await enforceAdminSessionResult(makeReq({ headers: { authorization: authz } }));
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(401);
    expect(outcome.layer).toBe(3);
    expect(outcome.challenge).toBe(true);
    expect(outcome.reason).toBe("admin 2FA required");
  });

  it("challenges with 401 when the 2FA cookie carries an invalid code", async () => {
    const { authz } = stubValidAdminEnv();
    vi.stubEnv("ADMIN_2FA_SECRET", TOTP_SECRET);
    // A well-formed but wrong code (current counter + 1, so no window matches).
    const wrongCode = String((generateTotp(TOTP_SECRET, 0) + 1) % 1_000_000).padStart(6, "0");
    const cookie = encrypt2FACode(wrongCode, TOTP_SECRET);
    const outcome = await enforceAdminSessionResult(
      makeReq({ headers: { authorization: authz, cookie: `x-admin-2fa=${cookie}` } }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(401);
    expect(outcome.layer).toBe(3);
    expect(outcome.challenge).toBe(true);
    expect(outcome.reason).toBe("invalid or expired 2FA code");
  });

  it("accepts a valid encrypted TOTP cookie and returns the identity", async () => {
    const { authz } = stubValidAdminEnv();
    vi.stubEnv("ADMIN_2FA_SECRET", TOTP_SECRET);
    const code = String(generateTotp(TOTP_SECRET, 0)).padStart(6, "0");
    const cookie = encrypt2FACode(code, TOTP_SECRET);
    const outcome = await enforceAdminSessionResult(
      makeReq({ headers: { authorization: authz, cookie: `x-admin-2fa=${cookie}` } }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.identity?.userId).toBe("user_1");
    expect(outcome.identity?.email).toBe("root@example.com");
  });
});

describe("enforceAdminSessionResult — Layer 4 (IP allowlist)", () => {
  it("blocks IPs outside the allowlist with 403", async () => {
    const { authz } = stubValidAdminEnv();
    vi.stubEnv("ADMIN_ALLOWED_IPS", "203.0.113.0/24");
    const outcome = await enforceAdminSessionResult(
      makeReq({ headers: { authorization: authz }, remoteAddress: "198.51.100.5" }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.layer).toBe(4);
    expect(outcome.reason).toBe("ip not in allowlist");
  });

  it("allows IPs inside the allowlist", async () => {
    const { authz } = stubValidAdminEnv();
    vi.stubEnv("ADMIN_ALLOWED_IPS", "203.0.113.0/24");
    const outcome = await enforceAdminSessionResult(
      makeReq({ headers: { authorization: authz }, remoteAddress: "203.0.113.77" }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.identity?.email).toBe("root@example.com");
  });
});
