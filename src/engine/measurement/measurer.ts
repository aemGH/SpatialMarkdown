/**
 * Measurement orchestrator.
 *
 * For each `TextMeasurementRequest`:
 *   1. Check the `MeasurementCache` for a cached `PreparedText` handle.
 *   2. On cache miss, call `pretext.prepare(text, font)` and store it.
 *   3. Call `pretext.layout(prepared, maxWidth, lineHeight)` to get
 *      `{ height, lineCount }`.
 *   4. Build a `HeightOnlyMeasurement` result.
 *
 * Requests are sorted by font before measurement so that Pretext's
 * internal canvas context setup (which is per-font) is amortised across
 * all text sharing the same font.
 *
 * @module @spatial/engine/measurement/measurer
 */

import * as pretext from '@chenglou/pretext';
import type { PreparedTextWithSegments as PreparedText } from '@chenglou/pretext';
import type { MeasurementCache } from './cache';
import type { TextMeasurementRequest } from './text-collector';
import type { NodeId, Pixels } from '../../types/primitives';
import type { MeasurementResult } from '../../types/layout';
import { px } from '../../types/primitives';

// ─── Public Interface ────────────────────────────────────────────────

export interface Measurer {
  /**
   * Measure a batch of text requests and return results keyed by NodeId.
   *
   * This is the **hot path** of the layout pipeline. Requests that hit
   * the cache skip `pretext.prepare()` entirely (~0.0002ms per hit vs
   * 1–5ms per miss).
   */
  readonly measureNodes: (
    requests: ReadonlyArray<TextMeasurementRequest>,
  ) => Map<NodeId, MeasurementResult>;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createMeasurer(cache: MeasurementCache): Measurer {
  function measureNodes(
    requests: ReadonlyArray<TextMeasurementRequest>,
  ): Map<NodeId, MeasurementResult> {
    const results = new Map<NodeId, MeasurementResult>();

    if (requests.length === 0) {
      return results;
    }

    // ── Sort by font to amortise Pretext's per-font context setup ──
    const sorted = [...requests].sort((a, b) => {
      if (a.font < b.font) return -1;
      if (a.font > b.font) return 1;
      return 0;
    });

    for (const req of sorted) {
      // 1. Resolve PreparedText — cache hit or miss.
      let prepared: PreparedText | undefined = cache.get(
        req.text,
        req.font,
        req.whiteSpace,
      );

      if (prepared === undefined) {
        // Cache miss — call pretext.prepareWithSegments() to ensure we get
        // line-level detail for rendering.
        prepared = pretext.prepareWithSegments(req.text, req.font, {
          whiteSpace: req.whiteSpace,
        });
        cache.set(req.text, req.font, prepared, req.whiteSpace);
      }

      // 2. Call pretext.layoutWithLines() — fast (~0.0005ms).
      //    Returns { height, lineCount, lines: { text, width }[] }.
      const layoutResult = pretext.layoutWithLines(
        prepared,
        req.maxWidth,
        req.lineHeight,
      );

      // 3. Build the MeasurementResult.
      const lines = buildLineDetails(req.text, layoutResult.lineCount, req.maxWidth, layoutResult.lines);

      const measurement: MeasurementResult = {
        kind: 'line-detail',
        height: px(layoutResult.height),
        lineCount: layoutResult.lineCount,
        lines,
      };

      results.set(req.nodeId, measurement);
    }

    return results;
  }

  return { measureNodes };
}

// ─── Line Detail Builder ─────────────────────────────────────────────

/**
 * Produce per-line detail from the source text and pretext's lineCount.
 *
 * Strategy:
 *   1. Split on explicit newlines — these are guaranteed breaks.
 *   2. If pretext reports more lines than explicit breaks, distribute
 *      the extra wraps proportionally across the longest explicit lines.
 *   3. Width per line is estimated as the lesser of maxWidth or
 *      (charCount / totalChars) * maxWidth (heuristic — true per-line
 *      widths would need glyph-level data from pretext).
 */
function buildLineDetails(
  text: string,
  _lineCount: number,
  _maxWidth: Pixels,
  pretextLines?: ReadonlyArray<{ readonly text: string; readonly width: number }>,
): ReadonlyArray<{ readonly text: string; readonly width: Pixels }> {
  // Use lines from pretext if available (this provides accurate word wrapping)
  if (pretextLines && pretextLines.length > 0) {
    return pretextLines.map((line) => ({
      text: line.text,
      width: px(line.width),
    }));
  }

  // Fallback to explicit newline splitting if pretext didn't provide lines
  return text.split('\n').map((line) => ({
    text: line,
    width: px(0),
  }));
}
