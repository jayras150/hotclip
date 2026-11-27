import Link from "next/link";
import { Film, Mail, ShieldCheck } from "lucide-react";

const PRODUCT_LINKS = [
  { href: "/", label: "Studio" },
  { href: "/clips", label: "My Clips" },
  { href: "/billing", label: "Billing" },
  { href: "/sign-up", label: "Sign Up" },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/refund", label: "Refund & Cancellation Policy" },
  { href: "/dmca", label: "DMCA / Copyright Policy" },
];

const SUPPORT_LINKS = [
  { href: "mailto:support@hookclip.pro", label: "support@hookclip.pro", Icon: Mail },
  { href: "mailto:dmca@hookclip.pro", label: "dmca@hookclip.pro", Icon: ShieldCheck },
];

/**
 * Global site footer: product navigation, legal links and support contacts.
 * Token-driven dark glass styling, responsive from 320px up.
 */
export default function SiteFooter(): React.JSX.Element {
  return (
    <footer className="pointer-events-auto relative z-30 border-t border-white/[0.06] bg-[#04060a]/80 backdrop-blur">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        {/* Brand */}
        <div className="sm:col-span-2 lg:col-span-1">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-[#00f0ff]/25 bg-gradient-to-br from-[#00f0ff]/20 to-[#3b82f6]/15 text-[#00f0ff] shadow-[0_0_14px_var(--glow-soft)]">
              <Film className="h-4 w-4" aria-hidden="true" />
            </span>
            HookClip
            <span className="bg-gradient-to-r from-[#00f0ff] to-[#3b82f6] bg-clip-text text-transparent">
              .pro
            </span>
          </Link>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-[var(--text-muted)]">
            Turn long videos into viral-ready vertical shorts with AI — face
            tracking, karaoke subtitles and virality scoring, rendered on GPU.
          </p>
        </div>

        {/* Product */}
        <nav aria-label="Product">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)]">
            Product
          </h2>
          <ul className="mt-3 space-y-2">
            {PRODUCT_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-xs text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Legal */}
        <nav aria-label="Legal">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)]">
            Legal
          </h2>
          <ul className="mt-3 space-y-2">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-xs text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Support */}
        <nav aria-label="Support">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)]">
            Support
          </h2>
          <ul className="mt-3 space-y-2">
            {SUPPORT_LINKS.map(({ href, label, Icon }) => (
              <li key={href}>
                <a
                  href={href}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-white/[0.05]">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-[11px] text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>
            © {new Date().getFullYear()} HookClip.pro — All rights reserved.
          </span>
          <span>Rendering runs on GPU (Vast.ai).</span>
        </div>
      </div>
    </footer>
  );
}
