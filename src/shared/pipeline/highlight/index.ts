/**
 * Shared highlight-computation core (pure functions).
 * Strategy-agnostic: conditional on `runtime: "local" | "vast"` only via
 * injected LLM/Deps; planning, scoring and formatting are pure.
 */
export * from "./colors";
export * from "./vision";
