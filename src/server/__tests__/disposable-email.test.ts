/**
 * Unit tests — `isDisposableEmail` / `DISPOSABLE_DOMAINS`.
 *
 * Kontrak yang dikunci:
 *   - Normalisasi lowercase + trim sebelum pencocokan domain.
 *   - Cocok persis (`mailinator.com`) maupun subdomain (`mail.mailinator.com`).
 *   - Domain normal (gmail.com, company.com, mail.company.com) lolos.
 *   - Input non-string / malformed -> `false`, tidak pernah throw.
 *   - Daftar domain minimal 40 entri unik.
 */
import { describe, expect, it } from "vitest";
import { DISPOSABLE_DOMAINS, isDisposableEmail } from "../disposable-emails";

describe("isDisposableEmail — exact domain match", () => {
  it.each([
    "mailinator.com",
    "10minutemail.com",
    "yopmail.com",
    "maildrop.cc",
    "sharklasers.com",
    "getnada.com",
    "guerrillamail.com",
    "temp-mail.org",
    "throwawaymail.com",
    "dispostable.com",
  ])("blocks user@%s", (domain) => {
    expect(isDisposableEmail(`user@${domain}`)).toBe(true);
  });

  it("blocks every domain listed in DISPOSABLE_DOMAINS", () => {
    for (const domain of DISPOSABLE_DOMAINS) {
      expect(isDisposableEmail(`someone@${domain}`)).toBe(true);
    }
  });
});

describe("isDisposableEmail — normalization", () => {
  it("detects uppercase domains", () => {
    expect(isDisposableEmail("User@MAILINATOR.COM")).toBe(true);
  });

  it("detects domains surrounded by whitespace", () => {
    expect(isDisposableEmail("   user@yopmail.com   ")).toBe(true);
  });

  it("detects mixed case plus whitespace", () => {
    expect(isDisposableEmail("\tUser@10MinuteMail.Com \n")).toBe(true);
  });

  it("ignores a trailing dot in the domain", () => {
    expect(isDisposableEmail("user@mailinator.com.")).toBe(true);
  });
});

describe("isDisposableEmail — subdomain match", () => {
  it.each([
    "user@mail.mailinator.com",
    "user@inbox.temp-mail.org",
    "user@mail.dropmail.me",
    "user@a.b.maildrop.cc",
  ])("blocks %s", (email) => {
    expect(isDisposableEmail(email)).toBe(true);
  });
});

describe("isDisposableEmail — legitimate domains", () => {
  it.each([
    "user@gmail.com",
    "user@company.com",
    "user@mail.company.com",
    "user@outlook.com",
    "user@notmailinator.com",
    "user@mailinator.com.example.com",
    "user@sub.mailinator.com.evil.com",
  ])("allows %s", (email) => {
    expect(isDisposableEmail(email)).toBe(false);
  });
});

describe("isDisposableEmail — non-string input", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 123],
    ["object", {}],
    ["array", ["user@mailinator.com"]],
    ["boolean", true],
  ])("returns false for %s", (_label, value) => {
    expect(isDisposableEmail(value)).toBe(false);
  });
});

describe("isDisposableEmail — malformed input", () => {
  it.each([
    ["no @", "mailinator.com"],
    ["empty domain", "user@"],
    ["empty local part", "@domain.com"],
    ["empty string", ""],
    ["only whitespace", "    "],
    ["only @", "@"],
    ["no dot in domain", "user@mailinator"],
  ])("returns false for %s", (_label, value) => {
    expect(isDisposableEmail(value)).toBe(false);
  });
});

describe("DISPOSABLE_DOMAINS", () => {
  it("has at least 40 entries", () => {
    expect(DISPOSABLE_DOMAINS.length).toBeGreaterThanOrEqual(40);
  });

  it("contains no duplicates", () => {
    expect(new Set(DISPOSABLE_DOMAINS).size).toBe(DISPOSABLE_DOMAINS.length);
  });

  it("contains only lowercase, dot-free-edge domains", () => {
    for (const domain of DISPOSABLE_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
      expect(domain).toBe(domain.trim());
      expect(domain).toContain(".");
      expect(domain.startsWith(".")).toBe(false);
      expect(domain.endsWith(".")).toBe(false);
      expect(domain.includes("@")).toBe(false);
    }
  });

  it("includes the canonical high-volume providers", () => {
    for (const domain of [
      "mailinator.com",
      "guerrillamail.com",
      "10minutemail.com",
      "temp-mail.org",
      "yopmail.com",
      "throwawaymail.com",
      "getnada.com",
      "dispostable.com",
      "maildrop.cc",
      "sharklasers.com",
    ]) {
      expect(DISPOSABLE_DOMAINS).toContain(domain);
    }
  });
});
