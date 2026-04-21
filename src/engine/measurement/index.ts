/**
 * Pretext Measurement — Cache + batch measure orchestration.
 *
 * Public surface for the measurement module.
 *
 * @module @spatial/engine/measurement
 */

// ── Cache ─────────────────────────────────────────────────────────────
export type { MeasurementCache, CacheStats } from './cache';
export { createMeasurementCache } from './cache';

// ── Font Loader ───────────────────────────────────────────────────────
export type { FontLoader } from './font-loader';
export { createFontLoader } from './font-loader';

// ── Text Collector ────────────────────────────────────────────────────
export type { TextMeasurementRequest } from './text-collector';
export { collectTextRequests } from './text-collector';

// ── Measurer ──────────────────────────────────────────────────────────
export type { Measurer } from './measurer';
export { createMeasurer } from './measurer';
