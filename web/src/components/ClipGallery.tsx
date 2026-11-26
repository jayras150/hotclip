"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Play,
  Download,
  Trash2,
  TrendingUp,
  CheckCircle,
  XCircle,
  RefreshCw,
  Video,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Clip {
  id: string;
  jobId?: string;
  /** Human readable clip name (overrides auto-derived name). */
  name?: string;
  /** Direct media object URL (proxy/ingest bucket). */
  mediaUrl?: string;
  /** Locally generated preview URL for the viewer. */
  previewUrl?: string;
  /** Display resolution, e.g. "1920x1080". */
  resolution?: string;
  width?: number;
  height?: number;
  duration?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  /** Viral score (0-100). Also exposed as `score`. */
  viralScore?: number;
  score?: number;
  /** Render / processing state at the clip level. */
  status?: "ready" | "processing" | "failed";
  subtitleBurned?: boolean;
  position?: number;
  objectKey?: string;
  createdAt?: string;
}

type ClipStatusFilter = "all" | "ready" | "processing" | "failed";
type SortKey = "viral" | "newest" | "oldest";

interface ToastState {
  visible: boolean;
  message: string;
  type: "success" | "error";
}

interface ClipGalleryProps {
  jobId?: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const FILTERS: { key: ClipStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "processing", label: "Processing" },
  { key: "failed", label: "Failed" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "viral", label: "Viral ↑" },
  { key: "newest", label: "Newest →" },
  { key: "oldest", label: "Oldest ←" },
];

const POLL_INTERVAL_MS = 4000;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Envelope-tolerant: accepts `{ ok, data }`, `{ data }`, or a raw value. */
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
  return "Request failed";
}

