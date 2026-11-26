"use client";

import { useCallback, useEffect, useState } from "react";
import type { AspectRatio, AiModules } from "@shared/studio-contract";
import { DEFAULT_AI_MODULES, isAspectRatio, clampClipCount } from "@shared/studio-contract";

/* ------------------------------------------------------------------ */
/* Generic localStorage-backed state (SSR-safe, never throws)          */
/* ------------------------------------------------------------------ */

export function useStoredState<T>(
  key: string,
  fallback: T,
  validate: (value: unknown) => T | null,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = validate(JSON.parse(raw) as unknown);
        if (parsed !== null) setValue(parsed);
      }
    } catch {
      /* corrupted storage — keep the fallback */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage full or blocked — state stays in memory */
      }
    },
    [key],
  );

  return [hydrated ? value : fallback, update];
}

/* ------------------------------------------------------------------ */
/* Studio options (clip count / aspect ratio / AI modules)             */
/* ------------------------------------------------------------------ */

export interface StudioSettings {
  clipCount: number;
  aspectRatio: AspectRatio;
  modules: AiModules;
}

function validateClipCount(value: unknown): number | null {
  return typeof value === "number" ? clampClipCount(value) : null;
}

function validateRatio(value: unknown): AspectRatio | null {
  return isAspectRatio(value) ? value : null;
}

function validateModules(value: unknown): AiModules | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  return {
    faceTracking: typeof raw.faceTracking === "boolean" ? raw.faceTracking : true,
    karaokeAss: typeof raw.karaokeAss === "boolean" ? raw.karaokeAss : true,
    hookScore: typeof raw.hookScore === "boolean" ? raw.hookScore : true,
  };
}

export function useClipCount(): [number, (n: number) => void] {
  return useStoredState<number>("hc_clip_count", 3, validateClipCount);
}

export function useAspectRatio(): [AspectRatio, (r: AspectRatio) => void] {
  return useStoredState<AspectRatio>("hc_aspect_ratio", "9:16", validateRatio);
}

export function useAiModules(): [AiModules, (m: AiModules) => void] {
  return useStoredState<AiModules>("hc_ai_modules", { ...DEFAULT_AI_MODULES }, validateModules);
}

/* ------------------------------------------------------------------ */
/* Recent jobs (localStorage strip so a reload keeps context)          */
/* ------------------------------------------------------------------ */

export interface RecentJobEntry {
  jobId: string;
  title: string;
  status: string;
  createdAt: string;
}

export function useRecentJobs(): [
  RecentJobEntry[],
  (entry: RecentJobEntry) => void,
] {
  const [entries, setEntries] = useStoredState<RecentJobEntry[]>(
    "hc_recent_jobs",
    [],
    (value) => (Array.isArray(value) ? (value as RecentJobEntry[]) : null),
  );

  const push = useCallback(
    (entry: RecentJobEntry) => {
      setEntries([entry, ...entries.filter((e) => e.jobId !== entry.jobId)].slice(0, 8));
    },
    [entries, setEntries],
  );

  return [entries, push];
}
