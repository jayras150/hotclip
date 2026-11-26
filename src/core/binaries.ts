/**
 * Bundled binary resolution (ffmpeg / ffprobe).
 * In dev these come from node_modules; in the packaged app electron-builder
 * unpacks them from asar (see electron-builder.yml asarUnpack), so paths that
 * contain "app.asar" must be rewritten to "app.asar.unpacked".
 *
 * NOTE: `ffmpeg-static` under pnpm v11 can leave the real binary un-extracted at
 * a broken nested `node_modules/.pnpm` location.  `resolveFfmpegPath` therefore
 * validates the ffmpeg-static result and falls back to the system `ffmpeg` on
 * PATH (which covers installations such as the WinGet/yt-dlp packager).
 */

import { existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

/** Rewrite an asar-internal path to its unpacked twin (no-op outside asar). Pure. */
export function toUnpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/**
 * Search the system PATH (plus the platform `where` / `which` resolver) for an
 * executable named `name`. Returns the first valid path, or null when none is
 * found. Used as a fallback for the bundled `ffmpeg-static`.
 */
function findSystemBinary(name: string): string | null {
  const isWindows = process.platform === "win32";
  const sep = isWindows ? ";" : ":";
  const env = isWindows ? process.env.Path : process.env.PATH;
  const dirs = String(env ?? "").split(sep).map((d) => d.trim()).filter(Boolean);
  for (const dir of dirs) {
    const cand = join(dir, isWindows ? name + ".exe" : name);
    if (existsSync(cand)) return cand;
  }
  // Last resort: the platform resolver (where/which) covers installers that put
  // the binary outside the PATH entries we enumerated above.
  const which = isWindows ? "where" : "which";
  const result = spawnSync(which, [name], { stdio: "pipe" });
  if (result.status === 0) {
    const first = String(result.stdout ?? result.stderr ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  }
  return null;
}

/** Resolve the ffmpeg binary path. Prefers ffmpeg-static; falls back to system. */
export function resolveFfmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegStatic = require("ffmpeg-static") as string | null;
  if (ffmpegStatic) {
    // ffmpeg-static writes the binary path computed from its own directory.
    // Under pnpm v11 the binary can be missing at that (nested) location.
    if (existsSync(ffmpegStatic)) {
      return toUnpackedPath(ffmpegStatic);
    }
  }
  const sys = findSystemBinary("ffmpeg");
  if (sys) return sys;
  throw new Error("ffmpeg binary not found (ffmpeg-static and system PATH both missing)");
}

/** Resolve the ffprobe binary path (@ffprobe-installer). Throws when unavailable. */
export function resolveFfprobePath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { path } = require("@ffprobe-installer/ffprobe") as { path: string };
  if (!path) throw new Error("@ffprobe-installer/ffprobe did not provide a binary for this platform");
  return toUnpackedPath(path);
}
