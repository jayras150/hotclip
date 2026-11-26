/**
 * Server-side Cloudflare Turnstile verification.
 *
 * Rules:
 *   - POST `https://challenges.cloudflare.com/turnstile/v0/siteverify`
 *     dengan body `application/x-www-form-urlencoded`: `secret`, `response`,
 *     dan `remoteip` (opsional).
 *   - Parse JSON `{ success }`. Hanya `success === true` yang lolos.
 *   - Timeout keras 5 detik via `AbortController`.
 *   - Tidak pernah throw: selalu return `{ success, error? }`.
 *   - Secret kosong (argumen maupun env) -> `{ success: false, error: 'not configured' }`.
 *
 * Verifikasi: `npx tsc --noEmit -p tsconfig.node.json`
 */

export interface TurnstileVerification {
  success: boolean;
  error?: string;
}

export interface TurnstileRequestPayload {
  secret: string;
  response: string;
  remoteip?: string;
}

export const TURNSTILE_SITE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_TIMEOUT_MS = 5_000;

/**
 * Verifikasi token Turnstile ke Cloudflare.
 *
 * `secret` boleh dikosongkan; saat itu dipakai `process.env.TURNSTILE_SECRET_KEY`.
 * Bila keduanya kosong, hasilnya `not configured` (fail-closed, tanpa network call).
 */
export async function verifyTurnstile(
  token: string,
  secret?: string,
  remoteip?: string,
): Promise<TurnstileVerification> {
  const effectiveSecret = (secret ?? "").trim() || (process.env.TURNSTILE_SECRET_KEY ?? "").trim();
  if (effectiveSecret.length === 0) {
    return { success: false, error: "not configured" };
  }

  const payload: TurnstileRequestPayload = {
    secret: effectiveSecret,
    response: token ?? "",
  };
  if (remoteip) payload.remoteip = remoteip;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

  try {
    const response = await fetch(TURNSTILE_SITE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeForm(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { success: false, error: "invalid-json" };
    }

    if (parsed.success === true) return { success: true };

    const codes = Array.isArray(parsed["error-codes"])
      ? (parsed["error-codes"] as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    return {
      success: false,
      error: codes.length > 0 ? codes.join(",") : "turnstile-failed",
    };
  } catch (error) {
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (name === "AbortError" || controller.signal.aborted) {
      return { success: false, error: "timeout" };
    }
    return { success: false, error: "network-error" };
  } finally {
    clearTimeout(timer);
  }
}

function encodeForm(payload: TurnstileRequestPayload): string {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}
