"use client";

import { useEffect, useRef, useState } from "react";
import { NEXT_PUBLIC_TURNSTILE_SITE_KEY } from "@/lib/clerk";

/**
 * Wrapper client-component untuk Cloudflare Turnstile (anti-abuse opsional).
 *
 * - Memuat `https://challenges.cloudflare.com/turnstile/v0/api.js` sekali
 *   dan me-render `<div className="turnstile cf-turnstile"
 *   data-sitekey={...}>` (class `cf-turnstile` dipakai Turnstile untuk
 *   auto-render; class `turnstile` dipertahankan sesuai konvensi proyek).
 * - Jika `NEXT_PUBLIC_TURNSTILE_SITE_KEY` tidak ada, cukup me-render
 *   placeholder "captcha disabled" — build tetap lulus dan alur auth
 *   tidak diblokir.
 */
export function TurnstileWidget(): React.JSX.Element {
  const [mounted, setMounted] = useState(false);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    setMounted(true);

    if (!NEXT_PUBLIC_TURNSTILE_SITE_KEY || scriptRef.current) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    scriptRef.current = script;

    return () => {
      // Script global Turnstile sengaja tidak dihapus saat unmount:
      // api.js bersifat singleton dan aman dipakai ulang antar halaman.
      scriptRef.current = null;
    };
  }, []);

  if (!NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    return (
      <p
        className="mt-4 text-center text-xs text-[var(--text-muted)]"
        role="note"
      >
        captcha disabled
      </p>
    );
  }

  if (!mounted) {
    return (
      <div
        className="mt-4 h-[65px] w-full animate-pulse rounded-lg bg-[var(--surface-2)]"
        aria-hidden="true"
      />
    );
  }

  return (
    <div className="mt-4 flex justify-center">
      <div
        className="turnstile cf-turnstile"
        data-sitekey={NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        data-theme="dark"
        role="group"
        aria-label="Verifikasi manusia (Cloudflare Turnstile)"
      />
    </div>
  );
}
