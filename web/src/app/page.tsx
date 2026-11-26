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
    title: "GPU Vast.ai instan",
    description:
      "Provisioning otomatis di GPU cloud Vast.ai — pipeline mulai render dalam hitungan detik.",
  },
  {
    Icon: Clapperboard,
    title: "Auto-cut hook scoring",
    description:
      "Model hook-score memilih momen terbaik secara presisi, bukan tebakan manual.",
  },
  {
    Icon: ShieldCheck,
    title: "Tanpa akun",
    description:
      "Cukup tempel URL dan atur opsi — tidak ada API key, tidak ada login.",
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
                className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur transition-transform duration-300 hover:-translate-y-1"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      {/* ------------------------------ Footer ------------------------------ */}
      <footer className="relative z-10 border-t border-white/5 bg-[#04060a]/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>HookClip — AI highlight detection dan short-form export.</span>
          <span>Render dijalankan di GPU Vast.ai.</span>
        </div>
      </footer>
    </div>
  );
}
