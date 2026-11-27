import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { NEXT_PUBLIC_CLERK_SIGN_IN_URL, clerkAppearance } from "@/lib/clerk";

export const metadata: Metadata = {
  title: "Sign Up — HotClip",
  description: "Create a HotClip Studio account: name, email and password.",
};

/**
 * Sign Up page (Clerk).
 *
 * - Form: name, email, password (managed by the Clerk instance config).
 * - Dark "obsidian cyber" theme; OAuth buttons styled via
 *   `elements.socialButtonsBlockButton` for readable text on dark surfaces.
 * - No external Turnstile widget: Clerk's built-in bot protection applies.
 */
export default function SignUpPage() {
  return (
    <main
      className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12"
      aria-labelledby="sign-up-title"
    >
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1
            id="sign-up-title"
            className="text-2xl font-semibold tracking-tight text-[var(--text)]"
          >
            Sign Up
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Create a HotClip Studio account
          </p>
        </header>

        <div className="w-full flex justify-center">
          <SignUp
            appearance={clerkAppearance}
            routing="path"
            path="/sign-up"
            signInUrl={NEXT_PUBLIC_CLERK_SIGN_IN_URL}
            fallbackRedirectUrl="/"
          />
        </div>
      </div>
    </main>
  );
}
