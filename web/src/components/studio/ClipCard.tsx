"use client";

import { useCallback, useRef, useState } from "react";
import { Copy, Download, Flame, Play } from "lucide-react";
import { motion, useSpring } from "framer-motion";
import type { PublicClip } from "@shared/studio-contract";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/public-api";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

/* ------------------------------------------------------------------ */
/* Small toast — local, so the studio never depends on a global Toaster */
/* ------------------------------------------------------------------ */

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const toast = useCallback((next: string) => {
    setMessage(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setMessage(null), 2200);
  }, []);

  const node = message ? (
    <div
      role="status"
      aria-live="polite"
      className="anim-slide-up-in pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/15 bg-[var(--surface)]/95 px-4 py-2 text-xs font-medium text-white shadow-[var(--shadow-card)] backdrop-blur"
    >
      {message}
    </div>
  ) : null;

  return { toast, toastNode: node };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function clipCaptionText(clip: PublicClip): string {
  const tags = clip.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
  return [clip.caption, tags].filter(Boolean).join("\n\n");
}

/* ------------------------------------------------------------------ */

interface ClipCardProps {
  clip: PublicClip;
  index: number;
  onOpen: (clip: PublicClip) => void;
  onToast: (message: string) => void;
}

const TILT_SPRING = { stiffness: 260, damping: 26, mass: 0.4 } as const;

export default function ClipCard({ clip, index, onOpen, onToast }: ClipCardProps) {
  const [copied, setCopied] = useState(false);
  const reduced = usePrefersReducedMotion();

  const rotateX = useSpring(0, TILT_SPRING);
  const rotateY = useSpring(0, TILT_SPRING);

  const handleTilt = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (reduced) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      rotateY.set(x * 9);
      rotateX.set(-y * 9);
    },
    [reduced, rotateX, rotateY],
  );

  const resetTilt = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
  }, [rotateX, rotateY]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(clipCaptionText(clip));
    onToast(ok ? "Caption copied" : "Caption copy failed");
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [clip, onToast]);

  const hotScore = clip.score >= 85;

  const scoreBadge = (
    <>
      <Flame className="h-3 w-3" aria-hidden="true" />
      <span className="tabular-nums">{Math.round(clip.score)}</span>
    </>
  );

  return (
    <article className="group relative" data-index={index}>
      <motion.div
        onMouseMove={handleTilt}
        onMouseLeave={resetTilt}
        whileHover={reduced ? undefined : { y: -6 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        style={
          reduced
            ? undefined
            : { rotateX, rotateY, transformPerspective: 900, transformStyle: "preserve-3d" }
        }
        className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] transition-[border-color,box-shadow,transform] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:border-[var(--accent)]/50 group-hover:shadow-[0_0_24px_var(--glow-soft),var(--shadow-card)]"
      >
        {/* Poster */}
        <div className="relative" style={{ aspectRatio: "9 / 16" }}>
          {clip.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clip.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : clip.previewUrl ? (
            <video
              src={clip.previewUrl}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background:
                  "linear-gradient(160deg, rgba(0,240,255,0.35), rgba(59,130,246,0.3) 55%, rgba(16,185,129,0.25))",
              }}
            />
          )}

          {/* Badges */}
          <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between">
            {hotScore && !reduced ? (
              <motion.span
                className="inline-flex items-center gap-1 rounded-full border border-[var(--success)]/40 bg-[color-mix(in_srgb,var(--success)_22%,transparent)] px-2 py-0.5 text-[11px] font-bold text-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.35)] backdrop-blur"
                animate={{ scale: [1, 1.07, 1], opacity: [1, 0.88, 1] }}
                transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
              >
                {scoreBadge}
              </motion.span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums backdrop-blur",
                  hotScore
                    ? "border-[var(--success)]/40 bg-[color-mix(in_srgb,var(--success)_22%,transparent)] text-emerald-300"
                    : "border-transparent bg-[linear-gradient(100deg,rgba(0,240,255,0.9),rgba(59,130,246,0.9))] text-[#04121a]",
                )}
              >
                {scoreBadge}
              </span>
            )}
            <span className="rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/90 backdrop-blur">
              {formatDuration(clip.durationSec)}
            </span>
          </div>

          {/* Play overlay */}
          <button
            type="button"
            onClick={() => onOpen(clip)}
            aria-label={`Preview ${clip.title}`}
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 outline-none transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur transition-transform duration-200 group-hover:scale-110">
              <Play className="ml-0.5 h-5 w-5 text-white" aria-hidden="true" />
            </span>
          </button>

          {/* Caption strip */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2.5">
            <p className="line-clamp-2 text-xs font-semibold leading-snug text-white">
              {clip.title}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 border-t border-[var(--border)] bg-white/[0.02] p-1.5">
          <a
            href={clip.mediaUrl}
            download={`${clip.title.replace(/[^\w\s-]/g, "").trim() || "hotclip"}.mp4`}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-[linear-gradient(100deg,var(--accent),var(--accent-2))] px-2 py-1.5 text-[11px] font-semibold text-[#04121a] outline-none transition duration-150 hover:shadow-[0_0_14px_var(--glow-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            MP4
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5 text-[11px] font-semibold outline-none transition duration-150 hover:border-[var(--glow)] hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              copied ? "text-emerald-300" : "text-[var(--text-muted)] hover:text-[var(--text)]",
            )}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied ? "Copied" : "Caption"}
          </button>
          <button
            type="button"
            onClick={() => onOpen(clip)}
            aria-label={`Open ${clip.title}`}
            className="inline-flex items-center justify-center rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-muted)] outline-none transition duration-150 hover:bg-white/[0.06] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </article>
  );
}
