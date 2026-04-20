/**
 * Backpressure controller with hysteresis.
 *
 * Monitors buffer utilization and signals pause/resume to the upstream
 * producer (Python SDK) via configurable callbacks. Uses hysteresis
 * (high/low watermarks) to avoid oscillating between states when
 * utilization hovers near a single threshold.
 *
 * - Pause when utilization > highWatermark (default 0.75)
 * - Resume when utilization < lowWatermark (default 0.25)
 * - Never re-fires if already in the target state
 *
 * @module @spatial/bridge/buffer/backpressure
 */

// ─── Options ─────────────────────────────────────────────────────────

export interface BackpressureOptions {
  /** Utilization ratio (0–1) above which to signal pause. Default 0.75. */
  readonly highWatermark?: number | undefined;

  /** Utilization ratio (0–1) below which to signal resume. Default 0.25. */
  readonly lowWatermark?: number | undefined;

  /** Called when the controller transitions to the paused state. */
  readonly onPause: () => void;

  /** Called when the controller transitions to the resumed state. */
  readonly onResume: () => void;
}

// ─── Public Interface ────────────────────────────────────────────────

export interface BackpressureController {
  /**
   * Evaluate the current utilization and fire pause/resume if the
   * state transition is warranted. Safe to call on every write.
   */
  readonly check: (utilization: number) => void;

  /** True when the controller is currently in the paused state. */
  readonly isPaused: () => boolean;

  /** Reset to the initial (unpaused) state without firing callbacks. */
  readonly reset: () => void;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createBackpressureController(
  options: BackpressureOptions,
): BackpressureController {
  const highWatermark = options.highWatermark ?? 0.75;
  const lowWatermark = options.lowWatermark ?? 0.25;

  if (highWatermark < 0 || highWatermark > 1) {
    throw new RangeError(
      `highWatermark must be between 0 and 1, got ${String(highWatermark)}`,
    );
  }
  if (lowWatermark < 0 || lowWatermark > 1) {
    throw new RangeError(
      `lowWatermark must be between 0 and 1, got ${String(lowWatermark)}`,
    );
  }
  if (lowWatermark >= highWatermark) {
    throw new RangeError(
      `lowWatermark (${String(lowWatermark)}) must be less than highWatermark (${String(highWatermark)})`,
    );
  }

  let paused = false;

  function check(utilization: number): void {
    if (!paused && utilization > highWatermark) {
      paused = true;
      options.onPause();
    } else if (paused && utilization < lowWatermark) {
      paused = false;
      options.onResume();
    }
  }

  function isPaused(): boolean {
    return paused;
  }

  function reset(): void {
    paused = false;
  }

  return { check, isPaused, reset };
}
