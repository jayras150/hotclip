"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { UserButton, SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/clerk";

/**
 * Kontrol autentikasi untuk header aplikasi (gaya "obsidian cyber").
 *
 * - Signed in  -> <UserButton /> (avatar + menu profil Clerk).
 * - Signed out -> <SignInButton /> dan <SignUpButton />.
 * - Sebelum hydration / tanpa publishable key: tautan statis
 *   `/sign-in` + `/sign-up` — sehingga teks "Sign In" / "Sign Up"
 *   tetap ada di HTML hasil SSR (dan tidak ada hydration mismatch,
 *   karena render klien pertama identik).
 *
 * @param onMenuOpen   Dipanggil saat tombol hamburger diklik (mobile);
 *                     AppShell/SiteHeader memakainya untuk drawer navigasi.
 * @param mobileOpen   State drawer terbuka (ikon berubah jadi X).
 */

const AUTH_APPEARANCE = {
  variables: {
    colorPrimary: "#00f0ff",
    colorPrimaryForeground: "#06080d",
    colorNeutral: "#0c1018",
    colorForeground: "#e6edf6",
    colorBorder: "rgba(255,255,255,0.08)",
    colorBackground: "#06080d",
    colorInput: "#0c1018",
    colorInputForeground: "#e6edf6",
    colorRing: "rgba(0,240,255,0.35)",
    borderRadius: "10px",
  },
} as const;

const SIGN_BUTTON_BASE =
  "inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

const SIGN_IN_CLASS = `${SIGN_BUTTON_BASE} bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] text-[#04121a] shadow-[0_0_16px_var(--glow-soft)] hover:shadow-[0_0_26px_var(--glow)] hover:brightness-110 active:brightness-95`;

const SIGN_UP_CLASS = `${SIGN_BUTTON_BASE} border border-[var(--border-strong)] bg-[var(--surface-2)]/80 text-[var(--text)] backdrop-blur hover:border-[var(--accent)]/60 hover:text-white hover:shadow-[0_0_14px_var(--glow-soft)]`;

/** Tombol statis (SSR-safe, tanpa ketergantungan Clerk). */
function StaticAuthButtons(): React.JSX.Element {
  return (
    <>
      <Link
        href="/sign-in"
        className={SIGN_IN_CLASS}
      >
        Sign In
      </Link>
      <Link
        href="/sign-up"
        className={SIGN_UP_CLASS}
      >
        Sign Up
      </Link>
    </>
  );
}

function MobileMenuButton({
  onMenuOpen,
  mobileOpen,
}: {
  onMenuOpen: () => void;
  mobileOpen: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onMenuOpen}
      aria-label={mobileOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
      aria-expanded={mobileOpen}
      aria-controls="mobile-navigation"
      className="grid h-9 w-9 place-items-center rounded-xl text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:hidden"
    >
      {mobileOpen ? (
        <X className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Menu className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}

/** Varian Clerk — hanya dirender saat clerkEnabled (ClerkProvider aktif). */
function AuthNavbarClerk({
  onMenuOpen,
  mobileOpen,
}: {
  onMenuOpen?: () => void;
  mobileOpen: boolean;
}): React.JSX.Element {
  const [mounted, setMounted] = useState(false);
  const { isSignedIn } = useAuth();

  // Hindari hydration mismatch: render klien PERTAMA harus identik dengan
  // SSR (tombol statis), status Clerk baru dipakai setelah mount.
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center gap-2">
        <StaticAuthButtons />
        {onMenuOpen ? (
          <MobileMenuButton onMenuOpen={onMenuOpen} mobileOpen={mobileOpen} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isSignedIn ? (
        <>
          <span
            className="hidden items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] sm:inline-flex"
            aria-hidden="true"
          >
            Akun saya
          </span>
          <UserButton appearance={AUTH_APPEARANCE} />
        </>
      ) : (
        <>
          <SignInButton mode="modal" appearance={AUTH_APPEARANCE}>
            <button
              type="button"
              className={SIGN_IN_CLASS}
            >
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal" appearance={AUTH_APPEARANCE}>
            <button
              type="button"
              className={SIGN_UP_CLASS}
            >
              Sign Up
            </button>
          </SignUpButton>
        </>
      )}

      {onMenuOpen ? (
        <MobileMenuButton onMenuOpen={onMenuOpen} mobileOpen={mobileOpen} />
      ) : null}
    </div>
  );
}

export default function AuthNavbar({
  onMenuOpen,
  mobileOpen = false,
}: {
  onMenuOpen?: () => void;
  mobileOpen?: boolean;
}): React.JSX.Element {
  // Tanpa publishable key (dev lokal), hook Clerk akan throw di luar
  // ClerkProvider — render tautan statis saja.
  if (!clerkEnabled) {
    return (
      <div className="flex items-center gap-2">
        <StaticAuthButtons />
        {onMenuOpen ? (
          <MobileMenuButton onMenuOpen={onMenuOpen} mobileOpen={mobileOpen} />
        ) : null}
      </div>
    );
  }
  return <AuthNavbarClerk onMenuOpen={onMenuOpen} mobileOpen={mobileOpen} />;
}
