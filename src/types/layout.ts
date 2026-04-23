/**
 * Layout constraint, measurement, and geometry types.
 *
 * @module @spatial/types/layout
 */

import type { Pixels, NodeId } from './primitives';
import type { NodeKind } from './ast';

// ─── Layout Constraints (top-down) ──────────────────────────────────

/** Top-down size constraints passed from parent to child during layout. */
export interface LayoutConstraint {
  readonly maxWidth: Pixels;
  readonly maxHeight: Pixels;
  readonly availableWidth: Pixels;
  readonly availableHeight: Pixels;
}

// ─── Measurement Results ─────────────────────────────────────────────

/** Result of measuring a node's content — either a simple height or per-line detail. */
export type MeasurementResult =
  | HeightOnlyMeasurement
  | LineDetailMeasurement;

/** Lightweight measurement that only reports total height and line count. */
export interface HeightOnlyMeasurement {
  readonly kind: 'height-only';
  readonly height: Pixels;
  readonly lineCount: number;
}

/** Full measurement including per-line text and width for hit-testing and rendering. */
export interface LineDetailMeasurement {
  readonly kind: 'line-detail';
  readonly height: Pixels;
  readonly lineCount: number;
  readonly lines: ReadonlyArray<{
    readonly text: string;
    readonly width: Pixels;
  }>;
}

// ─── Layout Box (absolute coordinates) ───────────────────────────────

/** Resolved layout geometry for a single node in absolute document coordinates. */
export interface LayoutBox {
  readonly nodeId: NodeId;
  readonly kind: NodeKind;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly contentX: Pixels;
  readonly contentY: Pixels;
  readonly contentWidth: Pixels;
  readonly contentHeight: Pixels;
  readonly children: ReadonlyArray<LayoutBox>;
  readonly measurement: MeasurementResult | null;
  readonly clipChildren: boolean;
  readonly scrollable: boolean;
}
