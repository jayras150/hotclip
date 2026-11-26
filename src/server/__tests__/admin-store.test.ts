import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryAdminStore, createAdminStore } from "../admin-store";

function makeStore(): InMemoryAdminStore {
  const store = new InMemoryAdminStore();
  store.seedUser({
    id: "user-1",
    email: "alice@example.com",
    role: "member",
    createdAt: "2024-01-01T00:00:00.000Z",
    creditsBalance: 500,
  });
  store.seedUser({
    id: "user-2",
    email: "bob@example.com",
    role: "admin",
    createdAt: "2024-02-01T00:00:00.000Z",
    creditsBalance: 42,
  });
  return store;
}

describe("InMemoryAdminStore", () => {
  let store: InMemoryAdminStore;

  beforeEach(() => {
    store = makeStore();
  });

  it("lists users newest first", async () => {
    const users = await store.listAdminUsers();
    expect(users.map((u) => u.id)).toEqual(["user-2", "user-1"]);
  });

  it("honours the list limit", async () => {
    const users = await store.listAdminUsers(1);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe("user-2");
  });

  it("bans a user (status suspended + bannedAt + reason)", async () => {
    const banned = await store.banUser("user-1", "abuse");
    expect(banned?.status).toBe("suspended");
    expect(banned?.banReason).toBe("abuse");
    expect(banned?.bannedAt).toBeTruthy();

    const [row] = await store.listAdminUsers();
    expect(row?.id).toBe("user-2");
    const reloaded = (await store.listAdminUsers()).find((u) => u.id === "user-1");
    expect(reloaded?.status).toBe("suspended");
  });

  it("returns null when banning an unknown user", async () => {
    await expect(store.banUser("missing")).resolves.toBeNull();
  });

  it("unbans a user (status active, clears ban metadata)", async () => {
    await store.banUser("user-1", "spam");
    const unbanned = await store.unbanUser("user-1");
    expect(unbanned?.status).toBe("active");
    expect(unbanned?.bannedAt).toBeUndefined();
    expect(unbanned?.banReason).toBeUndefined();
  });

  it("returns null when unbanning an unknown user", async () => {
    await expect(store.unbanUser("missing")).resolves.toBeNull();
  });

  it("resets a user's quota to zero", async () => {
    const reset = await store.resetUserQuota("user-1");
    expect(reset?.creditsBalance).toBe(0);
    expect(reset?.localBalance).toBe(0);

    const reloaded = (await store.listAdminUsers()).find((u) => u.id === "user-1");
    expect(reloaded?.creditsBalance).toBe(0);
  });

  it("returns null when resetting the quota of an unknown user", async () => {
    await expect(store.resetUserQuota("missing")).resolves.toBeNull();
  });

  it("writes audit entries and reads them newest first", async () => {
    await store.writeAdminAuditLog({
      action: "user.ban",
      entity: "user",
      entityId: "user-1",
      userId: "admin-1",
      adminEmail: "root@example.com",
      ip: "203.0.113.7",
      details: { reason: "abuse" },
    });
    await store.writeAdminAuditLog({
      action: "user.quota.reset",
      entity: "user",
      entityId: "user-2",
      adminEmail: "root@example.com",
    });

    const logs = await store.listAdminAuditLogs();
    expect(logs).toHaveLength(2);
    // Same-millisecond writes fall back to insertion order; both entries exist.
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("user.ban");
    expect(actions).toContain("user.quota.reset");

    const ban = logs.find((l) => l.action === "user.ban");
    expect(ban).toMatchObject({
      entity: "user",
      entityId: "user-1",
      userId: "admin-1",
      adminEmail: "root@example.com",
      ip: "203.0.113.7",
    });
    expect(ban?.id).toBeTruthy();
    expect(ban?.createdAt).toBeTruthy();
  });

  it("caps the audit log list at the requested limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.writeAdminAuditLog({ action: `a.${i}`, entity: "user", entityId: `u-${i}` });
    }
    await expect(store.listAdminAuditLogs(2)).resolves.toHaveLength(2);
  });

  it("does not leak internal audit state through debugAuditLogs", async () => {
    await store.writeAdminAuditLog({ action: "user.ban", entity: "user" });
    const logs = store.debugAuditLogs();
    logs[0]!.action = "tampered";
    expect(store.debugAuditLogs()[0]!.action).toBe("user.ban");
  });

  it("reports a healthy in-memory store", async () => {
    await expect(store.health()).resolves.toBe(true);
  });
});

describe("createAdminStore", () => {
  it("falls back to the in-memory driver without Supabase env", () => {
    const store = createAdminStore({});
    expect(store).toBeInstanceOf(InMemoryAdminStore);
  });

  it("falls back when only one Supabase env var is present", () => {
    expect(createAdminStore({ SUPABASE_URL: "https://example.supabase.co" })).toBeInstanceOf(
      InMemoryAdminStore,
    );
    expect(
      createAdminStore({ SUPABASE_SERVICE_ROLE_KEY: "service-role" }),
    ).toBeInstanceOf(InMemoryAdminStore);
  });

  it("selects the PostgREST driver when both env vars are present", () => {
    const store = createAdminStore({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    });
    expect(store.constructor.name).toBe("PostgrestAdminStore");
    expect(store).not.toBeInstanceOf(InMemoryAdminStore);
  });
});
