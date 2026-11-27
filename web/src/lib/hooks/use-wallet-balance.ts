"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  SIGNED_OUT_WALLET_AUTH,
  type WalletAuth,
  fetchWalletBalance,
} from "@/lib/wallet-balance";

/** Stable, Clerk-driven authentication surface for the wallet fetcher. */
export function useClerkWalletAuth(): WalletAuth {
  const auth = useAuth();
  // Clerk 7 returns `isLoaded`/`isSignedIn`/`userId` as `boolean | undefined`
  // during SSR; contract them to the narrow types the rest of the app uses.
  return {
    isLoaded: Boolean(auth.isLoaded),
    isSignedIn: Boolean(auth.isSignedIn),
    userId: auth.userId ?? null,
    getToken: auth.getToken,
  };
}

export interface WalletBalanceState {
  /** "signed-out" | "loading" | "ready" | "unavailable" */
  status: "signed-out" | "loading" | "ready" | "unavailable";
  balance: number | null;
  currency: string;
  /** True only once Clerk resolved the session and the user is signed in. */
  signedIn: boolean;
  /** Reload the balance after, e.g., a successful top-up. */
  refresh: () => void;
}

function loadingState(): WalletBalanceState {
  return {
    status: "signed-out",
    balance: null,
    currency: "credits",
    signedIn: false,
    refresh: () => {},
  };
}

/**
 * Client hook: the balance request is skipped until Clerk resolves the
 * session (`isLoaded && isSignedIn`) and is re-run when the session becomes
 * available (effect depends on `isLoaded`, `isSignedIn`, `userId`).
 * Fails gracefully: never throws for a non-2xx / `{ok:false}` reply, and the
 * console gets at most one warning across the whole load.
 */
export function useWalletBalance(auth: WalletAuth): WalletBalanceState {
  const [state, setState] = useState<WalletBalanceState>(loadingState);

  const refresh = useCallback(() => {
    // Placeholder: some components (e.g. StudioShell) drive their own reload.
  }, []);

  useEffect(() => {
    // Client guard: never fire before Clerk has resolved the session, and
    // never fire during prerender when Clerk is not yet available.
    if (!auth.isLoaded || !auth.isSignedIn) {
      setState({ status: "signed-out", balance: null, currency: "credits", signedIn: false, refresh });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await fetchWalletBalance(auth);
        if (cancelled) return;
        setState(
          result.status === "ready"
            ? {
                status: "ready",
                balance: result.balance,
                currency: result.currency,
                signedIn: true,
                refresh,
              }
            : {
                status: "unavailable",
                balance: null,
                currency: "credits",
                signedIn: true,
                refresh,
              },
        );
      } catch (error) {
        if (cancelled) return;
        // Network failure before the server fully supports the wallet row:
        // keep the placeholder (balance null) instead of propagating an
        // unhandled rejection.
        setState({
          status: "unavailable",
          balance: null,
          currency: "credits",
          signedIn: true,
          refresh,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.isLoaded, auth.isSignedIn, auth.userId, refresh]);

  return {
    status: state.status,
    balance: state.balance,
    currency: state.currency,
    signedIn: state.signedIn,
    refresh,
  };
}
