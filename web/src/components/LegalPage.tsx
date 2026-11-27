import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalPageProps {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

/**
 * Shared layout for the four legal pages (Privacy, Terms, Refund, DMCA).
 * Dark obsidian styling consistent with the HookClip design tokens.
 */
export default function LegalPage({
  title,
  updated,
  intro,
  sections,
}: LegalPageProps): React.JSX.Element {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] transition hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to Studio
      </Link>

      <h1 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">
        Last updated: {updated}
      </p>
      <p className="mt-6 leading-relaxed text-[var(--text-muted)]">{intro}</p>

      <div className="mt-10 space-y-10">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-white">
              {section.heading}
            </h2>
            <div className="mt-3 space-y-3">
              {section.paragraphs.map((paragraph, index) => (
                <p
                  key={index}
                  className="text-sm leading-relaxed text-[var(--text-muted)]"
                >
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--text-muted)]">
                  {section.bullets.map((bullet, index) => (
                    <li key={index}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-14 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-muted)]">
        Questions about this policy? Contact{" "}
        <a
          href="mailto:support@hookclip.pro"
          className="font-semibold text-[var(--accent)] hover:underline"
        >
          support@hookclip.pro
        </a>
        . See also our{" "}
        <Link href="/privacy" className="text-[var(--accent)] hover:underline">
          Privacy Policy
        </Link>
        {", "}
        <Link href="/terms" className="text-[var(--accent)] hover:underline">
          Terms of Service
        </Link>
        {", "}
        <Link href="/refund" className="text-[var(--accent)] hover:underline">
          Refund Policy
        </Link>
        {" and "}
        <Link href="/dmca" className="text-[var(--accent)] hover:underline">
          DMCA Policy
        </Link>
        .
      </footer>
    </main>
  );
}

export type { ReactNode };
