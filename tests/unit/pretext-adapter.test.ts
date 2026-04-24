/**
 * Pretext fork smoke test.
 *
 * Verifies that our forked measurement module accepts an injected
 * MeasurementContext and that pretext's layout functions work with it.
 * This catches upstream pretext changes that break our monkey-patch
 * or internal assumptions.
 *
 * @module tests/unit/pretext-adapter
 */

import { describe, it, expect } from 'vitest';
import { createNodeCanvasMeasurementContext } from '../../src/engine/measurement/node-canvas-context';
import { setMeasureContext, getMeasureContext } from '../../src/engine/measurement/pretext-fork/measurement.js';

describe('Pretext fork measurement injection', () => {
  it('accepts an injected MeasurementContext', () => {
    const ctx = createNodeCanvasMeasurementContext();
    setMeasureContext(ctx);

    const resolved = getMeasureContext();
    expect(resolved).toBe(ctx);
  });

  it('measureText returns a finite width via injected context', () => {
    const ctx = createNodeCanvasMeasurementContext();
    setMeasureContext(ctx);

    const result = ctx.measureText('hello');
    expect(Number.isFinite(result.width)).toBe(true);
    expect(result.width).toBeGreaterThan(0);
  });

  it('font setter is reflected on subsequent measureText calls', () => {
    const ctx = createNodeCanvasMeasurementContext();
    setMeasureContext(ctx);

    ctx.font = '16px sans-serif';
    const small = ctx.measureText('M').width;

    ctx.font = '32px sans-serif';
    const large = ctx.measureText('M').width;

    expect(large).toBeGreaterThan(small);
  });
});
