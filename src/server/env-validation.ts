/**
 * Admin/auth environment validation — pure function, no runtime deps.
 *
 * Rules:
 *   - CLERK_SECRET_KEY is required when Clerk webhooks are enabled
 *     (i.e. CLERK_WEBHOOK_SECRET is set).
 *   - TURNSTILE_SECRET_KEY is required when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *     is set (site key without secret makes verification impossible).
 *   - ADMIN_2FA_SECRET, when set, must be at least 32 characters (TOTP-grade).
 *   - ADMIN_ALLOWED_IPS, when set, must be a valid comma-separated list of
 *     IPv4/IPv6 addresses (empty entries are rejected).
 */

export interface AdminEnvValidation {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function isValidIp(value: string): boolean {
  const ip = value.trim();
  if (!ip) return false;
  if (IPV4_RE.test(ip)) {
    return ip.split(".").every((octet) => {
      const n = Number(octet);
      return n >= 0 && n <= 255 && (octet.length === 1 || octet[0] !== "0");
    });
  }
  if (ip.includes(":")) {
    if (!IPV6_RE.test(ip)) return false;
    const colonGroups = (ip.match(/:/g) ?? []).length;
    return ip.includes("::") || colonGroups >= 2;
  }
  return false;
}

export function validateAdminEnv(env: Record<string, string | undefined>): AdminEnvValidation {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Clerk webhook requires both signing secret and API key.
  if (env.CLERK_WEBHOOK_SECRET && !env.CLERK_SECRET_KEY) {
    missing.push("CLERK_SECRET_KEY");
  }

  // Turnstile: site key set in client -> server secret must exist to verify.
  if (env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET_KEY) {
    missing.push("TURNSTILE_SECRET_KEY");
  }

  // 2FA secret strength.
  const twoFa = env.ADMIN_2FA_SECRET;
  if (twoFa !== undefined && twoFa.length > 0 && twoFa.length < 32) {
    warnings.push("ADMIN_2FA_SECRET must be at least 32 characters");
  }

  // Admin allowlist must be a valid CSV of IPs.
  const ips = env.ADMIN_ALLOWED_IPS;
  if (ips !== undefined && ips.trim() !== "") {
    for (const entry of ips.split(",")) {
      if (!isValidIp(entry)) {
        warnings.push(`ADMIN_ALLOWED_IPS contains invalid IP: "${entry.trim()}"`);
        break;
      }
    }
  }

  return { ok: missing.length === 0 && warnings.length === 0, missing, warnings };
}
