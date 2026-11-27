"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  CreditCard,
  Film,
  LogOut,
  Server,
  Wallet,
  X,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import AuthNavbar from "@/components/auth/AuthNavbar";

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Studio", icon: Film },
  { href: "/clips", label: "My Clips", icon: Clapperboard },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/admin", label: "Admin Pool", icon: Server },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

interface WalletData {
  balance: number;
  currency: string;
}

function formatBalance(balance: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(balance);
  } catch {
    return `${balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function CreditBadge() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadWallet() {
      try {
        const response = await apiClient.wallet();
        if (!cancelled) {
          setWallet(response.data);
        }
      } catch {
        // Best-effort: keep the placeholder when the wallet is unavailable.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadWallet();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = wallet ? formatBalance(wallet.balance, wallet.currency) : "—";

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface/70 px-3 py-2 text-sm"
      title={wallet ? `${wallet.balance} ${wallet.currency}` : "Credit balance"}
    >
      <span className="flex items-center gap-2 text-text-muted">
        <Wallet className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">Credits</span>
      </span>
      <span
        className={`font-semibold tabular-nums ${loading ? "animate-pulse text-text-muted" : "text-text"}`}
      >
        {value}
      </span>
    </div>
  );
}

function LogOutButton() {
  const [busy, setBusy] = useState(false);

  const handleSignOut = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await apiClient.signOut();
    } catch {
      // Sign out client-side even when the API call fails.
    } finally {
      window.location.href = "/login";
    }
  }, [busy]);

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={busy}
      aria-label="Sign out"
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span>{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}

interface SidebarContentProps {
  pathname: string;
  onNavigate?: () => void;
}

function SidebarContent({ pathname, onNavigate }: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--primary)] text-white shadow-sm">
          <Film className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">HotClip Studio</p>
          <p className="text-[11px] text-text-muted">AI clip factory</p>
        </div>
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 overflow-y-auto px-3 py-2"
      >
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Workspace
        </p>
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-[var(--primary)]/10 font-medium text-[var(--primary)]"
                      : "text-text-muted hover:bg-surface-2/60 hover:text-text"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-border p-3">
        <CreditBadge />
        <LogOutButton />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AppShell                                                            */
/* ------------------------------------------------------------------ */

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll and close on Escape while the drawer is open.
  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  // Auth screens render without chrome.
  if (pathname === "/login" || pathname === "/register") {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-[var(--sidebar)] md:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/80 px-4 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-[#04121a] shadow-[0_0_18px_var(--glow-soft)] md:hidden">
              <Film className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="hidden text-sm font-semibold tracking-tight text-[var(--text)] md:block">
              HotClip Studio
            </p>
          </div>

          {/* Kontrol auth Clerk: <UserButton /> saat signed in, tombol
              "Sign In" / "Sign Up" saat signed out, plus hamburger mobile. */}
          <AuthNavbar
            onMenuOpen={() => setMobileOpen(true)}
            mobileOpen={mobileOpen}
          />
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={closeMobile}
            className="absolute inset-0 h-full w-full bg-black/60 backdrop-blur-sm"
          />
          <div
            id="mobile-navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-border bg-[var(--sidebar)] shadow-xl"
          >
            <div className="flex items-center justify-end px-3 pt-3">
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Close navigation menu"
                className="grid h-9 w-9 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2/70 hover:text-text"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarContent pathname={pathname} onNavigate={closeMobile} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
