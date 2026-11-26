/**
 * Color palette generation for highlight review rendering.
 * Pure function: generates accent palettes for review highlights without I/O.
 */

/** Default color palette (8 colors, 180° hue spread for best contrast). */
export const DEFAULT_PALETTE = [
  "#22c55e", // green — success/done
  "#3b82f6", // blue — neutral info
  "#f59e0b", // amber — warning/attention
  "#ef4444", // red — error/danger
  "#8b5cf6", // violet — premium/highlight
  "#ec4899", // pink — accent
  "#14b8a6", // teal — secondary action
  "#f97316", // orange — primary highlight
];

/**
 * Convert a hex color to RGB channels (0-255).
 */
export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

/** Interpolate between two hex colors. */
export function interpolateColor(a: string, b: string, t: number): string {
  const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [0, 0, 0];
    return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
  };
  const [ra, ga, ba] = hexToRgb(a);
  const [rb, gb, bb] = hexToRgb(b);
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/**
 * Interpolate a gradient between two colors.
 * Returns an array of `steps` evenly spaced colors.
 */
export function gradient(a: string, b: string, steps: number): string[] {
  return Array.from({ length: steps }, (_, i) => interpolateColor(a, b, i / (steps - 1)));
}

/** Shuffle an array (Fisher-Yates). */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Get a deterministic palette for the Nth category.
 * Used to assign consistent colors to review highlights without shared state.
 */
export function paletteFor(index: number): string[] {
  const base = DEFAULT_PALETTE;
  const offset = index % base.length;
  const next = (offset + 3) % base.length;
  return [base[offset], base[next]];
}

/**
 * Compute complementary color (for text on a colored background).
 */
export function complementary(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const inv = [255 - r, 255 - g, 255 - b];
  return `#${inv[0].toString(16).padStart(2, "0")}${inv[1].toString(16).padStart(2, "0")}${inv[2].toString(16).padStart(2, "0")}`;
}

/**
 * Convert hex to HSL for lightness-based selection.
 */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const rc = (max - r) / d;
    const gc = (max - g) / d;
    const bc = (max - b) / d;
    if (r === max) h = (gc - bc) / 6;
    else if (g === max) h = (bc - rc) / 6 + 1 / 3;
    else h = (rc - gc) / 6 + 2 / 3;
    h = ((h % 1) + 1) % 1;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** Convert [0, 1] value to hex color. */
export function grayToHex(v: number): string {
  const v255 = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `#${v255.toString(16).padStart(2, "0")}${v255.toString(16).padStart(2, "0")}${v255.toString(16).padStart(2, "0")}`;
}
