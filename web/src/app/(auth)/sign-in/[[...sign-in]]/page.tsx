import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { NEXT_PUBLIC_CLERK_SIGN_UP_URL, clerkAppearance } from "@/lib/clerk";

export const metadata: Metadata = {
  title: "Sign In — HotClip",
  description: "Sign in to manage your clips, credits and exports.",
};

/**
 * Sign In page (Clerk).
 *
 * - Routed under the `(auth)` group; Clerk redirects to `/sign-in`
 *   automatically when there is no session.
 * - Rendered in the dark "obsidian cyber" Clerk theme (background #14161D,
 *   input #0B0D14, text #F8FAFC, cyan accent); OAuth buttons are styled via
 *   `elements.socialButtonsBlockButton` so Google/GitHub stay readable.
 * - No external Turnstile widget: Clerk's built-in bot protection applies.
 */
export default function SignInPage() {
  return (
    <main
      className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12"
      aria-labelledby="sign-in-title"
    >
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1
            id="sign-in-title"
            className="text-2xl font-semibold tracking-tight text-[var(--text)]"
          >
            Sign In
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Continue to HotClip Studio
          </p>
        </header>

        <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#06080d] p-1 shadow-[0_0_40px_var(--glow-soft)]">
          <SignIn
            appearance={clerkAppearance}
            routing="path"
            path="/sign-in"
            signUpUrl={NEXT_PUBLIC_CLERK_SIGN_UP_URL}
            fallbackRedirectUrl="/"
          />
        </div>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Don't have an account?{" "}
          <Link
            href={NEXT_PUBLIC_CLERK_SIGN_UP_URL}
            className="font-medium text-[var(--accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Sign Up
          </Link>
        </p>
      </div>
    </main>
  );
}
