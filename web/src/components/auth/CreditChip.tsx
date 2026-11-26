"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Wallet } from "lucide-react";
import { clerkEnabled } from "@/lib/clerk";
import type { Wallet as WalletData } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * Indikator saldo kredit di header.
 *
 * - SSR / render pertama: render placeholder "Credits —" (identik dengan
 *   render klien pertama, jadi tidak ada hydration mismatch).
 * - Setelah mount + signed in: fetch `/api/v1/wallet/balance` lalu tampilkan
 *   saldo + link ke /billing (top-up & riwayat).
 * - Signed out: tetap tampil "—" dan mengarahkan ke /sign-in.
 */

function formatBalance(balance: number, currency: string): string {
  try {
    return `${balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  } catch {
    return `${balance} ${currency}`;
  }
}

function CreditChipInner(): React.JSX.Element {
  const { isSignedIn, getToken } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !isSignedIn) return;
    let cancelled = false;

    async function load() {
      try {
        // Sertakan Clerk token agar backend memakai identitas Clerk, bukan
        // sesi legacy (lihat currentUserId() di api-v1).
        const token = await getToken();
        const response = await fetch(`${API_BASE}/api/v1/wallet/balance`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { ok?: boolean; data?: WalletData };
        if (payload?.data && !cancelled) setWallet(payload.data);
      } catch {
        // Best-effort: biarkan placeholder bila wallet belum tersedia.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mounted, isSignedIn, getToken]);

  const signedIn = mounted && Boolean(isSignedIn);
  const value = wallet ? formatBalance(wallet.balance, wallet.currency) : "—";
  const href = signedIn ? "/billing" : "/sign-in";
  const label = signedIn
    ? "Saldo kredit — klik untuk top up / riwayat"
    : "Masuk untuk melihat saldo kredit";

  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <Wallet className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
      <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">
        Credits
      </span>
      <span
        className={`font-semibold tabular-nums ${wallet ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
      >
        {value}
      </span>
    </Link>
  );
}

/** Tanpa ClerkProvider (publishable key kosong) hook Clerk tidak bisa dipakai. */
export default function CreditChip(): React.JSX.Element {
  if (!clerkEnabled) {
    return (
      <Link
        href="/sign-in"
        title="Masuk untuk melihat saldo kredit"
        aria-label="Masuk untuk melihat saldo kredit"
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Wallet className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Credits
        </span>
        <span className="font-semibold tabular-nums text-[var(--text-muted)]">—</span>
      </Link>
    );
  }
  return <CreditChipInner />;
}
