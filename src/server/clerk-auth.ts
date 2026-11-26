/**
 * Clerk session auth.
 *
 * `verifyClerkSession(req)`:
 *   - Parse `Authorization: Bearer <token>`.
 *   - Verifikasi via `verifyToken` dari `@clerk/backend` dengan
 *     `{ secretKey: process.env.CLERK_SECRET_KEY }`.
 *   - Return `null` bila token tidak ada / invalid (tidak pernah throw).
 */

import { type IncomingMessage } from "node:http";
import { verifyToken } from "@clerk/backend";

export interface ClerkSession {
  userId: string;
  email: string;
}

export async function verifyClerkSession(
  req: IncomingMessage,
): Promise<ClerkSession | null> {
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7).trim();
  if (token.length === 0) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const claims = (await verifyToken(token, { secretKey })) as Record<
      string,
      unknown
    >;

    const userId = typeof claims.sub === "string" ? claims.sub : "";
    if (userId.length === 0) return null;

    const email = typeof claims.email === "string" ? claims.email : "";
    return { userId, email };
  } catch {
    return null;
  }
}
