/**
 * Shared contact-sheet composition for highlight review.
 * Pure function: compose frames into a numbered grid without I/O.
 * The caller owns sampling (local vision or container worker).
 */
export interface ContactSheetFrame {
  index: number;
  /** Pixel data as an array buffer (filled by the caller). */
  pixels: Uint8Array;
  /** Frame width/height (contact sheet is square). */
  w: number;
  h: number;
}

/**
 * Compose up to `cellCount` frames into a single square image grid.
 * Each cell is drawn centered; cells beyond `cellCount` are left black.
 * Pure (no ffmpeg/LLM/I/O), safe to call from both local and vast workers.
 */
export function composeContactSheet(
  frames: ContactSheetFrame[],
  cellCount: number,
  cellSize: number
): Uint8Array {
  const size = cellSize;
  const total = cellCount * cellSize;
  const out = new Uint8Array(total * total * 3);
  const half = Math.floor(cellSize / 2);

  for (let i = 0; i < cellCount; i++) {
    const f = frames[i];
    if (!f) continue;
    // Copy into the center of the cell, allowing small overflow-safe clip.
    // Column/row inside cell
    const cx = i % Math.ceil(Math.sqrt(cellCount));
    const cy = Math.floor(i / Math.ceil(Math.sqrt(cellCount)));
    const px = cx * size + half - Math.floor(f.w / 2);
    const py = cy * size + half - Math.floor(f.h / 2);
    const src = f.pixels;
    const srcW = f.w;
    if (px < 0 || py < 0 || px + srcW > total) continue;
    for (let y = 0; y < f.h; y++) {
      const dstRow = (py + y) * total * 3;
      const srcRow = (y * srcW) * 3;
      for (let x = 0; x < srcW * 3; x++) {
        out[dstRow + x] = src[srcRow + x];
      }
    }
  }
  return out;
}
