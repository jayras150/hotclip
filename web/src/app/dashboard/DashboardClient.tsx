"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock,
  Plus,
  XCircle,
  Play,
  Wallet,
  ChevronRight,
  RefreshCw,
  Film,
} from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useWalletBalance, useClerkWalletAuth } from "@/lib/hooks/use-wallet-balance";
import { createJob, ensureSession } from "@/lib/public-api";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Normalized layout state shared between the job list and progress cards. */
interface JobLayout {
  id: string;
  source: string;
  status: string;
  progress: number;
  updatedAt: string;
}

/** One row in the paste-link input form. */
interface SourceRow {
  kind: "url" | "file";
  url?: string;
  uploadKey?: string;
  fileName?: string;
  fileSize?: number;
}

/* ------------------------------------------------------------------ */
/* Main client component                                              */
/* ------------------------------------------------------------------ */

export default function DashboardClient() {
  const auth = useClerkWalletAuth();
  const wallet = useWalletBalance(auth);
  const { isSignedIn } = useAuth();

  // Input form
  const [sourceRows, setSourceRows] = useState<SourceRow[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Jobs + progress
  const [jobs, setJobs] = useState<JobLayout[]>([]);
  const [flush, setFlush] = useState(false);

  /* ------------------------------------------------------ */
  /* Public job submission (POST /api/v1/public/jobs)       */
  /* ------------------------------------------------------ */

  const submitJob = useCallback(async (rows: SourceRow[]) => {
    const validRows = rows.filter(
      (row) => row.kind === "url" && row.url?.trim(),
    );
    if (validRows.length === 0) return;

    // 1. Ensure an anonymous public session first (the client session token
    //    is hoisted into memory / storage before the request is sent).
    try {
      await ensureSession();
    } catch {
      // Session bootstrap is best-effort; the request still carries any
      // previously stored session id.
    }

    const payload: import("@shared/studio-contract").CreatePublicJobRequest = {
      sourceUrl: validRows[0]?.kind === "url" ? validRows[0]!.url : undefined,
      uploadKey: validRows[0]?.kind === "file" ? validRows[0]!.uploadKey : undefined,
      sourceTitle: validRows[0]?.fileName ?? `Source 1`,
      clipCount: 1,
      aspectRatio: "9:16",
      modules: { faceTracking: true, karaokeAss: true, hookScore: true },
    };

    try {
      const created = await createJob(payload);
      setJobs((prev) => [
        {
          id: created.id,
          source: created.sourceUrl
            ? created.sourceUrl
            : created.sourceTitle ?? "New job",
          status: created.status,
          progress: created.progress,
          updatedAt: created.updatedAt,
        },
        ...prev,
      ]);
      setSourceRows([]);
      setUrlDraft("");
      setFlush((f) => !f);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create the job.";
      setSourceRows((prev) => prev.slice(0, -1));
      setPasteError(`${message} Re-submit the full list.`);
    }
  }, []);

  /* ------------------------------------------------------ */
  /* Input: paste-link form                                 */
  /* ------------------------------------------------------ */

  const addUrlRow = useCallback(() => {
    setSourceRows((prev) => [...prev, { kind: "url" }]);
  }, []);

  const setUrlRow = useCallback(
    (index: number, value: string) => {
      setSourceRows((prev) =>
        prev.map((row, i) =>
          i === index ? { ...row, kind: "url", url: value } : row,
        ),
      );
    },
    [],
  );

  const removeRow = useCallback((index: number) => {
    setSourceRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const hasSources = sourceRows.some((row) => row.url?.trim());

  const submitLatest = useCallback(() => {
    if (sourceRows.length === 0) return;
    void submitJob(sourceRows);
  }, [sourceRows, submitJob]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
        throw new Error("unsupported");
      }
      const text = await navigator.clipboard.readText();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        setPasteError("Clipboard is empty.");
        return;
      }
      setSourceRows(lines.map((url) => ({ kind: "url", url })));
      setPasteError(null);
      setUrlDraft(lines[0]);
    } catch {
      setPasteError("Clipboard permission denied. Paste manually with Ctrl+V.");
    }
  }, []);

  /* ------------------------------------------------------ */
  /* Job reconciliation (GET /api/v1/public/jobs)           */
  /* ------------------------------------------------------ */

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/public/jobs", { cache: "no-store" });
      const list = (await res.json()) as Array<{
        id: string;
        sourceUrl?: string;
        sourceTitle?: string;
        status: string;
        progress: number;
        updatedAt: string;
      }>;

      if (!Array.isArray(list)) return;

      setJobs((prev) => {
        const existingIds = new Set(prev.map((j) => j.id));
        const incoming = list.filter((j) => !existingIds.has(j.id));
        const updated: JobLayout[] = [...prev];
        return reconcileJobs(incoming, updated);
      });
    } catch {
      // API unavailable: the next poll will retry automatically.
    }
  }, []);

  /**
   * Reconcile incoming public jobs into a job-layout list (no async/await).
   */
  function reconcileJobs(
    incoming: Array<{ id: string; sourceTitle?: string }>,
    updated: JobLayout[],
  ): JobLayout[] {
    for (const row of incoming) {
      try {
        const res = fetch(
          `/api/v1/public/jobs/${encodeURIComponent(row.id)}`,
          { cache: "no-store" },
        );
        const payload = res.then((r) => r.json()) as Promise<{
          job: JobLayout & { stage?: string | null; error?: string };
        } | null>;

        payload.then((p) => {
          if (!p?.job) return;
          updated.push({
            id: p.job.id,
            source: p.job.source ?? row.sourceTitle ?? "Untitled",
            status: p.job.status,
            progress: p.job.progress,
            updatedAt: p.job.updatedAt,
          });
        }).catch(() => {
          // Keep the list row; the next poll will reconcile it.
        });
      } catch {
        // Keep the list row; the next poll will reconcile it.
      }
    }
    return updated;
  }

  useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => {
      void loadJobs();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  /* ------------------------------------------------------ */
  /* Rendering                                                */
  /* ------------------------------------------------------ */

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-[var(--text)]">
            Studio
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Paste a link or upload a file, then track every render until the clips
            are ready.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Balance */}
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <Wallet className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {wallet.status === "ready" &&
              typeof wallet.balance === "number"
                ? `${wallet.balance} credits`
                : "No wallet data"}
            </span>
          </div>

          {/* Top-up CTA */}
          <button
            type="button"
            onClick={() => {
              if (wallet.status === "ready" && typeof wallet.balance === "number") {
                if (wallet.balance <= 0) {
                  void window.location.assign("/billing");
                  return;
                }
              }
              void window.location.assign("/billing");
            }}
            disabled={!wallet.signedIn}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Top up</span>
          </button>
        </div>
      </header>

      {/* Input: paste-link form */}
      <section
        aria-labelledby="input-heading"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)] sm:p-5"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--glow-soft)] text-[var(--accent)]">
            <Film className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2
            id="input-heading"
            className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--text)]"
          >
            Paste your video link
          </h2>
        </div>

        <p className="mt-1 text-xs text-[var(--text-muted)]">
          The public studio API accepts a list of video URLs. Each entry becomes
          its own render job — paste several lines to batch submit.
        </p>

        <div className="mt-3">
          <label
            htmlFor="video-link"
            className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
          >
            Video URL
          </label>
          <div className="flex items-center gap-2">
            <input
              id="video-link"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://youtu.be/..."
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              disabled={sourceRows.some((row) => row.kind === "url")}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={pasteFromClipboard}
              disabled={!navigator.clipboard?.readText}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="hidden sm:inline">Paste Link</span>
              <Film className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {pasteError && (
            <p
              role="alert"
              className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-300"
            >
              <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {pasteError}
            </p>
          )}
        </div>

        {sourceRows.map((row, index) => (
          <div
            key={`${row.url ?? row.uploadKey ?? index}-row`}
            className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--text-muted)]">
              <Film className="h-4 w-4" aria-hidden="true" />
            </span>
            <input
              value={row.url ?? ""}
              onChange={(e) => setUrlRow(index, e.target.value)}
              placeholder="https://youtu.be/..."
              className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
            />
            <button
              type="button"
              onClick={() => removeRow(index)}
              aria-label="Remove source"
              className="flex shrink-0 items-center justify-center rounded-lg p-1 text-[var(--text-muted)] transition hover:bg-[var(--danger)]/15 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addUrlRow}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-accent)] bg-[var(--glow-soft)] px-3 py-2 text-xs font-semibold text-[var(--accent)] transition-colors duration-150 hover:bg-[var(--accent)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add link
          </button>
          <button
            type="button"
            onClick={submitLatest}
            disabled={!hasSources}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--gradient-accent)] px-4 py-2 text-sm font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition-all duration-200 hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="hidden sm:inline">Submit jobs</span>
            <Play className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {hasSources
            ? `Selected ${sourceRows.length} source${sourceRows.length > 1 ? "s" : ""}. Submit to queue all of them.`
            : "No links yet. Add a link or paste from the clipboard to submit."}
        </p>
      </section>

      {/* Processing progress list — jobs */}
      {jobs.length > 0 ? (
        <section aria-labelledby="jobs-heading" className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--glow-soft)] text-[var(--accent)]">
              <Clock className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2
              id="jobs-heading"
              className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--text)]"
            >
              Processing progress
            </h2>
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {jobs.length}
            </span>
          </div>

          <div className="space-y-2">
            {jobs.map((job) => (
              <JobProgressCard key={job.id} job={job} flush={flush} />
            ))}
          </div>
        </section>
      ) : (
        <section
          aria-label="No jobs yet"
          className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">
            <Film className="h-6 w-6" aria-hidden="true" />
          </div>
          <h3 className="mt-4 font-[family-name:var(--font-display)] text-base font-semibold text-[var(--text)]">
            No jobs yet
          </h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Submit a video link above and the render pipeline will start
            processing it. Your progress list appears here.
          </p>
        </section>
      )}

      {/* My Clips link */}
      <div className="flex justify-center">
        <Link
          href="/clips"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-accent-soft)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          My Clips
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Job progress card                                                    */
/* ------------------------------------------------------------------ */

