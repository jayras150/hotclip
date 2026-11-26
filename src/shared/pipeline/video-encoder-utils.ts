/**
 * Strategy-agnostic ffmpeg execution + binary resolution.
 * Injected by the runtime adapter so tests stay isolated from Node built-ins.
 */

import { promisify } from "util";
import { execFile, type ExecFileOptions } from "child_process";

type ExecFileAsync = <O extends ExecFileOptions = ExecFileOptions>(
  file: string,
  args?: string[],
  options?: O,
  callback?: (err: Error | null, stdout: Buffer, stderr: Buffer) => void
) => Promise<{ stdout: Buffer; stderr: Buffer }>;

export const execFileAsync = promisify(execFile) as ExecFileAsync;

/** Resolve the ffmpeg binary path (ffmpeg-static). Throws when unavailable. */
export function resolveFfmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require("ffmpeg-static") as string | null;
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary for this platform");
  return ffmpegPath;
}
