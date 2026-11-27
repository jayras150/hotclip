"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Scissors,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
} from "framer-motion";
import type {
  AiModules,
  AspectRatio,
  PublicClip,
  PublicJob,
} from "@shared/studio-contract";
import { clampClipCount } from "@shared/studio-contract";
import { cn } from "@/lib/cn";
import {
  PublicApiError,
  createJob,
  ensureSession,
  getJob,
  FALLBACK_LIMITS,
} from "@/lib/public-api";
import {
  useAiModules,
  useAspectRatio,
  useClipCount,
  useRecentJobs,
} from "@/lib/hooks/use-studio-settings";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";
import SourceInput, { type SourceSelection } from "./SourceInput";
import StudioOptions from "./StudioOptions";
import PipelineVisualizer from "./PipelineVisualizer";
import LiveLogTerminal from "./LiveLogTerminal";
import ClipGrid from "./ClipGrid";
import ClipPreviewModal from "./ClipPreviewModal";
import { CreditGuard, creditGuardEnabled, type CreditState } from "./CreditGuard";
import { useToast } from "./ClipCard";

/* ------------------------------------------------------------------ */
/* State machine: idle → submitting → running → done | failed          */
/* ------------------------------------------------------------------ */

type Phase = "idle" | "submitting" | "running" | "done" | "failed";

const POLL_INTERVAL_MS = 2000;

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/* CTA: rotating conic ring + shimmer sweep + magnetic hover           */
/* ------------------------------------------------------------------ */

function CreateShortsButton({
  busy,
  submitting,
  onClick,
  reduced,
}: {
  busy: boolean;
  submitting: boolean;
  onClick: () => void;
  reduced: boolean;
}) {
  // Magnetic hover: spring-follow a small offset toward the cursor.
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, { stiffness: 300, damping: 24, mass: 0.4 });
  const y = useSpring(rawY, { stiffness: 300, damping: 24, mass: 0.4 });

  const handleMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (reduced || busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    rawX.set(Math.max(-1, Math.min(1, dx)) * 6);
    rawY.set(Math.max(-1, Math.min(1, dy)) * 4);
  };

  const handleLeave = () => {
    rawX.set(0);
    rawY.set(0);
  };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      disabled={busy}
      style={reduced ? undefined : { x, y }}
      whileHover={reduced || busy ? undefined : { scale: 1.015 }}
      whileTap={reduced || busy ? undefined : { scale: 0.98 }}
      className={cn(
        "relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-3.5 text-base font-semibold text-white outline-none shadow-lg shadow-indigo-950/40 transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
        busy ? "cursor-not-allowed opacity-70" : "opacity-100",
      )}
    >
      {/* Base gradient */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-20"
        style={{ backgroundImage: "linear-gradient(120deg, var(--accent-2), #6366f1)" }}
      />

      {/* Rotating conic-gradient border layer */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-xl"
        style={{
          padding: "1.5px",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      >
        {!reduced && (
          <motion.span
            className="absolute inset-[-150%]"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, var(--accent) 80deg, transparent 200deg)",
            }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 7, ease: "linear" }}
          />
        )}
      </span>

      {/* Shimmer sweep overlay */}
      {!reduced && !busy && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-xl">
          <motion.span
            className="absolute inset-y-0 w-1/3 -skew-x-12"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)",
            }}
            initial={{ x: "-140%" }}
            animate={{ x: ["-140%", "360%"] }}
            transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut", repeatDelay: 1.2 }}
          />
        </span>
      )}

      <span className="relative z-10 inline-flex items-center gap-2">
        {submitting ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <Scissors className="h-5 w-5" aria-hidden="true" />
        )}
        {submitting ? "Menyiapkan job…" : "Buat Shorts Sekarang"}
      </span>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */

