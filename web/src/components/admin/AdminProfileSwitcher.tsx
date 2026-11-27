"use client";

import { useAuth, UserButton } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/clerk";
import { useRouter } from "next/navigation";

/**
 * Profile switcher in the admin header.
 *
 * - When Clerk is enabled (publishable key set) the active Clerk `<UserButton />`
 *   is rendered, matching the logged-in state. This is the only part that needs
 *   the live `useAuth()` call and therefore requires a `<ClerkProvider>` above.
 * - When Clerk is NOT configured (local dev, `next build` without the key),
 *   we render a plain static `Sign In` button so prerendering and SSR never
 *   throw. Behavior is unchanged for the user: the link still goes to
 *   `/sign-in`.
 *
 * Note: this deliberately does not expose a "Sign out" button. Signout is
 * handled by Clerk itself (the built-in `<UserButton />` includes a sign-out
 * menu via Clerk's UI layer, so no extra handler is required here).
 */
export function AdminProfileSwitcher(): React.JSX.Element {
  const router = useRouter();

  // Render the static fallback BEFORE using `useAuth`, so that prerendering
  // (and any render cycle when `clerkEnabled` is false) never calls a Clerk
  // hook outside of `<ClerkProvider>`.
  if (!clerkEnabled) {
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

  // Clerk is enabled: read the live auth state and render the Clerk widget.
  const { isSignedIn } = useAuth();

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
      // When signed out, Clerk's widget already renders a "Sign in" entry
      // that redirects to the sign-in URL. We keep the component as the
      // authoritative UI so no custom fallback is required here.
    />
  );
}
