/**
 * Next.js middleware — Clerk session bootstrap + admin host isolation.
 *
 * Order matters:
 *   1. `clerkMiddleware()` runs first so `auth()` / `currentUser()` have a
 *      session to work with inside admin routes.
 *   2. Pure host-routing (`resolveAdminRoute`) then decides whether the
 *      request should be rewritten onto `/admin*` or rejected with a 403.
 *
 * Policy:
 *   - Requests to the admin vhost (`admin.hookclip.pro`, or `ADMIN_DOMAIN`)
 *     are rewritten to `/admin...`, so `admin.hookclip.pro/users` serves
 *     `/admin/users`.
 *   - Requests to the canonical site (`hookclip.pro`, `www.hookclip.pro`)
 *     for any `/admin*` path return 403 JSON — the admin UI must never be
 *     reachable from the public host.
 *   - Unknown hosts pass through untouched.
 */

import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveAdminRoute } from "./lib/admin-host-routing";

export default clerkMiddleware((_auth, req: NextRequest) => {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const { pathname } = req.nextUrl;

  const route = resolveAdminRoute(host, pathname, {
    adminHost: process.env.ADMIN_DOMAIN,
  });

  if (route.status) {
    return NextResponse.json(
      { ok: false, error: route.status === 403 ? "forbidden" : "error" },
      { status: route.status },
    );
  }

  if (route.rewrite && route.rewrite !== pathname) {
    const url = req.nextUrl.clone();
    url.pathname = route.rewrite;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Run on every request except Next.js internals and static assets, and
   * always for API routes.
   */
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
