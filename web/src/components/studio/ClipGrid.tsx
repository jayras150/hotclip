"use client";

import { motion } from "framer-motion";
import type { PublicClip } from "@shared/studio-contract";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";
import { Skeleton } from "@/components/ui/skeleton";
import ClipCard from "./ClipCard";

/** Poster-shaped skeleton shown while clips are still rendering. */
function ClipSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: "9 / 16",
          background:
            "linear-gradient(110deg, rgba(148,163,184,0.08) 30%, rgba(148,163,184,0.16) 50%, rgba(148,163,184,0.08) 70%)",
        }}
      >
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--border)] p-1.5">
        <Skeleton className="h-6 flex-1 rounded-[var(--radius-sm)]" />
        <Skeleton className="h-6 flex-1 rounded-[var(--radius-sm)]" />
      </div>
    </div>
  );
}

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 260, damping: 26 },
  },
} as const;

interface ClipGridProps {
  clips: PublicClip[];
  loading: boolean;
  expectedCount: number;
  onOpen: (clip: PublicClip) => void;
  onToast: (message: string) => void;
}

export default function ClipGrid({
  clips,
  loading,
  expectedCount,
  onOpen,
  onToast,
}: ClipGridProps) {
  const skeletons = Math.max(0, Math.min(expectedCount, 10) - clips.length);
  const reduced = usePrefersReducedMotion();

  return (
    <section aria-label="Generated clips" aria-busy={loading}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Your Clips
        </h2>
        <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
          {clips.length} ready
          {skeletons > 0 && loading ? ` · ${skeletons} processing` : ""}
        </span>
      </div>

      <motion.div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        variants={reduced ? undefined : containerVariants}
        initial={reduced ? false : "hidden"}
        animate={reduced ? undefined : "show"}
      >
        {clips.map((clip, index) => (
          <motion.div key={clip.id} variants={reduced ? undefined : itemVariants}>
            <ClipCard
              clip={clip}
              index={index}
              onOpen={onOpen}
              onToast={onToast}
            />
          </motion.div>
        ))}
        {loading &&
          Array.from({ length: skeletons }).map((_, index) => (
            <ClipSkeleton key={`skeleton-${index}`} />
          ))}
      </motion.div>

      {!loading && clips.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] bg-white/[0.03] p-8 text-center">
          <p className="text-sm font-medium text-[var(--text)]">No clips yet.</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            The pipeline finished without producing clips — try another video or increase the number of clips.
          </p>
        </div>
      )}
    </section>
  );
}
