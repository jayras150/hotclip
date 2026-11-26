/**
 * Unit tests — src/server/orchestrator.ts
 *
 * NOTE: `orchestrator.ts` on disk is the pre-existing Vast.ai orchestrator
 * (Main VPS coordinator). It speaks a different duck-typed contract than the
 * generic `dispatchJob(workerClient.dispatchJob)` design the task bullet used
 * as a starting point:
 *
 *   - worker client = `{ post(url, body): Promise<unknown> }` (not
 *     `dispatchJob(payload): Promise<{ ok, jobId }>`)
 *   - pool manager  = a real `PoolManager` instance (selectActiveProvider
 *     + presignGet), not a duck-typed `{ selectActiveProvider, presignPut }`
 *   - `handleWebhook` returns `void`, silently ignored on bad signature
 *     (not `false`), and marks the job `running`/`error` (not `completed`).
 *
 * The tests below verify the *behaviours* the task asks for, wired to the
 * actual on-disk API:
 *
 *   1. HMAC-SHA256 signature verify -> boolean (true / false)
 *   2. dispatchJob -> DispatchResult { jobId, status, workerUrl, error? }
 *   3. handleWebhook -> marks job in the in-memory map; wrong signature
 *      silently ignored (no throw, no job entry added)
 */

import { describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { Orchestrator, type DispatchResult, type JobPayload } from "../orchestrator";
import {
  PoolManager,
  type StorageProviderStore,
  type StorageProvider,
  type StoragePool,
  type StorageProviderConfig,
  type Presigner,
  NullPresigner,
} from "../storage/pool-manager";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** In-memory implementation of `StorageProviderStore` (duck-typed double). */
class InMemoryStorageProviderStore implements StorageProviderStore {
  private pools: StoragePool[] = [];
  private providers: StorageProvider[] = [];

  constructor(pools: StoragePool[] = [], providers: StorageProvider[] = []) {
    this.pools = pools;
    this.providers = providers;
  }

  async listPools(): Promise<StoragePool[]> {
    return this.pools;
  }

  async listProviders(poolId?: string): Promise<StorageProvider[]> {
    if (poolId) return this.providers.filter((p) => p.pool_id === poolId);
    return this.providers;
  }

  async updateProvider(providerId: string, patch: Partial<StorageProvider>): Promise<void> {
    const idx = this.providers.findIndex((p) => p.id === providerId);
    if (idx === -1) throw new Error(`provider ${providerId} not found`);
    this.providers[idx] = { ...this.providers[idx], ...patch };
  }

  async recordUsage(providerId: string, bytes: number): Promise<void> {
    const idx = this.providers.findIndex((p) => p.id === providerId);
    if (idx === -1) throw new Error(`provider ${providerId} not found`);
    this.providers[idx] = {
      ...this.providers[idx],
      used_bytes: BigInt(Number(this.providers[idx].used_bytes) + bytes),
    };
  }
}

function storagePool(overrides: Partial<StoragePool> = {}): StoragePool {
  return {
    id: overrides.id ?? "pool-global",
    name: "Global Pool",
    provider_name: "r2",
    account_label: "default",
    priority: overrides.priority ?? 10,
    quota_bytes: BigInt(100_000_000_000),
    used_bytes: BigInt(0),
    health_status: overrides.health_status ?? "healthy",
    is_active: true,
    user_id: null,
  };
}

function storageProvider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    id: overrides.id ?? "p-global",
    pool_id: overrides.pool_id ?? null,
    provider_name: "r2",
    config: {
      endpoint_url: "https://r2.example.com",
      region: "auto",
      bucket_name: "hotclip-media",
      access_key_id: "AKIATEST",
      secret_access_key: "secret",
    },
    quota_bytes: BigInt(10_000_000_000),
    used_bytes: BigInt(0),
    priority: overrides.priority ?? 10,
    health_status: overrides.health_status ?? "healthy",
    is_active: overrides.is_active ?? true,
    is_backup: false,
  };
}

