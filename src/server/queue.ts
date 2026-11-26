/**
 * Durable job queue — retry exponential, cancel, priority.
 *
 * Implementasi in-memory dengan worker loop `setTimeout` (concurrency 1).
 * Status terminal (`completed` / `failed` / `cancelled`) ditulis ke
 * `DataStore.updateJob` bila store disediakan. Timer di-`unref()` agar
 * tidak menahan proses exit.
 *
 * Verifikasi: `npx tsc --noEmit -p tsconfig.node.json`
 */

import type { DataStore, JobStatus } from "./store";

export interface QueueJob {
  jobId: string;
  userId?: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  status: "waiting" | "active" | "completed" | "failed" | "cancelled";
  enqueuedAt: number;
}

export interface JobQueueOptions {
  /** Jumlah percobaan maksimum per job. Default 3. */
  maxAttempts?: number;
  /** Store opsional untuk menulis status terminal job. */
  store?: DataStore;
  /** Callback dispatcher; default langsung menandai job selesai. */
  onDispatch?: (job: QueueJob) => Promise<void>;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 30_000;
const IDLE_DELAY_MS = 25;

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 100 * 2 ** Math.max(0, attempts - 1));
}

export class JobQueue {
  private readonly maxAttempts: number;
  private readonly store?: DataStore;
  private readonly onDispatch: (job: QueueJob) => Promise<void>;
  private readonly jobs = new Map<string, QueueJob>();
  private readonly retryAt = new Map<string, number>();

  private running = false;
  private processing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: JobQueueOptions = {}) {
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.store = opts.store;
    this.onDispatch = opts.onDispatch ?? (async () => undefined);
  }

  /** Tambah job ke antrean (idempoten per `jobId`). */
  async enqueue(
    jobId: string,
    params: { priority?: number; userId?: string } = {},
  ): Promise<QueueJob> {
    const existing = this.jobs.get(jobId);
    if (existing) return { ...existing };

    const job: QueueJob = {
      jobId,
      userId: params.userId,
      priority: Number.isFinite(params.priority) ? (params.priority as number) : 0,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      status: "waiting",
      enqueuedAt: Date.now(),
    };
    this.jobs.set(jobId, job);
    this.scheduleNext(0);
    return { ...job };
  }

  /** Batalkan job yang masih waiting/active. `true` bila berhasil. */
  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return false;
    }

    job.status = "cancelled";
    this.retryAt.delete(jobId);
    await this.persist(jobId, "cancelled");
    return true;
  }

  stats(): QueueStats {
    const result: QueueStats = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const job of this.jobs.values()) {
      result[job.status] += 1;
    }
    return result;
  }

  /** Mulai worker loop (idempoten). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  /** Hentikan worker loop dan bersihkan timer. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Proses semua job yang menunggu secara sinkron (mengabaikan backoff).
   * Berguna untuk test dan shutdown drain.
   */
  async drain(): Promise<void> {
    let guard = 0;
    while (guard < 10_000) {
      guard += 1;
      const next = this.pickNext(true);
      if (!next) return;
      await this.process(next);
    }
  }

  /* --------------------------- internal --------------------------- */

  private pickNext(ignoreRetry: boolean): QueueJob | null {
    const now = Date.now();
    const candidates = [...this.jobs.values()]
      .filter((job) => job.status === "waiting")
      .filter((job) => ignoreRetry || (this.retryAt.get(job.jobId) ?? 0) <= now)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.enqueuedAt - b.enqueuedAt;
      });
    return candidates[0] ?? null;
  }

  private async process(job: QueueJob): Promise<void> {
    job.status = "active";
    job.attempts += 1;

    try {
      await this.onDispatch({ ...job });
      if ((job.status as QueueJob["status"]) === "cancelled") return;

      job.status = "completed";
      this.retryAt.delete(job.jobId);
      await this.persist(job.jobId, "completed");
    } catch {
      if ((job.status as QueueJob["status"]) === "cancelled") return;

      if (job.attempts < job.maxAttempts) {
        job.status = "waiting";
        this.retryAt.set(job.jobId, Date.now() + backoffMs(job.attempts));
      } else {
        job.status = "failed";
        this.retryAt.delete(job.jobId);
        await this.persist(job.jobId, "failed");
      }
    }
  }

  private async persist(jobId: string, status: JobStatus): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.updateJob(jobId, { status });
    } catch {
      // Best-effort: kegagalan DB tidak boleh menghentikan antrean.
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);

    let delay = delayMs;
    if (delay <= 0) {
      const waiting = [...this.jobs.values()].filter((job) => job.status === "waiting");
      const now = Date.now();
      const futureRetries = waiting
        .map((job) => this.retryAt.get(job.jobId) ?? 0)
        .filter((at) => at > now);
      delay = waiting.length > 0 && futureRetries.length === waiting.length
        ? Math.max(0, Math.min(IDLE_DELAY_MS, Math.min(...futureRetries) - now))
        : (waiting.length > 0 ? 0 : IDLE_DELAY_MS);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (!this.running || this.processing) {
      this.scheduleNext(IDLE_DELAY_MS);
      return;
    }

    this.processing = true;
    try {
      const next = this.pickNext(false);
      if (next) {
        await this.process(next);
      }
    } finally {
      this.processing = false;
      this.scheduleNext(0);
    }
  }
}
