import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  NEXT_PUBLIC_CLERK_SIGN_UP_URL,
  clerkEnabled,
} from "@/lib/clerk";
import SiteFooter from "@/components/SiteFooter";
import "./globals.css";

export const metadata: Metadata = {
  title: "HotClip — Paste a URL, Get Viral Shorts",
  description:
    "Studio AI without login: paste a YouTube link or upload a video, get vertical clips ready for posting, with face-tracking, karaoke subtitles and virality scoring.",
  openGraph: {
    title: "HotClip — Paste a URL, Get Viral Shorts",
    description:
      "Studio AI without login: vertical clips ready for posting, with face-tracking, karaoke subtitles and virality scoring.",
    url: "https://hookclip.pro",
    siteName: "HookClip",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/og-banner.svg",
        width: 1200,
        height: 630,
        alt: "HookClip — Turn long videos into viral shorts",
      },
    ],
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.svg" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HotClip — Paste a URL, Get Viral Shorts",
    description:
      "Studio AI without login: vertical clips ready for posting, with face-tracking, karaoke subtitles and virality scoring.",
  },
};

export const viewport: Viewport = {
  themeColor: "#06080D",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Fonts: Space Grotesk for display, Inter for UI, JetBrains Mono for code/terminal. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
        />
        {/* Font tokens consumed by the studio components. */}
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html:
              ':root{--font-display:"Space Grotesk","Inter",system-ui,-apple-system,"Segoe UI",sans-serif;--font-sans:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,monospace;}',
          }}
        />
      </head>
      <body
        className="min-h-screen bg-[#06080D] text-slate-100 antialiased"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {/* ClerkProvider is mounted only in this root layout (single instance).
            Without a publishable key (env not set yet), children render
            as-is so the build/prerender does not fail. */}
        {clerkEnabled ? (
          <ClerkProvider
            publishableKey={NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
            signInUrl={NEXT_PUBLIC_CLERK_SIGN_IN_URL}
            signUpUrl={NEXT_PUBLIC_CLERK_SIGN_UP_URL}
          >
            {children}
            <SiteFooter />
          </ClerkProvider>
        ) : (
          <>
            {children}
            <SiteFooter />
          </>
        )}
      </body>
    </html>
  );
}
