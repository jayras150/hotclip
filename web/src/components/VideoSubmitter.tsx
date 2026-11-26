"use client";

import {
  useId,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  Ban,
  Captions,
  ChevronDown,
  Clock,
  FileText,
  FileVideo,
  Gauge,
  Layers,
  Link2,
  Loader2,
  Monitor,
  Smartphone,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface VideoSubmitterProps {
  onSubmitted?: (jobId: string) => void;
}

type SourceMode = "url" | "upload";
type Phase = "idle" | "presigning" | "uploading" | "creating";

interface CreateJobResponse {
  id?: string;
  jobId?: string;
  status?: string;
}

interface PresignResponse {
  uploadUrl: string;
  objectKey: string;
  method?: string;
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

const RATIOS = [
  { value: "9:16", label: "9:16", hint: "Vertical", Icon: Smartphone },
  { value: "1:1", label: "1:1", hint: "Square", Icon: Square },
  { value: "16:9", label: "16:9", hint: "Landscape", Icon: Monitor },
] as const;

type Ratio = (typeof RATIOS)[number]["value"];

const SUBTITLE_PRESETS = [
  { value: "none", label: "None", hint: "Fastest", description: "No captions added.", Icon: Ban },
  {
    value: "burned-in",
    label: "Burned-in",
    hint: "Most viral",
    description: "Captions baked into the frame.",
    Icon: Captions,
  },
  {
    value: "soft",
    label: "Soft",
    hint: "Toggleable",
    description: "Separate, editable subtitle track.",
    Icon: FileText,
  },
] as const;

type SubtitlePreset = (typeof SUBTITLE_PRESETS)[number]["value"];

const RESOLUTIONS = [
  { value: "720p", label: "720p", rate: 0.5, hint: "Fastest" },
  { value: "1080p", label: "1080p", rate: 0.75, hint: "Recommended" },
  { value: "4k", label: "4K", rate: 1, hint: "Max detail" },
] as const;

type Resolution = (typeof RESOLUTIONS)[number]["value"];

const MAX_CLIP_OPTIONS = [3, 5, 8, 10] as const;

const GPU_OVERHEAD_CREDITS = 10;
const SUBTITLE_CREDITS = 5;
const CREDIT_TO_IDR = 15_000;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatIdr(amount: number): string {
  return new Intl.NumberFormat("id-ID").format(amount);
}

function isValidSourceUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function detectSourceLabel(value: string): string | null {
  if (!isValidSourceUrl(value)) return null;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) {
      return "YouTube";
    }
    if (host === "b23.tv" || host === "bilibili.com" || host.endsWith(".bilibili.com")) {
      return "Bilibili";
    }
    return "Direct video";
  } catch {
    return null;
  }
}

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
  return "Something went wrong while starting the render. Please try again.";
}

async function createJob(payload: Record<string, unknown>): Promise<string> {
  const response = await apiClient.post<unknown>("/api/v1/jobs", payload);
  const job = unwrap<CreateJobResponse | null>(response);
  const jobId = job?.id ?? job?.jobId;
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("The server did not return a job id.");
  }
  return jobId;
}

