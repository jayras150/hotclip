/**
 * Clerk webhook handler — `POST /api/webhooks/clerk`.
 *
 * - Baca body (max 1 MB).
 * - Verifikasi signature via `verifyWebhook` (`@clerk/backend/webhooks`)
 *   dengan Web API `Request` yang dibangun dari raw body + header svix.
 * - `user.created` / `user.updated` / `user.deleted`: upsert idempoten ke
 *   in-memory store (TODO Supabase: ganti dengan upsert `public.profiles`).
 * - Audit: satu baris JSON ke console (pola `AuditLogger`).
 * - Signature invalid -> 400.
 */

import { type IncomingMessage, type ServerResponse } from "node:http";
import { verifyWebhook } from "@clerk/backend/webhooks";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export interface ClerkUserRecord {
  userId: string;
  email: string;
  deleted: boolean;
  updatedAt: string;
}

/** In-memory store, idempoten per userId. TODO: sinkron ke Supabase. */
export const clerkUserStore = new Map<string, ClerkUserRecord>();

function audit(event: Record<string, unknown>): void {
  try {
    console.log(
      JSON.stringify({ level: "audit", at: new Date().toISOString(), ...event }),
    );
  } catch {
    // serialisasi gagal -> abaikan
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Jangan destroy socket: terus konsumsi sisa body agar klien selesai
        // menulis dan respons 413 masih bisa dikirim.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) reject(new Error("payload too large"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

export async function handleClerkWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "payload too large" }));
    return;
  }

  const request = new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: new Headers({
      "svix-id": String(req.headers["svix-id"] ?? ""),
      "svix-timestamp": String(req.headers["svix-timestamp"] ?? ""),
      "svix-signature": String(req.headers["svix-signature"] ?? ""),
      "content-type": "application/json",
    }),
    body,
  });

  let evt: { type: string; data: Record<string, unknown> };
  try {
    evt = (await verifyWebhook(request, {
      signingSecret: process.env.CLERK_WEBHOOK_SECRET ?? "",
    })) as { type: string; data: Record<string, unknown> };
  } catch (error) {
    console.warn(
      "[webhook-clerk] signature verification failed:",
      error instanceof Error ? error.message : error,
    );
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid webhook signature" }));
    return;
  }

  const type = evt?.type ?? "unknown";
  const data = evt?.data ?? {};

  if (type === "user.created" || type === "user.updated" || type === "user.deleted") {
    const userId = typeof data.id === "string" ? data.id : "";
    if (userId.length > 0) {
      if (type === "user.deleted") {
        const existing = clerkUserStore.get(userId);
        clerkUserStore.set(userId, {
          userId,
          email: existing?.email ?? "",
          deleted: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const emails = Array.isArray(data.email_addresses)
          ? (data.email_addresses as Array<Record<string, unknown>>)
          : [];
        const primaryId =
          typeof data.primary_email_address_id === "string"
            ? data.primary_email_address_id
            : "";
        const primary = emails.find((e) => e.id === primaryId) ?? emails[0];
        const email = typeof primary?.email_address === "string" ? primary.email_address : "";
        // Upsert idempoten: hasil sama saat replay.
        clerkUserStore.set(userId, {
          userId,
          email: email || clerkUserStore.get(userId)?.email || "",
          deleted: false,
          updatedAt: new Date().toISOString(),
        });
      }

      // TODO Supabase: upsert ke public.profiles / public.users di sini.

      audit({
        action: `clerk.${type}`,
        entity: "user",
        entityId: userId,
        userId,
        ip: req.socket?.remoteAddress,
      });
    }
  } else {
    audit({ action: `clerk.${type}`, entity: "webhook", details: { type } });
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}
