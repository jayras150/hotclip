"use client";

import { motion, useReducedMotion, useSpring } from "framer-motion";
import { Film, Scissors } from "lucide-react";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

function DockLink({
  href,
  icon,
  label,
  reducedMotion,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  reducedMotion: boolean | null;
}) {
  const scale = useSpring(1, { stiffness: 400, damping: 20 });
  const bump = () => {
    if (!reducedMotion) scale.set(1.06);
  };
  const reset = () => scale.set(1);
  return (
    <motion.a
      href={href}
      className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-300 transition-colors duration-200 hover:bg-white/[0.07] hover:text-white hover:shadow-[0_0_14px_var(--glow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:px-4"
      style={{ scale }}
      onHoverStart={bump}
      onHoverEnd={reset}
      onFocus={bump}
      onBlur={reset}
    >
      <span aria-hidden className="sm:hidden">
        {icon}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </motion.a>
  );
}

export default function FloatingDock() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
      <motion.nav
        initial={{ opacity: 0, y: -12, scale: reduceMotion ? 1 : 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#0C1018]/70 px-4 py-2 shadow-[var(--shadow-glow)] backdrop-blur-xl transition-shadow duration-300 hover:border-[var(--accent)]/30 hover:shadow-[0_0_32px_var(--glow)] sm:gap-3 sm:px-5"
      >
        {/* Logo mark: stylized scissors + play-triangle glyph */}
        <a href="#" className="flex items-center gap-2" aria-label="HookClip">
          <svg
            width="26"
            height="26"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
          >
            {/* play triangle */}
            <motion.path
              d="M12 9 L23 16 L12 23 Z"
              stroke="#00F0FF"
              strokeWidth={2}
              strokeLinejoin="round"
              fill="rgba(0, 240, 255, 0.08)"
              initial={reduceMotion ? undefined : { pathLength: 0 }}
              animate={reduceMotion ? undefined : { pathLength: 1 }}
              transition={{ duration: 1, ease: EASE, delay: 0.2 }}
            />
            {/* scissor blades */}
            <motion.path
              d="M7 8 L18 22"
              stroke="#00F0FF"
              strokeWidth={2}
              strokeLinecap="round"
              initial={reduceMotion ? undefined : { pathLength: 0 }}
              animate={reduceMotion ? undefined : { pathLength: 1 }}
              transition={{ duration: 0.8, ease: EASE }}
            />
            <motion.path
              d="M7 24 L18 10"
              stroke="#00F0FF"
              strokeWidth={2}
              strokeLinecap="round"
              initial={reduceMotion ? undefined : { pathLength: 0 }}
              animate={reduceMotion ? undefined : { pathLength: 1 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
            />
            {/* scissor handles */}
            <motion.circle
              cx="5.5"
              cy="6.5"
              r="2.5"
              stroke="#3B82F6"
              strokeWidth={2}
              initial={reduceMotion ? undefined : { pathLength: 0 }}
              animate={reduceMotion ? undefined : { pathLength: 1 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.6 }}
            />
            <motion.circle
              cx="5.5"
              cy="25.5"
              r="2.5"
              stroke="#3B82F6"
              strokeWidth={2}
              initial={reduceMotion ? undefined : { pathLength: 0 }}
              animate={reduceMotion ? undefined : { pathLength: 1 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.7 }}
            />
          </svg>
          <span className="font-[family-name:var(--font-display)] text-base font-bold text-white">
            HookClip
            <span className="bg-gradient-to-r from-[#00F0FF] to-[#3B82F6] bg-clip-text text-transparent">
              .pro
            </span>
          </span>
        </a>

        {/* Status pill */}
        <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 md:inline-flex">
          <span className="relative flex h-2 w-2 items-center justify-center">
            {!reduceMotion && (
              <motion.span
                className="absolute inline-flex h-2 w-2 rounded-full bg-emerald-400/60"
                animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          GPU Cloud Ready
        </span>

        <div className="h-5 w-px bg-white/10" aria-hidden="true" />

        <nav className="flex items-center gap-1" aria-label="Main navigation">
          <DockLink
            href="#studio"
            icon={<Scissors size={16} strokeWidth={2} />}
            label="Studio"
            reducedMotion={reduceMotion}
          />
          <DockLink
            href="#clips"
            icon={<Film size={16} strokeWidth={2} />}
            label="Clip Gallery"
            reducedMotion={reduceMotion}
          />
        </nav>
      </motion.nav>
    </div>
  );
}
