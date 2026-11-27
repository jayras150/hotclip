"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { PublicClip } from "@shared/studio-contract";
import { cn } from "@/lib/cn";
import { copyText, clipCaptionText, useToast } from "./ClipCard";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/* Karaoke caption — evenly distributed active-word sweep driven by    */
/* `timeupdate`. We never receive real per-word timings from the      */
/* backend, so the highlight sweeps through the words linearly across */
/* the clip duration. Reduced-motion users get a static full caption. */
/* ------------------------------------------------------------------ */

function KaraokeCaption({
  text,
  videoRef,
  durationSec,
  reducedMotion,
}: {
  text: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  durationSec: number;
  reducedMotion: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reducedMotion || words.length === 0) {
      setActiveIndex(reducedMotion ? -2 : -1);
      return;
    }

    const update = () => {
      const time = video.currentTime;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationSec;
      if (duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, time / duration));
      setActiveIndex(Math.min(words.length - 1, Math.floor(ratio * words.length)));
    };

    update();
    video.addEventListener("timeupdate", update);
    return () => video.removeEventListener("timeupdate", update);
  }, [videoRef, durationSec, reducedMotion, words.length]);

  return (
    <p
      aria-label={`Caption: ${text}`}
      className="text-center text-lg font-extrabold leading-snug sm:text-xl"
    >
      {words.map((word, index) => {
        const active = activeIndex === index;
        return (
          <span
            key={`${word}-${index}`}
            aria-hidden="true"
            className={cn("mx-[0.12em] inline-block", active ? "text-white" : "text-white/55")}
            style={
              reducedMotion
                ? undefined
                : {
                    opacity: active ? 1 : 0.55,
                    transform: active ? "scale(1.08)" : "scale(1)",
                    filter: active
                      ? "drop-shadow(0 0 12px rgba(0, 240, 255, 0.9))"
                      : "none",
                    transition: "opacity 160ms ease, transform 160ms ease, filter 160ms ease",
                  }
            }
          >
            {word}
          </span>
        );
      })}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog body (clip is guaranteed non-null here)                      */
/* ------------------------------------------------------------------ */

function PreviewDialog({ clip, onClose }: { clip: PublicClip; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const { toast, toastNode } = useToast();
  const [reducedMotion, setReducedMotion] = useState(false);

  // Escape-to-close + focus trap + scroll lock.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);

    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Simple focus trap: keep Tab cycling inside the dialog.
  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: EASE }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[#02030a]/80 backdrop-blur-md"
      />

      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clip-preview-title"
        aria-label={`Preview ${clip.title}`}
        onKeyDown={trapFocus}
        initial={reducedMotion ? false : { opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reducedMotion ? undefined : { opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="glass glow-border relative z-10 flex w-full max-w-sm flex-col overflow-hidden rounded-[var(--radius-2xl)] shadow-[0_24px_80px_rgba(0,0,0,0.75)]"
      >
        {/* Video */}
        <div className="relative bg-black" style={{ aspectRatio: "9 / 16" }}>
          <video
            ref={videoRef}
            src={clip.mediaUrl}
            poster={clip.thumbnailUrl}
            className="h-full w-full object-contain"
            controls
            autoPlay
            playsInline
          />
          <div className="pointer-events-none absolute inset-x-3 bottom-14 rounded-[var(--radius-md)] border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-sm">
            <KaraokeCaption
              text={clip.caption || clip.title}
              videoRef={videoRef}
              durationSec={clip.durationSec}
              reducedMotion={reducedMotion}
            />
          </div>
        </div>

        {/* Meta */}
        <div className="flex-1 space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2
              id="clip-preview-title"
              className="font-[family-name:var(--font-display)] text-sm font-bold leading-snug text-[var(--text)]"
            >
              {clip.title}
            </h2>
            <span className="shrink-0 rounded-full border border-transparent bg-[linear-gradient(100deg,var(--accent),var(--accent-2))] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#04121a]">
              {Math.round(clip.score)}
            </span>
          </div>

          {clip.caption && (
            <p className="line-clamp-3 text-xs leading-relaxed text-[var(--text-muted)]">
              {clip.caption}
            </p>
          )}

          {clip.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {clip.hashtags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]"
                >
                  {tag.startsWith("#") ? tag : `#${tag}`}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <motion.a
              href={clip.mediaUrl}
              download={`${clip.title.replace(/[^\w\s-]/g, "").trim() || "hotclip"}.mp4`}
              whileHover={{ y: reducedMotion ? 0 : -1.5 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 py-2.5 text-xs font-bold text-[#04121a] outline-none shadow-[0_0_20px_var(--glow-soft)] transition-shadow duration-200 hover:shadow-[var(--shadow-glow)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
              style={{
                backgroundImage: "linear-gradient(100deg, var(--accent), var(--accent-2))",
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download MP4
            </motion.a>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(clipCaptionText(clip));
                toast(ok ? "Caption + hashtags copied" : "Copy failed");
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-transparent px-3 py-2.5 text-xs font-semibold text-[var(--text)] outline-none transition duration-150 hover:border-[var(--glow)] hover:text-[var(--accent)] hover:shadow-[0_0_16px_var(--glow-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Copy caption
            </button>
          </div>
        </div>

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-black/60 text-white outline-none backdrop-blur transition duration-150 hover:border-[var(--glow)] hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </motion.div>

      {toastNode}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

interface ClipPreviewModalProps {
  clip: PublicClip | null;
  onClose: () => void;
}

export default function ClipPreviewModal({ clip, onClose }: ClipPreviewModalProps) {
  return (
    <AnimatePresence>
      {clip && <PreviewDialog key={clip.id} clip={clip} onClose={onClose} />}
    </AnimatePresence>
  );
}
