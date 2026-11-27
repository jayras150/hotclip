/**
 * Clerk configuration (server-side / compiled by Next.js).
 *
 * All `NEXT_PUBLIC_*` values are inlined by Next.js at build time, so this
 * module exports constants that client components and server routes can use
 * without reading `process.env` directly.
 */

export const NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export const NEXT_PUBLIC_CLERK_SIGN_IN_URL =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";

export const NEXT_PUBLIC_CLERK_SIGN_UP_URL =
  process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";

export const NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_DISPLAY =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_DISPLAY ?? "";

/** True when a publishable key is configured (build / deploy is wired up). */
export const clerkEnabled = NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.length > 0;

/**
 * Dark-only "obsidian cyber" theme for Clerk widgets.
 *
 * Values match Clerk's Variables spec:
 * - colorBackground, colorText, colorPrimary, colorInput, colorRing, ...
 */
export const clerkAppearance = {
  variables: {
    colorBackground: "#14161D",
    colorNeutral: "#1C202B",
    colorText: "#F8FAFC",
    colorMutedForeground: "#8A97AB",
    colorPrimary: "#00D4FF",
    colorPrimaryForeground: "#0B0D14",
    colorInput: "#14161D",
    colorInputBackground: "#0B0D14",
    colorInputText: "#F8FAFC",
    colorBorder: "rgba(255,255,255,0.15)",
    colorRing: "rgba(0,240,255,0.35)",
    borderRadius: "10px",
  },
  elements: {
    socialButtonsBlockButton: {
      border: "1px solid",
      borderColor: "rgba(255,255,255,0.15)",
      backgroundColor: "#1C202B",
    },
    socialButtonsBlockButtonText: {
      color: "#F8FAFC",
    },
    rootBox: "w-full flex justify-center",
    cardBox: "w-full max-w-[400px] mx-auto",
    card: "w-full bg-[#14161D] border border-white/10 shadow-none",
    formFieldInput: {
      backgroundColor: "#0B0D14",
      color: "#F8FAFC",
      border: "1px solid rgba(255, 255, 255, 0.25)",
      "&:focus": { borderColor: "#00D4FF" },
    },
  },
};
