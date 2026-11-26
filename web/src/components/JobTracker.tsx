"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Play, Eye, XCircle, Cpu, RefreshCw } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";

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
  queued: "bg-amber-100 text-amber-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-600",
  timeout: "bg-rose-100 text-rose-700",
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
  return STATUS_CLASS[status ?? ""] ?? "bg-slate-100 text-slate-600";
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
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Job Tracker</h1>
          <p className="text-sm text-slate-500">
            Live pipeline progress — refreshed every 4 s
            {hasJobs ? ` · ${jobs.length} job${jobs.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex gap-2 self-end sm:self-start">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => (window.location.href = "/studio")}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Play className="h-4 w-4" />
            Studio
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <XCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs font-semibold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && !hasJobs && (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Cpu className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-800">No jobs yet</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your pipeline is idle. Create a video in{" "}
            <button
              type="button"
              className="font-medium text-indigo-600 hover:text-indigo-500"
              onClick={() => (window.location.href = "/studio")}
            >
              Studio
            </button>{" "}
            to get started.
          </p>
        </div>
      )}

      {loading && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="h-6 w-24 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-5">
                <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                <div className="mt-3 h-2 rounded-full bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && error === null && hasJobs && (
        <>
          {/* Filter tabs */}
          <div
            className="mt-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm"
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
                  className={`rounded-lg px-3 py-1.5 font-medium text-sm transition ${
                    filter === f.key
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="ml-1.5 text-xs text-slate-400">{count}</span>
                </button>
              );
            })}
          </div>

          {visibleJobs.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
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
                    className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                          <Clock className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400">Job {job.id.slice(0, 8)}</p>
                          <h2 className="truncate text-sm font-semibold text-slate-800">
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
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <span
                          className={`inline-flex h-2 w-2 rounded-full ${
                            isRunning ? "bg-indigo-500" : "bg-slate-300"
                          }`}
                        />
                        <span className="flex items-center gap-1">
                          {currentStepLabel(step)}
                          {isRunning && <span className="ml-1 text-indigo-500">● running</span>}
                        </span>
                      </div>
                    )}

                    {/* Progress */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* ETA / elapsed */}
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatEta(job.etaSeconds)}</span>
                      {isRunning && elapsed > 0 && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-400">{formatSeconds(elapsed)} ago</span>
                        </>
                      )}
                    </div>

                    {job.error && (
                      <p className="mt-2 line-clamp-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-600">
                        {job.error}
                      </p>
                    )}

                    {/* Provider */}
                    {provider && (provider.name || provider.externalId) && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <Cpu className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {[provider.name, provider.externalId].filter(Boolean).join(" · ")}
                        </span>
                        {provider.status && (
                          <span
                            className={`ml-auto text-[10px] font-medium uppercase tracking-wide ${
                              provider.status === "ready"
                                ? "text-emerald-600"
                                : "text-amber-600"
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
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                        onClick={() => (window.location.href = `/logs/${job.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                        <span className="hidden sm:inline">View logs</span>
                        <span className="sm:hidden">Logs</span>
                      </button>
                      <a
                        href={`/studio/job/${job.id}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
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

          <p className="mt-4 text-xs text-slate-400">
            Updated {updatedLabel} · polling every 4 s
          </p>
        </>
      )}
    </div>
  );
}

export default JobTracker;
