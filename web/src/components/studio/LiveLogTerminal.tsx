"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { WorkerLogEntry } from "@shared/studio-contract";
import { cn } from "@/lib/cn";
import { getJobLogs, logsStreamUrl } from "@/lib/public-api";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

const MAX_LINES = 500;
const POLL_INTERVAL_MS = 2000;

const MONO_STACK = 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)';

const LEVEL_CLASS: Record<string, string> = {
  debug: "text-slate-500",
  info: "text-[var(--accent)]",
  warn: "text-amber-300",
  error: "text-[var(--danger)]",
  stage: "font-bold text-[var(--success)]",
};

const EASE = [0.22, 1, 0.36, 1] as const;

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-US", { hour12: false });
}

interface LiveLogTerminalProps {
  jobId: string;
  /** Optional external log buffer (e.g. from polling) to seed the view. */
  seed?: WorkerLogEntry[];
  defaultOpen?: boolean;
}

/**
 * Live worker log. Primary transport is `GET /logs/:jobId` over SSE
 * (EventSource — it cannot send `x-client-session`, so the backend's
 * `hc_session` cookie carries the session). If SSE fails we fall back to
 * polling `GET /api/v1/public/jobs/:id/logs?after=N` every 2 s.
 */
export default function LiveLogTerminal({ jobId, seed, defaultOpen = true }: LiveLogTerminalProps) {
  const [entries, setEntries] = useState<WorkerLogEntry[]>(seed ?? []);
  const [open, setOpen] = useState(defaultOpen);
  const [transport, setTransport] = useState<"sse" | "poll" | "idle">("idle");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const lastIdRef = useRef(0);

  const reduced = usePrefersReducedMotion();

  const append = useCallback((incoming: WorkerLogEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((current) => {
      const seen = new Set(current.map((e) => e.id));
      const merged = [...current];
      for (const entry of incoming) {
        if (!seen.has(entry.id)) merged.push(entry);
      }
      merged.sort((a, b) => a.id - b.id);
      const trimmed = merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
      const latest = trimmed[trimmed.length - 1];
      if (latest && latest.id > lastIdRef.current) lastIdRef.current = latest.id;
      return trimmed;
    });
  }, []);

  /* ------------------------------ SSE ------------------------------ */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.EventSource !== "function") {
      setTransport("poll");
      return;
    }

    let source: EventSource | null = null;
    let disposed = false;

    try {
      source = new EventSource(logsStreamUrl(jobId, lastIdRef.current), {
        withCredentials: true,
      });
    } catch {
      setTransport("poll");
      return;
    }

    source.onopen = () => {
      if (!disposed) setTransport("sse");
    };

    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as WorkerLogEntry | WorkerLogEntry[];
        append(Array.isArray(payload) ? payload : [payload]);
      } catch {
        /* heartbeat or non-JSON frame */
      }
    };

    // The backend may name the event or send plain `message` frames.
    source.onmessage = handleEvent;
    source.addEventListener("log", handleEvent as EventListener);
    source.addEventListener("logs", handleEvent as EventListener);

    source.onerror = () => {
      if (disposed) return;
      // EventSource auto-reconnects on transient errors; only downgrade to
      // polling once the connection is fully closed.
      if (source && source.readyState === EventSource.CLOSED) {
        setTransport("poll");
      }
    };

    return () => {
      disposed = true;
      source?.close();
    };
  }, [jobId, append]);

  /* ----------------------------- Polling --------------------------- */
  useEffect(() => {
    if (transport === "sse") return;
    const controller = new AbortController();
    let cancelled = false;

    const tick = async () => {
      try {
        const batch = await getJobLogs(jobId, lastIdRef.current, controller.signal);
        if (!cancelled && Array.isArray(batch)) append(batch);
      } catch {
        /* backend may not have logs yet — keep polling silently */
      }
    };

    void tick();
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [jobId, transport, append]);

  /* --------------------------- Auto-scroll ------------------------- */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !open) return;
    if (pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [entries, open]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
  }, []);

  const transportLabel =
    transport === "sse" ? "stream" : transport === "poll" ? "polling" : "connecting";

  return (
    <section
      aria-label="Worker log"
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[var(--bg)]/90 shadow-[0_8px_32px_rgba(0,0,0,0.55)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 border-b border-white/5 px-4 py-2.5 text-left outline-none transition hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Terminal className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Live log
        </span>
        <span
          className="relative ml-1 flex h-1.5 w-1.5"
          aria-hidden="true"
        >
          {transport === "sse" && !reduced && (
            <motion.span
              className="absolute inset-0 rounded-full bg-[var(--success)]"
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 2.6 }}
              transition={{ repeat: Infinity, duration: 1.8, ease: "easeOut" }}
            />
          )}
          <span
            className={cn(
              "relative h-1.5 w-1.5 rounded-full",
              transport === "sse"
                ? "bg-[var(--success)]"
                : transport === "poll"
                  ? "bg-amber-400"
                  : "bg-slate-600",
            )}
          />
        </span>
        <span className="text-[10px] text-slate-500">{transportLabel}</span>
        <span className="ml-auto text-[10px] tabular-nums text-slate-600">
          {entries.length} lines
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="terminal-body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="relative overflow-hidden"
          >
            {/* Subtle scanline overlay */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)",
                maskImage: "linear-gradient(to bottom, black, transparent 85%)",
                WebkitMaskImage: "linear-gradient(to bottom, black, transparent 85%)",
              }}
            />

            <div
              ref={scrollRef}
              onScroll={onScroll}
              aria-live="polite"
              aria-atomic="false"
              className="relative max-h-64 overflow-y-auto px-3 py-2 text-[11px] leading-relaxed"
              style={{ fontFamily: MONO_STACK }}
            >
              {entries.length === 0 ? (
                <p className="px-1 py-2 text-slate-600">Waiting for logs from the worker…</p>
              ) : (
                <ol className="space-y-0.5">
                  {entries.map((entry) => (
                    <li key={entry.id} className="flex gap-2 whitespace-pre-wrap break-words">
                      <span className="shrink-0 text-slate-600">{timeLabel(entry.createdAt)}</span>
                      {entry.stage && (
                        <span className="shrink-0 rounded bg-white/5 px-1 text-[10px] uppercase text-slate-400">
                          {entry.stage}
                        </span>
                      )}
                      <span className={cn(LEVEL_CLASS[entry.level] ?? "text-slate-300")}>
                        {entry.message}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {/* Blinking cursor */}
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1 inline-block h-3.5 w-1.5 bg-[var(--accent)] align-middle",
                  !reduced && "anim-cursor-blink",
                )}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
