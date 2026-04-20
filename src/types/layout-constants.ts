/**
 * Shared layout constants for measurement and rendering.
 *
 * @module @spatial/types/layout-constants
 */

import { px, font } from './primitives';
import type { Pixels, FontDescriptor } from './primitives';

// MetricCard Constants
export const METRIC_VALUE_FONT: FontDescriptor = font('800 32px Inter');
export const METRIC_DELTA_FONT: FontDescriptor = font('600 13px Inter');
export const METRIC_FOOTER_FONT: FontDescriptor = font('500 11px Inter');

export const METRIC_VALUE_LINE_HEIGHT: Pixels = px(40);
export const METRIC_DELTA_LINE_HEIGHT: Pixels = px(18);
export const METRIC_FOOTER_LINE_HEIGHT: Pixels = px(14);

export const METRIC_LABEL_VALUE_GAP_SCALE = 1; // theme.spacing.xs
export const METRIC_VALUE_DELTA_GAP: Pixels = px(6);
export const METRIC_DELTA_FOOTER_GAP: Pixels = px(4);

// Callout Constants
export const CALLOUT_TITLE_FONT: FontDescriptor = font('700 15px Inter');
export const CALLOUT_TITLE_LINE_HEIGHT: Pixels = px(22);

// Quote Constants
export const QUOTE_FONT: FontDescriptor = font('italic 500 15px Georgia, "Times New Roman", serif');
export const QUOTE_LINE_HEIGHT: Pixels = px(24);
export const QUOTE_CITE_FONT: FontDescriptor = font('500 12px Inter');
export const QUOTE_CITE_LINE_HEIGHT: Pixels = px(16);

// DataTable Constants
export const TABLE_HEADER_FONT: FontDescriptor = font('600 11px Inter');
export const TABLE_BODY_FONT: FontDescriptor = font('500 13px Inter');
export const TABLE_HEADER_HEIGHT: Pixels = px(32);
export const TABLE_ROW_HEIGHT: Pixels = px(36);
export const TABLE_ROW_HEIGHT_COMPACT: Pixels = px(28);
export const TABLE_CELL_PADDING_X: Pixels = px(12);

// Chart Constants
export const CHART_TITLE_FONT: FontDescriptor = font('600 14px Inter');
export const CHART_TITLE_LINE_HEIGHT: Pixels = px(20);
export const CHART_LABEL_FONT: FontDescriptor = font('500 11px Inter');
export const CHART_LABEL_LINE_HEIGHT: Pixels = px(14);
export const CHART_LEGEND_HEIGHT: Pixels = px(22);
export const CHART_AXIS_LABEL_HEIGHT: Pixels = px(16);
