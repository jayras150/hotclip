"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useWalletBalance, useClerkWalletAuth } from "@/lib/hooks/use-wallet-balance";
import { clerkEnabled } from "@/lib/clerk";
import type { Wallet as WalletData } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * Credit balance indicator in the header.
 *
 * - SSR / render pertama: placeholder "Credits —" (identik dengan render klien
 *   pertama, sehingga tidak ada hydration mismatch).
 * - While Clerk has not finished loading its session (`isLoaded`/`isSignedIn` false):
 *   tidak ada request yang dikirim.
 * - Setelah Clerk selesai dan user signed in: ambil token Clerk dan fetch
 *   `/api/v1/wallet/balance` dengan `Authorization: Bearer <token>`, lalu tampilkan
 *   balance + link to /billing (top-up & history).
 * - Signed out: tetap tampil "—" dan mengarahkan ke /sign-in.
 * - On failure / no wallet record on the server: show "—" (subdued) and
 *   satu peringatan di console, tanpa crash.
 */

function formatBalance(balance: number, currency: string): string {
  try {
    return `${balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  } catch {
    return `${balance} ${currency}`;
  }
}

function CreditChipInner(): React.JSX.Element {
  const auth = useClerkWalletAuth();
  const { status, balance, currency, signedIn } = useWalletBalance(auth);
  const displayBalance = balance ?? null;

  const value = displayBalance !== null ? formatBalance(displayBalance, currency) : "—";
  const href = signedIn ? "/billing" : "/sign-in";
  const label = signedIn
    ? "Credit balance — click to top up / view history"
    : "Sign in to view your credit balance";

  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)]/70 px-3.5 py-2 text-xs shadow-[0_0_12px_var(--glow-soft)] backdrop-blur transition duration-200 hover:border-[var(--accent)]/70 hover:shadow-[0_0_20px_var(--glow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${displayBalance ? "" : "animate-pulse"}`}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12 6v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">
        Credits
      </span>
      <span
        className={`font-semibold tabular-nums ${displayBalance ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
      >
        {value}
      </span>
    </Link>
  );
}

/** Without ClerkProvider (empty publishable key) Clerk hooks cannot be used. */
export default function CreditChip(): React.JSX.Element {
  if (!clerkEnabled) {
    return (
      <Link
        href="/sign-in"
        title="Sign in to view your credit balance"
        aria-label="Sign in to view your credit balance"
        className="inline-flex cursor-pointer items-center gap-2 animate-pulse rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)]/70 px-3.5 py-2 text-xs backdrop-blur transition duration-200 hover:border-[var(--accent)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 6v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Credits
        </span>
        <span className="font-semibold tabular-nums text-[var(--text-muted)]">—</span>
      </Link>
    );
  }
  return <CreditChipInner />;
}
