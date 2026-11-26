import { describe, expect, it } from "vitest";
import { validateAdminEnv } from "../env-validation";

const GOOD_2FA = "a".repeat(32);

describe("validateAdminEnv", () => {
  it("passes for a fully configured environment", () => {
    const res = validateAdminEnv({
      CLERK_SECRET_KEY: "sk_test_x",
      CLERK_WEBHOOK_SECRET: "whsec_x",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      ADMIN_2FA_SECRET: GOOD_2FA,
      ADMIN_ALLOWED_IPS: "10.0.0.1,192.168.1.23",
    });
    expect(res).toEqual({ ok: true, missing: [], warnings: [] });
  });

  it("passes with everything unset (webhooks disabled)", () => {
    expect(validateAdminEnv({})).toEqual({ ok: true, missing: [], warnings: [] });
  });

  it("requires CLERK_SECRET_KEY when webhook is enabled", () => {
    const res = validateAdminEnv({ CLERK_WEBHOOK_SECRET: "whsec_x" });
    expect(res.ok).toBe(false);
    expect(res.missing).toContain("CLERK_SECRET_KEY");
  });

  it("does not require CLERK_SECRET_KEY without a webhook secret", () => {
    expect(validateAdminEnv({ CLERK_SECRET_KEY: "sk_test_x" }).ok).toBe(true);
  });

  it("requires TURNSTILE_SECRET_KEY when the site key is set", () => {
    const res = validateAdminEnv({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" });
    expect(res.ok).toBe(false);
    expect(res.missing).toContain("TURNSTILE_SECRET_KEY");
  });

  it("warns when ADMIN_2FA_SECRET is shorter than 32 chars", () => {
    const res = validateAdminEnv({ ADMIN_2FA_SECRET: "short" });
    expect(res.ok).toBe(false);
    expect(res.warnings[0]).toMatch(/ADMIN_2FA_SECRET/);
  });

  it("warns on invalid ADMIN_ALLOWED_IPS entries", () => {
    const res = validateAdminEnv({ ADMIN_ALLOWED_IPS: "10.0.0.1,not-an-ip" });
    expect(res.ok).toBe(false);
    expect(res.warnings[0]).toMatch(/not-an-ip/);
  });

  it("warns on out-of-range IPv4 octets", () => {
    const res = validateAdminEnv({ ADMIN_ALLOWED_IPS: "10.0.0.999" });
    expect(res.warnings[0]).toMatch(/10\.0\.0\.999/);
  });

  it("accepts IPv6 in ADMIN_ALLOWED_IPS", () => {
    const res = validateAdminEnv({ ADMIN_ALLOWED_IPS: "::1" });
    expect(res.warnings).toEqual([]);
  });
});
