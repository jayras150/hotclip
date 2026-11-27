/**
 * Shared package/credit contract between the web app (Next.js App Router),
 * the admin API (src/server), and the admin store (src/server/admin-store.ts).
 *
 * This file intentionally contains ONLY the types and the in-app default
 * packages — NO server-only dependencies, so the web app can import it
 * directly without pulling `src/server/admin-store.ts` into the container build.
 *
 * All prices are denominated in USD and rendered with an explicit `$` prefix
 * (en-US formatting only, never `id-ID` / plain `toLocaleString()`).
 */

/** A purchasable credit package (pricing tier), priced in USD. */
export interface AdminPackage {
  id: string;
  name: string;
  /** Slug used by the public pricing page / Clerk plan lookup. */
  slug: string;
  /** Price in US dollars (e.g. 9, 19, 49). */
  priceUsd: number;
  /** Credits granted when the package is purchased. */
  credits: number;
  /** Short marketing blurb. */
  description?: string;
  /** Ordered from cheapest to most expensive. */
  sortOrder: number;
  isActive: boolean;
  isPopular: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new package. */
export interface AdminPackageInput {
  name: string;
  slug: string;
  priceUsd: number;
  credits: number;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  isPopular?: boolean;
}

/** Patch for updating an existing package. */
export type AdminPackagePatch = Partial<AdminPackageInput>;

/* ------------------------------------------------------------------ */
/* In-app default packages (used as fallback when the backend route is  */
/* not available in the deployed container, e.g. standalone build)     */
/* ------------------------------------------------------------------ */

/**
 * Default USD pricing tiers used as the client-side fallback when the
 * backend `/api/packages` endpoint is not present in the deployed image.
 *
 * Free / Starter / Pro / Studio — every price denominated in USD.
 */
export function DEFAULT_PACKAGES(): AdminPackage[] {
  const now = nowIso();
  const base = (
    pkg: Omit<AdminPackage, "createdAt" | "updatedAt">,
  ): AdminPackage => ({
    ...pkg,
    createdAt: now,
    updatedAt: now,
  });
  return [
    base({
      id: "pkg-free",
      name: "Free",
      slug: "free",
      priceUsd: 0,
      credits: 10,
      description: "Try HookClip with a one-time starter credit grant.",
      sortOrder: 0,
      isActive: true,
      isPopular: false,
    }),
    base({
      id: "pkg-starter",
      name: "Starter",
      slug: "starter",
      priceUsd: 9,
      credits: 60,
      description: "For creators publishing a few shorts per week.",
      sortOrder: 1,
      isActive: true,
      isPopular: false,
    }),
    base({
      id: "pkg-pro",
      name: "Pro",
      slug: "pro",
      priceUsd: 19,
      credits: 150,
      description: "For daily posting with priority GPU rendering.",
      sortOrder: 2,
      isActive: true,
      isPopular: true,
    }),
    base({
      id: "pkg-studio",
      name: "Studio",
      slug: "studio",
      priceUsd: 49,
      credits: 450,
      description: "For teams and agencies producing clips at scale.",
      sortOrder: 3,
      isActive: true,
      isPopular: false,
    }),
  ];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** ISO timestamp helper — used by the default packages above. */
function nowIso(): string {
  return new Date().toISOString();
}
