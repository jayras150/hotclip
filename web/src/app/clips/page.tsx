"use client";

import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Film, Inbox, RefreshCw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { ClipGallery } from "@/components/ClipGallery";
import { JobTracker } from "@/components/JobTracker";

interface JobSummary {
  id: string;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export default function MyClipsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ data: Array<{ id: string }> }>("/api/v1/jobs");
      const list = Array.isArray(response?.data) ? response.data.filter((job) => Boolean(job?.id)) : [];
      setJobs(list);
      setSelectedJobId((current) => {
        if (current && list.some((job) => job.id === current)) {
          return current;
        }
        return list[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      // Best-effort: the page still renders the job tracker without a selection.
      setError(err instanceof Error ? err.message : "Unable to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const hasJobs = jobs.length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)]">
            <Clapperboard className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text">My Clips</h1>
            <p className="mt-0.5 text-sm text-text-muted">
              Browse the clips rendered by each job and track the pipeline in real time.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadJobs()}
          disabled={loading}
          className="btn self-start sm:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          <span>{loading ? "Refreshing…" : "Refresh"}</span>
        </button>
      </header>

      {/* Job selector */}
      <section aria-label="Job selection" className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <label
              htmlFor="job-select"
              className="text-xs font-semibold uppercase tracking-wider text-text-muted"
            >
              Job
            </label>
            <p className="mt-0.5 text-sm text-text-muted">
              {loading
                ? "Loading jobs…"
                : hasJobs
                  ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} available`
                  : "No jobs available yet"}
            </p>
          </div>
          <select
            id="job-select"
            value={selectedJobId ?? ""}
            onChange={(event) => setSelectedJobId(event.target.value || null)}
            disabled={!hasJobs}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-text outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-72"
          >
            {!hasJobs && <option value="">No jobs</option>}
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                Job {shortId(job.id)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-amber-200"
        >
          Showing cached results — {error}
        </div>
      )}

      {/* Clip gallery */}
      <section aria-labelledby="clip-gallery-heading" className="mt-8">
        <h2 id="clip-gallery-heading" className="sr-only">
          Clip gallery
        </h2>
        {selectedJobId ? (
          <ClipGallery jobId={selectedJobId} />
        ) : (
          <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-muted">
              <Inbox className="h-6 w-6" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-text">No clips to show</h3>
            <p className="mt-1 text-sm text-text-muted">
              Create a render in the{" "}
              <a href="/" className="font-medium text-[var(--primary)] hover:underline">
                Studio
              </a>{" "}
              to start generating clips.
            </p>
          </div>
        )}
      </section>

      {/* Job tracker */}
      <section aria-labelledby="job-tracker-heading" className="mt-12">
        <div className="mb-4 flex items-center gap-2">
          <Film className="h-5 w-5 text-text-muted" aria-hidden="true" />
          <h2 id="job-tracker-heading" className="text-xl font-bold tracking-tight text-text">
            All jobs
          </h2>
        </div>
        <JobTracker />
      </section>

    </div>
  );
}
