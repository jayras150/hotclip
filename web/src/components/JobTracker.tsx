"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Play, Eye, XCircle, Cpu, RefreshCw } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Provider {
  name?: string;
  externalId?: string;
  status?: string;
}

interface Job {
  id: string;
  status?: string;
  progress?: number;
  /** Human readable step the worker is on right now. */
  currentStep?: string;
  step?: string;
  current_step?: string;
  /** Seconds left on the current job. */
  etaSeconds?: number;
  sourceUrl?: string;
  inputUrl?: string;
  error?: string;
  clipCount?: number;
  createdAt?: string;
  updatedAt?: string;
  /** Vast.ai instance backing this job, when one is attached. */
  provider?: Provider | null;
}

type FilterKey = "all" | "queued" | "running" | "completed" | "failed";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  timeout: "Timeout",
};

const STATUS_CLASS: Record<string, string> = {
  queued: "bg-[rgba(245,158,11,0.12)] text-[var(--warning)] border border-[rgba(245,158,11,0.3)]",
  running: "bg-[var(--glow-soft)] text-accent border border-[var(--border-accent-soft)] shadow-[0_0_10px_var(--glow-soft)]",
  completed: "bg-[rgba(16,185,129,0.12)] text-[var(--success)] border border-[rgba(16,185,129,0.3)]",
  failed: "bg-[rgba(239,68,68,0.12)] text-[var(--danger)] border border-[var(--glow-danger)]",
  cancelled: "bg-white/[0.05] text-text-muted border border-border",
  timeout: "bg-[rgba(239,68,68,0.12)] text-[var(--danger)] border border-[var(--glow-danger)]",
};

const STEP_LABELS: Record<string, string> = {
  queued: "Waiting for worker",
  import: "Import",
  transcode: "Transcode",
  subtitle: "Subtitle",
  subtitle_burn: "Subtitle",
  render: "Render",
  export: "Export",
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
];

const JOBS_URL = "/api/v1/jobs";
const POLL_INTERVAL_MS = 4000;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Envelope-tolerant: accepts `{ ok, data }`, `{ data }`, or a raw array/object.
 */
function unwrap<T>(payload: unknown): T {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "data" in (payload as Record<string, unknown>)
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function errorMessage(err: unknown): string {
  const apiErr = err as ApiError;
  if (apiErr instanceof ApiError) return apiErr.message || "Request failed";
  if (err instanceof Error) return err.message;
  return "Failed to load jobs";
}

/** Server returns `data: Job[]`; to be safe handle raw arrays and empty payloads. */
function normalizeJobs(payload: unknown): Job[] {
  const data = unwrap<unknown>(payload);
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Job =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string",
  );
}

