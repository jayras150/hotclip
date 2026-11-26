/**
 * Pipeline-facing bridge for highlight computation.
 * Re-exports the pure core from src/core/highlight so adapters can reach
 * both the shared computation layer and the I/O-dependent pieces through
 * the same `runtime: "local" | "vast"` seam.
 */
export {
  collectVisionSignal,
  pickVisualNotes,
  planFrameTimes,
  visualPeakRanges,
} from "../../../core/highlight/vision";
export {
  parseSheetVerdicts,
  sanitizeVisibleText,
  visionSystemPrompt,
  sheetUserPrompt,
} from "../../../core/highlight/vision";