interface JobProgressCardProps {
  job: JobLayout;
  flush: boolean;
}

function JobProgressCard({ job, flush }: JobProgressCardProps) {
  const [phase, setPhase] = useState<"queued" | "running" | "done" | "failed">(
    job.status === "completed" ? "done" : "queued",
  );
  const [detail, setDetail] = useState<{
    stage?: string | null;
    progress: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (job.status === "completed" || job.status === "failed") return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/public/jobs/${encodeURIComponent(job.id)}`,
          { cache: "no-store" },
        );
        const payload = (await res.json()) as {
          job: {
            id: string;
            sourceUrl?: string;
            sourceTitle?: string;
            status: string;
            progress: number;
            stage: string | null;
            error?: string;
            updatedAt: string;
          };
        } | null;

        if (cancelled) return;
        if (!payload?.job) return;

        setDetail({
          stage: payload.job.stage ?? undefined,
          progress: payload.job.progress,
          error: payload.job.error ?? undefined,
        });

        if (payload.job.status === "completed") {
          setPhase("done");
        } else if (
          payload.job.status === "failed" ||
          payload.job.status === "timeout" ||
          payload.job.status === "cancelled"
        ) {
          setPhase("failed");
        } else {
          setPhase("running");
        }
      } catch {
        setPhase(job.status === "completed" ? "done" : "queued");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [job.id, job.status]);

  const isDone = phase === "done";
  const isFailed = phase === "failed";

  return (
    <article
      className={cn(
        "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)] transition-shadow duration-200",
        isDone && "border-[var(--border-accent)] shadow-[var(--glow-soft)]",
        isFailed && "border-[var(--border-accent)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)]">
            <Film className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text)]">
              {job.source}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{job.id}</p>
          </div>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
            formatBadgeClass(job.status),
          )}
        >
          {job.status}
        </span>
      </div>

      {/* Progress bar + live stage */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Progress</span>
          <span className="font-mono tabular-nums text-[var(--accent)]">
            {job.progress}%
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-2)_0%,var(--accent)_100%)] shadow-[0_0_12px_var(--glow)] transition-all duration-700"
            style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
          />
        </div>

        {detail && (
          <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="font-mono text-[var(--text-muted)]">
              {detail.stage ?? "queued"}
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[var(--text-muted)]">
              updated {formatTimestamp(job.updatedAt)}
            </span>
          </div>
        )}

        {isDone && (
          <div className="mt-2 flex items-center gap-2 text-sm text-[var(--success)]">
            <CheckCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            Rendered
          </div>
        )}
        {isFailed && (
          <div className="mt-2 flex items-center gap-2 text-sm text-[var(--danger)]">
            <XCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            Failed — patch, retry
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Link
          href={`/logs/${job.id}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-medium text-[var(--text)] transition hover:border-[var(--border-accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          Logs
        </Link>
        <Link
          href={`/clips?job=${job.id}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--gradient-accent)] px-3 py-2 text-xs font-semibold text-[#06080d] shadow-[var(--shadow-glow)] transition hover:shadow-[var(--shadow-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Film className="h-3.5 w-3.5" aria-hidden="true" />
          Clips
        </Link>
        <button
          type="button"
          onClick={() => {
            void fetch(
              `/api/v1/public/jobs/${encodeURIComponent(job.id)}`,
              { cache: "no-store" },
            );
          }}
          aria-label="Refresh job status"
          className="flex shrink-0 items-center justify-center rounded-xl p-2 text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Local icons                                                          */
/* ------------------------------------------------------------------ */

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toISOString();
  } catch {
    return iso;
  }
}

function formatBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-[var(--success)]/15 text-[var(--success)]";
    case "failed":
    case "timeout":
    case "cancelled":
      return "bg-[var(--danger)]/15 text-[var(--danger)]";
    default:
      return "bg-[var(--accent)]/15 text-[var(--accent)]";
  }
}

function CheckCircleIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}

function XCircleIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9 6 6" />
      <path d="m9 9-6 6" />
    </svg>
  );
}
