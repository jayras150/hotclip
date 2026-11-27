"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard, Film, Menu, Plus, Wallet, X, CreditCard } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { clerkEnabled, clerkAppearance } from "@/lib/clerk";
import type { Wallet as WalletData } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const NAV_LINKS = [
  { href: "/", label: "Studio" },
  { href: "/clips", label: "My Clips" },
  { href: "/billing", label: "Billing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

function BrandMark({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <Link
      href="/"
      aria-label="HookClip.pro — home"
      className="group inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-white transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg border border-[#00f0ff]/25 bg-gradient-to-br from-[#00f0ff]/20 to-[#3b82f6]/15 text-[#00f0ff] shadow-[0_0_14px_var(--glow-soft)] transition-shadow duration-300 group-hover:shadow-[0_0_20px_var(--glow)]">
        <Film className="h-4 w-4" aria-hidden="true" />
      </span>
      <span>
        HookClip
        <span className="bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] bg-clip-text text-transparent">
          .pro
        </span>
      </span>
      {!compact ? null : null}
    </Link>
  );
}

const BTN_BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

const SIGN_IN_CLASS = `${BTN_BASE} px-3.5 py-2 text-[var(--text)] hover:text-white sm:px-4`;
const SIGN_UP_CLASS = `${BTN_BASE} bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] px-3.5 py-2 text-[#04121a] shadow-[0_0_16px_var(--glow-soft)] hover:shadow-[0_0_26px_var(--glow)] hover:brightness-110 active:brightness-95 sm:px-4`;

/** SSR-safe buttons (no Clerk dependency — avoids hydration mismatch). */
function StaticAuthButtons(): React.JSX.Element {
  return (
    <>
      <Link href="/sign-in" className={SIGN_IN_CLASS}>
        Sign In
      </Link>
      <Link href="/sign-up" className={SIGN_UP_CLASS}>
        Get Started
      </Link>
    </>
  );
}

function MenuButton({ onMenuOpen, menuOpen }: { onMenuOpen: () => void; menuOpen: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onMenuOpen}
      aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
      aria-expanded={menuOpen}
      aria-controls="mobile-navigation"
      className="grid h-9 w-9 place-items-center rounded-xl text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:hidden"
    >
      {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}

/** Real-time credits pill — links to /billing (or /sign-in when signed out). */
function CreditPill({ wallet }: { wallet: WalletState }): React.JSX.Element {
  const href = wallet.signedIn ? "/billing" : "/sign-in";
  const value = wallet.balance !== null
    ? `${wallet.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${wallet.currency}`
    : "—";
  return (
    <Link
      href={href}
      title="Credit balance — top up & history"
      aria-label={`Credit balance: ${value} — open billing`}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)]/70 px-3 py-1.5 text-xs shadow-[0_0_12px_var(--glow-soft)] backdrop-blur transition duration-200 hover:border-[var(--accent)]/70 hover:shadow-[0_0_20px_var(--glow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${wallet.balance === null ? "animate-pulse motion-reduce:animate-none" : ""}`}
    >
      <Wallet
        className={`h-3.5 w-3.5 transition-colors duration-200 ${wallet.balance !== null ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
        aria-hidden="true"
      />
      <span className="hidden font-medium uppercase tracking-wide text-[var(--text-muted)] sm:inline">
        Credits
      </span>
      <span
        className={`font-semibold tabular-nums ${wallet.balance !== null ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
      >
        {value}
      </span>
    </Link>
  );
}

interface WalletState {
  signedIn: boolean;
  balance: number | null;
  currency: string;
}

/** Clerk-powered header actions — rendered only when ClerkProvider is active. */
function HeaderActionsClerk({ onMenuOpen, menuOpen }: { onMenuOpen: () => void; menuOpen: boolean }): React.JSX.Element {
  // Guard: this component is only rendered when clerkEnabled is true, so
  // useAuth() here is guaranteed to sit under a ClerkProvider.
  const { isSignedIn, getToken } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [wallet, setWallet] = useState<WalletState>({ signedIn: false, balance: null, currency: "credits" });
  const [userButton, setUserButton] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !isSignedIn) return;
    let cancelled = false;
    setUserButton(true);
    void load();
    return () => { cancelled = true; };

    async function load() {
      try {
        const token = await getToken();
        const response = await fetch(`${API_BASE}/api/v1/wallet/balance`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { ok?: boolean; data?: { balance?: number; currency?: string } };
        if (!cancelled && payload?.data) {
          setWallet({
            signedIn: true,
            balance: typeof payload.data.balance === "number" ? payload.data.balance : null,
            currency: payload.data.currency ?? "credits",
          });
        }
      } catch {
        // Best-effort — the pill keeps its placeholder.
      }
    }
  }, [mounted, isSignedIn, getToken]);

  if (!mounted) {
    return (
      <div className="flex items-center gap-2">
        <StaticAuthButtons />
        <MenuButton onMenuOpen={onMenuOpen} menuOpen={menuOpen} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isSignedIn ? (
        <>
          <CreditPill wallet={wallet} />
          <Link
            href="/billing"
            className={`${BTN_BASE} hidden border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20 hover:shadow-[0_0_16px_var(--glow-soft)] md:inline-flex`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Top Up
          </Link>
          {userButton ? <ClerkUserButtonSlot /> : null}
        </>
      ) : (
        <>
          <Link href="/sign-in" className={`${SIGN_IN_CLASS} hidden sm:inline-flex`}>
            Sign In
          </Link>
          <Link href="/sign-up" className={SIGN_UP_CLASS}>
            Get Started
          </Link>
        </>
      )}
      <MenuButton onMenuOpen={onMenuOpen} menuOpen={menuOpen} />
    </div>
  );
}

/** Late-mounted Clerk <UserButton /> (client-only, theme-matched). */
function ClerkUserButtonSlot(): React.JSX.Element {
  const { UserButton } = require("@clerk/nextjs") as typeof import("@clerk/nextjs");
  return (
    <UserButton
      appearance={{
        variables: {
          colorPrimary: "#00f0ff",
          colorPrimaryForeground: "#06080d",
          colorNeutral: "#0c1018",
          colorForeground: "#e6edf6",
          colorBorder: "rgba(255,255,255,0.08)",
          colorBackground: "#06080d",
          borderRadius: "10px",
        },
      }}
    />
  );
}

/** Slide-in mobile drawer with nav links + auth actions. */
function MobileDrawer({ open, onClose, wallet, isSignedIn }: { open: boolean; onClose: () => void; wallet: WalletState; isSignedIn: boolean }): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <button
        type="button"
        aria-label="Close navigation menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-pointer bg-black/60 backdrop-blur-sm anim-fade-in"
      />
      <div
        id="mobile-navigation"
        className="absolute inset-y-0 right-0 flex w-72 max-w-[85%] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl anim-slide-in-right"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <BrandMark compact />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="grid h-9 w-9 place-items-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto p-3">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Menu
          </p>
          <ul className="space-y-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={onClose}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] transition hover:bg-white/[0.04] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <Clapperboard className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-2 border-t border-[var(--border)] p-3">
          {isSignedIn ? (
            <>
              <div className="px-1 pb-1">
                <CreditPill wallet={wallet} />
              </div>
              <Link href="/billing" onClick={onClose} className={`${BTN_BASE} w-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2.5 text-[var(--accent)] hover:bg-[var(--accent)]/20`}>
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Top Up Credits
              </Link>
            </>
          ) : (
            <>
              <Link href="/sign-in" onClick={onClose} className={`${BTN_BASE} w-full border border-[var(--border-strong)] px-4 py-2.5 text-[var(--text)] hover:bg-[var(--surface-2)]`}>
                Sign In
              </Link>
              <Link href="/sign-up" onClick={onClose} className={`${BTN_BASE} w-full bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] px-4 py-2.5 text-[#04121a] shadow-[0_0_16px_var(--glow-soft)] hover:brightness-110`}>
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Site header: brand, real-time Credits pill, Top Up button and Clerk
 * `<UserButton />` when signed in; Sign In / Get Started when signed out.
 * Includes a working mobile drawer for 320px–430px screens.
 */
export default function SiteHeader(): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  // Guard: only call a Clerk hook when ClerkProvider is actually mounted.
  // When NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is empty, the layout renders the
  // children without a provider, and calling useAuth() there breaks
  // `npm run build` (SSR + prerender). Fall back to a safe placeholder.
  const { isSignedIn } = clerkEnabled ? useAuth() : { isSignedIn: false };
  const [mounted, setMounted] = useState(false);
  const [wallet] = useState<WalletState>({ signedIn: false, balance: null, currency: "credits" });

  useEffect(() => setMounted(true), []);
  // Close the drawer whenever the route changes.
  useEffect(() => setMobileOpen(false), [pathname]);

  const signedIn = mounted && clerkEnabled && Boolean(isSignedIn);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#06080d]/75 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
          <BrandMark />

          {/* Desktop nav links */}
          <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.slice(0, 3).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className={`inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  pathname === link.href
                    ? "bg-white/[0.06] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-white/[0.04] hover:text-[var(--text)]"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {clerkEnabled ? (
              <HeaderActionsClerk
                onMenuOpen={() => setMobileOpen((open) => !open)}
                menuOpen={mobileOpen}
              />
            ) : (
              <div className="flex items-center gap-2">
                <StaticAuthButtons />
                <MenuButton onMenuOpen={() => setMobileOpen((open) => !open)} menuOpen={mobileOpen} />
              </div>
            )}
          </div>
        </div>
      </header>

      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} wallet={wallet} isSignedIn={signedIn} />
    </>
  );
}
