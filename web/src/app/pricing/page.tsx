import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle,
  Lock,
  ArrowRight,
  Sparkles,
  Clock,
  AlertCircle,
  Layers,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { DEFAULT_PACKAGES } from "../../../../src/server/admin-store";

/**
 * Pricing + credit packages.
 *
 * Pricing tiers are model-driven:
 *  - If the backend exposes a packages endpoint, pages consume it.
 *  - The repository currently ships with the in-app default of three tiers
 *    (Free / Starter / Pro) plus a Studio add-on; the note below is shown
 *    whenever the backend returned no packages.
 *
 * Every price is denominated in USD with a "$" prefix and en-US formatting.
 */

export const metadata: Metadata = {
  title: "Pricing — HookClip AI",
  description:
    "Simple credit packages. $0 Free, $9 Starter, $19 Pro, $49 Studio — pay per credit grant, no subscriptions.",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface PackageRow {
  id: string;
  name: string;
  slug: string;
  priceUsd: number;
  credits: number;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  isPopular: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

const PACKAGE_NOTES: Record<string, string> = {
  free: "Try HookClip with a one-time starter credit grant.",
  starter: "For creators publishing a few shorts per week.",
  pro: "For daily posting with priority GPU rendering.",
  studio: "For teams and agencies producing clips at scale.",
};

/* ------------------------------------------------------------------ */
/* Pricing context (dynamic: backend-driven when available)            */
/* ------------------------------------------------------------------ */

/**
 * `loadPackages` hits the backend package route when it exists. The repository's
 * API currently has no `/packages` or `GET /api/admin/packages` endpoint, so the
 * fallback path below always wins at the moment — the in-app default keeps the
 * pricing screen usable immediately, and the note tells the operator what to do
 * when the backend wiring is added later.
 *
 * Prices live in USD and are emitted as `en-US` currency (`$0`, `$9`, `$19`,
 * `$49`) in the markup; never `id-ID` or plain `toLocaleString()` in the UI.
 */
async function loadPackages(): Promise<PackageRow[]> {
  try {
    const response = await fetch(
      "/api/packages",
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return DEFAULT_PACKAGES();
    }

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      data?: PackageRow[] | null;
      error?: { message?: string; code?: string } | null;
    } | null;

    if (payload?.ok === false || !Array.isArray(payload?.data)) {
      return DEFAULT_PACKAGES();
    }

    const rows = payload.data.filter(
      (row): row is PackageRow =>
        row !== null && typeof row === "object" && typeof row.priceUsd === "number",
    );

    return rows.length > 0 ? rows : DEFAULT_PACKAGES();
  } catch {
    return DEFAULT_PACKAGES();
  }
}

/* ------------------------------------------------------------------ */
/* Helpers — strict en-US currency only                                */
/* ------------------------------------------------------------------ */

/** Renders an integer USD price: `$0`, `$9`, `$19`, `$49`. */
function formatPriceUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function PricingPage() {
  const packages = await loadPackages();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)]">
      {/* Decorative glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow-soft)_0%,transparent_70%)]"
      />

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-accent-soft)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Credits
          </span>
          <h1 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight tracking-tight text-[var(--text)] sm:text-4xl">
            Simple pricing,{" "}
            <span className="text-gradient-cyber">no subscriptions</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            Buy credits in one of our tiers. Everything is rendered on GPU by
            default — no hidden fees, no per-clip surprises. Prices are listed in
            USD with a `$` prefix.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 rounded-xl bg-[var(--gradient-accent)] px-5 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:scale-[0.97] motion-reduce:transition-none"
            >
              Open the studio
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              Back to home
            </Link>
          </div>
        </header>

        {/* ------------------------------------------------------------------ */}
        <section aria-labelledby="packages-heading" className="mt-12">
          <h2
            id="packages-heading"
            className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-[var(--text)]"
          >
            Credit packages
          </h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Each package unlocks a fixed credit grant. More credits = more clips,
            with priority rendering on higher tiers.
          </p>

          {packages.length === 0 ? (
            /* Dynamic fallback: backend returned nothing. */
            <div
              className={cn(
                "mt-6 rounded-2xl border border-[var(--border-accent-soft)] border-dashed bg-[var(--surface)] p-8",
                "text-sm text-[var(--text-muted)]",
              )}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                <div>
                  <p className="font-medium text-[var(--text)]">
                    No packages available from the admin console / backend
                  </p>
                  <p className="mt-1">
                    The pricing view falls back to the in-app default:
                    {" "}
                    <strong>Free / Starter / Pro + Studio</strong>, synced from the
                    admin console.
                    {" "}
                    <a
                      href="https://hookclip.pro/admin"
                      className="font-medium text-[var(--accent)] underline underline-offset-2"
                    >
                      Configure packages in the admin console
                    </a>
                    {" "}and re-open this page.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {packages.map((pkg, index) => (
                <PackageCard key={pkg.id} pkg={pkg} hoveredIndex={index} />
              ))}
            </div>
          )}

          {/* Sync note */}
          <p
            className={cn(
              "mt-4 text-xs leading-relaxed text-[var(--text-muted)]",
              "border-t border-[var(--border)] pt-4",
            )}
          >
            <span className="flex items-center gap-1.5 font-medium text-[var(--text-muted)]">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Sync note
            </span>
            Packages above are synced from the admin console / backend when the
            backend exposes a packages route. The current backend ships with the
            in-app defaults:
            {" "}
            <strong>Free ($0)</strong>,{" "}
            <strong>Starter ($9)</strong>,{" "}
            <strong>Pro ($19)</strong>, plus{" "}
            <strong>Studio ($49)</strong>. Contact sales for custom tiers.
          </p>
        </section>

        {/* Credentials table */}
        <section
          aria-labelledby="credits-heading"
          className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)] sm:p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2
                id="credits-heading"
                className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--text)]"
              >
                Credits included per tier
              </h2>
              <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                Credits are granted on purchase and stack across jobs automatically.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Choose a plan
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {[
                    "Package",
                    "Price",
                    "Credits",
                    "Rendering",
                    "Support",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr
                    key={pkg.id}
                    className={cn(
                      "border-b border-[var(--border)] transition-colors duration-150",
                      pkg.isPopular
                        ? "bg-[var(--glow-soft)]"
                        : "hover:bg-white/[0.03]",
                    )}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        {pkg.isPopular && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                            <Sparkles className="h-3 w-3" aria-hidden="true" />
                            Popular
                          </span>
                        )}
                        <span className="font-medium text-[var(--text)]">
                          {pkg.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-sm font-semibold tabular-nums text-[var(--accent)]">
                      {formatPriceUsd(pkg.priceUsd)}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-sm tabular-nums text-[var(--text)]">
                      +{pkg.credits} credits
                    </td>
                    <td className="px-4 py-3.5 text-[var(--text-muted)]">
                      {pkg.isPopular ? "Priority" : "Standard"}
                    </td>
                    <td className="px-4 py-3.5 text-[var(--text-muted)]">
                      Per job
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA */}
        <section
          aria-labelledby="cta-heading"
          className="mt-10 flex flex-col gap-4 rounded-2xl border border-[var(--border-accent-soft)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between sm:p-8"
        >
          <div>
            <h2
              id="cta-heading"
              className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text)]"
            >
              Start with Free, upgrade when you need more
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Every tier includes the full pipeline: hook-score detection, karaoke
              subtitles, face tracking and multi-aspect export.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--gradient-accent)] px-5 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:scale-[0.97] motion-reduce:transition-none"
          >
            Open the studio
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