async function presignUpload(fileName: string, contentType: string): Promise<PresignResponse> {
  const response = await apiClient.post<unknown>("/api/v1/uploads/presign", {
    fileName,
    contentType,
  });
  const presign = unwrap<PresignResponse | null>(response);
  if (
    !presign ||
    typeof presign.uploadUrl !== "string" ||
    typeof presign.objectKey !== "string"
  ) {
    throw new Error("Could not prepare the upload. Please try again.");
  }
  return presign;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function VideoSubmitter({ onSubmitted }: VideoSubmitterProps) {
  const uid = useId();
  const urlId = `${uid}-url`;
  const fileId = `${uid}-file`;
  const sourceHeadingId = `${uid}-source-heading`;
  const ratioHeadingId = `${uid}-ratio-heading`;
  const subtitleHeadingId = `${uid}-subtitle-heading`;
  const durationId = `${uid}-duration`;
  const resolutionId = `${uid}-resolution`;
  const maxClipsId = `${uid}-max-clips`;

  const [sourceMode, setSourceMode] = useState<SourceMode>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [subtitlePreset, setSubtitlePreset] = useState<SubtitlePreset>("burned-in");
  const [duration, setDuration] = useState(90);
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [maxClips, setMaxClips] = useState<number>(5);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";
  const sourceLabel = detectSourceLabel(url.trim());

  const resolutionEntry = RESOLUTIONS.find((entry) => entry.value === resolution);
  const resolutionRate = resolutionEntry?.rate ?? 0.75;
  const resolutionLabel = resolutionEntry?.label ?? "1080p";
  const renderCredits = resolutionRate * duration;
  const subtitleCredits = subtitlePreset === "none" ? 0 : SUBTITLE_CREDITS;
  const totalCredits = Math.round(renderCredits + subtitleCredits + GPU_OVERHEAD_CREDITS);
  const totalIdr = totalCredits * CREDIT_TO_IDR;

  const subtitleLabel =
    SUBTITLE_PRESETS.find((entry) => entry.value === subtitlePreset)?.label ?? "None";

  const submitLabel =
    phase === "presigning"
      ? "Preparing upload…"
      : phase === "uploading"
        ? "Uploading video…"
        : phase === "creating"
          ? "Queuing render…"
          : "Start Render";

  function switchMode(mode: SourceMode) {
    setSourceMode(mode);
    setError(null);
  }

  function acceptFile(picked: File) {
    const looksLikeVideo =
      picked.type.startsWith("video/") ||
      /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(picked.name);
    if (!looksLikeVideo) {
      setError("Please choose a video file (MP4, MOV, WebM, …).");
      return;
    }
    setFile(picked);
    setError(null);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (picked) acceptFile(picked);
    // Allow re-selecting the same file after removing it.
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  }

  function removeFile() {
    setFile(null);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    try {
      let jobId: string;

      if (sourceMode === "url") {
        const sourceUrl = url.trim();
        if (!isValidSourceUrl(sourceUrl)) {
          setError("Enter a valid YouTube, Bilibili, or direct video URL (https://…).");
          return;
        }

        setPhase("creating");
        jobId = await createJob({
          sourceUrl,
          ratio,
          subtitlePreset,
          maxClips,
        });
      } else {
        if (!file) {
          setError("Choose a video file before starting the render.");
          return;
        }

        const contentType = file.type || "video/mp4";

        setPhase("presigning");
        const presign = await presignUpload(file.name, contentType);

        setPhase("uploading");
        const uploadResponse = await fetch(presign.uploadUrl, {
          method: presign.method ?? "PUT",
          body: file,
          headers: { "Content-Type": contentType },
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed (${uploadResponse.status} ${uploadResponse.statusText}).`);
        }

        setPhase("creating");
        jobId = await createJob({
          sourceFile: presign.objectKey,
          presignedUrl: presign.uploadUrl,
          ratio,
          subtitlePreset,
          maxClips,
        });
      }

      setUrl("");
      setFile(null);
      onSubmitted?.(jobId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhase("idle");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={busy}
      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)]"
    >
      {/* Card header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm"
            style={{ backgroundImage: "linear-gradient(135deg, var(--primary), var(--sky))" }}
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">
              Render a new video
            </h2>
            <p className="text-xs text-slate-500">
              Pick a source, choose a format, and let the pipeline do the cutting.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--mint)]" />
          Vast.ai GPU
        </span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---------------------------- Left: form ---------------------------- */}
        <div className="space-y-7 p-5 sm:p-7">
          {/* Source */}
          <section aria-labelledby={sourceHeadingId}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id={sourceHeadingId}
                className="text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Source
              </h3>
              <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Source type">
                <button
                  type="button"
                  onClick={() => switchMode("url")}
                  aria-pressed={sourceMode === "url"}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    sourceMode === "url"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Link
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("upload")}
                  aria-pressed={sourceMode === "upload"}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    sourceMode === "upload"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload
                </button>
              </div>
            </div>

            {sourceMode === "url" ? (
              <>
                <label htmlFor={urlId} className="sr-only">
                  Video URL
                </label>
                <div className="relative mt-3">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id={urlId}
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    value={url}
                    onChange={(event: { target: { value: string } }) => setUrl(event.target.value)}
                    disabled={busy}
                    placeholder="https://youtube.com/watch?v=…"
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {sourceLabel ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                      Detected: {sourceLabel}
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      Works with YouTube, Bilibili, or a direct video link.
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div
                  onDragOver={(event: { preventDefault(): void }) => {
                    event.preventDefault();
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  className={`mt-3 rounded-2xl border-2 border-dashed px-4 py-6 transition focus-within:ring-2 focus-within:ring-indigo-200 ${
                    dragging
                      ? "border-[var(--primary)] bg-indigo-50/70"
                      : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50"
                  } ${busy ? "opacity-70" : ""}`}
                >
                  <input
                    id={fileId}
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange}
                    disabled={busy}
                    className="sr-only"
                  />
                  {file ? (
                    <div className="flex w-full items-center gap-3 text-left">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--primary)] shadow-sm">
                        <FileVideo className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{file.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{formatFileSize(file.size)}</p>
                      </div>
                      <label
                        htmlFor={fileId}
                        className={`shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 ${
                          busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                        }`}
                      >
                        Replace
                      </label>
                      <button
                        type="button"
                        onClick={removeFile}
                        disabled={busy}
                        aria-label="Remove selected file"
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <label
                      htmlFor={fileId}
                      className={`flex w-full flex-col items-center justify-center text-center ${
                        busy ? "cursor-not-allowed" : "cursor-pointer"
                      }`}
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                        <Upload className="h-5 w-5" />
                      </span>
                      <span className="mt-3 text-sm font-semibold text-slate-700">
                        Drop a video here or browse
                      </span>
                      <span className="mt-1 text-xs text-slate-400">
                        MP4, MOV, WebM or other video files
                      </span>
                    </label>
                  )}
                </div>
              </>
            )}
          </section>

          <div className="h-px bg-slate-100" />

          {/* Ratio */}
          <section aria-labelledby={ratioHeadingId}>
            <h3
              id={ratioHeadingId}
              className="text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Aspect ratio
            </h3>
            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby={ratioHeadingId}>
              {RATIOS.map(({ value, label, hint, Icon }) => {
                const active = ratio === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setRatio(value)}
                    disabled={busy}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center transition disabled:cursor-not-allowed ${
                      active
                        ? "border-[var(--primary)] bg-indigo-50/70 text-slate-900 ring-1 ring-[var(--primary)]"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${active ? "text-[var(--primary)]" : "text-slate-400"}`} />
                    <span className="text-sm font-semibold">{label}</span>
                    <span className="text-[11px] text-slate-500">{hint}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Subtitles */}
          <section aria-labelledby={subtitleHeadingId}>
            <h3
              id={subtitleHeadingId}
              className="text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Subtitles
            </h3>
            <div
              className="mt-3 grid gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-labelledby={subtitleHeadingId}
            >
              {SUBTITLE_PRESETS.map(({ value, label, hint, description, Icon }) => {
                const active = subtitlePreset === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSubtitlePreset(value)}
                    disabled={busy}
                    className={`rounded-xl border px-3 py-3 text-left transition disabled:cursor-not-allowed ${
                      active
                        ? "border-[var(--primary)] bg-indigo-50/70 ring-1 ring-[var(--primary)]"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon
                        className={`h-4 w-4 ${active ? "text-[var(--primary)]" : "text-slate-400"}`}
                      />
                      <span className="text-sm font-semibold text-slate-800">{label}</span>
                      <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {hint}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                      {description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Duration + resolution */}
          <section>
            <div className="flex items-center justify-between">
              <label
                htmlFor={durationId}
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                <Clock className="h-3.5 w-3.5" />
                Duration
              </label>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                {formatDuration(duration)}
              </span>
            </div>
            <input
              id={durationId}
              type="range"
              min={30}
              max={600}
              step={15}
              value={duration}
              onChange={(event: { target: { value: string } }) => setDuration(Number(event.target.value))}
              disabled={busy}
              style={{ accentColor: "var(--primary)" }}
              className="mt-3 h-2 w-full cursor-pointer rounded-full disabled:cursor-not-allowed"
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-400">
              <span>30s</span>
              <span>10m</span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={resolutionId}
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"
                >
                  <Gauge className="h-3.5 w-3.5" />
                  Resolution
                </label>
                <div className="relative mt-2">
                  <select
                    id={resolutionId}
                    value={resolution}
                    onChange={(event: { target: { value: string } }) => setResolution(event.target.value as Resolution)}
                    disabled={busy}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-800 transition focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                  >
                    {RESOLUTIONS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label} · {entry.hint}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              <div>
                <label
                  htmlFor={maxClipsId}
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"
                >
                  <Layers className="h-3.5 w-3.5" />
                  Max clips
                </label>
                <div className="relative mt-2">
                  <select
                    id={maxClipsId}
                    value={maxClips}
                    onChange={(event: { target: { value: string } }) => setMaxClips(Number(event.target.value))}
                    disabled={busy}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-800 transition focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                  >
                    {MAX_CLIP_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {count} clips
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ---------------------------- Right: cost --------------------------- */}
        <aside className="border-t border-slate-200 bg-slate-50/70 p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div className="lg:sticky lg:top-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                <Gauge className="h-4 w-4" />
              </span>
              Cost estimate
            </h3>

            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">GPU overhead</dt>
                <dd className="font-medium text-slate-800">+{GPU_OVERHEAD_CREDITS} credits</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">
                  Render · {resolutionLabel} × {formatDuration(duration)}
                </dt>
                <dd className="font-medium text-slate-800">{renderCredits.toFixed(2)} credits</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Subtitles · {subtitleLabel}</dt>
                <dd className="font-medium text-slate-800">
                  {subtitleCredits > 0 ? `+${subtitleCredits} credits` : "Included"}
                </dd>
              </div>
            </dl>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Total
                </span>
                <span className="text-2xl font-bold tracking-tight text-slate-900">
                  {totalCredits}
                  <span className="ml-1 text-xs font-semibold text-slate-500">credits</span>
                </span>
              </div>
              <p className="mt-1 text-right text-sm font-semibold text-[var(--mint)]">
                Rp {formatIdr(totalIdr)}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:brightness-100"
              style={{
                backgroundImage: "linear-gradient(120deg, var(--primary), var(--sky))",
              }}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {submitLabel}
            </button>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
              Estimate only — the final charge depends on the actual render duration.
            </p>
          </div>
        </aside>
      </div>
    </form>
  );
}

export default VideoSubmitter;
