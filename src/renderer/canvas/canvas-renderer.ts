/**
 * Canvas 2D Renderer — RenderCommand[] → canvas pixels.
 *
 * High-performance 2D rendering backend that maps renderer-agnostic
 * draw commands to the Canvas 2D API. Supports HiDPI scaling.
 *
 * @module @spatial/renderer/canvas/canvas-renderer
 */

import type {
  RenderCommand,
  FillRectCommand,
  StrokeRectCommand,
  FillTextCommand,
  DrawImageCommand,
  ClipRectCommand,
  DrawLineCommand,
} from '../../types/render';
// Pixels and px used only in type signatures — consumers pass branded values

// ─── Public Interface ────────────────────────────────────────────────

export interface CanvasRenderer {
  /** Render a batch of commands to the canvas. Clears before drawing. */
  readonly render: (commands: ReadonlyArray<RenderCommand>) => void;
  /** Clear the entire canvas. */
  readonly clear: () => void;
  /** Resize the canvas to new logical dimensions. Applies DPR scaling. */
  readonly resize: (width: number, height: number) => void;
  /** Set the device pixel ratio for HiDPI rendering. */
  readonly setDPR: (dpr: number) => void;
  /** Release resources and detach from canvas. */
  readonly destroy: () => void;
}

// ─── Image Cache ─────────────────────────────────────────────────────

/**
 * Simple image cache to avoid re-creating HTMLImageElement on every frame.
 * Maps src URL → loaded HTMLImageElement.
 */
interface ImageCache {
  readonly get: (src: string) => HTMLImageElement | undefined;
  readonly load: (
    src: string,
    onLoad: (img: HTMLImageElement) => void,
  ) => void;
  readonly clear: () => void;
}

function createImageCache(): ImageCache {
  const cache = new Map<string, HTMLImageElement>();
  const pending = new Set<string>();

  return {
    get(src: string): HTMLImageElement | undefined {
      return cache.get(src);
    },

    load(src: string, onLoad: (img: HTMLImageElement) => void): void {
      // Already cached
      const existing = cache.get(src);
      if (existing !== undefined) {
        onLoad(existing);
        return;
      }

      // Already loading
      if (pending.has(src)) {
        return;
      }

      pending.add(src);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        pending.delete(src);
        cache.set(src, img);
        onLoad(img);
      };
      img.onerror = () => {
        pending.delete(src);
      };
      img.src = src;
    },

    clear(): void {
      cache.clear();
      pending.clear();
    },
  };
}

// ─── Rounded Rect Helper ─────────────────────────────────────────────

/**
 * Traces a rounded rectangle path on the given context.
 * Falls back to a regular rect when borderRadius is 0.
 */
function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }

  // Clamp radius to half the smallest dimension
  const clampedR = Math.min(r, w / 2, h / 2);

  // Use native roundRect if available (Chrome 99+, Firefox 112+, Safari 15.4+)
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, clampedR);
    return;
  }

  // Manual fallback for older browsers
  ctx.moveTo(x + clampedR, y);
  ctx.lineTo(x + w - clampedR, y);
  ctx.arcTo(x + w, y, x + w, y + clampedR, clampedR);
  ctx.lineTo(x + w, y + h - clampedR);
  ctx.arcTo(x + w, y + h, x + w - clampedR, y + h, clampedR);
  ctx.lineTo(x + clampedR, y + h);
  ctx.arcTo(x, y + h, x, y + h - clampedR, clampedR);
  ctx.lineTo(x, y + clampedR);
  ctx.arcTo(x, y, x + clampedR, y, clampedR);
  ctx.closePath();
}

// ─── Command Dispatch ────────────────────────────────────────────────

function executeFillRect(
  ctx: CanvasRenderingContext2D,
  cmd: FillRectCommand,
): void {
  ctx.fillStyle = cmd.color;

  if (cmd.borderRadius > 0) {
    ctx.beginPath();
    traceRoundedRect(ctx, cmd.x, cmd.y, cmd.width, cmd.height, cmd.borderRadius);
    ctx.fill();
  } else {
    ctx.fillRect(cmd.x, cmd.y, cmd.width, cmd.height);
  }
}

function executeStrokeRect(
  ctx: CanvasRenderingContext2D,
  cmd: StrokeRectCommand,
): void {
  ctx.strokeStyle = cmd.color;
  ctx.lineWidth = cmd.lineWidth;

  // For crisp lines (especially 1px borders), offset by 0.5px when thickness is odd.
  // We also subtract 1px from width/height for 1px strokes to stay within the logical box.
  const isOdd = Math.round(cmd.lineWidth) % 2 !== 0;
  const offset = isOdd ? 0.5 : 0;
  const x = cmd.x + offset;
  const y = cmd.y + offset;
  const w = isOdd ? cmd.width - 1 : cmd.width;
  const h = isOdd ? cmd.height - 1 : cmd.height;

  if (cmd.borderRadius > 0) {
    ctx.beginPath();
    traceRoundedRect(ctx, x, y, w, h, cmd.borderRadius);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, w, h);
  }
}

function executeFillText(
  ctx: CanvasRenderingContext2D,
  cmd: FillTextCommand,
): void {
  ctx.font = cmd.font;
  ctx.fillStyle = cmd.color;
  ctx.textBaseline = 'top';
  
  if (cmd.align === 'right') {
    ctx.textAlign = 'right';
  } else if (cmd.align === 'center') {
    ctx.textAlign = 'center';
  } else {
    ctx.textAlign = 'left';
  }

  // Handle multi-line text: split on \n and advance y by lineHeight
  const lines = cmd.text.split('\n');
  let currentY: number = cmd.y;

  for (const line of lines) {
    if (cmd.maxWidth > 0) {
      ctx.fillText(line, cmd.x, currentY, cmd.maxWidth);
    } else {
      ctx.fillText(line, cmd.x, currentY);
    }
    currentY += cmd.lineHeight;
  }
}

