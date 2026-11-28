"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

import { apiClient } from "@/lib/api";

/**
 * Bridges the Clerk session into the shared `apiClient` for the admin console.
 *
 * `/api/admin/*` is guarded server-side by `enforceAdminSessionResult`, which
 * only accepts a verified Clerk bearer token. Without this bridge every
 * console request would be anonymous and answered with 401/403.
 *
 * Only mounted when Clerk is configured (see `AdminLayout`), so `useAuth()`
 * always runs inside a real `<ClerkProvider>`.
 */
export function AdminApiAuthBridge(): null {
  const { getToken } = useAuth();

  useEffect(() => {
    apiClient.setTokenProvider(async () => {
      try {
        return (await getToken()) ?? null;
      } catch {
        return null;
      }
    });

    return () => {
      apiClient.setTokenProvider(null);
    };
  }, [getToken]);

  return null;
}