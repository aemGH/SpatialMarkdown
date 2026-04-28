/**
 * createApp() — Level 1 Production API.
 *
 * Single object that owns the pipeline + canvas renderer + their coordination.
 * Auto-resizes, auto-flushes, auto content-height — but the developer owns
 * the canvas element.
 *
 * @module @spatial-markdown/engine
 */

import type { SpatialPipeline, FeedStreamOptions } from '../pipeline';
import { createPipeline } from '../pipeline';
import type { CanvasRenderer } from '../renderer/canvas/canvas-renderer';
import { createCanvasRenderer } from '../renderer/canvas/canvas-renderer';
import type { RenderCommand } from '../types/render';
import type { LayoutInfo } from '../types/layout';
import type { ThemeConfig } from '../types/theme';
import { defaultTheme, darkTheme, highContrastTheme } from '../types/theme';
import type { EngineConfig } from '../config';
import type { StreamToken } from '../types/stream';

// ─── Theme Resolution ────────────────────────────────────────────────

/** Theme input — string shorthand or full ThemeConfig object. */
export type ThemeInput = 'light' | 'dark' | 'auto' | 'high-contrast' | ThemeConfig;

function resolveTheme(input: ThemeInput | undefined): ThemeConfig {
  if (input === undefined || input === 'light') return defaultTheme;
  if (input === 'dark') return darkTheme;
  if (input === 'high-contrast') return highContrastTheme;
  if (input === 'auto') {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return darkTheme;
    }
    return defaultTheme;
  }
  return input;
}

// ─── Public Interface ────────────────────────────────────────────────

export interface CreateAppOptions {
  /** The canvas element to render into. Required. */
  readonly canvas: HTMLCanvasElement;

  /** Theme — string shorthand or full ThemeConfig object. Default: 'light'. */
  readonly theme?: ThemeInput;

  /**
   * Resize behavior:
   *  - 'observe': ResizeObserver on canvas parent (default)
   *  - 'manual': you call app.resize() yourself
   */
  readonly resize?: 'observe' | 'manual';

  /**
   * Height behavior:
   *  - 'fit-content' (default): canvas grows vertically to fit rendered content
   *  - 'fixed': canvas height stays at provided initial value
   */
  readonly height?: 'fit-content' | 'fixed';

  /**
   * Auto-flush behavior:
   *  - 'stream-end' (default): flushes automatically when feedStream() finishes
   *  - 'manual': you call app.flush() yourself (for tests/SSR)
   */
  readonly flush?: 'stream-end' | 'manual';

  /** Maximum canvas height in pixels (prevents memory issues). Default: 8000. */
  readonly maxHeight?: number;

  /** Minimum canvas height in pixels. Default: 200. */
  readonly minHeight?: number;

  /** Bottom padding added below content for breathing room. Default: 32. */
  readonly contentPadding?: number;

  /** Power-user escape: forwarded directly to createPipeline(). */
  readonly advanced?: Partial<EngineConfig>;

  /** Called on pipeline errors if no 'error' event listener is attached. */
  readonly onError?: (error: unknown) => void;
}

/** Render event info passed to subscribers. */
export interface RenderInfo {
  readonly commands: ReadonlyArray<RenderCommand>;
  readonly layout: LayoutInfo;
  readonly renderTimeMs: number;
  readonly frameCount: number;
}

/** Resize event info. */
export interface ResizeInfo {
  readonly width: number;
  readonly height: number;
}

export interface SpatialApp {
  // ── Content ─────────────────────────────────────────────────────
  /** Feed a chunk of Spatial Markdown text. */
  feed(chunk: string): void;
  /** Feed a complete document and auto-flush. Convenience for static content. */
  feedComplete(markup: string): void;
  /**
   * Connect a ReadableStream or AsyncIterable to the pipeline.
   * Returns a Promise that resolves when the stream is fully consumed.
   * If flush mode is 'stream-end' (default), flushes automatically on completion.
   */
  feedStream(
    stream: ReadableStream<string | StreamToken> | AsyncIterable<string>,
    options?: FeedStreamOptions,
  ): Promise<void>;
  /** Clear the canvas and reset for fresh content. */
  clear(): void;
  /** Synchronously execute any pending layout pass. */
  flush(): void;

