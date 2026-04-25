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
import type { SpatialPipeline } from '../../pipeline';
import type { EngineConfig } from '../../config';
import type { RenderCommand } from '../../types/render';
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
      flush(): void;
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
  let pipeline: SpatialPipeline | null = null;
  let unsubscribeRender: (() => void) | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_DELAY = 250;

  function scheduleFlush(): void {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (pipeline !== null) {
        pipeline.flush();
      }
    }, FLUSH_DELAY);
  }

  window.SpatialEngine = {
    init(width: number, height: number, themeMode: 'light' | 'dark' = 'light') {
      if (pipeline !== null) this.destroy();
      const measureCtx = createPaintMeasurementContext();
      setMeasureContext(measureCtx);
      const config: Partial<EngineConfig> = themeMode === 'dark'
        ? { measurementContext: measureCtx, theme: darkTheme }
        : { measurementContext: measureCtx };
      pipeline = createPipeline(config);
      pipeline.resize(width, height);
      unsubscribeRender = pipeline.onRender((commands: ReadonlyArray<RenderCommand>) => {
        if (window.AndroidSpatialBridge) {
          window.AndroidSpatialBridge.onRenderCommands(JSON.stringify(commands));
        } else {
          console.warn('AndroidSpatialBridge not attached — render commands dropped.');
        }
      });
    },

    feed(text: string) {
      if (pipeline !== null) {
        pipeline.feed(text);
        scheduleFlush();
      } else {
        console.warn('SpatialEngine: Pipeline not initialized. Call init() first.');
      }
    },

    resize(width: number, height: number) {
      if (pipeline !== null) {
        pipeline.resize(width, height);
      }
    },

    flush() {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pipeline !== null) {
        pipeline.flush();
      }
    },

    destroy() {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (unsubscribeRender !== null) {
        unsubscribeRender();
        unsubscribeRender = null;
      }
      if (pipeline !== null) {
        pipeline.destroy();
      }
      pipeline = null;
    },
  };
})();
