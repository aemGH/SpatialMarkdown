/**
 * Node measurement context — uses the `canvas` npm package (node-canvas).
 *
 * This is the adapter used by the test suite and golden capture.
 * It requires the `canvas` devDependency to be installed.
 *
 * @module @spatial/engine/measurement/node-canvas-context
 */

import type { MeasurementContext } from './measurement-context';
import { createRequire } from 'node:module';

export function createNodeCanvasMeasurementContext(): MeasurementContext {
  const require = createRequire(import.meta.url);
  const { createCanvas } = require('canvas') as typeof import('canvas');
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d');

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
