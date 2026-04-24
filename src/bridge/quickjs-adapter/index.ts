/**
 * QuickJS Android Adapter
 *
 * This entry point is built into an IIFE bundle and loaded by the
 * QuickJS runtime on Android. It:
 *   1. Wraps `globalThis.PaintBridge` (injected by Kotlin) as a
 *      MeasurementContext for the forked pretext.
 *   2. Creates the SpatialPipeline via `createPipeline()`.
 *   3. Exposes `window.SpatialEngine` so Kotlin can call `init()`,
 *      `feed()`, `resize()`, and `destroy()`.
 *   4. Pushes render commands back to Kotlin via
 *      `globalThis.AndroidSpatialBridge.onRenderCommands()`.
 *
 * Build: `npm run build:quickjs`
 * Output: `dist/quickjs/index.js` → copied to Android assets.
 *
 * @module src/bridge/quickjs-adapter
 */

import { createPipeline } from '../../pipeline';
import { darkTheme } from '../../types/theme';
import { setMeasureContext } from '../../engine/measurement/pretext-fork/measurement.js';
import type { MeasurementContext } from '../../engine/measurement/measurement-context';

declare global {
  interface Window {
    /** Injected by Kotlin — bridges to android.graphics.Paint. */
    PaintBridge?: {
      measureText(text: string, font: string): number;
    };
    /** Injected by Kotlin — receives JSON render commands. */
    AndroidSpatialBridge?: {
      onRenderCommands(jsonString: string): void;
    };
    SpatialEngine: {
      init(width: number, height: number, themeMode?: 'light' | 'dark'): void;
      feed(text: string): void;
      resize(width: number, height: number): void;
      destroy(): void;
    };
  }
}

// ─── Build MeasurementContext from PaintBridge ─────────────────────

function createPaintMeasurementContext(): MeasurementContext {
  const bridge = window.PaintBridge;
  if (!bridge) {
    throw new Error(
      'PaintBridge is not available on globalThis. ' +
      'Ensure Kotlin SpatialEngine registers it before evaluating this bundle.',
    );
  }

  let currentFont = '16px sans-serif';

  return {
    measureText(text: string) {
      return { width: bridge.measureText(text, currentFont) };
    },
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
    },
  };
}

// ─── Engine bootstrap ──────────────────────────────────────────────

(() => {
  let pipeline: any = null;
  let flushTimer: any = null;
  const FLUSH_DELAY = 250;

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (pipeline && typeof pipeline.flush === 'function') {
        pipeline.flush();
      }
    }, FLUSH_DELAY);
  }

  window.SpatialEngine = {
    init(e, n, i = 'light') {
      if (pipeline) this.destroy();
      const measureCtx = createPaintMeasurementContext();
      setMeasureContext(measureCtx);
      const config: any = { measurementContext: measureCtx };
      if (i === 'dark') config.theme = darkTheme;
      pipeline = createPipeline(config);
      pipeline.resize(e, n);
      pipeline.onRender((commands: any) => {
        if (window.AndroidSpatialBridge) {
          window.AndroidSpatialBridge.onRenderCommands(JSON.stringify(commands));
        } else {
          console.warn('AndroidSpatialBridge not attached — render commands dropped.');
        }
      });
    },

    feed(text: string) {
      if (pipeline && typeof pipeline.feed === 'function') {
        pipeline.feed(text);
        scheduleFlush();
      } else {
        console.warn('SpatialEngine: Pipeline not initialized. Call init() first.');
      }
    },

    resize(width: number, height: number) {
      if (pipeline && typeof pipeline.resize === 'function') {
        pipeline.resize(width, height);
      }
    },

    flush() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pipeline && typeof pipeline.flush === 'function') {
        pipeline.flush();
      }
    },

    destroy() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pipeline && typeof pipeline.destroy === 'function') {
        pipeline.destroy();
      }
      pipeline = null;
    },
  };
})();
