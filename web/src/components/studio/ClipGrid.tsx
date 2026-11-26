"use client";

import { motion } from "framer-motion";
import type { PublicClip } from "@shared/studio-contract";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";
import ClipCard from "./ClipCard";

/** Poster-shaped skeleton shown while clips are still rendering. */
function ClipSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[var(--surface)]">
      <div
        className="animate-pulse"
        style={{
          aspectRatio: "9 / 16",
          background:
            "linear-gradient(110deg, rgba(148,163,184,0.08) 30%, rgba(148,163,184,0.16) 50%, rgba(148,163,184,0.08) 70%)",
        }}
      />
      <div className="border-t border-white/5 p-2">
        <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
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
    <section aria-label="Klip hasil" aria-busy={loading}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Klip kamu
        </h2>
        <span className="text-[11px] text-slate-500">
          {clips.length} siap
          {skeletons > 0 && loading ? ` · ${skeletons} diproses` : ""}
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
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center">
          <p className="text-sm font-medium text-slate-300">Belum ada klip.</p>
          <p className="mt-1 text-xs text-slate-500">
            Pipeline selesai tanpa menghasilkan klip — coba video lain atau naikkan jumlah klip.
          </p>
        </div>
      )}
    </section>
  );
}
