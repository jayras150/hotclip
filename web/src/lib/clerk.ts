/**
 * Konfigurasi Clerk (server-side / dikompilasi Next).
 *
 * Nilai `NEXT_PUBLIC_*` di-inline oleh Next.js saat build, jadi modul ini
 * diekspor sebagai konstanta agar komponen client dan route server tidak
 * perlu membaca `process.env` secara langsung.
 */

export const NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export const NEXT_PUBLIC_CLERK_SIGN_IN_URL =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";

export const NEXT_PUBLIC_CLERK_SIGN_UP_URL =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";

export const NEXT_PUBLIC_TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** True bila publishable key Clerk tersedia (build/deploy ter-konfigurasi). */
export const clerkEnabled = NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.length > 0;

/**
 * Tema "obsidian cyber" untuk widget Clerk (dark-only).
 * Nama variabel mengikuti `Variables` resmi Clerk:
 * colorBackground, colorText, colorPrimary, colorInput, colorRing, dst.
 */
export const clerkAppearance = {
  variables: {
    colorBackground: "#06080d",
    colorNeutral: "#0c1018",
    colorForeground: "#e6edf6",
    colorMutedForeground: "#8a97ab",
    colorPrimary: "#00f0ff",
    colorPrimaryForeground: "#04121a",
    colorInput: "#0c1018",
    colorInputForeground: "#e6edf6",
    colorBorder: "rgba(255,255,255,0.08)",
    colorRing: "rgba(0,240,255,0.35)",
    borderRadius: "10px",
  },
} as const;
