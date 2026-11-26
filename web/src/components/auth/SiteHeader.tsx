"use client";

import { useState } from "react";
import Link from "next/link";
import { Film } from "lucide-react";
import AuthNavbar from "./AuthNavbar";
import CreditChip from "./CreditChip";

/**
 * Header situs untuk halaman publik (homepage studio).
 *
 * Berisi brand, chip saldo kredit (link ke /billing saat login), dan
 * kontrol autentikasi Clerk (Sign In / Sign Up / UserButton).
 * Stiky di atas konten agar selalu terlihat saat scroll.
 */
export default function SiteHeader(): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#06080d]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-label="HookClip — beranda"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-500/15 text-cyan-300">
            <Film className="h-4 w-4" aria-hidden="true" />
          </span>
          HookClip
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <CreditChip />
          <AuthNavbar
            onMenuOpen={() => setMobileOpen((open) => !open)}
            mobileOpen={mobileOpen}
          />
        </div>
      </div>
    </header>
  );
}