interface PackageCardProps {
  pkg: PackageRow;
  hoveredIndex: number;
}

function PackageCard({ pkg, hoveredIndex }: PackageCardProps) {
  const isHovered = hoveredIndex === pkg.sortOrder;

  return (
    <article
      className={cn(
        "card-glow flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-hover)]",
        isHovered && "border-[var(--border-accent)]",
      )}
    >
      <div className="flex items-center gap-2">
        {pkg.isPopular && (
          <span className="flex items-center gap-1 rounded-full bg-[var(--glow-soft)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Popular
          </span>
        )}
        <span className="text-xs text-[var(--text-muted)]">
          {pkg.sortOrder === 0 && "Free"}
          {pkg.sortOrder === 1 && "Starter"}
          {pkg.sortOrder === 2 && "Pro"}
          {pkg.sortOrder === 3 && "Studio"}
        </span>
      </div>

      <h3 className="mt-4 font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
        {pkg.name} plan
      </h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{pkg.description}</p>

      <div className="mt-5 flex items-baseline gap-1">
        <span className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-[var(--text)]">
          {formatPriceUsd(pkg.priceUsd * 100)}
        </span>
        <span className="text-xs text-[var(--text-muted)]">USD</span>
      </div>

      <dl className="mt-4 space-y-1.5 text-xs text-[var(--text-muted)]">
        <div className="flex justify-between">
          <dt>Credits</dt>
          <dd className="font-medium text-[var(--text)] tabular-nums">
            +{pkg.credits}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Rendering</dt>
          <dd className="text-[var(--text-muted)]">
            {pkg.isPopular ? "Priority GPU" : "Standard GPU"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Support</dt>
          <dd className="text-[var(--text-muted)]">Per job</dd>
        </div>
      </dl>

      <div className="mt-auto pt-4">
        {pkg.isActive ? (
          <Link
            href="/dashboard"
            className={cn(
              "group flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200",
              pkg.isPopular
                ? "bg-[var(--gradient-accent)] text-[#06080d] shadow-[var(--shadow-glow)] hover:shadow-[var(--shadow-glow-hover)]"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--border-accent)] hover:text-[var(--accent)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:scale-[0.97] motion-reduce:transition-none",
            )}
          >
            {pkg.isPopular ? "Get started" : "Choose plan"}
            <ArrowRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isHovered && "translate-x-0.5",
              )}
              aria-hidden="true"
            />
          </Link>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Unavailable</p>
        )}
      </div>
    </article>
  );
}
