"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ClipboardPaste,
  FileVideo,
  Link2,
  Loader2,
  UploadCloud,
  X,
  Youtube,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { SourcePreview, PublicLimits } from "@shared/studio-contract";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";
import {
  PublicApiError,
  createUploadTarget,
  ensureSession,
  formatBytes,
  formatDuration,
  isValidVideoUrl,
  previewSource,
  uploadFile,
  type UploadHandle,
} from "@/lib/public-api";

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

export type SourceKind = "url" | "file";

export interface SourceSelection {
  kind: SourceKind;
  url?: string;
  uploadKey?: string;
  fileName?: string;
  fileSize?: number;
  preview?: SourcePreview;
}

interface SourceInputProps {
  limits: PublicLimits;
  value: SourceSelection | null;
  onChange: (selection: SourceSelection | null) => void;
  disabled?: boolean;
}

type UrlStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; preview: SourcePreview }
  | { state: "error"; message: string };

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; percent: number; fileName: string; fileSize: number }
  | { phase: "done"; uploadKey: string; fileName: string; fileSize: number }
  | { phase: "error"; message: string };

const DEBOUNCE_MS = 600;
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".webm"];

const SPRING = { type: "spring", stiffness: 380, damping: 32 } as const;
const SOFT_SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type) ||
    ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

/* ------------------------------------------------------------------ */
/* Tabs (local fallback — the shared Tabs primitive may not exist yet) */
/* ------------------------------------------------------------------ */