  // ── Layout ──────────────────────────────────────────────────────
  /** Resize the viewport width. Height auto-adjusts in 'fit-content' mode. */
  resize(width: number, height?: number): void;
  /** Get the current computed content height. */
  readonly contentHeight: number;
  /** Get the current viewport dimensions. */
  readonly viewport: { readonly width: number; readonly height: number };

  // ── Events ──────────────────────────────────────────────────────
  on(event: 'render', cb: (info: RenderInfo) => void): () => void;
  on(event: 'error', cb: (error: unknown) => void): () => void;
  on(event: 'resize', cb: (info: ResizeInfo) => void): () => void;

  // ── Lifecycle ───────────────────────────────────────────────────
  /** Tear down the app. Cancels observers, destroys pipeline and renderer. */
  destroy(): void;

  // ── Escape Hatches (Level 2) ────────────────────────────────────
  /** Direct access to the underlying pipeline (Level 2). */
  readonly pipeline: SpatialPipeline;
  /** Direct access to the underlying canvas renderer (Level 2). */
  readonly renderer: CanvasRenderer;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createApp(options: CreateAppOptions): SpatialApp {
  const {
    canvas,
    theme: themeInput,
    resize: resizeMode = 'observe',
    height: heightMode = 'fit-content',
    flush: flushMode = 'stream-end',
    maxHeight = 8000,
    minHeight = 200,
    contentPadding = 32,
    advanced,
    onError,
  } = options;

  // ── Resolve theme ───────────────────────────────────────────────
  const resolvedTheme = resolveTheme(themeInput);

  // ── Create Level 2 primitives ───────────────────────────────────
  const pipelineConfig: Partial<EngineConfig> = {
    theme: resolvedTheme,
    ...advanced,
  };

  let pipeline: SpatialPipeline = createPipeline(pipelineConfig);
  let canvasRenderer: CanvasRenderer = createCanvasRenderer(canvas);

  // ── State ───────────────────────────────────────────────────────
  let destroyed = false;
  let currentContentHeight = 0;
  let frameCount = 0;
  let viewportWidth = canvas.parentElement?.clientWidth || canvas.width || 800;
  let viewportHeight = heightMode === 'fixed' ? (canvas.height || 600) : minHeight;

  // Event subscribers
  const renderListeners: Set<(info: RenderInfo) => void> = new Set();
  const errorListeners: Set<(error: unknown) => void> = new Set();
  const resizeListeners: Set<(info: ResizeInfo) => void> = new Set();

  // ── Wire pipeline events ────────────────────────────────────────
  function wireEvents(): void {
    pipeline.onError((error: unknown) => {
      if (errorListeners.size > 0) {
        errorListeners.forEach((cb) => cb(error));
      } else if (onError) {
        onError(error);
      } else {
        console.error('[SpatialApp] Error:', error);
      }
    });

    pipeline.onRender((commands: ReadonlyArray<RenderCommand>, info: LayoutInfo) => {
      if (destroyed) return;

      // Auto-resize canvas height to fit content
      if (heightMode === 'fit-content') {
        const neededH = Math.min(
          maxHeight,
          Math.max(minHeight, Math.ceil(info.contentHeight + contentPadding)),
        );
        if (neededH !== viewportHeight) {
          viewportHeight = neededH;
          canvasRenderer.resize(viewportWidth, viewportHeight);
        }
      }

      // Render to canvas
      const t0 = performance.now();
      canvasRenderer.render(commands);
      const renderTimeMs = performance.now() - t0;

      frameCount++;
      currentContentHeight = info.contentHeight;

      // Notify render listeners
      if (renderListeners.size > 0) {
        const renderInfo: RenderInfo = {
          commands,
          layout: info,
          renderTimeMs,
          frameCount,
        };
        renderListeners.forEach((cb) => cb(renderInfo));
      }
    });
  }

  wireEvents();

  // ── Initial sizing ──────────────────────────────────────────────
  canvasRenderer.resize(viewportWidth, viewportHeight);
  pipeline.resize(viewportWidth, viewportHeight);

  // ── ResizeObserver (width-only) ─────────────────────────────────
  let resizeObserver: ResizeObserver | null = null;
  let resizeGuard = false;

  if (resizeMode === 'observe' && typeof ResizeObserver !== 'undefined') {
    const observeTarget = canvas.parentElement ?? canvas;
    resizeObserver = new ResizeObserver((entries) => {
      if (destroyed || resizeGuard) return;
      const entry = entries[0];
      if (!entry) return;

      const boxSize = entry.contentBoxSize?.[0];
      const newWidth = boxSize
        ? Math.round(boxSize.inlineSize)
        : Math.round(entry.contentRect.width);

      if (newWidth > 0 && newWidth !== viewportWidth) {
        resizeGuard = true;
        resizeApp(newWidth);
        resizeGuard = false;
      }
    });
    resizeObserver.observe(observeTarget);
  }

  // ── Internal helpers ────────────────────────────────────────────

  function resizeApp(width: number, height?: number): void {
    if (destroyed) return;
    viewportWidth = Math.max(1, Math.round(width));
    if (height !== undefined) {
      viewportHeight = Math.max(minHeight, Math.round(height));
    }
    canvasRenderer.resize(viewportWidth, viewportHeight);
    pipeline.resize(viewportWidth, viewportHeight);

    resizeListeners.forEach((cb) => cb({ width: viewportWidth, height: viewportHeight }));
  }

  function rebuildPipeline(): void {
    pipeline.destroy();
    canvasRenderer.clear();

    pipeline = createPipeline(pipelineConfig);
    wireEvents();
    pipeline.resize(viewportWidth, viewportHeight);

    frameCount = 0;
    currentContentHeight = 0;
  }

  // ── Public API ──────────────────────────────────────────────────

  function feed(chunk: string): void {
    if (destroyed) return;
    pipeline.feed(chunk);
  }

  function feedComplete(markup: string): void {
    if (destroyed) return;
    pipeline.feed(markup);
    pipeline.flush();
  }

  async function feedStream(
    stream: ReadableStream<string | StreamToken> | AsyncIterable<string>,
    streamOptions?: FeedStreamOptions,
  ): Promise<void> {
    if (destroyed) return;

    // Convert AsyncIterable to ReadableStream if needed
    let readableStream: ReadableStream<string | StreamToken>;
    if (isReadableStream(stream)) {
      readableStream = stream;
    } else {
      readableStream = asyncIterableToReadableStream(stream);
    }

    // Wrap the stream to detect completion
    return new Promise<void>((resolve, reject) => {
      const [forPipeline, forMonitor] = readableStream.tee();

      // Feed the pipeline with one branch
      pipeline.feedStream(forPipeline, streamOptions);

      // Monitor the other branch for completion
      const reader = forMonitor.getReader();
      (async () => {
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
          // Stream complete — auto-flush if configured
          if (flushMode === 'stream-end' && !destroyed) {
            pipeline.flush();
          }
          resolve();
        } catch (err) {
          if (flushMode === 'stream-end' && !destroyed) {
            pipeline.flush();
          }
          reject(err);
        }
      })();
    });
  }