function executeDrawImage(
  ctx: CanvasRenderingContext2D,
  cmd: DrawImageCommand,
  imageCache: ImageCache,
  requestRedraw: () => void,
): void {
  if (cmd.src.length === 0) {
    // Empty src — nothing to draw
    return;
  }

  const cached = imageCache.get(cmd.src);
  if (cached !== undefined) {
    ctx.drawImage(cached, cmd.x, cmd.y, cmd.width, cmd.height);
    return;
  }

  // Start async load; redraw when complete
  imageCache.load(cmd.src, (img) => {
    ctx.drawImage(img, cmd.x, cmd.y, cmd.width, cmd.height);
    requestRedraw();
  });
}

function executeClipRect(
  ctx: CanvasRenderingContext2D,
  cmd: ClipRectCommand,
): void {
  ctx.save();
  ctx.beginPath();
  traceRoundedRect(ctx, cmd.x, cmd.y, cmd.width, cmd.height, cmd.borderRadius);
  ctx.clip();
}

function executeRestoreClip(ctx: CanvasRenderingContext2D): void {
  ctx.restore();
}

function executeDrawLine(
  ctx: CanvasRenderingContext2D,
  cmd: DrawLineCommand,
): void {
  ctx.strokeStyle = cmd.color;
  ctx.lineWidth = cmd.lineWidth;
  ctx.lineCap = 'round';

  // Offset by 0.5px for odd-width lines to ensure they hit pixel centers.
  const isOdd = Math.round(cmd.lineWidth) % 2 !== 0;
  const offset = isOdd ? 0.5 : 0;

  ctx.beginPath();
  ctx.moveTo(cmd.x1 + offset, cmd.y1 + offset);
  ctx.lineTo(cmd.x2 + offset, cmd.y2 + offset);
  ctx.stroke();
}

// ─── Renderer Factory ────────────────────────────────────────────────

function getContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Failed to get Canvas 2D rendering context');
  }
  return ctx;
}

/**
 * Creates a Canvas 2D rendering backend.
 *
 * @param canvas - The HTMLCanvasElement to render into.
 * @returns A CanvasRenderer instance.
 *
 * @example
 * ```ts
 * const renderer = createCanvasRenderer(document.getElementById('canvas') as HTMLCanvasElement);
 * renderer.resize(800, 600);
 * renderer.render(commands);
 * ```
 */
export function createCanvasRenderer(canvas: HTMLCanvasElement): CanvasRenderer {
  const ctx: CanvasRenderingContext2D = getContext2D(canvas);

  let dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  let logicalWidth: number = canvas.width;
  let logicalHeight: number = canvas.height;
  let destroyed = false;
  let pendingCommands: ReadonlyArray<RenderCommand> | null = null;

  const imageCache = createImageCache();

  // ── Internal Helpers ─────────────────────────────────────────────

  function applyDPRScaling(): void {
    // Set physical canvas size
    canvas.width = Math.round(logicalWidth * dpr);
    canvas.height = Math.round(logicalHeight * dpr);

    // Set CSS display size
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;

    // Scale context so draw calls use logical coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function requestRedraw(): void {
    if (destroyed || pendingCommands === null) return;
    // Re-render the last command batch (e.g., after an image loads)
    renderCommands(pendingCommands);
  }

  function renderCommands(commands: ReadonlyArray<RenderCommand>): void {
    if (destroyed) return;

    // Automatically adapt to browser zoom / DPR changes on the fly
    if (typeof window !== 'undefined' && window.devicePixelRatio !== dpr) {
      dpr = window.devicePixelRatio;
      applyDPRScaling();
    }

    // Clear with identity transform to cover full physical canvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    for (const cmd of commands) {
      executeCommand(cmd);
    }
  }

  function executeCommand(cmd: RenderCommand): void {
    switch (cmd.kind) {
      case 'fill-rect':
        executeFillRect(ctx, cmd);
        break;
      case 'stroke-rect':
        executeStrokeRect(ctx, cmd);
        break;
      case 'fill-text':
        executeFillText(ctx, cmd);
        break;
      case 'draw-image':
        executeDrawImage(ctx, cmd, imageCache, requestRedraw);
        break;
      case 'clip-rect':
        executeClipRect(ctx, cmd);
        break;
      case 'restore-clip':
        executeRestoreClip(ctx);
        break;
      case 'draw-line':
        executeDrawLine(ctx, cmd);
        break;
    }
  }

  // ── Initialize ───────────────────────────────────────────────────

  applyDPRScaling();

  // ── Public API ───────────────────────────────────────────────────

  return {
    render(commands: ReadonlyArray<RenderCommand>): void {
      if (destroyed) return;
      pendingCommands = commands;
      renderCommands(commands);
    },

    clear(): void {
      if (destroyed) return;
      pendingCommands = null;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    },

    resize(width: number, height: number): void {
      if (destroyed) return;
      logicalWidth = width;
      logicalHeight = height;
      applyDPRScaling();
    },

    setDPR(newDpr: number): void {
      if (destroyed) return;
      dpr = newDpr;
      applyDPRScaling();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      pendingCommands = null;
      imageCache.clear();

      // Clear canvas
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    },
  };
}