function ModeTabs({
  active,
  onChange,
  disabled,
  reduced,
}: {
  active: SourceKind;
  onChange: (kind: SourceKind) => void;
  disabled?: boolean;
  reduced: boolean;
}) {
  const tabs: { kind: SourceKind; label: string; Icon: typeof Youtube }[] = [
    { kind: "url", label: "YouTube URL", Icon: Youtube },
    { kind: "file", label: "Upload Video", Icon: UploadCloud },
  ];

  return (
    <div
      role="tablist"
      aria-label="Video source"
      className="relative grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1"
    >
      {tabs.map(({ kind, label, Icon }) => {
        const selected = active === kind;
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(kind)}
            className={cn(
              "relative inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50",
              selected ? "text-white" : "text-slate-400 hover:text-slate-200",
            )}
          >
            {selected && (
              <motion.span
                layoutId={reduced ? undefined : "hc-source-tab"}
                aria-hidden="true"
                className="absolute inset-0 rounded-lg border border-[var(--accent)]/25 bg-white/10 shadow-[0_0_18px_var(--glow-soft)]"
                transition={SPRING}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function SourceInput({ limits, value, onChange, disabled }: SourceInputProps) {
  const [mode, setMode] = useState<SourceKind>("url");
  const [urlDraft, setUrlDraft] = useState(value?.url ?? "");
  const [urlStatus, setUrlStatus] = useState<UrlStatus>({ state: "idle" });
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadHandleRef = useRef<UploadHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reduced = usePrefersReducedMotion();

  /* -------------------- Debounced URL preview -------------------- */
  useEffect(() => {
    if (mode !== "url") return; // keep the URL selection alive while on the file tab

    const trimmed = urlDraft.trim();
    if (trimmed.length === 0) {
      setUrlStatus({ state: "idle" });
      return;
    }
    if (!isValidVideoUrl(trimmed)) {
      setUrlStatus({ state: "error", message: "Enter a valid URL (http/https)." });
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setUrlStatus({ state: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        await ensureSession(); // first-interaction silent session
        const preview = await previewSource(trimmed, controller.signal);
        setUrlStatus({ state: "ready", preview });
        onChange({
          kind: "url",
          url: trimmed,
          preview,
        });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        const message =
          error instanceof PublicApiError
            ? error.status === 0
              ? error.message
              : `Preview failed: ${error.message}`
            : "Preview failed. Try again.";
        setUrlStatus({ state: "error", message });
        onChange(null);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // onChange intentionally excluded — parent callback is stable per render
    // cycle and re-running on its identity would retrigger the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDraft, mode]);

  /* -------------------- Upload flow -------------------- */
  const startUpload = useCallback(
    async (file: File) => {
      if (file.size > limits.maxUploadBytes) {
        setUpload({
          phase: "error",
          message: `File size exceeds the ${formatBytes(limits.maxUploadBytes)} limit.`,
        });
        return;
      }
      setUpload({ phase: "uploading", percent: 0, fileName: file.name, fileSize: file.size });
      try {
        await ensureSession();
        const target = await createUploadTarget({
          fileName: file.name,
          contentType: file.type || "video/mp4",
          sizeBytes: file.size,
        });
        const handle = uploadFile(file, target, (percent) => {
          setUpload((current) =>
            current.phase === "uploading" ? { ...current, percent } : current,
          );
        });
        uploadHandleRef.current = handle;
        const uploadKey = await handle.promise;
        setUpload({
          phase: "done",
          uploadKey,
          fileName: file.name,
          fileSize: file.size,
        });
        onChange({
          kind: "file",
          uploadKey,
          fileName: file.name,
          fileSize: file.size,
        });
      } catch (error) {
        if (error instanceof PublicApiError && error.code === "UPLOAD_ABORTED") {
          setUpload({ phase: "idle" });
          onChange(null);
          return;
        }
        setUpload({
          phase: "error",
          message: error instanceof PublicApiError ? error.message : "Upload failed.",
        });
        onChange(null);
      }
    },
    [limits.maxUploadBytes, onChange],
  );

  const cancelUpload = useCallback(() => {
    uploadHandleRef.current?.abort();
    uploadHandleRef.current = null;
    setUpload({ phase: "idle" });
    onChange(null);
  }, [onChange]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setUrlDraft("");
    setUrlStatus({ state: "idle" });
    setUpload({ phase: "idle" });
    onChange(null);
  }, [onChange]);

  /* -------------------- Clipboard paste -------------------- */
  const pasteFromClipboard = useCallback(async () => {
    setPasteError(null);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
        throw new Error("unsupported");
      }
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        setPasteError("Clipboard is empty.");
        return;
      }
      if (!isValidVideoUrl(trimmed)) {
        setPasteError("Clipboard does not contain a valid video URL.");
        return;
      }
      setUrlDraft(trimmed);
    } catch {
      setPasteError("Clipboard permission denied. Paste manually with Ctrl+V.");
    }
  }, []);

  const hasSelection = value !== null;

  /* ---------------------------------------------------------------- */
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur sm:p-5">
      <ModeTabs active={mode} onChange={setMode} disabled={disabled} reduced={reduced} />

      <div className="mt-4" role="tabpanel">
        {/* ------------------------- URL mode ------------------------- */}
        {mode === "url" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="hc-source-url" className="block text-xs font-medium text-slate-300">
                Video URL
              </label>
              <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 outline-none transition hover:bg-white/10 hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
              >
                <ClipboardPaste className="h-3 w-3" aria-hidden="true" />
                Paste from clipboard
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 transition-colors focus-within:border-[var(--accent)]/60">
              <Link2 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <input
                id="hc-source-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://www.youtube.com/watch?v=..."
                value={urlDraft}
                disabled={disabled}
                onChange={(e) => setUrlDraft(e.target.value)}
                className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-slate-600"
              />
              {urlStatus.state === "loading" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" aria-hidden="true" />
              )}
              {urlDraft.length > 0 && !disabled && (
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Clear link"
                  className="rounded p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {pasteError && (
              <p role="alert" className="mt-1.5 text-[11px] text-amber-300">
                {pasteError}
              </p>
            )}

            {/* Preview / error card */}
            <div aria-live="polite" className="mt-3">
              <AnimatePresence mode="wait" initial={false}>
                {urlStatus.state === "error" && (
                  <motion.div
                    key="url-error"
                    initial={reduced ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, y: -6 }}
                    transition={SOFT_SPRING}
                    className="flex items-start gap-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-xs text-rose-200"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {urlStatus.message}
                  </motion.div>
                )}

                {urlStatus.state === "ready" && (
                  <motion.div
                    key="url-ready"
                    initial={reduced ? false : { opacity: 0, scale: 0.96, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, scale: 0.98, y: -4 }}
                    transition={SOFT_SPRING}
                    className="flex items-stretch gap-3 overflow-hidden rounded-xl border border-white/10 bg-black/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={urlStatus.preview.thumbnail}
                      alt=""
                      className="h-20 w-36 shrink-0 object-cover"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1 py-2 pr-3">
                      <p className="truncate text-sm font-semibold text-white">
                        {urlStatus.preview.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {urlStatus.preview.author ? `${urlStatus.preview.author} · ` : ""}
                        {formatDuration(urlStatus.preview.durationSec)}
                      </p>
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        Ready to process
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* ------------------------ File mode ------------------------- */}
        {mode === "file" && (
          <div>
            <div className="relative">
              {/* Rotating conic-gradient ring, only while dragging */}
              <AnimatePresence>
                {dragOver && !reduced && (
                  <motion.div
                    key="drag-ring"
                    aria-hidden="true"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, rotate: 360 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      opacity: { duration: 0.2 },
                      rotate: { repeat: Infinity, duration: 8, ease: "linear" },
                    }}
                    className="pointer-events-none absolute -inset-[2px] z-0 rounded-xl opacity-90 blur-[1px]"
                    style={{
                      padding: "2px",
                      background:
                        "conic-gradient(from 0deg, transparent 0deg, var(--accent) 90deg, var(--accent-2) 180deg, transparent 300deg)",
                      WebkitMask:
                        "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                      WebkitMaskComposite: "xor",
                      maskComposite: "exclude",
                    }}
                  />
                )}
              </AnimatePresence>

              <button
                type="button"
                aria-label="Upload video: drag a file here or press Enter to select"
                onClick={() => !disabled && fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (!file || disabled) return;
                  if (!isAcceptedFile(file)) {
                    setUpload({
                      phase: "error",
                      message: "Unsupported format. Use MP4, MOV, or WebM.",
                    });
                    return;
                  }
                  void startUpload(file);
                }}
                className={cn(
                  "relative z-10 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  dragOver
                    ? "border-[var(--accent)]/70 bg-[var(--accent)]/10"
                    : "border-white/15 bg-black/20 hover:border-white/30",
                )}
              >
                <UploadCloud
                  className={cn(
                    "h-8 w-8 transition-colors",
                    dragOver ? "text-[var(--accent)]" : "text-slate-400",
                  )}
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-slate-200">
                  Drag &amp; drop video, or click to select
                </p>
                <p className="text-xs text-slate-500">
                  MP4, MOV, WebM · max {formatBytes(limits.maxUploadBytes)}
                </p>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                className="sr-only"
                disabled={disabled}
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void startUpload(file);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Upload progress / result */}
            <div aria-live="polite" className="mt-3">
              <AnimatePresence mode="wait" initial={false}>
                {upload.phase === "error" && (
                  <motion.div
                    key="upload-error"
                    initial={reduced ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, y: -6 }}
                    transition={SOFT_SPRING}
                    className="flex items-start gap-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-xs text-rose-200"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {upload.message}
                  </motion.div>
                )}

                {(upload.phase === "uploading" || upload.phase === "done") && (
                  <motion.div
                    key="upload-progress"
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, y: -6 }}
                    transition={SOFT_SPRING}
                    className="rounded-xl border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <FileVideo className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200">
                        {upload.fileName} · {formatBytes(upload.fileSize)}
                      </span>
                      {upload.phase === "uploading" ? (
                        <button
                          type="button"
                          onClick={cancelUpload}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-rose-300 transition hover:bg-[var(--danger)]/15"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                          Cancel
                        </button>
                      ) : (
                        <span className="rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          Done
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
                      role="progressbar"
                      aria-valuenow={upload.phase === "uploading" ? upload.percent : 100}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <motion.div
                        className="h-full rounded-full"
                        initial={false}
                        animate={{
                          width: `${upload.phase === "uploading" ? upload.percent : 100}%`,
                        }}
                        transition={reduced ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }}
                        style={{
                          backgroundImage:
                            "linear-gradient(90deg, var(--accent-2), var(--accent))",
                          boxShadow: "0 0 12px var(--glow-soft)",
                        }}
                      />
                    </div>
                    {upload.phase === "uploading" && (
                      <p className="mt-1 text-right text-[10px] tabular-nums text-slate-500">
                        {upload.percent}% sent
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasSelection && (
          <motion.p
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="mt-3 overflow-hidden text-[11px] text-slate-500"
          >
            Source ready — set options below, then hit Create Shorts.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
