import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { NEXT_PUBLIC_CLERK_SIGN_UP_URL, clerkAppearance } from "@/lib/clerk";

export const metadata: Metadata = {
  title: "Sign In — HotClip",
  description: "Masuk ke HotClip Studio untuk mengelola klip, kredit, dan ekspor.",
};

/**
 * Halaman Sign In (Clerk).
 *
 * - Dirouting di bawah grup `(auth)`; Clerk menangani redirect otomatis ke
 *   `/sign-in` ketika sesi belum ada.
 * - Widget digaya "obsidian cyber": background #06080d, border
 *   rgba(255,255,255,0.08), teks #e6edf6, accent cyan.
 * - Judul memakai kata "Sign In" (bukan "login").
 * - `<TurnstileWidget />` adalah lapisan anti-abuse opsional; tanpa env
 *   site key ia hanya menampilkan placeholder sehingga build tetap aman.
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
            Lanjutkan ke HotClip Studio
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

        <div className="mt-5">
          <TurnstileWidget />
        </div>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Belum punya akun?{" "}
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
