"use client";

import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Captions,
  Check,
  Circle,
  Crop,
  Download,
  Radar,
} from "lucide-react";
import { motion } from "framer-motion";
import type { PipelineStage, PublicJob } from "@shared/studio-contract";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

/* ------------------------------------------------------------------ */
/* Stage mapping                                                       */
/* ------------------------------------------------------------------ */

type VisualStageId = "download" | "transcribe" | "analyze" | "render" | "upload";

interface VisualStage {
  id: VisualStageId;
  label: string;
  Icon: typeof Download;
  /** PipelineStage values that mean "this stage is currently executing". */
  activeOn: PipelineStage[];
}

const STAGES: VisualStage[] = [
  { id: "download", label: "Ingest", Icon: Download, activeOn: ["downloading"] },
  { id: "transcribe", label: "Whisper AI", Icon: AudioLines, activeOn: ["transcribing"] },
  { id: "analyze", label: "Hook Detector", Icon: Radar, activeOn: ["analyzing"] },
  { id: "render", label: "9:16 Reframe", Icon: Crop, activeOn: ["rendering"] },
  { id: "upload", label: "ASS Render", Icon: Captions, activeOn: ["uploading"] },
];

/** Rank used to decide which visual stages are already finished. */
const STAGE_ORDER: PipelineStage[] = [
  "queued",
  "provisioning",
  "downloading",
  "transcribing",
  "analyzing",
  "rendering",
  "uploading",
  "completed",
];

function stageRank(stage: PipelineStage | null | undefined): number {
  if (!stage) return 0;
  const index = STAGE_ORDER.indexOf(stage);
  return index >= 0 ? index : 0;
}

type StageState = "done" | "active" | "pending";

function stateFor(stage: VisualStage, current: PipelineStage | null, progress: number): StageState {
  const activeIndex = STAGE_ORDER.indexOf(
    current && STAGE_ORDER.includes(current) ? current : "queued",
  );

  // queued/provisioning → nothing started yet visually.
  if (activeIndex <= 0) return "pending";
  if (activeIndex >= STAGE_ORDER.indexOf("completed")) return "done";

  const own = stage.activeOn.map((s) => STAGE_ORDER.indexOf(s)).filter((i) => i >= 0);
  const stageStart = Math.min(...own);
  const stageEnd = Math.max(...own);

  if (activeIndex > stageEnd) return "done";
  if (activeIndex >= stageStart) return "active";

  // Progress-based fallback so the bar still advances when the backend only
  // reports a coarse stage.
  if (progress >= 100) return "done";
  return "pending";
}

/* ------------------------------------------------------------------ */
/* Animated percent counter                                            */
/* ------------------------------------------------------------------ */

function AnimatedPercent({ value, reduced }: { value: number; reduced: boolean }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return;

    const start = performance.now();
    const duration = 420;
    let raf = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + delta * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = value;
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  useEffect(() => {
    fromRef.current = value;
  }, [value]);

  return <>{Math.round(display)}%</>;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface PipelineVisualizerProps {
  job: Pick<PublicJob, "stage" | "status" | "progress">;
}

export default function PipelineVisualizer({ job }: PipelineVisualizerProps) {
  const stage = job.stage;
  const progress = Math.max(0, Math.min(100, job.progress ?? 0));
  const failed = job.status === "failed" || job.status === "timeout" || job.status === "cancelled";
  const completed = job.status === "completed" || progress >= 100;
  const reduced = usePrefersReducedMotion();

  const headline =
    job.status === "queued"
      ? "Waiting for GPU…"
      : job.status === "failed"
        ? "Render failed"
        : job.status === "timeout"
          ? "Render timeout"
          : job.status === "cancelled"
            ? "Cancelled"
            : completed
              ? "Done — clips ready"
              : `Stage: ${STAGES.find((s) => s.activeOn.includes(stage as PipelineStage))?.label ?? "Provisioning GPU"}`;

  return (
    <section
      aria-label="Pipeline progress"
      className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Pipeline
          </p>
          <p
            aria-live="polite"
            className={cn(
              "mt-0.5 text-sm font-semibold",
              failed ? "text-rose-300" : completed ? "text-emerald-300" : "text-white",
            )}
          >
            {headline}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-bold tabular-nums text-[var(--accent)]">
          <AnimatedPercent value={progress} reduced={reduced} />
        </span>
      </div>

      {/* Stage stepper */}
      <ol className="mt-5 flex items-start justify-between gap-1">
        {STAGES.map((s, index) => {
          const state: StageState = completed ? "done" : stateFor(s, stage, progress);
          const isLast = index === STAGES.length - 1;
          const Icon = s.Icon;

          return (
            <li key={s.id} className="relative flex flex-1 flex-col items-center">
              {/* Connector to the next stage */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-3.5 h-[2px] w-full origin-left overflow-hidden rounded-full"
                  style={{
                    background:
                      state === "done"
                        ? "linear-gradient(90deg, var(--accent), var(--accent-2))"
                        : "rgba(148,163,184,0.22)",
                  }}
                >
                  {state === "active" && !reduced && (
                    <motion.span
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(90deg, var(--accent) 0 6px, transparent 6px 12px)",
                      }}
                      initial={{ backgroundPositionX: "0px" }}
                      animate={{ backgroundPositionX: "24px" }}
                      transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                    />
                  )}
                </span>
              )}

              <span
                className={cn(
                  "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border",
                  state === "done" && "border-[var(--accent)]/60 bg-[var(--accent)]/20 text-[var(--accent)]",
                  state === "active" &&
                    "border-[var(--accent)] bg-[var(--accent)]/25 text-white shadow-[0_0_16px_var(--glow)]",
                  state === "pending" && "border-white/15 bg-[var(--surface)] text-slate-500",
                )}
              >
                {state === "active" && !reduced && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full border border-[var(--accent)]"
                    initial={{ opacity: 0.7, scale: 1 }}
                    animate={{ opacity: 0, scale: 1.7 }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: "easeOut" }}
                  />
                )}
                {state === "done" ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : state === "active" ? (
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Circle className="h-2.5 w-2.5" aria-hidden="true" />
                )}
              </span>

              <span
                className={cn(
                  "mt-1.5 text-center text-[10px] font-medium leading-tight sm:text-[11px]",
                  state === "pending" ? "text-slate-500" : "text-slate-200",
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Progress bar */}
      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Render progress percentage"
      >
        <motion.div
          className="h-full rounded-full"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
          style={{
            backgroundImage: failed
              ? "linear-gradient(90deg, var(--danger), #fb7185)"
              : "linear-gradient(90deg, var(--accent-2), var(--accent), var(--success))",
            boxShadow: "0 0 12px var(--glow-soft)",
          }}
        />
      </div>
    </section>
  );
}
