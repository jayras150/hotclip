/**
 * Blokir email disposable / sekali pakai di boundary registrasi.
 *
 * - `DISPOSABLE_DOMAINS`: daftar domain throwaway bervolume tinggi.
 * - `isDisposableEmail(email)`: normalisasi lowercase + trim, ambil domain
 *   setelah `@` terakhir, lalu cocokkan **persis** atau sebagai **subdomain**
 *   (`user@mail.mailinator.com` ikut terblokir).
 * - Input non-string / email malformed (tanpa `@`, domain kosong) -> `false`.
 *
 * Verifikasi: `npx tsc --noEmit -p tsconfig.node.json`
 */

export const DISPOSABLE_DOMAINS: ReadonlyArray<string> = [
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "burnermail.io",
  "byom.de",
  "deadaddress.com",
  "discard.email",
  "discardmail.com",
  "disposableaddress.com",
  "disposablemail.com",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "emailtemporario.com.br",
  "fakeinbox.com",
  "fakemailgenerator.com",
  "filzmail.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxkitten.com",
  "incognitomail.com",
  "jetable.org",
  "mailcatch.com",
  "mailexpire.com",
  "maildrop.cc",
  "mailforspam.com",
  "mailinator.com",
  "mailinator.net",
  "mailinator2.com",
  "mailmetrash.com",
  "mailnesia.com",
  "mailnull.com",
  "mailsac.com",
  "mailtemp.info",
  "mailtothis.com",
  "mailtrash.net",
  "mintemail.com",
  "mohmal.com",
  "mytemp.email",
  "nada.email",
  "no-spam.ws",
  "nowmymail.com",
  "objectmail.com",
  "proxymail.eu",
  "rcpt.at",
  "sharklasers.com",
  "spam4.me",
  "spambox.us",
  "spamfree24.org",
  "spamgourmet.com",
  "spamhereplease.com",
  "spamspot.com",
  "spamthisplease.com",
  "stopmail.me",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempemail.net",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.io",
  "tempmail.net",
  "tempmail.org",
  "tempmail2.com",
  "tempmailaddress.com",
  "tempomail.fr",
  "temporarymail.com",
  "tempsky.com",
  "tmail.ws",
  "tmpeml.com",
  "tmpmail.net",
  "tmpmail.org",
  "trash-mail.at",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "throwawaymail.com",
  "throwaway.email",
  "truemail.space",
  "wegwerfemail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "zetmail.com",
];

const DISPOSABLE_DOMAIN_SET: ReadonlySet<string> = new Set(DISPOSABLE_DOMAINS);

/**
 * Cek apakah email memakai domain disposable.
 *
 * Cocok bila domain penuh ada di daftar (`mailinator.com`) **atau** ia
 * subdomain dari salah satu entri (`mail.mailinator.com`).
 */
export function isDisposableEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;

  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return false;

  // Pakai `@` terakhir agar display name berisi `@` tidak merusak domain.
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) return false;

  const domain = normalized.slice(atIndex + 1).replace(/\.+$/, "");
  if (domain.length === 0) return false;

  if (DISPOSABLE_DOMAIN_SET.has(domain)) return true;

  // Subdomain match: `sub.mailinator.com` -> `mailinator.com`.
  const labels = domain.split(".");
  for (let i = 1; i < labels.length; i += 1) {
    if (DISPOSABLE_DOMAIN_SET.has(labels.slice(i).join("."))) return true;
  }

  return false;
}
