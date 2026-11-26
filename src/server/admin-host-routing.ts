/**
 * Pure admin host-routing rules — no Next.js or Node runtime dependencies so
 * the logic is trivially unit-testable and reusable from middleware.ts.
 *
 * Routing model:
 *   - admin host (ADMIN_HOST)          -> everything rewrites to /admin*
 *   - main host + /admin* path         -> forbidden (403): admin UI is only
 *                                          reachable via the dedicated admin
 *                                          domain, never from the main site
 *   - main host + any other path       -> passthrough (no rewrite)
 */

export const ADMIN_HOST = "admin.hookclip.pro";
export const MAIN_HOSTS = ["hookclip.pro", "www.hookclip.pro"];

export interface AdminRouteResult {
  /** Next.js rewrite target (relative path). Absent for passthrough/403. */
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

/**
 * Resolve how a request should be routed based on Host header + pathname.
 */
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
