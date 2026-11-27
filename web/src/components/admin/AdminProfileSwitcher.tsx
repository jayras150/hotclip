"use client";

import { useAuth, UserButton } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/clerk";
import { useRouter } from "next/navigation";

/**
 * Profile switcher in the admin header.
 *
 * - When Clerk is enabled (publishable key set) the active Clerk `<UserButton />`
 *   is rendered, matching the logged-in state.
 * - When Clerk is NOT configured (local dev, `next build` without the key),
 *   a plain static `Sign In` button is rendered so prerendering and SSR never
 *   throw.
 *
 * `clerkEnabled` is inlined at build time, so the branch is fixed for the
 * lifetime of the bundle: hooks are never called conditionally at runtime.
 * The Clerk-dependent part lives in `ClerkProfileButton`, which is only
 * MOUNTED when Clerk is enabled — keeping rules-of-hooks intact.
 */
export function AdminProfileSwitcher(): React.JSX.Element {
  return clerkEnabled ? <ClerkProfileButton /> : <StaticSignInButton />;
}

function StaticSignInButton(): React.JSX.Element {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        void router.push("/sign-in");
      }}
      className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-xs font-semibold text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      Sign In
    </button>
  );
}

/**
 * Clerk-backed header widget. Only mounted inside the root `<ClerkProvider>`.
 * `useAuth()` is called so the header re-renders when the session changes;
 * Clerk's own `<UserButton />` renders the sign-out menu.
 */
function ClerkProfileButton(): React.JSX.Element {
  useAuth();

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
        elements: {
          avatarBox: "h-8 w-8",
        },
      }}
    />
  );
}