export default function StudioShell() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [clips, setClips] = useState<PublicClip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewClip, setPreviewClip] = useState<PublicClip | null>(null);

  // Saldo kredit user aktif (diisi CreditGuard bila Clerk aktif).
  const [credit, setCredit] = useState<CreditState>({
    signedIn: false,
    balance: null,
  });

  const [clipCount, setClipCount] = useClipCount();
  const [aspectRatio, setAspectRatio] = useAspectRatio();
  const [modules, setModules] = useAiModules();
  const [recentJobs, pushRecentJob] = useRecentJobs();
  const { toast, toastNode } = useToast();

  const pollRef = useRef<number | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const busy = phase === "submitting" || phase === "running";
  const reduced = usePrefersReducedMotion();

  /* -------------------- Poll job detail while running ------------- */
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (phase !== "running" || !job) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const detail = await getJob(job.id);
        if (cancelled) return;
        setJob(detail.job);
        setClips(detail.clips.filter((clip) => clip.status !== "failed"));

        if (detail.job.status === "completed") {
          setPhase("done");
          stopPolling();
        } else if (
          detail.job.status === "failed" ||
          detail.job.status === "timeout" ||
          detail.job.status === "cancelled"
        ) {
          setPhase("failed");
          setError(detail.job.error ?? "Render gagal. Silakan coba lagi.");
          stopPolling();
        }
      } catch {
        /* transient poll failure — keep trying on the next interval */
      }
    };

    void tick();
    pollRef.current = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [phase, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => stopPolling, [stopPolling]);

  /* ------------------------------ Submit --------------------------- */
  const submit = useCallback(async () => {
    const router = useRouter();
    /* Step 1 — Auth Guard: stop and redirect to /sign-in when not logged in. */
    if (creditGuardEnabled) {
      const { isSignedIn } = useAuth();
      if (!isSignedIn) {
        router.push("/sign-in");
        return;
      }
    }
    if (!source) {
      setError("Paste a video URL or upload a file first.");
      return;
    }
    if (source.kind === "url" && !source.url) {
      setError("The link is empty.");
      return;
    }
    if (source.kind === "file" && !source.uploadKey) {
      setError("The upload is not finished yet.");
      return;
    }
    /* Step 2 — Credit Guard: stop and route to /billing when balance is insufficient. */
    if (credit.signedIn && credit.balance !== null) {
      if (credit.balance <= 0) {
        router.push("/billing");
        return;
      }
      if (credit.balance < 1) {
        router.push("/billing");
        return;
      }
    }
    if (credit.signedIn && credit.balance !== null && credit.balance <= 0) {
      setError("Credit balance is 0. Visit /billing to top up before you render.");
      return;
    }

    setError(null);
    setClips([]);
    setJob(null);
    setPhase("submitting");

    try {
      await ensureSession();
      const created = await createJob({
        ...(source.kind === "url" ? { sourceUrl: source.url } : {}),
        ...(source.kind === "file"
          ? { uploadKey: source.uploadKey, sourceTitle: source.fileName }
          : {}),
        clipCount: clampClipCount(clipCount),
        aspectRatio: aspectRatio as AspectRatio,
        modules: modules as AiModules,
      });

      setJob(created);
      setPhase("running");
      pushRecentJob({
        jobId: created.id,
        title: source.preview?.title ?? source.fileName ?? "New render",
        status: created.status,
        createdAt: created.createdAt,
      });
      // Smooth-scroll the pipeline into view.
      window.requestAnimationFrame(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      setPhase("failed");
      setError(
        err instanceof PublicApiError
          ? err.message
          : "Failed to create the render job. Please try again.",
      );
    }
  }, [source, clipCount, aspectRatio, modules, credit, pushRecentJob]);

  const blockMotion = {
    initial: reduced ? false : ({ opacity: 0, y: 16 } as const),
    animate: { opacity: 1, y: 0 },
    exit: reduced ? undefined : ({ opacity: 0, y: -12 } as const),
    transition: { duration: reduced ? 0 : 0.3, ease: EASE },
  };

  /* ------------------------------ Render --------------------------- */
  return (
    <div className="space-y-5">
      {/* --------------------------- Composer --------------------------- */}
      <div ref={sectionRef} className="scroll-mt-24 space-y-4">
        {/* Pengambil saldo kredit (tanpa UI) — hanya saat Clerk aktif. */}
        {creditGuardEnabled ? <CreditGuard onState={setCredit} /> : null}

        <SourceInput
          limits={FALLBACK_LIMITS}
          value={source}
          onChange={setSource}
          disabled={busy}
        />

        <StudioOptions
          clipCount={clipCount}
          onClipCountChange={setClipCount}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          modules={modules}
          onModulesChange={setModules}
          disabled={busy}
        />

        <div className="flex items-center gap-3">
          <CreateShortsButton
            busy={busy}
            submitting={phase === "submitting"}
            onClick={() => void submit()}
            reduced={reduced}
          />
        </div>

        {/* Info sisa kredit (jelas & selalu terlihat saat login). */}
        {credit.signedIn && (
          <p
            role="status"
            className={cn(
              "text-xs",
              credit.balance !== null && credit.balance <= 0
                ? "text-rose-300"
                : "text-[var(--text-muted)]",
            )}
          >
            {credit.balance !== null
              ? credit.balance <= 0
                ? "Sisa kredit: 0 — saldo habis, top up di /billing."
                : `Sisa kredit: ${credit.balance.toLocaleString("en-US")}`
              : "Memuat saldo kredit…"}
          </p>
        )}

        {error && phase !== "failed" && (
          <p role="alert" className="text-xs text-rose-300">
            {error}
          </p>
        )}
      </div>

      {/* --------------- Running / failed / done crossfade -------------- */}
      <AnimatePresence mode="wait" initial={false}>
        {/* ------------------------ Running state ----------------------- */}
        {phase === "running" && job && (
          <motion.div key="running" {...blockMotion} className="space-y-4" aria-live="polite">
            <PipelineVisualizer job={job} />
            <LiveLogTerminal jobId={job.id} />
            {clips.length > 0 && (
              <ClipGrid
                clips={clips}
                loading={clips.length < (job.clipCount ?? clipCount)}
                expectedCount={job.clipCount ?? clipCount}
                onOpen={setPreviewClip}
                onToast={toast}
              />
            )}
          </motion.div>
        )}

        {/* ------------------------- Failed state ----------------------- */}
        {phase === "failed" && (
          <motion.div
            key="failed"
            {...blockMotion}
            role="alert"
            className="rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-5"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-rose-200">Render gagal</p>
                <p className="mt-1 text-xs leading-relaxed text-rose-300/90">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setPhase("idle");
                    setError(null);
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-200 outline-none transition hover:bg-rose-500/20 focus-visible:ring-2 focus-visible:ring-rose-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Coba lagi
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* -------------------------- Done state ------------------------ */}
        {phase === "done" && (
          <motion.div key="done" {...blockMotion} className="space-y-4">
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--success)]/25 bg-[var(--success)]/10 p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
              <p className="text-sm font-semibold text-emerald-200">
                Selesai! {clips.length} klip siap diunduh atau dipratinjau.
              </p>
            </div>
            <ClipGrid
              clips={clips}
              loading={false}
              expectedCount={job?.clipCount ?? clipCount}
              onOpen={setPreviewClip}
              onToast={toast}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* --------------------------- History ---------------------------- */}
      {recentJobs.length > 0 && (
        <section aria-labelledby="riwayat-heading" className="pt-2">
          <h2
            id="riwayat-heading"
            className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
          >
            Riwayat
          </h2>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {recentJobs.map((entry) => (
              <li key={entry.jobId}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const detail = await getJob(entry.jobId);
                      setJob(detail.job);
                      setClips(detail.clips);
                      setPhase(
                        detail.job.status === "completed"
                          ? "done"
                          : detail.job.status === "failed" ||
                              detail.job.status === "timeout" ||
                              detail.job.status === "cancelled"
                            ? "failed"
                            : "running",
                      );
                      setError(detail.job.error ?? null);
                    } catch {
                      toast("Riwayat tidak bisa dimuat");
                    }
                  }}
                  className="flex w-44 shrink-0 flex-col rounded-xl border border-white/10 bg-white/5 p-2.5 text-left outline-none transition hover:border-white/25 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span className="truncate text-xs font-semibold text-slate-200">
                    {entry.title}
                  </span>
                  <span className="mt-0.5 text-[10px] text-slate-500">
                    {new Date(entry.createdAt).toLocaleString("id-ID", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span
                    className={cn(
                      "mt-1 w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      entry.status === "completed"
                        ? "bg-[var(--success)]/15 text-emerald-300"
                        : entry.status === "failed"
                          ? "bg-[var(--danger)]/15 text-rose-300"
                          : "bg-[var(--accent)]/15 text-[var(--accent)]",
                    )}
                  >
                    {entry.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ClipPreviewModal clip={previewClip} onClose={() => setPreviewClip(null)} />
      {toastNode}
    </div>
  );
}
