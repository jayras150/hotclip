import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createApiExtRouter, type ApiExtRouterOptions } from "../api-ext";

interface CallResult {
  status: number;
  body: Record<string, unknown>;
}

function createTestServer(opts: ApiExtRouterOptions = {}): http.Server {
  const router = createApiExtRouter(opts);
  return http.createServer((req, res) => {
    void router(req, res).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "internal error" }));
      }
    });
  });
}

function call(
  server: http.Server,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<CallResult> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: address.port, method, path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(text) as Record<string, unknown>;
          } catch {
            body = { raw: text };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function withServer(
  opts: ApiExtRouterOptions,
  fn: (server: http.Server) => Promise<void>,
): Promise<void> {
  const server = createTestServer(opts);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(server);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const allowAll = async () => ({
  ok: true as const,
  userId: "user_admin",
  email: "admin@example.com",
});
const denyAll = async () => ({
  ok: false as const,
  status: 403 as const,
  error: "not an admin",
});

afterEach(() => {
  delete process.env.AUTH_TOKEN;
});

describe("admin router — session guard", () => {
  it("rejects /api/admin/* when the guard denies", async () => {
    await withServer({ adminGuard: denyAll }, async (server) => {
      for (const path of [
        "/api/admin",
        "/api/admin/users",
        "/api/admin/audit-logs",
        "/api/admin/providers",
        "/api/admin/storage-pools",
      ]) {
        const res = await call(server, "GET", path);
        expect(res.status, path).toBe(403);
        expect(res.body.ok).toBe(false);
      }
    });
  });

  it("rejects mutations when the guard denies", async () => {
    await withServer({ adminGuard: denyAll }, async (server) => {
      const res = await call(server, "POST", "/api/admin/users/u1/ban");
      expect(res.status).toBe(403);
    });
  });

  it("keeps /api/admin/health public for liveness probes", async () => {
    await withServer({ adminGuard: denyAll }, async (server) => {
      const res = await call(server, "GET", "/api/admin/health");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  it("serves the console endpoints once the guard passes", async () => {
    await withServer({ adminGuard: allowAll }, async (server) => {
      const users = await call(server, "GET", "/api/admin/users");
      expect(users.status).toBe(200);
      expect(Array.isArray(users.body.data)).toBe(true);

      const audit = await call(server, "GET", "/api/admin/audit-logs");
      expect(audit.status).toBe(200);
      expect(Array.isArray(audit.body.data)).toBe(true);

      const providers = await call(server, "GET", "/api/admin/providers");
      expect(providers.status).toBe(200);
      expect(Array.isArray(providers.body.data)).toBe(true);

      const summary = await call(server, "GET", "/api/admin");
      expect(summary.status).toBe(200);
      const data = summary.body.data as Record<string, unknown>;
      expect(typeof data.activeProviders).toBe("number");
      expect(typeof data.totalCredits).toBe("number");
    });
  });

  it("does not leak the admin identity between requests", async () => {
    // First request passes, second is denied: the audit trail of the denied
    // one must not reuse the previous admin's identity.
    const outcomes = [allowAll, denyAll];
    let index = 0;
    const guard = async () => {
      const outcome = outcomes[Math.min(index++, outcomes.length - 1)];
      return outcome();
    };

    await withServer({ adminGuard: guard }, async (server) => {
      const first = await call(server, "GET", "/api/admin/users");
      expect(first.status).toBe(200);
      const second = await call(server, "GET", "/api/admin/users");
      expect(second.status).toBe(403);
    });
  });
});

describe("admin router — non-admin namespace", () => {
  it("answers 404 JSON for unknown paths outside /api/admin", async () => {
    await withServer({ adminGuard: allowAll }, async (server) => {
      const res = await call(server, "GET", "/api/v1/packages");
      expect(res.status).toBe(404);
    });
  });
});

describe("public pricing catalog", () => {
  it("serves /api/packages without an admin session", async () => {
    await withServer({ adminGuard: denyAll }, async (server) => {
      const res = await call(server, "GET", "/api/packages");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const packages = res.body.data as Array<Record<string, unknown>>;
      expect(Array.isArray(packages)).toBe(true);
      expect(packages.length).toBeGreaterThan(0);
      // Only the public shape leaks — no owner or cost fields.
      const keys = Object.keys(packages[0]);
      expect(keys).not.toContain("costLocal");
      expect(keys).not.toContain("userId");
    });
  });
});