import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowRight,
  Clock,
  Film,
  FileUp,
  Loader2,
  Plus,
  XCircle,
  Play,
  Wallet,
  ChevronRight,
} from "lucide-react";
import SiteHeader from "@/components/auth/SiteHeader";
import { useWalletBalance, useClerkWalletAuth } from "@/lib/hooks/use-wallet-balance";
import { cn } from "@/lib/cn";
import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Studio — HookClip AI",
  description:
    "HookClip AI studio: paste a link or upload a video, track the render pipeline, and grab your viral clips.",
};

/**
 * Protected route entry point (server component).
 *
 * Clerk's `auth()` returns a `SessionAuthWithRedirect` object. Unlike the older
 * `auth()` shapes it does not expose `isSignedIn` — it returns the `Auth`
 * object directly, which carries `userId`. We therefore gate on `userId`.
 */
export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)]">
      {/* Decorative cyan glow — token driven, purely presentational. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow-soft)_0%,transparent_70%)]"
      />

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <DashboardClient />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fallback (defense in depth)                                         */
/* ------------------------------------------------------------------ */

function DashboardUnauthenticated() {
  return (
    <div className="py-24 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]">
        <Wallet className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-5 font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--text)]">
        You need to sign in to use the studio
      </h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Create an account or sign in to paste a link, render clips and track your
        pipeline.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--gradient-accent)] px-5 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:scale-[0.97] motion-reduce:transition-none"
        >
          Sign in
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href="/sign-up"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          Create a free account
        </Link>
      </div>
    </div>
  );
}
