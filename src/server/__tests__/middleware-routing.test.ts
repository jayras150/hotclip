import { describe, expect, it } from "vitest";
import {
  ADMIN_HOST,
  MAIN_HOSTS,
  normalizeHost,
  resolveAdminRoute,
} from "../admin-host-routing";

describe("normalizeHost", () => {
  it("lowercases and strips port and trailing dot", () => {
    expect(normalizeHost("Admin.Hookclip.Pro:443")).toBe("admin.hookclip.pro");
    expect(normalizeHost("HOOKCLIP.PRO.")).toBe("hookclip.pro");
    expect(normalizeHost("  www.hookclip.pro ")).toBe("www.hookclip.pro");
  });
});

describe("resolveAdminRoute — admin host", () => {
  it("rewrites / to /admin", () => {
    expect(resolveAdminRoute("admin.hookclip.pro", "/")).toEqual({
      rewrite: "/admin",
    });
  });

  it("rewrites arbitrary paths under /admin", () => {
    expect(resolveAdminRoute("admin.hookclip.pro", "/users")).toEqual({
      rewrite: "/admin/users",
    });
    expect(resolveAdminRoute("admin.hookclip.pro", "/admin/settings")).toEqual({
      rewrite: "/admin/settings",
    });
  });

  it("keeps existing /admin/ paths untouched", () => {
    expect(resolveAdminRoute(ADMIN_HOST, "/admin/logs/tail")).toEqual({
      rewrite: "/admin/logs/tail",
    });
  });
});

describe("resolveAdminRoute — main host", () => {
  it.each(MAIN_HOSTS)("blocks /admin on %s with 403", (host) => {
    expect(resolveAdminRoute(host, "/admin")).toEqual({ status: 403 });
    expect(resolveAdminRoute(host, "/admin/settings")).toEqual({ status: 403 });
  });

  it("allows normal paths on the main host (passthrough)", () => {
    expect(resolveAdminRoute("hookclip.pro", "/dashboard")).toEqual({});
    expect(resolveAdminRoute("www.hookclip.pro", "/")).toEqual({});
  });

  it("does not block paths merely starting with 'admin' as prefix", () => {
    // /administrator is a distinct path, not the admin UI.
    expect(resolveAdminRoute("hookclip.pro", "/administrator")).toEqual({});
  });
});

describe("resolveAdminRoute — unknown hosts", () => {
  it("passes through unknown hosts", () => {
    expect(resolveAdminRoute("example.com", "/whatever")).toEqual({});
  });
});
