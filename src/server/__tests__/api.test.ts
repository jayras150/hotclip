/**
 * Integration/unit tests — src/server/api.ts (Node built-in `http` router).
 *
 * Rules: vitest + Node built-ins only (no framework, no Supabase SDK).
 * Each test builds a fresh router + server on an ephemeral port.
 */
import http from "http";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createApiRouter } from "../api";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface HttpRequestResult {
  statusCode: number;
  body: unknown;
}

function createTestServer(opts: {
  apiToken?: string;
  rateLimit?: { maxRequests: number; windowMs: number };
} = {}): ReturnType<typeof http.createServer> {
  const router = createApiRouter(opts);
  const server = http.createServer((req, res) => {
    void router(req, res).catch((error) => {
      console.error("[api] route error:", error);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "internal error" }));
      }
    });
  });
  return server;
}

async function request(
  server: ReturnType<typeof http.createServer>,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<HttpRequestResult> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const { port } = server.address() as { port: number };
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: url,
        headers: { "Content-Type": "application/json", ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const parsed =
              chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
            resolve({ statusCode: res.statusCode ?? 0, body: parsed });
          } catch {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: { raw: Buffer.concat(chunks).toString("utf8") },
            });
          }
        });
      },
    );
    req.on("error", reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("API router", () => {
  let server: ReturnType<typeof http.createServer>;
  let token: string;

  beforeEach(async () => {
    token = "test-secret-token";
    const router = createApiRouter({
      apiToken: token,
      rateLimit: { maxRequests: 5, windowMs: 60_000 },
    });
    server = http.createServer((req, res) => {
      void router(req, res).catch((error) => {
        console.error("[api] route error:", error);
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "internal error" }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/health -> 200 { ok: true }, no auth required", async () => {
    const res = await request(server, "GET", "/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /api/v1/jobs without token -> 401", async () => {
    const res = await request(server, "POST", "/api/v1/jobs", { source: "demo.mp4" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/v1/jobs with valid token -> 201 and jobId present", async () => {
    const res = await request(
      server,
      "POST",
      "/api/v1/jobs",
      { source: "demo.mp4", videoUrl: "https://videos.example.com/demo.mp4" },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(201);
    expect((res.body as Record<string, unknown>)).toHaveProperty("jobId");
    expect(typeof (res.body as Record<string, unknown>).jobId).toBe("string");
    expect((res.body as Record<string, unknown> & { jobId?: string }).jobId!.length).toBeGreaterThan(0);
    expect((res.body as Record<string, unknown>).status).toBe("queued");
  });

  it("GET /api/v1/jobs/nonexistent -> 404", async () => {
    const res = await request(server, "GET", "/api/v1/jobs/does-not-exist-123");
    expect(res.statusCode).toBe(404);
  });

  it("rate limiter: 5 rapid requests -> 6th -> 429", async () => {
    const make = (n: number) =>
      request(
        server,
        "POST",
        "/api/v1/jobs",
        { source: `rate-test-${n}.mp4` },
        { Authorization: `Bearer ${token}` },
      );

    const responses = await Promise.all([1, 2, 3, 4, 5].map((n) => make(n)));
    for (const res of responses) {
      expect(res.statusCode).toBe(201);
    }

    const sixth = await request(
      server,
      "POST",
      "/api/v1/jobs",
      { source: "rate-test-6.mp4" },
      { Authorization: `Bearer ${token}` },
    );
    expect(sixth.statusCode).toBe(429);
  });

  it("GET /api/v1/jobs/:id -> 200 for a known job", async () => {
    const created = await request(
      server,
      "POST",
      "/api/v1/jobs",
      { source: "known.mp4" },
      { Authorization: `Bearer ${token}` },
    );
    expect(created.statusCode).toBe(201);
    const jobId = (created.body as { jobId: string }).jobId;

    const res = await request(server, "GET", `/api/v1/jobs/${jobId}`);
    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>)).toHaveProperty("jobId");
    expect((res.body as Record<string, unknown>).jobId).toBe(jobId);
  });
});
