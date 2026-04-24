/**
 * Auto-detect the best MeasurementContext for the current runtime.
 *
 * Priority:
 *   1. If the caller passed an explicit context, use it.
 *   2. If `OffscreenCanvas` is available (browser), use it.
 *   3. If `canvas` npm package is resolvable (Node tests), use it.
 *   4. Otherwise throw with a helpful error.
 *
 * @module @spatial/engine/measurement/auto-detect
 */

import type { MeasurementContext } from './measurement-context';
import { createBrowserMeasurementContext } from './browser-context';
import { createNodeCanvasMeasurementContext } from './node-canvas-context';

export function autoDetectMeasurementContext(
  explicit?: MeasurementContext,
): MeasurementContext {
  if (explicit !== undefined) {
    return explicit;
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    return createBrowserMeasurementContext();
  }

  try {
    // Probe for node-canvas presence without a hard top-level require.
    require.resolve('canvas');
    return createNodeCanvasMeasurementContext();
  } catch {
    // node-canvas not installed
  }

  throw new Error(
    'No MeasurementContext available. Pass one explicitly via `createPipeline({ measurementContext: ctx })`, ' +
    'or ensure the environment provides OffscreenCanvas (browser) or the `canvas` npm package (Node).',
  );
}
