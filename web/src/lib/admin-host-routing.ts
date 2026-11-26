/**
 * Pure admin host-routing rules — Edge-compatible copy.
 *
 * The canonical implementation lives in the repo root at
 * `src/server/admin-host-routing.ts` (typechecked + unit-tested by the Node
 * project). That file cannot be imported from the Next.js app: the web
 * `tsconfig.json` only maps `@shared/*` to `../src/shared/*`, and middleware
 * runs on the Edge runtime where Node built-ins are unavailable.
 *
 * This module therefore mirrors the rules exactly and stays pure (no Node
 * imports, no Next.js imports) so it can be bundled into middleware. Keep the
 * two files in sync — `src/server/__tests__/admin-host-routing.test.ts` pins
 * the canonical behaviour.
 *
 * Routing model:
 *   - admin host (ADMIN_HOST / ADMIN_DOMAIN)  -> everything rewrites to /admin*
 *   - main host + /admin* path                -> forbidden (403): the admin UI
 *                                                is only reachable via the
 *                                                dedicated admin domain
 *   - anything else                           -> passthrough
 */

export const ADMIN_HOST = "admin.hookclip.pro";
export const MAIN_HOSTS = ["hookclip.pro", "www.hookclip.pro"];

export interface AdminRouteResult {
  /** Rewrite target (relative path). Absent for passthrough/403. */
  rewrite?: string;
  /** Shortcut HTTP status (e.g. 403) when the request must be blocked. */
  status?: number;
}

export interface AdminRouteOptions {
  /** Extra host treated as the admin vhost (e.g. `ADMIN_DOMAIN` env). */
  adminHost?: string;
  /** Extra hosts treated as the main (public) site. */
  mainHosts?: string[];
}

/** Normalize a Host header: lowercase, strip port, strip trailing dot. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Resolve how a request should be routed from its Host header + pathname. */
export function resolveAdminRoute(
  host: string,
  pathname: string,
  opts: AdminRouteOptions = {},
): AdminRouteResult {
  const h = normalizeHost(host);
  const path = pathname || "/";
  const adminHosts = new Set([ADMIN_HOST]);
  if (opts.adminHost) adminHosts.add(normalizeHost(opts.adminHost));
  const mainHosts = new Set([...MAIN_HOSTS, ...(opts.mainHosts ?? []).map(normalizeHost)]);

  if (adminHosts.has(h)) {
    // Admin vhost: map "/" -> "/admin" and keep deeper paths under /admin.
    if (path === "/admin" || path.startsWith("/admin/")) {
      return { rewrite: path };
    }
    return { rewrite: `/admin${path === "/" ? "" : path}` };
  }

  if (mainHosts.has(h)) {
    if (path === "/admin" || path.startsWith("/admin/")) {
      return { status: 403 };
    }
    return {};
  }

  // Unknown host: passthrough (let Next.js decide / 404).
  return {};
}
