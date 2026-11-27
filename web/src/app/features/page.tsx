import type { Metadata } from "next";
import Link from "next/link";
import { type FC } from "react";
import {
  RectangleHorizontal,
  Captions,
  ArrowRight,
  Gauge,
  ScanFace,
  Sparkles,
} from "lucide-react";
import SiteHeader from "@/components/auth/SiteHeader";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Features — HookClip AI",
  description:
    "HookClip AI turns long videos into viral-ready shorts: hook-score clip detection, karaoke ASS subtitles, face tracking and multi-aspect-ratio export.",
};

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

interface Feature {
  Icon: FC<{ className?: string }>;
  title: string;
  description: string;
  bullets: string[];
}

const FEATURES: Feature[] = [
  {
    Icon: Gauge,
    title: "Auto viral clip detection",
    description:
      "A hook-score model reads the transcript and audio energy to pick the moments most likely to stop the scroll — no manual scrubbing.",
    bullets: ["Hook-score (0–100) per segment", "Ranked, non-overlapping picks"],
  },
  {
    Icon: Captions,
    title: "Dynamic subtitles",
    description:
      "Word-timed ASS karaoke subtitles are burned straight into the render, so every clip ships platform-ready.",
    bullets: ["Word-by-word highlight", "Stylable, hard-coded burn-in"],
  },
  {
    Icon: ScanFace,
    title: "Face / speaker tracking",
    description:
      "The crop follows the active speaker and keeps faces centered in the vertical frame, even when people move.",
    bullets: ["Active-speaker crop", "Multi-face safe zones"],
  },
  {
    Icon: RectangleHorizontal,
    title: "Multi-aspect-ratio export",
    description:
      "Every job renders in the aspect ratio your channel needs — vertical for Shorts, square for feeds, landscape for embeds.",
    bullets: ["9:16 vertical", "1:1 square", "16:9 landscape"],
  },
];

const RATIOS = [
  { label: "9:16", hint: "Shorts · Reels · TikTok" },
  { label: "1:1", hint: "Feed posts" },
  { label: "16:9", hint: "YouTube · embeds" },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function FeaturesPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)]">
      {/* Decorative cyan glow — token driven, purely presentational. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,var(--glow-soft)_0%,transparent_70%)]"
      />

      <SiteHeader />

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 lg:px-8">
        {/* ------------------------------ Hero ------------------------------ */}
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-accent-soft)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            HookClip AI
          </span>
          <h1 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
            One pipeline, from raw upload to
            <span className="text-gradient-cyber"> ready-to-post clips</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            HookClip AI finds the strongest moments in a long video, reframes them
            around the speaker, burns in karaoke subtitles and exports every
            aspect ratio your channels need.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/pricing"
              className="group inline-flex items-center gap-2 rounded-xl bg-[var(--gradient-accent)] px-5 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:scale-[0.97] motion-reduce:transition-none"
            >
              See pricing
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              Try the studio
            </Link>
          </div>
        </header>

        {/* --------------------------- Feature grid -------------------------- */}
        <section aria-labelledby="features-heading" className="mt-14">
          <h2 id="features-heading" className="sr-only">
            Feature overview
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ Icon, title, description, bullets }) => (
              <article
                key={title}
                className={cn(
                  "card-glow flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)] sm:p-6",
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-accent-soft)] bg-[var(--glow-soft)] text-[var(--accent)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text)]">
                  {title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
                  {description}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-2 text-xs text-[var(--text-muted)]"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]"
                      />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* --------------------------- Aspect ratios ------------------------- */}
        <section
          aria-labelledby="ratios-heading"
          className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)] sm:p-6"
        >
          <h2
            id="ratios-heading"
            className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--text)]"
          >
            Export presets
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Pick the frame per job — every preset is rendered on GPU with the same
            quality pipeline.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {RATIOS.map(({ label, hint }) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3"
              >
                <p className="font-[family-name:var(--font-mono)] text-sm font-semibold text-[var(--accent)]">
                  {label}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------- CTA ------------------------------ */}
        <section
          aria-labelledby="cta-heading"
          className="mt-10 flex flex-col gap-4 rounded-2xl border border-[var(--border-accent-soft)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between sm:p-8"
        >
          <div>
            <h2
              id="cta-heading"
              className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text)]"
            >
              Ready to turn one video into a week of shorts?
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Plans start free — credits are metered per render.
            </p>
          </div>
          <Link
            href="/pricing"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--gradient-accent)] px-5 py-2.5 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:scale-[0.97] motion-reduce:transition-none"
          >
            View pricing
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      </main>
    </div>
  );
}