  function clear(): void {
    if (destroyed) return;
    rebuildPipeline();
  }

  function flush(): void {
    if (destroyed) return;
    pipeline.flush();
  }

  function on(event: 'render' | 'error' | 'resize', cb: unknown): () => void {
    switch (event) {
      case 'render': {
        const typedCb = cb as (info: RenderInfo) => void;
        renderListeners.add(typedCb);
        return () => { renderListeners.delete(typedCb); };
      }
      case 'error': {
        const typedCb = cb as (error: unknown) => void;
        errorListeners.add(typedCb);
        return () => { errorListeners.delete(typedCb); };
      }
      case 'resize': {
        const typedCb = cb as (info: ResizeInfo) => void;
        resizeListeners.add(typedCb);
        return () => { resizeListeners.delete(typedCb); };
      }
      default:
        return () => {};
    }
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    pipeline.destroy();
    canvasRenderer.destroy();

    renderListeners.clear();
    errorListeners.clear();
    resizeListeners.clear();
  }

  return {
    feed,
    feedComplete,
    feedStream,
    clear,
    flush,
    resize: resizeApp,
    get contentHeight() { return currentContentHeight; },
    get viewport() { return { width: viewportWidth, height: viewportHeight }; },
    on,
    destroy,
    get pipeline() { return pipeline; },
    get renderer() { return canvasRenderer; },
  };
}

// ─── Utility Functions ───────────────────────────────────────────────

function isReadableStream(
  value: ReadableStream<string | StreamToken> | AsyncIterable<string>,
): value is ReadableStream<string | StreamToken> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getReader' in value &&
    typeof (value as ReadableStream<unknown>).getReader === 'function'
  );
}

function asyncIterableToReadableStream(
  iterable: AsyncIterable<string>,
): ReadableStream<string> {
  return new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const chunk of iterable) {
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
