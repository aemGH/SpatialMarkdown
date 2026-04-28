/**
 * mount() — Level 0 Zero-Config API.
 *
 * The simplest way to use Spatial Markdown. Give it a DOM element or
 * CSS selector, and it creates everything for you: canvas, pipeline,
 * renderer, resize handling, and auto-flush.
 *
 * @example
 * ```ts
 * import { mount } from '@spatial-markdown/engine';
 *
 * const sm = mount('#chat', { theme: 'dark' });
 * sm.feed('<Slide><Heading level={1}>Hello World</Heading></Slide>');
 * ```
 *
 * @module @spatial-markdown/engine
 */

import type { SpatialApp, CreateAppOptions, ThemeInput, RenderInfo } from './create-app';
import { createApp } from './create-app';
import type { FeedStreamOptions } from '../pipeline';
import type { StreamToken } from '../types/stream';

// ─── Mount Symbol (prevents double-mounting) ─────────────────────────

const MOUNT_SYMBOL = Symbol.for('spatial-markdown-mounted');

interface MountableElement extends HTMLElement {
  [MOUNT_SYMBOL]?: MountedInstance;
}

// ─── Public Interface ────────────────────────────────────────────────

export interface MountOptions {
  /** Theme — string shorthand or full theme object. Default: 'light'. */
  readonly theme?: ThemeInput;

  /** Initial content to render immediately. */
  readonly content?: string;

  /**
   * Resize behavior:
   *  - 'container' (default): auto-resize to container width via ResizeObserver
   *  - 'fixed': use the container's current dimensions and don't observe changes
   *  - { width, height }: explicit fixed dimensions
   */
  readonly resize?: 'container' | 'fixed' | { width: number; height: number };

  /** Called on pipeline errors. Default: console.error. */
  readonly onError?: (error: unknown) => void;

  /** Called on each render frame. */
  readonly onRender?: (info: RenderInfo) => void;

  /** If true, replaces an existing mount on the same target. Default: false. */
  readonly replace?: boolean;

  /** Maximum canvas height in pixels. Default: 8000. */
  readonly maxHeight?: number;
}

export interface MountedInstance {
  /** Feed a chunk of Spatial Markdown text. */
  feed(chunk: string): void;

  /** Feed a complete document (auto-flushes). */
  feedComplete(markup: string): void;

  /**
   * Connect a ReadableStream or AsyncIterable (e.g., from an LLM API).
   * Resolves when the stream is fully consumed and rendered.
   */
  feedStream(
    stream: ReadableStream<string | StreamToken> | AsyncIterable<string>,
    options?: FeedStreamOptions,
  ): Promise<void>;

  /** Clear content and reset for fresh rendering. */
  clear(): void;

  /** Synchronously flush any pending layout pass. */
  flush(): void;

  /** Tear down the mount: removes canvas, disconnects observers, frees memory. */
  destroy(): void;

  /** Escape hatch: access the underlying Level 1 SpatialApp. */
  readonly app: SpatialApp;
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Mount a Spatial Markdown renderer into a DOM element.
 *
 * @param target - An HTMLElement or a CSS selector string.
 * @param options - Optional configuration.
 * @returns A MountedInstance with feed/stream/destroy controls.
 *
 * @example
 * ```ts
 * // Minimal — 2 lines
 * const sm = mount('#output');
 * sm.feed('<Slide><Heading level={1}>Hello</Heading></Slide>');
 *
 * // With streaming from an LLM
 * const sm = mount('#output', { theme: 'dark' });
 * const response = await fetch('/api/llm', { method: 'POST', body: prompt });
 * await sm.feedStream(response.body!);
 *
 * // Cleanup
 * sm.destroy();
 * ```
 */
export function mount(
  target: HTMLElement | string,
  options?: MountOptions,
): MountedInstance {
  const {
    theme,
    content,
    resize: resizeOption = 'container',
    onError,
    onRender,
    replace = false,
    maxHeight,
  } = options ?? {};

  // ── Resolve target element ──────────────────────────────────────
  const element = resolveTarget(target);

  // ── Check for existing mount ────────────────────────────────────
  const mountable = element as MountableElement;
  if (mountable[MOUNT_SYMBOL]) {
    if (replace) {
      mountable[MOUNT_SYMBOL].destroy();
    } else {
      throw new Error(
        '[SpatialMarkdown] Target element already has a mounted instance. ' +
        'Call destroy() first or pass { replace: true }.',
      );
    }
  }

  // ── Create canvas element ───────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  // Height is managed by the app (fit-content mode)
  element.appendChild(canvas);

  // ── Resolve resize options ──────────────────────────────────────
  let appResizeMode: 'observe' | 'manual' = 'observe';
  let initialWidth: number | undefined;
  let initialHeight: number | undefined;

  if (resizeOption === 'fixed') {
    appResizeMode = 'manual';
    initialWidth = element.clientWidth || 800;
    initialHeight = element.clientHeight || 600;
  } else if (typeof resizeOption === 'object') {
    appResizeMode = 'manual';
    initialWidth = resizeOption.width;
    initialHeight = resizeOption.height;
  }
  // 'container' → 'observe' (default)

  // ── Create Level 1 app ──────────────────────────────────────────
  const appOptions: CreateAppOptions = {
    canvas,
    ...(theme !== undefined ? { theme } : {}),
    resize: appResizeMode,
    height: 'fit-content',
    flush: 'stream-end',
    ...(onError !== undefined ? { onError } : {}),
    ...(maxHeight !== undefined ? { maxHeight } : {}),
  };

  const app = createApp(appOptions);

  // Apply fixed dimensions if specified
  if (initialWidth !== undefined) {
    app.resize(initialWidth, initialHeight);
  }

  // Subscribe to render events if callback provided
  if (onRender) {
    app.on('render', onRender);
  }

  // ── Feed initial content ────────────────────────────────────────
  if (content) {
    app.feedComplete(content);
  }

  // ── Build mounted instance ──────────────────────────────────────
  const instance: MountedInstance = {
    feed(chunk: string): void {
      app.feed(chunk);
    },

    feedComplete(markup: string): void {
      app.feedComplete(markup);
    },

    feedStream(
      stream: ReadableStream<string | StreamToken> | AsyncIterable<string>,
      streamOptions?: FeedStreamOptions,
    ): Promise<void> {
      return app.feedStream(stream, streamOptions);
    },

    clear(): void {
      app.clear();
    },

    flush(): void {
      app.flush();
    },

    destroy(): void {
      app.destroy();
      // Remove canvas from DOM
      if (canvas.parentElement === element) {
        element.removeChild(canvas);
      }
      // Clear mount symbol
      delete mountable[MOUNT_SYMBOL];
    },

    get app() { return app; },
  };

  // Mark element as mounted
  mountable[MOUNT_SYMBOL] = instance;

  return instance;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target === 'string') {
    const el = document.querySelector<HTMLElement>(target);
    if (!el) {
      throw new Error(
        `[SpatialMarkdown] mount() target not found: "${target}". ` +
        'Pass a valid CSS selector or HTMLElement.',
      );
    }
    return el;
  }
  return target;
}
