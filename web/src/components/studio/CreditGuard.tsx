"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/clerk";

/**
 * Guard saldo kredit untuk alur render studio.
 *
 * Komponen ini tidak merender apa pun; ia mengambil saldo wallet user
 * yang login (via Clerk token) dan melaporkannya ke parent lewat
 * `onState`, agar `submit()` bisa memblokir render saat saldo habis.
 *
 * Hanya boleh dirender saat `clerkEnabled` (butuh ClerkProvider).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface CreditState {
  signedIn: boolean;
  /** `null` = belum diketahui (fetch gagal / masih memuat). */
  balance: number | null;
}

export function CreditGuard({
  onState,
}: {
  onState: (state: CreditState) => void;
}): null {
  const { isSignedIn, getToken } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (!isSignedIn) {
      onState({ signedIn: false, balance: null });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const token = await getToken();
        const response = await fetch(`${API_BASE}/api/v1/wallet/balance`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: { balance?: number };
        };
        if (!cancelled) {
          onState({
            signedIn: true,
            balance: typeof payload?.data?.balance === "number" ? payload.data.balance : null,
          });
        }
      } catch {
        if (!cancelled) onState({ signedIn: true, balance: null });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mounted, isSignedIn, getToken, onState]);

  return null;
}

export const creditGuardEnabled = clerkEnabled;
