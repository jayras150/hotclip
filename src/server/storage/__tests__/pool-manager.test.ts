/**
 * Unit test — src/server/storage/pool-manager.ts
 *
 * Kriteria verifikasi Phase 4:
 *   - pickActiveProvider / PoolManager pure routing: 100% pass
 *   - store/double: in-memory store + NullPresigner (no Supabase SDK, no AWS SDK)
 *   - coverage: selection rule, health failover, pool-full, quota, recordUsage
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  pickActiveProvider,
  NullPresigner,
  PoolManager,
  NoActiveProviderError,
  ProviderUnhealthyError,
  PoolFullError,
  type StorageProvider,
  type StorageProviderStore,
  type StoragePool,
} from "../pool-manager";

/* ------------------------------------------------------------------ */
/* Fixture + in-memory store (double)                                 */
/* ------------------------------------------------------------------ */

function prov(overrides: Partial<StorageProvider> = {}): StorageProvider {
  const base: StorageProvider = {
    id: crypto.randomUUID(),
    pool_id: null,
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
    priority: 10,
    health_status: "healthy",
    is_active: true,
    is_backup: false,
  };
  return { ...base, ...overrides };
}

function pool(overrides: Partial<StoragePool> = {}): StoragePool {
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

class InMemoryStorageProviderStore implements StorageProviderStore {
  pools: StoragePool[] = [];
  providers: StorageProvider[] = [];

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

  async updateProvider(_providerId: string, patch: Partial<StorageProvider>): Promise<void> {
    const idx = this.providers.findIndex((p) => p.id === _providerId);
    if (idx === -1) throw new Error(`provider ${_providerId} tidak ditemukan`);
    this.providers[idx] = { ...this.providers[idx], ...patch };
  }

  async recordUsage(providerId: string, bytes: number): Promise<void> {
    const idx = this.providers.findIndex((p) => p.id === providerId);
    if (idx === -1) throw new Error(`provider ${providerId} tidak ditemukan`);
    this.providers[idx] = {
      ...this.providers[idx],
      used_bytes: BigInt(Math.max(0, Number(this.providers[idx].used_bytes) + bytes)),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Tests — pure routing                                             */
/* ------------------------------------------------------------------ */

describe("pickActiveProvider", () => {
  it("memilih provider sehat, priority terendah, kapasitas tersedia terbanyak", () => {
    const providers = [
      prov({ id: "a", priority: 30, used_bytes: BigInt(9_000_000_000), health_status: "healthy" }), // kapasitas 1B
      prov({ id: "b", priority: 10, used_bytes: BigInt(1_000_000_000), health_status: "healthy" }), // kapasitas 9B
      prov({ id: "c", priority: 10, used_bytes: BigInt(5_000_000_000), health_status: "healthy" }), // kapasitas 5B
    ];
    const chosen = pickActiveProvider(providers);
    expect(chosen?.id).toBe("b");
  });

  it("skip provider down (auto failover ke yang sehat)", () => {
    const providers = [
      prov({ id: "down", health_status: "down", priority: 1, used_bytes: BigInt(0) }),
      prov({ id: "healthy", health_status: "healthy", priority: 10, used_bytes: BigInt(0) }),
    ];
    const chosen = pickActiveProvider(providers);
    expect(chosen?.id).toBe("healthy");
  });

  it("mengembalikan null kalau tidak ada yang aktif", () => {
    const providers = [
      prov({ id: "b", is_active: false, priority: 1, health_status: "healthy" }),
    ];
    expect(pickActiveProvider(providers)).toBeNull();
  });

  it("memfilter oleh poolId (mentugas pool spesifik + global)", () => {
    const globalProv = prov({ id: "g", pool_id: null });
    const poolProv = prov({ id: "p", pool_id: "pool-x" });
    const globalChoice = pickActiveProvider([globalProv]);
    expect(globalChoice?.id).toBe("g");
    const poolChoice = pickActiveProvider([poolProv], "pool-x");
    expect(poolChoice?.id).toBe("p");
  });

  it("mengembalikan null kalau provider pool tidak cocok", () => {
    const providers = [prov({ id: "other", pool_id: "pool-other" })];
    expect(pickActiveProvider(providers, "pool-x")).toBeNull();
  });

  it("mengutip provider degraded kalau tidak ada yang healthy", () => {
    const providers = [
      prov({ id: "degraded", health_status: "degraded", priority: 5, used_bytes: BigInt(0) }),
      prov({ id: "down", health_status: "down", priority: 1, used_bytes: BigInt(0) }),
    ];
    const chosen = pickActiveProvider(providers);
    expect(chosen?.id).toBe("degraded");
  });
});

/* ------------------------------------------------------------------ */
/* Tests — NullPresigner                                            */
/* ------------------------------------------------------------------ */

describe("NullPresigner", () => {
  it("mengembalikan URL PUT + GET deterministik", async () => {
    const presigner = new NullPresigner("https://s3.example.io");
    const put = await presigner.presignPut({
      endpoint: "https://r2.example.com",
      bucket: "hotclip",
      key: "clip.mp4",
      expirySeconds: 3600,
    });
    expect(put).toMatchObject({ method: "PUT", url: "https://s3.example.io/hotclip/clip.mp4?X-Amz-Signature=demo" });
    expect(put.headers["Content-Type"]).toBe("video/mp4");

    const get = await presigner.presignGet({
      endpoint: "https://r2.example.com",
      bucket: "hotclip",
      key: "clip.mp4",
      expirySeconds: 300,
    });
    expect(get).toMatchObject({ method: "GET" });
  });
});

/* ------------------------------------------------------------------ */
/* Tests — PoolManager                                              */
/* ------------------------------------------------------------------ */

describe("PoolManager", () => {
  let store: InMemoryStorageProviderStore;
  let manager: PoolManager;

  beforeEach(() => {
    store = new InMemoryStorageProviderStore(
      [pool({ id: "pool-g" })],
      [
        prov({
          id: "p-healthy-low",
          pool_id: "pool-g",
          priority: 1,
          used_bytes: BigInt(0),
          health_status: "healthy",
        }),
        prov({
          id: "p-down",
          pool_id: "pool-g",
          priority: 2,
          used_bytes: BigInt(0),
          health_status: "down",
        }),
        prov({
          id: "p-full",
          pool_id: "pool-g",
          priority: 1,
          used_bytes: BigInt(10_000_000_000),
          health_status: "healthy",
        }),
      ],
    );
    manager = new PoolManager(store, new NullPresigner());
  });

  it("selectActiveProvider memilih provider sehat & paling besar sisa quota", async () => {
    const chosen = await manager.selectActiveProvider("pool-g");
    // p-healthy-low (0/10B) vs p-full (10/10B) → p-healthy-low
    expect(chosen.id).toBe("p-healthy-low");
  });

  it("presignPut mengembalikan URL PUT", async () => {
    const url = await manager.presignPut("clips/1/clip.mp4", "pool-g");
    expect(url).toHaveProperty("method", "PUT");
    expect(url).toHaveProperty("url");
    expect(url.headers["Content-Type"]).toBe("video/mp4");
  });

  it("presignPut melempar PoolFullError kalau quota habis", async () => {
    const store = new InMemoryStorageProviderStore([pool()], [
      prov({ id: "full", pool_id: "pool-g", priority: 1, used_bytes: BigInt(100_000_000_000), health_status: "healthy" }),
    ]);
    const manager = new PoolManager(store, new NullPresigner());
    const chosen = await manager.selectActiveProvider("pool-g");
    console.error("[DIAG] selected provider id =", chosen?.id, "| quota =", chosen?.quota_bytes, "| used =", chosen?.used_bytes);
    await expect(manager.presignPut("clip.mp4", "pool-g")).rejects.toThrow(PoolFullError);
  });

  it("selectActiveProvider melempar NoActiveProviderError kalau tidak ada provider", async () => {
    const empty = new PoolManager(
      new InMemoryStorageProviderStore([pool()], []),
      new NullPresigner(),
    );
    await expect(empty.selectActiveProvider("pool-g")).rejects.toThrow(NoActiveProviderError);
  });

  it("selectActiveProvider melempar ProviderUnhealthyError kalau provider down", async () => {
    const onlyDown = new PoolManager(
      new InMemoryStorageProviderStore([pool()], [
        prov({ id: "only", pool_id: "pool-g", health_status: "down" }),
      ]),
      new NullPresigner(),
    );
    await expect(onlyDown.selectActiveProvider("pool-g")).rejects.toThrow(ProviderUnhealthyError);
  });

  it("recordUsage memperbarui used_bytes", async () => {
    await manager.recordUsage("p-healthy-low", 1_234_567);
    const updated = await store.listProviders("pool-g");
    expect(updated[0].used_bytes).toBe(BigInt(1_234_567));
  });

  it("healthCheck mengubah health_status menjadi down bila kapasitas penuh", async () => {
    await manager.healthCheck("p-healthy-low", BigInt(20_000_000_000));
    const updated = await store.listProviders("pool-g");
    expect(updated[0].health_status).toBe("down");
  });
});