function formatSeconds(total: number): string {
  const totalSec = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function truncateUrl(url: string, max = 42): string {
  try {
    const u = new URL(url);
    const s = `${u.host}${u.pathname}`;
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return url.length > max ? `${url.slice(0, max)}…` : url;
  }
}

function statusLabel(status?: string): string {
  return STATUS_LABELS[status ?? ""] ?? status ?? "Unknown";
}

function statusBadgeClass(status?: string): string {
  return STATUS_CLASS[status ?? ""] ?? "bg-white/[0.05] text-text-muted border border-border";
}

function jobStep(job: Job): string | undefined {
  return job.currentStep ?? job.step ?? job.current_step;
}

function currentStepLabel(step?: string): string {
  return STEP_LABELS[step ?? ""] ?? (step ?? "—");
}

function formatEta(etaSeconds?: number): string {
  if (etaSeconds === undefined || etaSeconds === null || Number.isNaN(etaSeconds)) return "—";
  if (etaSeconds <= 0) return "Done";
  return `ends in ${formatSeconds(etaSeconds)}`;
}

function jobSource(job: Job): string {
  return job.sourceUrl ?? job.inputUrl ?? "";
}

function jobProgress(job: Job): number {
  const value = Number(job.progress);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function elapsedSeconds(job: Job): number {
  if (job.status !== "running" || !job.updatedAt) return 0;
  const diff = Date.now() - new Date(job.updatedAt).getTime();
  if (!Number.isFinite(diff)) return 0;
  return Math.max(0, Math.floor(diff / 1000));
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function JobTracker() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const payload = await apiClient.get<unknown>(JOBS_URL);
      setJobs(normalizeJobs(payload));
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---- polling (every 4s) + visibility auto-refresh ---- */

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      if (!alive) return;
      if (typeof document !== "undefined" && document.hidden) return;
      await refresh();
    };

    void refresh();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  /* ---- derived ---- */

  const visibleJobs = useMemo(() => {
    if (filter === "all") return jobs;
    return jobs.filter((j: Job) => j.status === filter);
  }, [jobs, filter]);

  const hasJobs = jobs.length > 0;
  const updatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : "—";

  /* ---------- render ---------- */

  return (
    <div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text">Job Tracker</h1>
          <p className="text-sm text-text-muted">
            Live pipeline progress — refreshed every 4 s
            {hasJobs ? ` · ${jobs.length} job${jobs.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex gap-2 self-end sm:self-start">
          <button
            type="button"
            onClick={() => void refresh()}
            className="glass inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition duration-150 hover:border-[var(--border-accent)] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] motion-reduce:transition-none"
          >
            {loading ? <Spinner size={16} /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          <button
            type="button"
            onClick={() => (window.location.href = "/studio")}
            className="glass inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition duration-150 hover:border-[var(--border-accent)] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] motion-reduce:transition-none"
          >
            <Play className="h-4 w-4" />
            Studio
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--glow-danger)] bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-[color-mix(in_srgb,var(--danger)_75%,white)]">
          <XCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="cursor-pointer text-xs font-semibold underline underline-offset-2 transition duration-150 hover:text-[var(--danger)]"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && !hasJobs && (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface/60 p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-muted shadow-[0_0_16px_var(--glow-soft)]">
            <Cpu className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-text">No jobs yet</h2>
          <p className="mt-1 text-sm text-text-muted">
            Your pipeline is idle. Create a video in{" "}
            <button
              type="button"
              className="cursor-pointer font-medium text-accent transition duration-150 hover:text-[color-mix(in_srgb,var(--accent)_80%,white)] hover:drop-shadow-[0_0_6px_var(--glow)]"
              onClick={() => (window.location.href = "/studio")}
            >
              Studio
            </button>{" "}
            to get started.
          </p>
        </div>
      )}

      {loading && (
        <div className="mt-6 rounded-2xl border border-border bg-surface/60 p-6">
          <Skeleton className="h-6 w-24" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border p-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-2 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && error === null && hasJobs && (
        <>
          {/* Filter tabs */}
          <div
            className="mt-6 flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1 text-sm"
            role="tablist"
            aria-label="Job status filter"
          >
            {FILTERS.map((f) => {
              const count =
                f.key === "all" ? jobs.length : jobs.filter((j: Job) => j.status === f.key).length;
              return (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={filter === f.key}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 font-medium text-sm transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] motion-reduce:transition-none ${
                    filter === f.key
                      ? "bg-[var(--gradient-accent)] text-[#04121a] shadow-[0_0_12px_var(--glow-soft)]"
                      : "text-text-muted hover:text-text"
                  }`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className={`ml-1.5 text-xs ${filter === f.key ? "text-[#04121a]/70" : "text-[var(--text-faint)]"}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {visibleJobs.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center text-sm text-text-muted">
              No {filter} jobs right now.
            </div>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleJobs.map((job: Job) => {
                const isRunning = job.status === "running";
                const step = jobStep(job);
                const source = jobSource(job);
                const progress = jobProgress(job);
                const elapsed = elapsedSeconds(job);
                const provider = job.provider ?? null;

                return (
                  <article
                    key={job.id}
                    className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] transition duration-200 hover:border-[var(--border-accent-soft)] hover:shadow-[var(--shadow-card-hover)] motion-reduce:transition-none"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent shadow-[0_0_12px_var(--glow-soft)]">
                          <Clock className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-[var(--text-faint)]">Job {job.id.slice(0, 8)}</p>
                          <h2 className="truncate text-sm font-semibold text-text">
                            {source ? truncateUrl(source) : "Untitled render"}
                          </h2>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(job.status)}`}
                      >
                        {statusLabel(job.status)}
                      </span>
                    </div>

                    {step && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                        <span
                          className={`inline-flex h-2 w-2 rounded-full ${
                            isRunning
                              ? "bg-accent shadow-[0_0_8px_var(--glow)] animate-pulse motion-reduce:animate-none"
                              : "bg-white/20"
                          }`}
                        />
                        <span className="flex items-center gap-1">
                          {currentStepLabel(step)}
                          {isRunning && <span className="ml-1 text-accent">● running</span>}
                        </span>
                      </div>
                    )}

                    {/* Progress */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-text-muted">
                        <span>Progress</span>
                        <span className="font-mono text-accent">{progress}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-2)_0%,var(--accent)_100%)] shadow-[0_0_12px_var(--glow)] transition-all duration-700 motion-reduce:transition-none"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* ETA / elapsed */}
                    <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatEta(job.etaSeconds)}</span>
                      {isRunning && elapsed > 0 && (
                        <>
                          <span className="text-[var(--text-faint)]">·</span>
                          <span className="text-[var(--text-faint)]">{formatSeconds(elapsed)} ago</span>
                        </>
                      )}
                    </div>

                    {job.error && (
                      <p className="mt-2 line-clamp-2 rounded-lg bg-[rgba(239,68,68,0.1)] px-2 py-1.5 text-xs text-[color-mix(in_srgb,var(--danger)_75%,white)]">
                        {job.error}
                      </p>
                    )}

                    {/* Provider */}
                    {provider && (provider.name || provider.externalId) && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                        <Cpu className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {[provider.name, provider.externalId].filter(Boolean).join(" · ")}
                        </span>
                        {provider.status && (
                          <span
                            className={`ml-auto text-[10px] font-medium uppercase tracking-wide ${
                              provider.status === "ready"
                                ? "text-[var(--success)]"
                                : "text-[var(--warning)]"
                            }`}
                          >
                            {provider.status}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-auto flex gap-2 pt-3">
                      <button
                        type="button"
                        className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-text-muted transition duration-150 hover:border-[var(--border-accent)] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] motion-reduce:transition-none"
                        onClick={() => (window.location.href = `/logs/${job.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                        <span className="hidden sm:inline">View logs</span>
                        <span className="sm:hidden">Logs</span>
                      </button>
                      <a
                        href={`/studio/job/${job.id}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[linear-gradient(100deg,var(--accent)_0%,var(--accent-2)_100%)] px-3 py-2 text-sm font-semibold text-[#04121a] shadow-[0_0_16px_rgba(0,240,255,0.18)] transition duration-150 hover:shadow-[var(--shadow-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] motion-reduce:transition-none"
                      >
                        <Play className="h-4 w-4" />
                        <span className="hidden sm:inline">Open studio</span>
                        <span className="sm:hidden">Studio</span>
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <p className="mt-4 font-mono text-xs text-[var(--text-faint)]">
            Updated {updatedLabel} · polling every 4 s
          </p>
        </>
      )}
    </div>
  );
}

export default JobTracker;
