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

  // Hooks must run unconditionally — the derived values are computed below.
  // "signed-out"/"loading" collapse to a placeholder report; "unavailable"
  // (wallet row missing server-side / network error) surfaces as
  // signed-in-with-unknown-balance so the UI keeps working non-blocking.
  //
  // The report is reported as two PRIMITIVES, never as a fresh object: a new
  // object identity in the dependency array re-runs the effect on every
  // render, which calls the parent's `setCredit`, which re-renders the parent,
  // which re-runs the effect — an infinite render loop that made every input
  // on the homepage re-render thousands of times a second and left the App
  // Router unable to commit navigation. Primitives make the effect fire only
  // when the values actually change.
  const reportSignedIn =
    status === "ready" ? signedIn : status === "unavailable";
  const reportBalance =
    status === "ready" ? (balance ?? null) : null;

  // `onState` is `setCredit` from the parent, which React guarantees to be
  // stable across renders, so this effect cannot be re-triggered by it.
  useEffect(() => {
    onState({ signedIn: reportSignedIn, balance: reportBalance });
  }, [reportSignedIn, reportBalance, onState]);

  return null;
}

export const creditGuardEnabled = clerkEnabled;
