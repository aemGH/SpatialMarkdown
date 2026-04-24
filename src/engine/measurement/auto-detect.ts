/**
 * Auto-detect the best MeasurementContext for the current runtime.
 *
 * Priority:
 *   1. If the caller passed an explicit context, use it.
 *   2. If `OffscreenCanvas` is available (browser), use it.
 *   3. Otherwise throw with a helpful error.
 *
 * @module @spatial/engine/measurement/auto-detect
 */

import type { MeasurementContext } from './measurement-context';
import { createBrowserMeasurementContext } from './browser-context';

export function autoDetectMeasurementContext(
  explicit?: MeasurementContext,
): MeasurementContext {
  if (explicit !== undefined) {
    return explicit;
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    return createBrowserMeasurementContext();
  }

  throw new Error(
    'No MeasurementContext available. Pass one explicitly via `createPipeline({ measurementContext: ctx })`, ' +
    'or ensure the environment provides OffscreenCanvas.',
  );
}
