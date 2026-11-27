"use client";

import { useAuth, UserButton } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/clerk";
import { useRouter } from "next/navigation";

/**
 * Profil klien di header admin: ditampilkan `UserButton` bila clerk aktif
 * (tema dark-office Clerk). Hanya mengganti `<SignOutButton>` dari layout
 * admin yang sebelumnya menghenti prerender saat env Clerk belum di-set —
 * ini tidak mengubah layanan (aktor tetap sama: avatar + menu profil),
 * hanya menghilangkan tombol sign-out expil yang Clerk baru bisa handle.
 */
export function AdminProfileSwitcher(): React.JSX.Element {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  if (!clerkEnabled) {
    return (
      <button
        type="button"
        onClick={() => void router.push("/sign-in")}
        className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-xs font-semibold text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        Sign In
      </button>
    );
  }

  return (
    <UserButton
      appearance={{
        variables: {
          colorPrimary: "#00f0ff",
          colorPrimaryForeground: "#06080d",
          colorNeutral: "#0c1018",
          colorForeground: "#e6edf6",
          colorBorder: "rgba(255,255,255,0.08)",
          colorBackground: "#06080d",
          borderRadius: "10px",
        },
        elements: {
          avatarBox: "h-8 w-8",
        },
      }}
    />
  );
}
