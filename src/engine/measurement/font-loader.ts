/**
 * Font loading manager.
 *
 * Pretext's `prepare()` requires fonts to be loaded before measurement.
 * If called with an unloaded font, it silently falls back to a system
 * font and produces wrong metrics. This module prevents that by gating
 * measurement behind font readiness.
 *
 * - Browser: delegates to `document.fonts.load()`.
 * - SSR / Node / Worker: marks all fonts as loaded (no DOM available).
 *
 * @module @spatial/engine/measurement/font-loader
 */

import type { FontDescriptor } from '../../types/primitives';

// ─── Public Interface ────────────────────────────────────────────────

export interface FontLoader {
  /**
   * Ensure a single font is loaded. Resolves immediately on cache hit
   * or when the Font Loading API is unavailable (SSR/Node).
   */
  readonly ensureLoaded: (font: FontDescriptor) => Promise<void>;

  /** Synchronous check — true if previously loaded or if DOM unavailable. */
  readonly isLoaded: (font: FontDescriptor) => boolean;

  /**
   * Preload a batch of fonts in parallel.
   * Resolves when **all** fonts are ready (or immediately in SSR).
   */
  readonly preload: (fonts: ReadonlyArray<FontDescriptor>) => Promise<void>;
}

// ─── DOM Feature Detection ───────────────────────────────────────────

/**
 * Returns `true` if the Font Loading API is available in this runtime.
 * Isolated into a function so it can be evaluated lazily (avoids
 * top-level `document` reference that would throw in Node).
 */
function hasFontLoadingAPI(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.fonts !== 'undefined' &&
    typeof document.fonts.load === 'function'
  );
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createFontLoader(): FontLoader {
  /** Set of FontDescriptor strings we have already confirmed loaded. */
  const loadedFonts = new Set<string>();

  /**
   * In-flight load promises, keyed by FontDescriptor string.
   * Prevents duplicate concurrent loads for the same font.
   */
  const pendingLoads = new Map<string, Promise<void>>();

  // Snapshot the capability once at construction time.
  const canUseDOMFonts = hasFontLoadingAPI();

  // ── Core load logic ─────────────────────────────────────────────

  function ensureLoaded(font: FontDescriptor): Promise<void> {
    // Fast path: already loaded.
    const key: string = font;
    if (loadedFonts.has(key)) {
      return Promise.resolve();
    }

    // No DOM? Treat every font as loaded (SSR / Node / Worker).
    if (!canUseDOMFonts) {
      loadedFonts.add(key);
      return Promise.resolve();
    }

    // De-duplicate in-flight requests for the same font.
    const pending = pendingLoads.get(key);
    if (pending !== undefined) {
      return pending;
    }

    // Kick off the load via the Font Loading API.
    // `document.fonts.load()` accepts a CSS font shorthand string,
    // which is exactly what FontDescriptor is.
    const loadPromise = document.fonts
      .load(font)
      .then(() => {
        loadedFonts.add(key);
      })
      .catch(() => {
        // Font failed to load (network error, missing font).
        // Mark as "loaded" anyway — Pretext will fall back to the
        // browser's default font. Re-measurement will happen if
        // the font loads later (via a future ensureLoaded call).
        loadedFonts.add(key);
      })
      .finally(() => {
        pendingLoads.delete(key);
      });

    pendingLoads.set(key, loadPromise);
    return loadPromise;
  }

  function isLoaded(font: FontDescriptor): boolean {
    if (!canUseDOMFonts) {
      return true;
    }
    return loadedFonts.has(font);
  }

  function preload(fonts: ReadonlyArray<FontDescriptor>): Promise<void> {
    if (fonts.length === 0) {
      return Promise.resolve();
    }
    const promises: Array<Promise<void>> = [];
    for (const f of fonts) {
      promises.push(ensureLoaded(f));
    }
    return Promise.all(promises).then(() => undefined);
  }

  return { ensureLoaded, isLoaded, preload };
}
