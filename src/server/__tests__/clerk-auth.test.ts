/**
 * Unit tests — src/server/clerk-auth.ts
 *
 * `verifyToken` dari `@clerk/backend` di-mock penuh, jadi test ini murni
 * unit: parsing header, gate env, pemetaan claims, dan error handling.
 */
import { type IncomingMessage } from "node:http";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/backend", () => ({ verifyToken: vi.fn() }));

import { verifyToken } from "@clerk/backend";
import { verifyClerkSession } from "../clerk-auth";

const mockedVerifyToken = vi.mocked(verifyToken);

function reqWithHeaders(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("verifyClerkSession", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CLERK_SECRET_KEY;
    mockedVerifyToken.mockReset();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns null when Authorization header is missing", async () => {
    const req = reqWithHeaders({});
    await expect(verifyClerkSession(req)).resolves.toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when Authorization is not a Bearer token", async () => {
    const req = reqWithHeaders({ authorization: "Basic dXNlcjpwYXNz" });
    await expect(verifyClerkSession(req)).resolves.toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when Bearer token is empty", async () => {
    const req = reqWithHeaders({ authorization: "Bearer " });
    await expect(verifyClerkSession(req)).resolves.toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when CLERK_SECRET_KEY is not set (verifyToken not called)", async () => {
    const req = reqWithHeaders({ authorization: "Bearer some-token" });
    await expect(verifyClerkSession(req)).resolves.toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns session from claims on a valid token", async () => {
    process.env.CLERK_SECRET_KEY = "sk_test_valid_session_key";
    mockedVerifyToken.mockResolvedValue({
      sub: "user_abc123",
      email: "abc@example.com",
    } as never);

    const req = reqWithHeaders({ authorization: "Bearer valid.jwt.token" });
    await expect(verifyClerkSession(req)).resolves.toEqual({
      userId: "user_abc123",
      email: "abc@example.com",
    });
  });

  it("returns null when verifyToken throws", async () => {
    process.env.CLERK_SECRET_KEY = "sk_test_throwing_key";
    mockedVerifyToken.mockRejectedValue(new Error("invalid signature"));

    const req = reqWithHeaders({ authorization: "Bearer bad.token.here" });
    await expect(verifyClerkSession(req)).resolves.toBeNull();
  });

  it("returns null when claims.sub is missing", async () => {
    process.env.CLERK_SECRET_KEY = "sk_test_no_sub_key";
    mockedVerifyToken.mockResolvedValue({ email: "x@example.com" } as never);

    const req = reqWithHeaders({ authorization: "Bearer no.sub.token" });
    await expect(verifyClerkSession(req)).resolves.toBeNull();
  });

  it("returns empty-string email when claims.email is missing (source behavior)", async () => {
    // Catatan: implementasi sumber tidak menolak claims tanpa email;
    // ia mengembalikan email "" — test ini mendokumentasikan perilaku aktual.
    process.env.CLERK_SECRET_KEY = "sk_test_no_email_key";
    mockedVerifyToken.mockResolvedValue({ sub: "user_no_email" } as never);

    const req = reqWithHeaders({ authorization: "Bearer no.email.token" });
    await expect(verifyClerkSession(req)).resolves.toEqual({
      userId: "user_no_email",
      email: "",
    });
  });

  it("calls verifyToken with the token and { secretKey } from env", async () => {
    const secretKey = "sk_test_secret_check_key";
    process.env.CLERK_SECRET_KEY = secretKey;
    mockedVerifyToken.mockResolvedValue({ sub: "user_check", email: "c@example.com" } as never);

    const req = reqWithHeaders({ authorization: "Bearer my.jwt.value" });
    await verifyClerkSession(req);

    expect(mockedVerifyToken).toHaveBeenCalledTimes(1);
    expect(mockedVerifyToken).toHaveBeenCalledWith("my.jwt.value", { secretKey });
  });
});