function normalizeClips(payload: unknown): Clip[] {
  const data = unwrap<unknown>(payload);
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Clip =>
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

function statusLabel(status?: string): string {
  if (status === "ready") return "Ready";
  if (status === "processing") return "Processing";
  if (status === "failed") return "Failed";
  return status ?? "Ready";
}

function clipStatus(clip: Clip): ClipStatusFilter {
  if (clip.status === "processing") return "processing";
  if (clip.status === "failed") return "failed";
  // Media rows from the API represent finished clips.
  return "ready";
}

function basename(value?: string): string {
  if (!value) return "";
  try {
    const u = new URL(value);
    return u.pathname.split("/").pop() ?? "";
  } catch {
    const parts = value.split(/[/\\]/);
    return parts[parts.length - 1] ?? "";
  }
}

function deriveName(clip: Clip): string {
  const custom = clip.name?.trim();
  if (custom) return custom;
  const base = basename(clip.mediaUrl ?? clip.objectKey)?.replace(/\.[^.]+$/, "");
  if (base) return base.length > 46 ? `${base.slice(0, 46)}…` : base;
  if (typeof clip.position === "number") return `Clip ${clip.position + 1}`;
  return `Clip ${clip.id.slice(0, 8)}`;
}

function clipResolution(clip: Clip): string {
  if (clip.resolution) return clip.resolution;
  if (clip.width && clip.height) return `${clip.width}x${clip.height}`;
  return "—";
}

function viralScore(clip: Clip): number {
  const candidates = [clip.viralScore, clip.score];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.min(100, Math.max(0, Math.round(value)));
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Viral score ring (3 segments: 0-33 low, 34-66 mid, 67-100 hot)      */
/* ------------------------------------------------------------------ */

interface ViralScoreRingProps {
  score: number;
  size?: number;
}

function ViralScoreRing({ score, size = 72 }: ViralScoreRingProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const radius = 15.9155; // 2 * pi * r = 100
  const segments: Array<{ from: number; to: number; color: string; label: string }> = [
    { from: 0, to: 33, color: "#10b981", label: "LOW" },
    { from: 33, to: 66, color: "#f59e0b", label: "MID" },
    { from: 66, to: 100, color: "#f43f5e", label: "HOT" },
  ];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        className="shrink-0"
        role="img"
        aria-label="Viral score ring"
      >
        {/* Track */}
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-slate-100"
        />
        {segments.map((seg) => {
          const len = seg.to - seg.from;
          return (
            <circle
              key={seg.label}
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              strokeWidth="2.5"
              stroke={seg.color}
              strokeDasharray={`${len} 100`}
              strokeDashoffset={-seg.from}
              strokeLinecap="round"
              transform="rotate(-90 18 18)"
            />
          );
        })}
      </svg>
      <div className="text-center">
        <span className="text-lg font-bold leading-none text-slate-800">{clamped}</span>
        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          viral
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function ClipGallery({ jobId }: ClipGalleryProps) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ClipStatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("viral");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "", type: "success" });

  const canLoad = Boolean(jobId);
  const clipsUrl = jobId ? `/api/v1/jobs/${jobId}/clips` : "";

  const showToast = useCallback((message: string, type: ToastState["type"]) => {
    setToast({ visible: true, message, type });
  }, []);

  /* ---- fetch clips (poll every 4s while visible) ---- */

  const load = useCallback(async (): Promise<void> => {
    if (!jobId) return;
    try {
      const payload = await apiClient.get<unknown>(`/api/v1/jobs/${jobId}/clips`);
      setClips(normalizeClips(payload));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) {
      setClips([]);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    void load();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (alive) void load();
    }, POLL_INTERVAL_MS);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [jobId, load]);

  /* ---- toast auto-dismiss ---- */
  useEffect(() => {
    if (!toast.visible) return;
    const id = window.setTimeout(() => setToast((t: ToastState) => ({ ...t, visible: false })), 3000);
    return () => window.clearTimeout(id);
  }, [toast.visible]);

  /* ---- derived ---- */
  const filtered = useMemo(() => {
    let list = clips.filter((c: Clip) => clipStatus(c) === filter || filter === "all");
    if (sortBy === "viral") {
      list = [...list].sort((a: Clip, b: Clip) => viralScore(b) - viralScore(a));
    } else if (sortBy === "newest") {
      list = [...list].sort((a: Clip, b: Clip) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
      );
    } else {
      list = [...list].sort((a: Clip, b: Clip) =>
        String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
      );
    }
    return list;
  }, [clips, filter, sortBy]);

  const totalViral = useMemo(
    () => clips.reduce((sum: number, c: Clip) => sum + viralScore(c), 0),
    [clips],
  );
  const avgViral = clips.length ? Math.round(totalViral / clips.length) : 0;

  /* ---- actions ---- */

  const handleDownload = async (clip: Clip): Promise<void> => {
    if (!jobId || savingId) return;
    try {
      setSavingId(clip.id);
      const payload = await apiClient.get<unknown>(
        `/api/v1/jobs/${jobId}/clips/${clip.id}/download`,
      );
      const data = unwrap<{ downloadUrl?: string; url?: string } | null>(payload);
      const downloadUrl =
        (typeof data?.downloadUrl === "string" && data.downloadUrl) ||
        (typeof data?.url === "string" && data.url) ||
        clip.mediaUrl ||
        "";
      if (!downloadUrl) throw new Error("No download URL was returned for this clip.");
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
      showToast("Download started", "success");
    } catch (err) {
      const fallback = clip.mediaUrl;
      if (fallback) {
        window.open(fallback, "_blank", "noopener,noreferrer");
        showToast("Opened clip preview", "success");
      } else {
        showToast(errorMessage(err), "error");
      }
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (clip: Clip): Promise<void> => {
    if (!jobId || savingId) return;
    if (!window.confirm("Delete this clip?")) return;
    try {
      setSavingId(clip.id);
      // Stub endpoint: the API may not expose deletion yet.
      await apiClient.post<unknown>(`/api/v1/jobs/${jobId}/clips/${clip.id}/delete`, {});
      setClips((prev: Clip[]) => prev.filter((c: Clip) => c.id !== clip.id));
      showToast("Clip deleted", "success");
    } catch (err) {
      showToast(errorMessage(err), "error");
    } finally {
      setSavingId(null);
    }
  };

  const handleReexport = async (clip: Clip): Promise<void> => {
    if (!jobId || savingId) return;
    try {
      setSavingId(clip.id);
      // Stub endpoint: the API may not expose re-export yet.
      await apiClient.post<unknown>(`/api/v1/jobs/${jobId}/clips/${clip.id}/reexport`, {});
      showToast("Re-export started", "success");
      await load();
    } catch (err) {
      showToast(errorMessage(err), "error");
    } finally {
      setSavingId(null);
    }
  };

  /* ---------- render ---------- */

  if (!jobId) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Video className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-800">No job selected</h2>
        <p className="mt-1 text-sm text-slate-500">
          Pick a job to see its clips. Open{" "}
          <button
            type="button"
            className="font-medium text-indigo-600 hover:text-indigo-500"
            onClick={() => (window.location.href = "/studio")}
          >
            Studio
          </button>{" "}
          to start a new render.
        </p>
      </div>
    );
  }

  return (
    <div>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Clip Gallery</h1>
          <p className="text-sm text-slate-500">
            {clips.length} clip{clips.length !== 1 ? "s" : ""} · viral avg{" "}
            <span className="font-semibold text-slate-700">{avgViral}</span>
          </p>
        </div>
        <div className="flex gap-2 self-end sm:self-start">
          <button
            type="button"
            onClick={() => void load()}
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

      {/* Filter + sort */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm"
          role="tablist"
          aria-label="Clip status filter"
        >
          {FILTERS.map((f) => (
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
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              className={`rounded-lg px-3 py-1.5 font-medium text-sm transition ${
                sortBy === s.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              onClick={() => setSortBy(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Viral summary */}
      {clips.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-6">
          <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-sm">
            <TrendingUp className="h-5 w-5 text-indigo-500" />
            <div>
              <p className="text-xs text-slate-400">Average viral score</p>
              <p className="text-xl font-bold text-slate-800">{avgViral}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-sm">
            <Play className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="text-xs text-slate-400">Total clips</p>
              <p className="text-xl font-bold text-slate-800">{clips.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && error === null && filtered.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Video className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-800">
            {clips.length === 0 ? "No clips yet" : "No clips match this filter"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {clips.length === 0
              ? "This job has no clips yet. The list refreshes automatically every 4 s."
              : "Try a different status filter."}
          </p>
        </div>
      )}

      {loading && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="rounded-2xl border border-slate-200 p-3">
              <div className="h-32 animate-pulse rounded-xl bg-slate-200" />
              <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-2 rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {!loading && error === null && filtered.length > 0 && (
        <div
          className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          role="list"
        >
          {filtered.map((clip: Clip) => {
            const viral = viralScore(clip);
            const status = clipStatus(clip);
            const src = clip.previewUrl ?? clip.mediaUrl;
            const name = deriveName(clip);
            const busy = savingId === clip.id;

            return (
              <article
                key={clip.id}
                className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md"
              >
                {/* Preview */}
                <div className="relative overflow-hidden rounded-xl bg-slate-100">
                  {src ? (
                    <video
                      className="h-32 w-full object-cover transition group-hover:scale-[1.02]"
                      src={src}
                      poster={src}
                      controls
                      preload="metadata"
                      aria-label={`Preview of ${name}`}
                    />
                  ) : (
                    <div className="flex h-32 w-full items-center justify-center text-xs text-slate-400">
                      <Video className="h-6 w-6" />
                    </div>
                  )}
                  <span
                    className={`absolute left-2 top-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      status === "ready"
                        ? "bg-emerald-500/15 text-emerald-600"
                        : status === "processing"
                          ? "bg-blue-500/15 text-blue-600"
                          : "bg-rose-500/15 text-rose-600"
                    }`}
                  >
                    {statusLabel(status)}
                  </span>
                </div>

                {/* Meta */}
                <h3 className="mt-2 truncate text-sm font-semibold text-slate-800">{name}</h3>
                <p className="text-xs text-slate-400">
                  {formatSeconds(clip.duration ?? 0)} · {clipResolution(clip)} ·{" "}
                  {clip.subtitleBurned ? "subtitle baked" : "no subtitles"}
                </p>

                {/* Viral score */}
                <div className="mt-3 flex items-center justify-between">
                  <ViralScoreRing score={viral} />
                  <span className="text-xs font-semibold text-slate-600">{viral}</span>
                </div>

                {/* Actions */}
                <div className="mt-auto flex gap-1.5 pb-2">
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleDownload(clip)}
                    disabled={busy}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {busy ? "…" : "Download"}
                  </button>
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleReexport(clip)}
                    disabled={busy}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {busy ? "…" : "Re-export"}
                  </button>
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-medium text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleDelete(clip)}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="mt-2 text-indigo-600 underline underline-offset-2"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Toast */}
      {toast.visible && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
              toast.type === "success" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

export default ClipGallery;
