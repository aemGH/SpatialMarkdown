/**
 * Host-provided text measurement context.
 *
 * Pretext needs exactly two things from its measurement backend:
 *   1. `measureText(text)` → `{ width }`
 *   2. `font` (settable string, CSS font shorthand)
 *
 * Any host that can provide these — Browser (OffscreenCanvas),
 * Node (node-canvas), Android (android.graphics.Paint via JNI) —
 * can run the full Spatial Markdown engine without DOM assumptions.
 *
 * @module @spatial/engine/measurement/measurement-context
 */

export interface MeasurementContext {
  /**
   * Measure the rendered width of `text` in the currently-set font.
   * Sub-pixel precision is fine; the engine rounds for serialization.
   */
  measureText(text: string): { width: number };

  /**
   * CSS font shorthand string (e.g., "14px Inter"). Setting this
   * prepares the context for subsequent `measureText()` calls.
   */
  font: string;
}

/** Optional: host-specific engine profile hints for pretext tuning. */
export interface EngineProfile {
  lineFitEpsilon: number;
  carryCJKAfterClosingQuote: boolean;
  preferPrefixWidthsForBreakableRuns: boolean;
  preferEarlySoftHyphenBreak: boolean;
}

/**
 * Factory signature for creating a MeasurementContext.
 * Hosts implement this and pass the result into `createPipeline()`.
 */
export type MeasurementContextFactory = () => MeasurementContext;
