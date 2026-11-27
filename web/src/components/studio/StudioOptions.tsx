"use client";

import { useId } from "react";
import { Info, Minus, Plus } from "lucide-react";
import { motion } from "framer-motion";
import type { AiModules, AspectRatio } from "@shared/studio-contract";
import { ASPECT_RATIOS } from "@shared/studio-contract";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

/* ------------------------------------------------------------------ */
/* Aspect-ratio geometry                                               */
/* ------------------------------------------------------------------ */

const RATIO_DIMENSIONS: Record<AspectRatio, { w: number; h: number; label: string }> = {
  "9:16": { w: 9, h: 16, label: "Vertical" },
  "4:5": { w: 4, h: 5, label: "Feed" },
  "1:1": { w: 1, h: 1, label: "Square" },
  "16:9": { w: 16, h: 9, label: "Landscape" },
};

/* 22px on the short side keeps every icon inside the same square box. */
function frameStyle(ratio: AspectRatio): { width: number; height: number } {
  const { w, h } = RATIO_DIMENSIONS[ratio];
  const short = 22;
  return w >= h ? { width: short * (w / h), height: short } : { width: short, height: short * (h / w) };
}

/* ------------------------------------------------------------------ */
/* Field shell                                                         */
/* ------------------------------------------------------------------ */

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-xs font-semibold uppercase tracking-wider text-slate-400"
        >
          {label}
        </label>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip (local, hover + focus)                                      */
/* ------------------------------------------------------------------ */

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="rounded-full p-0.5 text-slate-500 outline-none transition hover:text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-white/10 bg-[#0d1424] p-2.5 text-[11px] font-normal leading-relaxed text-slate-300 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Switch (local fallback)                                             */
/* ------------------------------------------------------------------ */

const KNOB_SPRING = { type: "spring", stiffness: 420, damping: 28 } as const;

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  reduced,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
  reduced: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-sm font-medium text-slate-200">
            {label}
          </label>
          <InfoTip text={description} />
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{description}</p>
      </div>
      <motion.button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        animate={reduced ? undefined : { scale: checked ? 1 : 0.985 }}
        whileTap={reduced || disabled ? undefined : { scale: 0.93 }}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50",
          checked
            ? "bg-[var(--accent)]/85 shadow-[0_0_14px_var(--glow-soft)]"
            : "bg-slate-700",
        )}
      >
        <motion.span
          aria-hidden="true"
          className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow"
          layout={reduced ? false : true}
          transition={reduced ? { duration: 0 } : KNOB_SPRING}
          animate={{ x: checked ? 20 : 0 }}
        />
      </motion.button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StudioOptions                                                       */
/* ------------------------------------------------------------------ */

interface StudioOptionsProps {
  clipCount: number;
  onClipCountChange: (n: number) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  modules: AiModules;
  onModulesChange: (modules: AiModules) => void;
  disabled?: boolean;
  minClips?: number;
  maxClips?: number;
}

const CLIP_PRESETS = [1, 3, 5, 10];

export default function StudioOptions({
  clipCount,
  onClipCountChange,
  aspectRatio,
  onAspectRatioChange,
  modules,
  onModulesChange,
  disabled,
  minClips = 1,
  maxClips = 10,
}: StudioOptionsProps) {
  const clamp = (n: number) => Math.min(maxClips, Math.max(minClips, Math.round(n)));
  const reduced = usePrefersReducedMotion();

  return (
    <div className="grid gap-5 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur sm:p-5 lg:grid-cols-2">
      {/* -------------------------- Clip count -------------------------- */}
      <Field label="Number of clips" hint={`${minClips}–${maxClips} clips`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Decrease number of clips"
            disabled={disabled || clipCount <= minClips}
            onClick={() => onClipCountChange(clamp(clipCount - 1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <output
            aria-live="polite"
            className="w-10 text-center text-lg font-bold tabular-nums text-white"
          >
            {clipCount}
          </output>
          <button
            type="button"
            aria-label="Increase number of clips"
            disabled={disabled || clipCount >= maxClips}
            onClick={() => onClipCountChange(clamp(clipCount + 1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>

          <div
            role="group"
            aria-label="Number of clips preset"
            className="ml-auto flex gap-1 rounded-lg border border-white/10 bg-black/25 p-1"
          >
            {CLIP_PRESETS.filter((n) => n >= minClips && n <= maxClips).map((preset) => {
              const selected = clipCount === clamp(preset);
              return (
                <motion.button
                  key={preset}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onClipCountChange(clamp(preset))}
                  whileHover={reduced || disabled ? undefined : { y: -2 }}
                  whileTap={reduced || disabled ? undefined : { scale: 0.94 }}
                  transition={KNOB_SPRING}
                  className={cn(
                    "relative min-w-9 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40",
                    selected
                      ? "border-[var(--accent)]/60 bg-[var(--accent)]/15 text-[var(--accent)] shadow-[0_0_12px_var(--glow-soft)]"
                      : "border-transparent text-slate-400 hover:text-slate-200",
                  )}
                >
                  {preset}
                  {selected && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-md ring-1 ring-[var(--accent)]"
                      initial={false}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={KNOB_SPRING}
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>
      </Field>

      {/* ------------------------ Aspect ratio ------------------------- */}
      <Field label="Aspect ratio" hint={RATIO_DIMENSIONS[aspectRatio].label}>
        <div
          role="radiogroup"
          aria-label="Aspect ratio"
          className="grid grid-cols-4 gap-1.5"
        >
          {ASPECT_RATIOS.map((ratio) => {
            const selected = aspectRatio === ratio;
            const dims = RATIO_DIMENSIONS[ratio];
            const size = frameStyle(ratio);
            return (
              <button
                key={ratio}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onAspectRatioChange(ratio)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cyan-300",
                  selected
                    ? "border-cyan-400/60 bg-cyan-400/10"
                    : "border-white/10 bg-black/20 hover:border-white/25",
                )}
              >
                <span
                  className="flex h-8 items-center justify-center"
                  aria-hidden="true"
                >
                  <motion.span
                    className={cn(
                      "rounded-[3px] border",
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent)]/30 shadow-[0_0_10px_var(--glow-soft)]"
                        : "border-slate-500",
                    )}
                    initial={false}
                    animate={{
                      width: size.width,
                      height: size.height,
                      opacity: 1,
                    }}
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 26 }}
                  />
                </span>
                <span
                  className={cn(
                    "text-[11px] font-semibold",
                    selected ? "text-cyan-200" : "text-slate-400",
                  )}
                >
                  {dims.w}:{dims.h}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* -------------------------- AI modules ------------------------- */}
      <div className="lg:col-span-2">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            AI Modules
          </span>
          <span className="text-[11px] text-slate-500">can be turned off anytime</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Toggle
            checked={modules.faceTracking}
            disabled={disabled}
            onChange={(next) => onModulesChange({ ...modules, faceTracking: next })}
            label="Face-Tracking"
            reduced={reduced}
            description="Keeps the speaker's face centered in the vertical frame dynamically."
          />
          <Toggle
            checked={modules.karaokeAss}
            disabled={disabled}
            onChange={(next) => onModulesChange({ ...modules, karaokeAss: next })}
            label="Karaoke ASS"
            reduced={reduced}
            description="Burn-in subtitles with word-by-word highlights that follow the audio."
          />
          <Toggle
            checked={modules.hookScore}
            disabled={disabled}
            onChange={(next) => onModulesChange({ ...modules, hookScore: next })}
            label="Hook Score"
            reduced={reduced}
            description="Scores viral potential for each moment to pick the best clips."
          />
        </div>
      </div>
    </div>
  );
}
