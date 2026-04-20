/**
 * Layout constraint, measurement, and geometry types.
 *
 * @module @spatial/types/layout
 */

import type { Pixels, NodeId } from './primitives';
import type { NodeKind } from './ast';

// ─── Layout Constraints (top-down) ──────────────────────────────────

export interface LayoutConstraint {
  readonly maxWidth: Pixels;
  readonly maxHeight: Pixels;
  readonly availableWidth: Pixels;
  readonly availableHeight: Pixels;
}

// ─── Measurement Results ─────────────────────────────────────────────

export type MeasurementResult =
  | HeightOnlyMeasurement
  | LineDetailMeasurement;

export interface HeightOnlyMeasurement {
  readonly kind: 'height-only';
  readonly height: Pixels;
  readonly lineCount: number;
}

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
