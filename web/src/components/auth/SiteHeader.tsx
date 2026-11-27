"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, Menu, Wallet, X } from "lucide-react";
import { useAuth, UserButton } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/clerk";
import { useWalletBalance, useClerkWalletAuth } from "@/lib/hooks/use-wallet-balance";

/* ------------------------------------------------------------------ */
/* Links & button tokens                                               */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/billing", label: "Pricing" },
] as const;

const DASHBOARD_LINK = { href: "/clips", label: "Dashboard" } as const;

const GHOST_BTN =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]";

const SOLID_BTN =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] px-4 text-sm font-semibold text-[#04121a] shadow-[0_0_16px_rgba(0,240,255,0.25)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]";

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Brand(): React.JSX.Element {
  return (
    <Link
      href="/"
      aria-label="HookClip.pro — home"
      className="flex items-center gap-2.5 rounded-lg font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#00f0ff]/25 bg-gradient-to-br from-[#00f0ff]/20 to-[#3b82f6]/15 text-[#00f0ff]">
        <Film className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="leading-none">
        HookClip
        <span className="bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] bg-clip-text text-transparent">
          .pro
        </span>
      </span>
    </Link>
  );
}

function CreditBadge({ balance }: { balance: number | null }): React.JSX.Element {
  const value =
    balance === null
      ? "—"
      : balance.toLocaleString("en-US", { maximumFractionDigits: 2 });

  return (
    <Link
      href="/billing"
      title="Credit balance — top up & history"
      aria-label={`Credit balance: ${value} — open billing`}
      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs transition-colors hover:border-[#00f0ff]/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]"
    >
      <Wallet
        className={`h-3.5 w-3.5 ${balance === null ? "text-zinc-500" : "text-[#00f0ff]"}`}
        aria-hidden="true"
      />
      <span className="font-semibold tabular-nums text-zinc-100">{value}</span>
      <span className="hidden text-[11px] font-medium uppercase tracking-wide text-zinc-500 sm:inline">
        credits
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function HeaderShell({
  signedIn,
  balance,
}: {
  signedIn: boolean;
  balance: number | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on route change so it can never linger over the page.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#09090b]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: brand */}
        <Brand />

        {/* Center: nav */}
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-6 text-sm font-medium text-zinc-300 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-1 py-1.5 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]"
            >
              {link.label}
            </Link>
          ))}
          {signedIn ? (
            <Link
              href={DASHBOARD_LINK.href}
              className="rounded-md px-1 py-1.5 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]"
            >
              {DASHBOARD_LINK.label}
            </Link>
          ) : null}
        </nav>

        {/* Right: auth actions */}
        <div className="flex items-center gap-2">
          {signedIn ? (
            <>
              <span className="hidden sm:inline-flex">
                <CreditBadge balance={balance} />
              </span>
              <Link href={DASHBOARD_LINK.href} className={`${GHOST_BTN} hidden md:inline-flex`}>
                Dashboard
              </Link>
              {/* Clerk widget — only rendered inside <ClerkProvider>. */}
              <UserButton />
            </>
          ) : (
            <>
              {/*
               * Auth CTAs use a plain <a> on purpose: Next.js <Link> calls
               * e.preventDefault() and then relies on an App Router transition
               * to commit, which is currently not committing on this build
               * (the URL never changes). A hard navigation always works.
               */}
              <a href="/sign-in" className={`${GHOST_BTN} hidden sm:inline-flex`}>
                Sign In
              </a>
              <a href="/sign-up" className={SOLID_BTN}>
                Get Started
              </a>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] md:hidden"
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer — never rendered while closed. */}
      {open ? (
        <div id="mobile-navigation" className="border-t border-white/10 bg-[#09090b]/95 md:hidden">
          <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-4 py-3">
            {[...NAV_LINKS, ...(signedIn ? [DASHBOARD_LINK] : [])].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]"
              >
                {link.label}
              </Link>
            ))}

            {signedIn ? (
              <div className="mt-1 px-1">
                <CreditBadge balance={balance} />
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <Link href="/sign-in" onClick={() => setOpen(false)} className={`${GHOST_BTN} w-full justify-center`}>
                  Sign In
                </Link>
                <Link href="/sign-up" onClick={() => setOpen(false)} className={`${SOLID_BTN} w-full justify-center`}>
                  Get Started
                </Link>
              </div>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Clerk / static entry point                                          */
/* ------------------------------------------------------------------ */

/**
 * `clerkEnabled` is inlined at build time, so exactly one branch ships in a
 * given bundle: Clerk hooks and `<UserButton />` are never evaluated outside
 * a mounted `<ClerkProvider>`, and hooks are never called conditionally.
 */
export default function SiteHeader(): React.JSX.Element {
  return clerkEnabled ? <ClerkHeader /> : <HeaderShell signedIn={false} balance={null} />;
}

function ClerkHeader(): React.JSX.Element {
  // `useAuth()` runs here so the header re-renders on sign-in/sign-out.
  useAuth();
  const auth = useClerkWalletAuth();
  const { status, balance, signedIn } = useWalletBalance(auth);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <HeaderShell
      signedIn={mounted && signedIn}
      balance={status === "ready" ? balance : null}
    />
  );
}
