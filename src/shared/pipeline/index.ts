/**
 * HotClip Pipeline — shared computation library.
 *
 * This is the runtime-agnostic core of HotClip. It holds *pure* functions
 * (planning, scoring, composition, encoding selection) extracted from
 * src/core/* so both the local Electron app and the Vast.ai container
 * worker can import the same logic without a fork.
 *
 * Strategy: every computation function is mounted with a
 * `runtime: "local" | "vast"` parameter. Pure functions have **no**
 * "vast" strategy — they are strategy-agnostic by construction. Only
 * I/O (ffmpeg probes, image extraction, LLM calls, model loading) is
 * strategy-specific and goes through the `Deps` injection contract.
 */

export * from "./video-encoder";
export * from "./reframe";
export * from "./emotion";
export * from "./diarize";
export * from "./highlight";
export * from "./caption-overlay";
export * from "./contact-sheet";
export * from "./transcribe";
export * from "./pipeline";
