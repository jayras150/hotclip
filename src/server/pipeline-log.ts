/**
 * Pipeline log + stage helpers shared by the public studio router and the
 * Vast.ai orchestrator.
 *
 * Every public job writes two things so the studio stays meaningful:
 *   1. `jobs.stage` + `jobs.progress` (0-100) — the coarse state machine.
 *   2. `worker_logs` rows — the append-only stream replayed by SSE/JSON.
 *
 * Writes are best-effort: a logging failure must never break the pipeline.
 * The sink is injected (`PipelineLogSink`) so unit tests run with an in-memory
 * recorder instead of PostgREST.
 */

import type { LogLevel, PipelineStage } from "../shared/studio-contract";
import type { PublicStore } from "./public-store";

/** Minimal sink the orchestrator needs; `PublicStore` implements it. */
export interface PipelineLogSink {
  appendLog(entry: {
    jobId: string;
    clientSessionId: string | null;
    level: LogLevel;
    stage: PipelineStage | null;
    message: string;
    instanceId?: string | null;
  }): Promise<void>;
  patchJob(
    jobId: string,
    patch: {
      stage?: PipelineStage;
      progress?: number;
      status?: "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";
      error?: string;
    },
  ): Promise<void>;
}

export interface EmitLogOptions {
  sink?: PipelineLogSink;
  instanceId?: string | null;
}

function toSink(sink: PipelineLogSink | PublicStore | undefined): PipelineLogSink | undefined {
  return sink as PipelineLogSink | undefined;
}

/**
 * Append one `worker_logs` row. Never throws — a broken sink is reported to
 * the console once per call and otherwise ignored.
 */
export async function emitLog(
  jobId: string,
  clientSessionId: string | null,
  level: LogLevel,
  stage: PipelineStage | null,
  message: string,
  options: EmitLogOptions = {},
): Promise<void> {
  const sink = toSink(options.sink);
  if (!sink) return;
  try {
    await sink.appendLog({
      jobId,
      clientSessionId,
      level,
      stage,
      message,
      instanceId: options.instanceId ?? null,
    });
  } catch (error) {
    console.warn(
      "[pipeline-log] appendLog failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Move the job to `stage` at `progress` percent and record a `stage`-level log
 * line describing the transition.
 */
export async function setStage(
  jobId: string,
  clientSessionId: string | null,
  stage: PipelineStage,
  progress: number,
  message?: string,
  options: EmitLogOptions = {},
): Promise<void> {
  const sink = toSink(options.sink);
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  if (sink) {
    try {
      await sink.patchJob(jobId, {
        stage,
        progress: clamped,
        status: stage === "completed" ? "completed" : stage === "failed" ? "failed" : "running",
      });
    } catch (error) {
      console.warn(
        "[pipeline-log] patchJob failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (message !== undefined) {
    await emitLog(jobId, clientSessionId, "stage", stage, message, options);
  }
}

/** Progress percentage per pipeline stage, used for coarse progress writes. */
export const STAGE_PROGRESS: Record<PipelineStage, number> = {
  queued: 0,
  provisioning: 10,
  downloading: 25,
  transcribing: 45,
  analyzing: 65,
  rendering: 80,
  uploading: 92,
  completed: 100,
  failed: 100,
};