/** Build the smallest valid `PoolManager` + `Orchestrator` pair for tests. */
function buildOrchestrator(
  workerClient: {
    post(url: string, body: unknown): Promise<unknown>;
  },
  webhookSecret = "whsec",
  timeoutMs = 30_000,
  heartbeatMs = 5_000,
) {
  // One global provider (pool_id=null) for `selectActiveProvider()` and a
  // second provider pinned to the global id for `presignGet(provider.id)`.
  const store = new InMemoryStorageProviderStore(
    [storagePool({ id: "pool-global" })],
    [
      storageProvider({ id: "p-global", pool_id: null }),
      storageProvider({ id: "p-p1", pool_id: "p-global" }),
    ],
  );
  const poolManager = new PoolManager(store, new NullPresigner());
  return new Orchestrator(poolManager, workerClient, webhookSecret, timeoutMs, heartbeatMs);
}

/* ------------------------------------------------------------------ */
/* 1. verifyWebhookSignature — HMAC-SHA256, returns boolean            */
/* ------------------------------------------------------------------ */

describe("Orchestrator.verifyWebhookSignature", () => {
  it("returns true when signature matches createHmac('sha256', secret)", () => {
    const orchestrator = buildOrchestrator({ post: () => Promise.resolve({}) }, "whsec");
    const payload = { jobId: "job-1", event: "job.completed" };
    const payloadStr = JSON.stringify(payload);
    const signature = createHmac("sha256", "whsec").update(payloadStr).digest("hex");

    expect(orchestrator.verifyWebhookSignature(Buffer.from(payloadStr), signature)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    const orchestrator = buildOrchestrator({ post: () => Promise.resolve({}) }, "whsec");
    const payload = { jobId: "job-1" };
    const payloadStr = JSON.stringify(payload);

    expect(orchestrator.verifyWebhookSignature(Buffer.from(payloadStr), "not-the-signature")).toBe(false);
    expect(orchestrator.verifyWebhookSignature(Buffer.from(payloadStr), "")).toBe(false);
  });

  it("returns false for a tampered/hacked signature", () => {
    const orchestrator = buildOrchestrator({ post: () => Promise.resolve({}) }, "whsec");
    const payload = { jobId: "job-1", event: "job.completed" };
    const payloadStr = JSON.stringify(payload);
    const signature = createHmac("sha256", "whsec").update(payloadStr).digest("hex");

    // Flip one character of a genuine signature.
    const tampered = signature.slice(0, -1) + (signature.slice(-1) === "0" ? "1" : "0");

    expect(orchestrator.verifyWebhookSignature(Buffer.from(payloadStr), signature)).toBe(true);
    expect(orchestrator.verifyWebhookSignature(Buffer.from(payloadStr), tampered)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. dispatchJob — returns DispatchResult { jobId, status, workerUrl } */
/* ------------------------------------------------------------------ */

describe("Orchestrator.dispatchJob", () => {
  it("queues the job and returns DispatchResult with status 'queued' -> 'running' + workerUrl", async () => {
    const workerClient = {
      post: vi.fn().mockResolvedValue({ ok: true, jobId: "xyz" }),
    };
    const orchestrator = buildOrchestrator(workerClient, "whsec");
    const job: JobPayload = {
      id: "job-1",
      sourceUrl: "https://videos.example.com/demo.mp4",
    };

    const result = await orchestrator.dispatchJob(job);

    // workerUrl is always set; jobId is overwritten by the worker's reply.
    expect(result).toEqual({
      jobId: "xyz",
      status: "running",
      workerUrl: "http://localhost:8080/jobs",
    });
    expect(workerClient.post).toHaveBeenCalledTimes(1);
    expect(workerClient.post).toHaveBeenCalledWith(
      "http://localhost:8080/jobs",
      expect.objectContaining({
        id: "job-1",
        sourceBucket: "hotclip-media",
        sourceMethod: "GET",
      }),
    );
  });

  it("marks status 'error' when workerClient.post rejects", async () => {
    const failing = {
      post: vi.fn().mockRejectedValue(new Error("network timeout")),
    };
    const orchestrator = buildOrchestrator({ post: () => Promise.reject(new Error("network timeout")) }, "whsec");
    const job: JobPayload = { id: "job-1", sourceUrl: "https://videos.example.com/demo.mp4" };

    const result = await orchestrator.dispatchJob(job);

    expect(result.status).toBe("error");
    expect(result.error).toBe("network timeout");
    expect(result.jobId).toBe("job-1");
  });

  it("sets workerUrl from WORKER_WEBHOOK_BASE_URL env var", async () => {
    process.env.WORKER_WEBHOOK_BASE_URL = "http://worker-test:1234";
    try {
      const workerClient = {
        post: vi.fn().mockResolvedValue({ ok: true, jobId: "xyz" }),
      };
      const orchestrator = buildOrchestrator(workerClient, "whsec");
      const job: JobPayload = { id: "job-1", sourceUrl: "https://videos.example.com/demo.mp4" };

      const result = await orchestrator.dispatchJob(job);

      expect(result.workerUrl).toBe("http://worker-test:1234/jobs");
    } finally {
      delete process.env.WORKER_WEBHOOK_BASE_URL;
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. handleWebhook — correct HMAC marks job; wrong sig silent         */
/* ------------------------------------------------------------------ */

describe("Orchestrator.handleWebhook", () => {
  it("marks the job as 'running' (job.completed) with a correct signature", async () => {
    const workerClient = {
      post: vi.fn().mockResolvedValue({ ok: true, jobId: "xyz" }),
    };
    const orchestrator = buildOrchestrator(workerClient, "whsec");

    const payload = { jobId: "job-1", event: "job.completed" };
    const payloadStr = JSON.stringify(payload);
    const signature = createHmac("sha256", "whsec").update(payloadStr).digest("hex");

    const job = { id: "job-1", sourceUrl: "https://videos.example.com/demo.mp4" };
    await orchestrator.dispatchJob(job);
    await orchestrator.handleWebhook(payload, signature);

    const jobEntries = (orchestrator as unknown as { jobs: Map<string, DispatchResult> }).jobs;
    const entry = jobEntries.get("job-1");
    expect(entry?.status).toBe("running");
    expect(entry?.jobId).toBe("job-1");
    expect(entry?.workerUrl).toBe("http://localhost:8080/jobs");
  });

  it("marks the job as 'error' (job.failed) with a correct signature", async () => {
    const workerClient = {
      post: vi.fn().mockResolvedValue({ ok: true, jobId: "xyz" }),
    };
    const orchestrator = buildOrchestrator(workerClient, "whsec");

    const payload = { jobId: "job-2", event: "job.failed", error: "ffmpeg crashed" };
    const payloadStr = JSON.stringify(payload);
    const signature = createHmac("sha256", "whsec").update(payloadStr).digest("hex");

    await orchestrator.handleWebhook(payload, signature);

    const jobEntries = (orchestrator as unknown as { jobs: Map<string, DispatchResult> }).jobs;
    const entry = jobEntries.get("job-2");
    expect(entry?.status).toBe("error");
    expect(entry?.error).toBe("ffmpeg crashed");
  });

  it("silently ignores a wrong signature — no throw, job not marked", async () => {
    const workerClient = {
      post: vi.fn().mockResolvedValue({ ok: true, jobId: "xyz" }),
    };
    const orchestrator = buildOrchestrator(workerClient, "whsec");

    const payload = { jobId: "job-3", event: "job.completed" };

    // Kontrak baru: `handleWebhook` mengembalikan boolean `accepted` (false
    // bila signature salah) supaya webhook handler bisa membalas `{ok:false}`.
    await expect(orchestrator.handleWebhook(payload, "totally-wrong-signature")).resolves.toBe(false);

    const jobEntries = (orchestrator as unknown as { jobs: Map<string, DispatchResult> }).jobs;
    expect(jobEntries.has("job-3")).toBe(false);
  });

  it("silently ignores payloads without a jobId or an accepted event", async () => {
    const workerClient = {
      post: vi.fn().mockResolvedValue({ ok: true, jobId: "xyz" }),
    };
    const orchestrator = buildOrchestrator(workerClient, "whsec");

    const payload = { jobId: "" };
    const payloadStr = JSON.stringify(payload);
    const signature = createHmac("sha256", "whsec").update(payloadStr).digest("hex");

    // Missing jobId: signature verifies, but the handler bails out before
    // writing anything to the job map.
    await orchestrator.handleWebhook(payload, signature);
    const jobEntries = (orchestrator as unknown as { jobs: Map<string, DispatchResult> }).jobs;
    expect(jobEntries.has("")).toBe(false);
  });
});
