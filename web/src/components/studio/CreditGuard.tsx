"use client";

import { useEffect } from "react";
import { useWalletBalance, useClerkWalletAuth } from "@/lib/hooks/use-wallet-balance";
import { clerkEnabled } from "@/lib/clerk";

/**
 * Credit-balance guard for the studio render flow.
 *
 * Renders nothing; it fetches the signed-in user's wallet balance (via a
 * Clerk token) and reports it to the parent through `onState`, so `submit()`
 * can block rendering when the balance is exhausted.
 *
 * Must only be rendered when `clerkEnabled` (requires a ClerkProvider).
 */

export interface CreditState {
  signedIn: boolean;
  /** `null` = not yet known (fetch failed / still loading). */
  balance: number | null;
}

export function CreditGuard({
  onState,
}: {
  onState: (state: CreditState) => void;
}): null {
  const auth = useClerkWalletAuth();
  const { status, balance, signedIn } = useWalletBalance(auth);

  // Hooks must run unconditionally — the derived report is computed below.
  // "signed-out"/"loading" collapse to a placeholder report; "unavailable"
  // (wallet row missing server-side / network error) surfaces as
  // signed-in-with-unknown-balance so the UI keeps working non-blocking.
  const report: CreditState =
    status === "ready"
      ? { signedIn, balance: balance ?? null }
      : status === "unavailable"
        ? { signedIn: true, balance: null }
        : { signedIn: false, balance: null };

  useEffect(() => {
    onState(report);
    // `report` is derived from the hook state, so this fires on every change.
  }, [report, onState]);

  return null;
}

export const creditGuardEnabled = clerkEnabled;
