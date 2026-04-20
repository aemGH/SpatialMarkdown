/**
 * FrameScheduler — Coalesces layout/render updates into a single
 * requestAnimationFrame callback per frame.
 *
 * Design:
 *   - Only the *most recent* callback survives. Multiple `feed()` calls
 *     within a single frame are batched automatically — only the final
 *     layout pass runs.
 *   - In Node.js (no rAF), falls back to `setTimeout(cb, 16)` (~60fps).
 *   - `flush()` executes the pending callback synchronously and cancels
 *     the scheduled frame, useful for tests and SSR.
 *   - `destroy()` cancels any pending frame without executing.
 *
 * Performance target: zero allocations on the hot path (scheduleUpdate
 * with an already-pending frame just swaps the function pointer).
 *
 * @module @spatial-markdown/engine
 */

// ─── Public Interface ────────────────────────────────────────────────

export interface FrameScheduler {
  /**
   * Schedule a callback to run on the next animation frame.
   * If a frame is already pending, the previous callback is replaced
   * (latest wins). If no frame is pending, a new one is requested.
   */
  readonly scheduleUpdate: (callback: () => void) => void;

  /**
   * Synchronously execute the pending callback (if any) and cancel
   * the scheduled animation frame. No-op if nothing is pending.
   */
  readonly flush: () => void;

  /**
   * Cancel any pending animation frame without executing the callback.
   * After calling destroy(), scheduleUpdate() becomes a no-op.
   */
  readonly destroy: () => void;
}

// ─── Environment Detection ───────────────────────────────────────────

/**
 * Returns a rAF/cancelRAF pair. In browser environments, uses the
 * native `requestAnimationFrame`. In Node.js (or environments without
 * rAF), falls back to `setTimeout` with a ~16ms delay (~60fps).
 */
function getRAFPair(): {
  readonly request: (cb: () => void) => number;
  readonly cancel: (id: number) => void;
} {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    return {
      request: (cb: () => void): number => requestAnimationFrame(cb),
      cancel: (id: number): void => cancelAnimationFrame(id),
    };
  }

  // Fallback for Node.js / non-browser environments
  return {
    request: (cb: () => void): number => setTimeout(cb, 16) as unknown as number,
    cancel: (id: number): void => clearTimeout(id),
  };
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createFrameScheduler(): FrameScheduler {
  const raf = getRAFPair();

  let pendingCallback: (() => void) | null = null;
  let frameHandle: number | null = null;
  let destroyed = false;

  /**
   * The rAF callback. Captures and clears the pending state before
   * invoking the callback, so a new scheduleUpdate() inside the
   * callback correctly requests another frame.
   */
  function onFrame(): void {
    frameHandle = null;
    const cb = pendingCallback;
    pendingCallback = null;

    if (cb !== null) {
      cb();
    }
  }

  function scheduleUpdate(callback: () => void): void {
    if (destroyed) return;

    // Always store the latest callback (last-writer wins)
    pendingCallback = callback;

    // Only request a new frame if one isn't already pending
    if (frameHandle === null) {
      frameHandle = raf.request(onFrame);
    }
  }

  function flush(): void {
    if (pendingCallback === null) return;

    // Cancel the pending rAF since we're executing synchronously
    if (frameHandle !== null) {
      raf.cancel(frameHandle);
      frameHandle = null;
    }

    const cb = pendingCallback;
    pendingCallback = null;
    cb();
  }

  function destroy(): void {
    destroyed = true;
    pendingCallback = null;

    if (frameHandle !== null) {
      raf.cancel(frameHandle);
      frameHandle = null;
    }
  }

  return { scheduleUpdate, flush, destroy };
}
