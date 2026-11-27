"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, Scissors, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

/* ------------------------------------------------------------------ */
/* Showcase slides (folded into the hero demo stage)                   */
/* ------------------------------------------------------------------ */

interface Slide {
  eyebrow: string;
  title: string;
  description: string;
  /** Poster gradient used as a stand-in for source footage. */
  gradient: string;
  score: number;
  duration: string;
}

const SLIDES: Slide[] = [
  {
    eyebrow: "Podcast",
    title: "The first 3-second hook",
    description: "The hook-score model picks the moments with the highest retention.",
    gradient: "linear-gradient(135deg, #312e81, #0ea5e9)",
    score: 94,
    duration: "0:38",
  },
  {
    eyebrow: "Streaming VOD",
    title: "The most viral reaction",
    description: "Face-tracking keeps the expression centered in the 9:16 frame.",
    gradient: "linear-gradient(135deg, #7c2d12, #f43f5e)",
    score: 88,
    duration: "0:52",
  },
  {
    eyebrow: "Webinar",
    title: "Automatic karaoke subtitles",
    description: "ASS burn-in with word-by-word highlights, ready to post.",
    gradient: "linear-gradient(135deg, #064e3b, #10b981)",
    score: 91,
    duration: "0:45",
  },
];

const SLIDE_AUTOPLAY_MS = 5000;

/* ------------------------------------------------------------------ */
/* Motion variants                                                     */
/* ------------------------------------------------------------------ */

const EASE = [0.22, 1, 0.36, 1] as const;

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

/* Demo stage: 16:9 source tilts away, AI reticle sweeps, 9:16 crop blooms. */
const stageSource = {
  idle: {
    rotateY: 0,
    x: 0,
    scale: 1,
    opacity: 1,
    transition: { duration: 0.6, ease: EASE },
  },
  active: {
    rotateY: 38,
    x: "-16%",
    scale: 0.92,
    opacity: 0.7,
    transition: { duration: 0.7, ease: EASE },
  },
};

const stageCrop = {
  idle: { opacity: 0, scale: 0.55, y: 24 },
  active: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE, delay: 0.25 },
  },
};

const stageReticle = {
  idle: { opacity: 0, x: "-30%" },
  active: {
    opacity: [0, 1, 1, 0],
    x: "10%",
    transition: { duration: 1.1, ease: "linear" as const, delay: 0.1 },
  },
};

const KARAOKE_WORDS = ["Find", "viral", "hooks", "in", "seconds", "flat."];

const karaokeContainer = {
  idle: {},
  active: {
    transition: { staggerChildren: 0.16, delayChildren: 0.55 },
  },
};

const karaokeWord = {
  idle: { color: "rgba(226, 232, 240, 0.55)", scale: 1 },
  active: {
    color: "#00F0FF",
    scale: 1.08,
    transition: { duration: 0.22, ease: EASE },
  },
};

const DEMO_LOOP_MS = 6000;

/* ------------------------------------------------------------------ */
/* Interactive 16:9 -> 9:16 demo stage                                 */
/* ------------------------------------------------------------------ */

