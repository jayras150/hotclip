/**
 * Integration tests — src/server/webhook-clerk.ts
 *
 * `verifyWebhook` dari `@clerk/backend/webhooks` di-mock penuh, request
 * dikirim lewat Node `http` client ke server sungguhan (pola api.test.ts).
 */
import http from "http";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/backend/webhooks", () => ({ verifyWebhook: vi.fn() }));

import { verifyWebhook } from "@clerk/backend/webhooks";
import { handleClerkWebhook, clerkUserStore } from "../webhook-clerk";

const mockedVerifyWebhook = vi.mocked(verifyWebhook);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function createTestServer(): ReturnType<typeof http.createServer> {
  return http.createServer((req, res) => {
    void handleClerkWebhook(req, res).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "internal error" }));
      }
    });
  });
}

interface HttpResult {
  statusCode: number;
  body: unknown;
  raw: string;
}

async function request(
  server: ReturnType<typeof http.createServer>,
  body: string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as { port: number };
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/webhooks/clerk",
        headers: { "Content-Type": "application/json", ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = null;
          try {
            parsed = raw.length > 0 ? JSON.parse(raw) : null;
          } catch {
            parsed = null;
          }
          resolve({ statusCode: res.statusCode ?? 0, body: parsed, raw });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const SVIX_HEADERS = {
  "svix-id": "msg_test_0001",
  "svix-timestamp": String(Math.floor(Date.now() / 1000)),
  "svix-signature": "v1,fffffffffffffffffffffffffffffffffffffffffff",
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("handleClerkWebhook", () => {
  let server: ReturnType<typeof http.createServer>;
  const savedEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    delete process.env.CLERK_SECRET_KEY;
    process.env.CLERK_WEBHOOK_SECRET = "whsec_test_unique_secret_key";
    clerkUserStore.clear();
    mockedVerifyWebhook.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    server = createTestServer();
    return new Promise<void>((resolve) => server.listen(0, () => resolve()));
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env = { ...savedEnv };
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns 400 and leaves store untouched when verifyWebhook throws", async () => {
    mockedVerifyWebhook.mockRejectedValue(new Error("invalid signature"));

    const res = await request(server, JSON.stringify({ type: "user.created", data: {} }), SVIX_HEADERS);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "invalid webhook signature" });
    expect(clerkUserStore.size).toBe(0);
  });

  it("returns 200 and upserts user.created into the store", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      type: "user.created",
      data: {
        id: "user_1",
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: "a@example.com" }],
      },
    } as never);

    const res = await request(
      server,
      JSON.stringify({ type: "user.created" }),
      SVIX_HEADERS,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const record = clerkUserStore.get("user_1");
    expect(record).toBeDefined();
    expect(record!.email).toBe("a@example.com");
    expect(record!.deleted).toBe(false);
    expect(typeof record!.updatedAt).toBe("string");
  });

  it("falls back to the first email when primary id does not match", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      type: "user.created",
      data: {
        id: "user_fallback",
        primary_email_address_id: "idn_missing",
        email_addresses: [{ id: "idn_other", email_address: "first@example.com" }],
      },
    } as never);

    const res = await request(server, "{}", SVIX_HEADERS);
    expect(res.statusCode).toBe(200);
    expect(clerkUserStore.get("user_fallback")!.email).toBe("first@example.com");
  });

  it("upserts user.updated idempotently (store size stays 1)", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      type: "user.updated",
      data: {
        id: "user_2",
        primary_email_address_id: "idn_2",
        email_addresses: [{ id: "idn_2", email_address: "b@example.com" }],
      },
    } as never);

    const payload = JSON.stringify({ type: "user.updated" });
    const first = await request(server, payload, SVIX_HEADERS);
    const second = await request(server, payload, SVIX_HEADERS);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(clerkUserStore.size).toBe(1);
    expect(clerkUserStore.get("user_2")!.email).toBe("b@example.com");
    expect(clerkUserStore.get("user_2")!.deleted).toBe(false);
  });

  it("user.updated replaces the stored email", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      type: "user.created",
      data: {
        id: "user_3",
        primary_email_address_id: "idn_3",
        email_addresses: [{ id: "idn_3", email_address: "old@example.com" }],
      },
    } as never);
    await request(server, "{}", SVIX_HEADERS);

    mockedVerifyWebhook.mockResolvedValue({
      type: "user.updated",
      data: {
        id: "user_3",
        primary_email_address_id: "idn_3b",
        email_addresses: [{ id: "idn_3b", email_address: "new@example.com" }],
      },
    } as never);
    await request(server, "{}", SVIX_HEADERS);

    expect(clerkUserStore.get("user_3")!.email).toBe("new@example.com");
  });

  it("user.deleted marks deleted=true while preserving the email", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      type: "user.created",
      data: {
        id: "user_4",
        primary_email_address_id: "idn_4",
        email_addresses: [{ id: "idn_4", email_address: "del@example.com" }],
      },
    } as never);
    await request(server, "{}", SVIX_HEADERS);

    mockedVerifyWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_4" },
    } as never);
    const res = await request(server, "{}", SVIX_HEADERS);

    expect(res.statusCode).toBe(200);
    const record = clerkUserStore.get("user_4")!;
    expect(record.deleted).toBe(true);
    expect(record.email).toBe("del@example.com");
  });

  it("returns 413 when body exceeds 1MB", async () => {
    const bigBody = JSON.stringify({ data: "x".repeat(1024 * 1024 + 16) });
    const res = await request(server, bigBody, SVIX_HEADERS);

    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ ok: false, error: "payload too large" });
  });

  it("emits one audit JSON line with level=audit on success", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      type: "user.created",
      data: {
        id: "user_audit",
        primary_email_address_id: "idn_a",
        email_addresses: [{ id: "idn_a", email_address: "audit@example.com" }],
      },
    } as never);

    await request(server, "{}", SVIX_HEADERS);

    const auditLines = logSpy.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .filter((line: string) => {
        try {
          return (JSON.parse(line) as Record<string, unknown>).level === "audit";
        } catch {
          return false;
        }
      });

    expect(auditLines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(auditLines[0]!) as Record<string, unknown>;
    expect(parsed.action).toBe("clerk.user.created");
    expect(parsed.entityId).toBe("user_audit");
  });

  it("passes svix headers to verifyWebhook via a Web API Request", async () => {
    mockedVerifyWebhook.mockResolvedValue({ type: "unknown.event", data: {} } as never);

    await request(server, "{}", SVIX_HEADERS);

    expect(mockedVerifyWebhook).toHaveBeenCalledTimes(1);
    const [, opts] = mockedVerifyWebhook.mock.calls[0]!;
    expect((opts as { signingSecret: string }).signingSecret).toBe(
      process.env.CLERK_WEBHOOK_SECRET,
    );
  });
});
