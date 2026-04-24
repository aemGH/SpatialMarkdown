/**
 * Browser measurement context — uses OffscreenCanvas.
 *
 * This is the default when `typeof OffscreenCanvas !== 'undefined'`.
 * It matches upstream pretext's original behavior exactly.
 *
 * @module @spatial/engine/measurement/browser-context
 */

import type { MeasurementContext } from './measurement-context';

export function createBrowserMeasurementContext(): MeasurementContext {
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext('2d')!;

  return {
    measureText(text: string) {
      return ctx.measureText(text);
    },
    get font() {
      return ctx.font;
    },
    set font(value: string) {
      ctx.font = value;
    },
  };
}