function DemoStage() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [autoActive, setAutoActive] = useState(false);

  // Auto-loop: pulse the demo every ~6s while not hovered.
  useEffect(() => {
    if (prefersReducedMotion) return;
    const id = window.setInterval(() => {
      setAutoActive((v) => !v);
    }, DEMO_LOOP_MS);
    return () => window.clearInterval(id);
  }, [prefersReducedMotion]);

  const active = prefersReducedMotion ? true : hovered || autoActive;

  return (
    <div
      className="relative flex h-[280px] w-full max-w-md items-center justify-center sm:h-[340px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={() => setHovered((v) => !v)}
      role="img"
      aria-label="Interactive demo: a 16:9 frame is scanned by AI face-tracking, then cropped into a vertical 9:16 clip with karaoke subtitles"
    >
      {/* Source frame (16:9) */}
      <motion.div
        variants={stageSource}
        initial="idle"
        animate={active ? "active" : "idle"}
        className="absolute w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
        style={{ aspectRatio: "16 / 9" }}
      >
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #1e293b 0%, #334155 55%, #0f172a 100%)" }} />
        <span className="absolute left-3 top-3 rounded-md bg-black/50 px-2 py-0.5 text-[10px] font-medium text-slate-300">
          Source 16:9
        </span>
        {/* Face-track reticle sweeping across the source frame */}
        <motion.div
          variants={stageReticle}
          initial="idle"
          animate={active ? "active" : "idle"}
          className="absolute top-1/2 h-14 w-14 -translate-y-1/2 rounded-md border-2 border-[#00F0FF] shadow-[0_0_18px_rgba(0,240,255,0.45)]"
        >
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#00F0FF]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#00F0FF]">
            face-track
          </span>
          <span aria-hidden className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#00F0FF]/80" />
        </motion.div>
      </motion.div>

      {/* Result clip (9:16) with karaoke subtitles */}
      <motion.div
        variants={stageCrop}
        initial="idle"
        animate={active ? "active" : "idle"}
        className="pointer-events-none absolute overflow-hidden rounded-2xl border-2 border-[#00F0FF]/60 shadow-[0_0_32px_rgba(0,240,255,0.35)]"
        style={{
          width: "44%",
          aspectRatio: "9 / 16",
          background: "linear-gradient(160deg, rgba(59,130,246,0.85) 0%, rgba(0,240,255,0.6) 55%, rgba(16,185,129,0.7) 100%)",
        }}
      >
        <span className="absolute left-3 top-3 rounded-md bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white">
          Clip 9:16
        </span>
        <motion.div
          variants={karaokeContainer}
          initial="idle"
          animate={active ? "active" : "idle"}
          className="absolute inset-x-3 bottom-6 flex flex-wrap justify-center gap-x-1 gap-y-0.5 text-[11px] font-bold"
        >
          {KARAOKE_WORDS.map((word) => (
            <motion.span
              key={word}
              variants={karaokeWord}
              className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
            >
              {word}
            </motion.span>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

interface HeroProps {
  onStart: () => void;
}

export default function Hero({ onStart }: HeroProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<number | null>(null);

  const step = useCallback((direction: 1 | -1) => {
    setSlideIndex((current) => (current + direction + SLIDES.length) % SLIDES.length);
  }, []);

  // Autoplay with pause; a single timer, no render loop.
  useEffect(() => {
    if (reducedMotion || paused) return;
    timerRef.current = window.setInterval(
      () => step(1),
      SLIDE_AUTOPLAY_MS,
    );
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [paused, reducedMotion, step]);

  const slide = SLIDES[slideIndex]!;

  return (
    <section className="relative z-10 px-4 pt-16 sm:px-6 sm:pt-24 lg:px-8">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]"
      >
        {/* ------------------------------ Copy ------------------------------ */}
        <div className="text-center lg:text-left">
          <motion.span
            variants={item}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-300 backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            No login · No API key
          </motion.span>

          <motion.h1
            variants={item}
            className="mt-6 font-[family-name:var(--font-display)] text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl"
          >
            Paste URL.{" "}
            <span className="relative inline-block">
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: "linear-gradient(110deg, #00F0FF, #3B82F6, #10B981)",
                }}
              >
                Get viral Shorts.
              </span>
              {/* Underline glow — transform/opacity only */}
              <span
                aria-hidden="true"
                className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full"
                style={{
                  backgroundImage: "linear-gradient(90deg, transparent, #00F0FF, #10B981, transparent)",
                  animation: reducedMotion ? "none" : "hc-pulse 3.4s ease-in-out infinite",
                }}
              />
            </span>
          </motion.h1>

          <motion.p
            variants={item}
            className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg lg:mx-0"
          >
            HookClip cuts long videos into vertical clips ready to post —
            complete with face-tracking, karaoke subtitles, and a virality score.
            All on the GPU, all automatic.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:items-start"
          >
            <motion.button
              type="button"
              onClick={onStart}
              whileHover={reducedMotion ? undefined : { y: -2, scale: 1.02 }}
              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
              className="group inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-7 py-3.5 text-base font-bold shadow-lg shadow-cyan-950/50 shadow-[0_0_18px_var(--glow-soft)] outline-none transition-shadow duration-300 hover:shadow-[0_0_32px_var(--glow)] focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#06080D] sm:w-auto"
              style={{
                backgroundImage: "linear-gradient(120deg, #00F0FF, #3B82F6 60%, #10B981)",
                color: "#04121a",
              }}
            >
              <Scissors className="h-5 w-5 transition-transform duration-200 group-hover:rotate-12" aria-hidden="true" />
              Create Shorts Now
            </motion.button>
            <motion.a
              href="#klip"
              whileHover={reducedMotion ? undefined : { y: -2 }}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-6 py-3.5 text-sm font-semibold text-[var(--text-muted)] backdrop-blur outline-none transition duration-200 hover:border-[var(--accent)]/50 hover:text-white hover:shadow-[0_0_16px_var(--glow-soft)] focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#06080D] sm:w-auto"
            >
              Watch Sample Clips
            </motion.a>
          </motion.div>
          <motion.p variants={item} className="mt-3 text-xs text-slate-500">
            Free to use · results ready to download in minutes
          </motion.p>
        </div>

        {/* --------------------------- Showcase ----------------------------- */}
        <motion.div variants={item} className="relative">
          <DemoStage />

          {/* Slide card */}
          <div
            className="mx-auto mt-6 max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur"
            aria-roledescription="carousel"
            aria-label="Sample clips"
          >
            <div className="flex items-stretch gap-3 p-3">
              <div
                className="relative w-24 shrink-0 overflow-hidden rounded-xl"
                style={{ aspectRatio: "9 / 16", background: slide.gradient }}
              >
                <span className="absolute right-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  {slide.score}
                </span>
                <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                  {slide.duration}
                </span>
              </div>
              <div className="min-w-0 flex-1 py-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400">
                  {slide.eyebrow}
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold text-white">
                  {slide.title}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                  {slide.description}
                </p>

                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous sample"
                    className="rounded-md p-1 text-slate-400 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {SLIDES.map((s, index) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => setSlideIndex(index)}
                      aria-label={`Sample ${index + 1}`}
                      aria-current={index === slideIndex}
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        index === slideIndex
                          ? "w-5 bg-cyan-300"
                          : "w-1.5 bg-white/25 hover:bg-white/40",
                      )}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next sample"
                    className="rounded-md p-1 text-slate-400 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaused((p) => !p)}
                    aria-label={paused ? "Play automatically" : "Pause"}
                    className="ml-auto rounded-md p-1 text-slate-400 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    {paused ? (
                      <Play className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Pause className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
