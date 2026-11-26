/**
 * Unit tests — `verifyTurnstile` (Cloudflare Turnstile siteverify).
 *
 * Kontrak yang dikunci:
 *   - Secret kosong (argumen + env) -> `not configured` TANPA network call.
 *   - Fallback ke `process.env.TURNSTILE_SECRET_KEY`.
 *   - POST form-urlencoded berisi `secret`, `response`, `remoteip` opsional.
 *   - `success === true` -> `{ success: true }`; selain itu error-code apa adanya.
 *   - JSON invalid -> `invalid-json`; abort -> `timeout`; else -> `network-error`.
 *   - Tidak pernah throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_SITE_VERIFY_URL,
  TURNSTILE_TIMEOUT_MS,
  verifyTurnstile,
} from "../turnstile";

const ORIGINAL_ENV = process.env.TURNSTILE_SECRET_KEY;

function jsonResponse(payload: unknown): { text: () => Promise<string> } {
  return { text: () => Promise.resolve(JSON.stringify(payload)) };
}

function rawResponse(body: string): { text: () => Promise<string> } {
  return { text: () => Promise.resolve(body) };
}

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

type FetchCall = [url: string, init: RequestInit];

function firstFetchCall(mock: ReturnType<typeof vi.fn>): FetchCall {
  const calls = mock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0] as unknown as FetchCall;
}

function bodyParams(init: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init.body));
}

describe("verifyTurnstile", () => {
  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (ORIGINAL_ENV === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY;
    } else {
      process.env.TURNSTILE_SECRET_KEY = ORIGINAL_ENV;
    }
  });

  it("returns 'not configured' without calling fetch when secret and env are empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok");

    expect(result).toEqual({ success: false, error: "not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats whitespace-only secret as not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "   ");

    expect(result).toEqual({ success: false, error: "not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to process.env.TURNSTILE_SECRET_KEY", async () => {
    process.env.TURNSTILE_SECRET_KEY = "  env-secret  ";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok");

    expect(result).toEqual({ success: true });
    const [, init] = firstFetchCall(fetchMock);
    const params = bodyParams(init);
    expect(params.get("secret")).toBe("env-secret");
    expect(params.get("response")).toBe("tok");
  });

  it("returns success when Cloudflare reports success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({ success: true });
  });

  it("surfaces joined error-codes when verification fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-input-response");
  });

  it("joins multiple error-codes with a comma", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: false, "error-codes": ["missing-input-secret", "timeout-or-duplicate"] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({
      success: false,
      error: "missing-input-secret,timeout-or-duplicate",
    });
  });

  it("falls back to 'turnstile-failed' when error-codes is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: false }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({ success: false, error: "turnstile-failed" });
  });

  it("returns 'invalid-json' when the response body is not JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rawResponse("<html>oops</html>"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({ success: false, error: "invalid-json" });
  });

  it("returns 'timeout' when fetch rejects with AbortError", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.reject(abortError()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({ success: false, error: "timeout" });
  });

  it("returns 'timeout' when fetch rejects because the signal was aborted", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({ success: false, error: "timeout" });
  });

  it("returns 'network-error' for non-abort rejections", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({ success: false, error: "network-error" });
  });

  it("returns 'network-error' when response.text() throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: () => Promise.reject(new Error("stream broken")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile("tok", "secret-key");

    expect(result).toEqual({ success: false, error: "network-error" });
  });

  it("posts to the Cloudflare siteverify endpoint with form-urlencoded body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("token-value", "secret-value");

    const [url, init] = firstFetchCall(fetchMock);
    expect(url).toBe(TURNSTILE_SITE_VERIFY_URL);
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");

    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");

    expect(String(init.body)).toContain("secret=");
    expect(String(init.body)).toContain("response=");

    const params = bodyParams(init);
    expect(params.get("secret")).toBe("secret-value");
    expect(params.get("response")).toBe("token-value");
    expect(params.has("remoteip")).toBe(false);
  });

  it("sends remoteip when the third argument is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("token-value", "secret-value", "203.0.113.7");

    const [, init] = firstFetchCall(fetchMock);
    const params = bodyParams(init);
    expect(params.get("remoteip")).toBe("203.0.113.7");
    expect(String(init.body)).toContain("remoteip=");
  });

  it("omits remoteip for an empty string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("token-value", "secret-value", "");

    const [, init] = firstFetchCall(fetchMock);
    expect(bodyParams(init).has("remoteip")).toBe(false);
  });

  it("prefers the explicit secret argument over the env variable", async () => {
    process.env.TURNSTILE_SECRET_KEY = "env-secret";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("tok", "explicit-secret");

    const [, init] = firstFetchCall(fetchMock);
    expect(bodyParams(init).get("secret")).toBe("explicit-secret");
  });

  it("uses a 5s abort timeout signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("tok", "secret-key");

    expect(TURNSTILE_TIMEOUT_MS).toBe(5000);
    const [, init] = firstFetchCall(fetchMock);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.signal as AbortSignal).aborted).toBe(false);
  });

  it("aborts the request once the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      let captured: AbortSignal | undefined;
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        captured = init.signal as AbortSignal;
        return new Promise<never>((_resolve, reject) => {
          captured?.addEventListener("abort", () => reject(abortError()));
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const pending = verifyTurnstile("tok", "secret-key");
      await vi.advanceTimersByTimeAsync(TURNSTILE_TIMEOUT_MS);

      const result = await pending;

      expect(captured?.aborted).toBe(true);
      expect(result).toEqual({ success: false, error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws, even when fetch throws synchronously", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTurnstile("tok", "secret-key")).resolves.toEqual({
      success: false,
      error: "network-error",
    });
  });
});
