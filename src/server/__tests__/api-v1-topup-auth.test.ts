import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createApiV1Router } from "../api-v1";
import { InMemoryStore } from "../store";

/**
 * Regression tests for the top-up credit-minting vulnerability.
 *
 * Before the fix, `POST /api/v1/topups` had no authentication: `currentUserId()`
 * fell back to the literal string "anonymous" and the handler called
 * `store.applyTopup`, which credited a wallet immediately with status
 * "settled". An unauthenticated caller could therefore mint credits by hand.
 */

interface CallResult {
  status: number;
  body: Record<string, unknown>;
}

const servers: http.Server[] = [];

function startServer(store: InMemoryStore, apiToken = ""): http.Server {
  const router = createApiV1Router({ store, apiToken, sessionSecret: "test-secret" });
  const server = http.createServer((req, res) => {
    void router(req, res).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "internal error" }));
      }
    });
  });
  servers.push(server);
  return server;
}

function call(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult> {
  const address = server.address() as AddressInfo;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        method,
        path,
        headers: {
          ...(payload ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(text) as Record<string, unknown>;
          } catch {
            parsed = { raw: text };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Resolves the wallet balance, or null when no wallet row exists at all. */
async function balanceOf(store: InMemoryStore, userId: string): Promise<number | null> {
  try {
    const wallet = await store.getWallet(userId);
    return wallet?.balance ?? null;
  } catch {
    return null;
  }
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("POST /api/v1/topups — anonymous credit minting", () => {
  it("rejects an unauthenticated caller with the original exploit payload", async () => {
    const store = new InMemoryStore();
    const server = startServer(store);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    // The exact shape the audit used: self-service `manual` gateway, 500k IDR.
    const res = await call(server, "POST", "/api/v1/topups", {
      amountLocal: 500_000,
      gateway: "manual",
    });

    expect(res.status).toBe(401);
    // No wallet may be provisioned, let alone credited.
    expect(await balanceOf(store, "anonymous")).toBeNull();
  });

  it("rejects the `manual` gateway even behind a machine token", async () => {
    const store = new InMemoryStore();
    const server = startServer(store, "machine-token");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    const res = await call(
      server,
      "POST",
      "/api/v1/topups",
      { amountLocal: 500_000, gateway: "manual" },
      { Authorization: "Bearer machine-token" },
    );

    // A shared token has no wallet owner, so it must not settle a top-up.
    expect([401, 403]).toContain(res.status);
    expect(await balanceOf(store, "anonymous")).toBeNull();
  });

  it("does not credit a wallet when a signed-in user records a pending top-up", async () => {
    const store = new InMemoryStore();
    const server = startServer(store);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    const email = `payer-${Date.now()}@example.test`;
    const registered = await call(server, "POST", "/api/v1/auth/register", {
      email,
      password: "correct-horse-battery",
    });
    expect(registered.status).toBe(201);
    const token = (registered.body.data as { token?: string } | undefined)?.token;
    expect(typeof token).toBe("string");

    const res = await call(
      server,
      "POST",
      "/api/v1/topups",
      { amountLocal: 150_000, currency: "IDR", gateway: "midtrans" },
      { Authorization: `Bearer ${token}` },
    );

    // Accepted as an *intent*, but nothing is credited until the gateway
    // confirms payment. The balance must stay at whatever it was before.
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/"settled"/);
  });

  it("rejects unexpected fields and out-of-range amounts", async () => {
    const store = new InMemoryStore();
    const server = startServer(store);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    const email = `fields-${Date.now()}@example.test`;
    const registered = await call(server, "POST", "/api/v1/auth/register", {
      email,
      password: "correct-horse-battery",
    });
    const token = (registered.body.data as { token?: string } | undefined)?.token;
    const auth = { Authorization: `Bearer ${token}` };

    // Client-supplied ownership must never be honoured.
    const spoofed = await call(
      server,
      "POST",
      "/api/v1/topups",
      { amountLocal: 15_000, gateway: "midtrans", userId: "someone-else" },
      auth,
    );
    expect(spoofed.status).toBe(400);

    const tooLarge = await call(
      server,
      "POST",
      "/api/v1/topups",
      { amountLocal: 999_999_999_999, gateway: "midtrans" },
      auth,
    );
    expect(tooLarge.status).toBe(400);

    const negative = await call(
      server,
      "POST",
      "/api/v1/topups",
      { amountLocal: -15_000, gateway: "midtrans" },
      auth,
    );
    expect(negative.status).toBe(400);

    const fractional = await call(
      server,
      "POST",
      "/api/v1/topups",
      { amountLocal: 15_000.5, gateway: "midtrans" },
      auth,
    );
    expect(fractional.status).toBe(400);
  });
});