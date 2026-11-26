/**
 * Shared caption-rendering core (pure functions).
 * Strategy-agnostic: payload building, line breaking and keyword fusion
 * have no I/O. Web overlay rendering only differs from libass by the
 * JSON contract, which is what this module exports.
 */
export * from "../../../core/caption-overlay/payload";
