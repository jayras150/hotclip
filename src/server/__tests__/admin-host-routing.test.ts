import { describe, expect, it } from "vitest";

import {
  ADMIN_HOST,
  MAIN_HOSTS,
  normalizeHost,
  resolveAdminRoute,
} from "../admin-host-routing";

describe("admin host routing — normalizeHost", () => {
  it("normalizes case, port and trailing dot", () => {
    expect(normalizeHost("ADMIN.HookClip.Pro:443")).toBe("admin.hookclip.pro");
    expect(normalizeHost("hookclip.pro.")).toBe("hookclip.pro");
    expect(normalizeHost("  www.hookclip.pro  ")).toBe("www.hookclip.pro");
  });
});

describe("admin host routing — admin vhost rewrites to /admin", () => {
  it("rewrites the root path", () => {
    expect(resolveAdminRoute(ADMIN_HOST, "/")).toEqual({ rewrite: "/admin" });
  });

  it("prefixes arbitrary paths with /admin", () => {
    expect(resolveAdminRoute(ADMIN_HOST, "/users")).toEqual({ rewrite: "/admin/users" });
    expect(resolveAdminRoute("admin.hookclip.pro", "/users/42")).toEqual({
      rewrite: "/admin/users/42",
    });
    expect(resolveAdminRoute("admin.hookclip.pro", "/audit")).toEqual({
      rewrite: "/admin/audit",
    });
  });

  it("leaves already-prefixed /admin paths alone", () => {
    expect(resolveAdminRoute(ADMIN_HOST, "/admin")).toEqual({ rewrite: "/admin" });
    expect(resolveAdminRoute(ADMIN_HOST, "/admin/users")).toEqual({ rewrite: "/admin/users" });
  });

  it("honours a custom ADMIN_DOMAIN", () => {
    expect(resolveAdminRoute("ops.example.com", "/users", { adminHost: "ops.example.com" })).toEqual({
      rewrite: "/admin/users",
    });
  });

  it("treats the custom admin host case-insensitively with a port", () => {
    expect(
      resolveAdminRoute("OPS.Example.com:8443", "/", { adminHost: "ops.example.com" }),
    ).toEqual({ rewrite: "/admin" });
  });
});

describe("admin host routing — main host blocks /admin", () => {
  it.each(MAIN_HOSTS)("returns 403 for /admin on %s", (host) => {
    expect(resolveAdminRoute(host, "/admin")).toEqual({ status: 403 });
    expect(resolveAdminRoute(host, "/admin/users")).toEqual({ status: 403 });
    expect(resolveAdminRoute(host, "/admin/audit-logs")).toEqual({ status: 403 });
  });

  it("passes through non-admin paths on the main host", () => {
    expect(resolveAdminRoute("hookclip.pro", "/")).toEqual({});
    expect(resolveAdminRoute("hookclip.pro", "/clips")).toEqual({});
    expect(resolveAdminRoute("www.hookclip.pro", "/billing")).toEqual({});
  });

  it("does not treat /administrator as an admin path", () => {
    expect(resolveAdminRoute("hookclip.pro", "/administrator")).toEqual({});
  });

  it("allows an extra main host to be configured", () => {
    expect(resolveAdminRoute("staging.example.com", "/admin", { mainHosts: ["staging.example.com"] })).toEqual(
      { status: 403 },
    );
  });
});

describe("admin host routing — unknown hosts", () => {
  it("passes through unknown hosts untouched", () => {
    expect(resolveAdminRoute("example.com", "/admin")).toEqual({});
    expect(resolveAdminRoute("192.168.1.10:3000", "/")).toEqual({});
    expect(resolveAdminRoute("localhost:3000", "/users")).toEqual({});
  });

  it("treats an empty pathname as '/'", () => {
    expect(resolveAdminRoute(ADMIN_HOST, "")).toEqual({ rewrite: "/admin" });
  });
});
