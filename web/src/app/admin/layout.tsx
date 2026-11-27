'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClerkProvider } from '@clerk/nextjs';
import {
  clerkEnabled,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  NEXT_PUBLIC_CLERK_SIGN_UP_URL,
} from '@/lib/clerk';
import { LayoutDashboard, ShieldAlert, ScrollText, Users } from 'lucide-react';
import { AdminProfileSwitcher } from '@/components/admin/AdminProfileSwitcher';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/audit', label: 'Audit Logs', icon: ScrollText },
] as const;

/**
 * Admin console shell — dark-only obsidian cyber chrome around every
 * `/admin/*` route: fixed sidebar nav, sticky header with the Clerk
 * `<UserButton />` (SignIn/SignOut renamed by Clerk's default theme) and a
 * `UserButton` access point.
 *
 * ClerkProvider wraps the admin shell only when a publishable key is set,
 * so prerendering (`npm run build`) and localhost do not throw even when
 * Clerk is not configured. Behavior of every page is unchanged.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return clerkEnabled ? (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL!}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL!}
    >
      <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <a
          href="#admin-main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface-2)] focus:px-3 focus:py-2"
        >
          Skip to content
        </a>

        <aside
          aria-label="Admin navigation"
          className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-5">
            <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-white/[0.03] text-[var(--accent)]">
              <ShieldAlert size={18} aria-hidden="true" />
            </span>
            <div>
              <div className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wide">
                HookClip Admin
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">Console operations</div>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                    active
                      ? 'bg-white/[0.06] font-semibold text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:bg-white/[0.04] hover:text-[var(--text)]',
                  )}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[var(--border)] p-3 text-[11px] text-[var(--text-muted)]">
            Restricted area · all actions audited
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-end gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
            <AdminProfileSwitcher />
          </header>

          <main id="admin-main" className="min-w-0 flex-1 p-6">
            {children}
          </main>
        </div>
      </div>
    </ClerkProvider>
  ) : (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface-2)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside
        aria-label="Admin navigation"
        className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-white/[0.03] text-[var(--accent)]">
            <ShieldAlert size={18} aria-hidden="true" />
          </span>
          <div>
            <div className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wide">
              HookClip Admin
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">Console operations</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                  active
                    ? 'bg-white/[0.06] font-semibold text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:bg-white/[0.04] hover:text-[var(--text)]',
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--border)] p-3 text-[11px] text-[var(--text-muted)]">
          Restricted area · all actions audited
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
          <AdminProfileSwitcher />
        </header>

        <main id="admin-main" className="min-w-0 flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
