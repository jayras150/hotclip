/**
 * Shared transcription pipeline — pure, strategy-agnostic core.
 * Deps injection contract: callers supply `TranscribeDeps` (I/O);
 * pure functions (segmentation, alignment, scoring, quality) have no I/O.
 */
export * from "./transcribe/types";
export * from "./transcribe/punctuate";
export * from "./transcribe/segment";
