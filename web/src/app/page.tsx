"use client";

import { useCallback } from "react";
import { Clapperboard, ShieldCheck, Zap } from "lucide-react";
import CyberCanvasBackground from "@/components/motion/CyberCanvasBackground";
import FloatingDock from "@/components/motion/FloatingDock";
import SiteHeader from "@/components/auth/SiteHeader";
import Hero from "@/components/studio/Hero";
import StudioShell from "@/components/studio/StudioShell";

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    Icon: Zap,
    title: "Instant Vast.ai GPU",
    description:
      "Automatic provisioning on Vast.ai GPU cloud—render starts in seconds.",
  },
  {
    Icon: Clapperboard,
    title: "Auto-cut hook scoring",
    description:
      "Hook-score model picks the best moments precisely, not manual guesswork.",
  },
  {
    Icon: ShieldCheck,
    title: "No account needed",
    description:
      "Paste a URL, set options—no API key, no login required.",
  },
] as const;

/* ------------------------------------------------------------------ */

export default function StudioPage() {
  const scrollToStudio = useCallback(() => {
    window.requestAnimationFrame(() => {
      document
        .getElementById("studio")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#06080D] text-slate-100">
      {/* Animated canvas backdrop — fixed behind everything */}
      <CyberCanvasBackground />

      <FloatingDock />

      <SiteHeader />

      <main className="relative z-10">
        <Hero onStart={scrollToStudio} />

        {/* ------------------------------ Studio ------------------------------ */}
        {/* `klip` anchor sits on the gallery wrapper; the clip grid renders
            inside StudioShell, so both dock links land on the clip results. */}
        <div id="klip" aria-hidden="true" className="scroll-mt-24" />
        <section
          id="studio"
          aria-label="Studio render"
          className="mx-auto mt-16 max-w-3xl scroll-mt-24 px-4 pb-4 sm:px-6 lg:px-8"
        >
          <StudioShell />
        </section>

        {/* ------------------------------ Features ---------------------------- */}
        <section
          aria-label="Keunggulan"
          className="mx-auto mt-16 max-w-6xl px-4 pb-20 sm:px-6 lg:px-8"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map(({ Icon, title, description }) => (
              <article
                key={title}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-5 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-[var(--accent)]/40 hover:shadow-[0_0_28px_var(--glow-soft)]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#00f0ff]/20 bg-gradient-to-br from-[#00f0ff]/15 to-[#3b82f6]/10 text-[#00f0ff]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      {/* ------------------------------ Footer ------------------------------ */}
      <footer className="relative z-10 border-t border-white/[0.06] bg-[#04060a]/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>
            <span className="font-semibold text-[var(--text)]">HookClip</span>
            <span className="bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] bg-clip-text text-transparent">
              .pro
            </span>{" "}
            — AI highlight detection dan short-form export.
          </span>
          <span>Render dijalankan di GPU Vast.ai.</span>
        </div>
      </footer>
    </div>
  );
}
