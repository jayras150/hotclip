/**
 * Wallet balance fetching helpers (client-side, Clerk-authenticated).
 *
 * Every request to `GET /api/v1/wallet/balance` must:
 * 1. wait until Clerk has resolved the session (`isLoaded && isSignedIn`),
 * 2. carry a Clerk session token: `Authorization: Bearer <token>`.
 *
 * The backend currently answers 500 (`{"ok":false,"error":"internal error"}`)
 * when the signed-in user has no wallet row yet; that is being fixed on the
 * server, so callers must treat a failed fetch as "balance unavailable"
 * instead of crashing or spamming the console.
 */

declare const process: {
  env: Record<string, string | undefined>;
};

export const WALLET_BALANCE_URL = "/api/v1/wallet/balance";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"
).replace(/\/$/, "");

/** Minimal auth surface the wallet fetcher needs (Clerk-backed). */
export interface WalletAuth {
  /** False until Clerk has resolved the session on the client. */
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  /** Resolves to the Clerk session token, or `null` when signed out. */
  getToken: () => Promise<string | null>;
}

/** Stub used when Clerk is disabled (no publishable key / no provider). */
export const SIGNED_OUT_WALLET_AUTH: WalletAuth = {
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  getToken: async () => null,
};

export type WalletBalanceOutcome =
  | { status: "ready"; balance: number; currency: string }
  | { status: "unavailable"; reason: string };

let warnedOnce = false;

/** Log at most one warning per page load — the failure is expected while the server-side wallet-row fix lands. */
function warnOnce(message: string): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(message);
}

/**
 * Fetches the wallet balance with a Clerk Bearer token. Never throws for
 * HTTP/parse failures — returns an "unavailable" outcome instead. If
 * `getToken()` resolves to `null`, no request is sent at all.
 */
export async function fetchWalletBalance(
  auth: WalletAuth,
  signal?: AbortSignal,
): Promise<WalletBalanceOutcome> {
  const token = await auth.getToken();
  if (!token) {
    // Skip the request rather than sending an unauthenticated one (the API
    // would answer 500 and the console would show a confusing error).
    return { status: "unavailable", reason: "no-token" };
  }

  try {
    const response = await fetch(`${API_BASE}${WALLET_BALANCE_URL}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      data?: { balance?: unknown; currency?: unknown };
    } | null;

    if (!response.ok || !payload || payload.ok === false || !payload.data) {
      // API returns 500 when the wallet row is missing server-side (server fix in progress).
      warnOnce(
        `[wallet] Balance unavailable (HTTP ${response.status}). ` +
          "Showing a placeholder; the server may be missing the wallet row for this user.",
      );
      return { status: "unavailable", reason: `HTTP_${response.status}` };
    }

    const rawBalance = payload.data.balance;
    const balance =
      typeof rawBalance === "number" && Number.isFinite(rawBalance)
        ? rawBalance
        : Number(rawBalance);
    if (!Number.isFinite(balance)) {
      return { status: "unavailable", reason: "invalid-balance" };
    }
    return {
      status: "ready",
      balance,
      currency:
        typeof payload.data.currency === "string" && payload.data.currency.length > 0
          ? payload.data.currency
          : "credits",
    };
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    warnOnce(
      "[wallet] Balance fetch failed (network error). Showing a placeholder.",
    );
    return { status: "unavailable", reason: "network-error" };
  }
}
