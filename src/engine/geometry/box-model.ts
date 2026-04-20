/**
 * Box Model — Extract padding and gap from SpatialNode props.
 *
 * Centralizes the logic for reading padding, gap, and edge insets
 * from the heterogeneous props of each node kind. Pure functions.
 *
 * @module @spatial/engine/geometry/box-model
 */

import type { Pixels } from '../../types/primitives';
import { px } from '../../types/primitives';
import type { EdgeInsets } from '../../types/primitives';
import type { SpatialNode } from '../../types/ast';

// ─── Padding Extraction ──────────────────────────────────────────────

/**
 * Extract the four-sided padding from a SpatialNode's props.
 * Handles paddingX/paddingY overrides where present.
 *
 * Nodes without explicit padding return zero insets.
 */
export function getNodePadding(node: SpatialNode): EdgeInsets {
  switch (node.kind) {
    case 'slide': {
      const p = node.props;
      const h = p.paddingX !== undefined ? p.paddingX : p.padding;
      const v = p.paddingY !== undefined ? p.paddingY : p.padding;
      return { top: v, right: h, bottom: v, left: h };
    }

    case 'auto-grid': {
      const pad = node.props.padding;
      return { top: pad, right: pad, bottom: pad, left: pad };
    }

    case 'stack': {
      const p = node.props;
      const h = p.paddingX !== undefined ? p.paddingX : p.padding;
      const v = p.paddingY !== undefined ? p.paddingY : p.padding;
      return { top: v, right: h, bottom: v, left: h };
    }

    case 'columns': {
      const pad = node.props.padding;
      return { top: pad, right: pad, bottom: pad, left: pad };
    }

    case 'canvas': {
      const pad = node.props.padding;
      return { top: pad, right: pad, bottom: pad, left: pad };
    }

    case 'metric-card': {
      const pad = node.props.padding;
      return { top: pad, right: pad, bottom: pad, left: pad };
    }

    case 'code-block': {
      const pad = node.props.padding;
      return { top: pad, right: pad, bottom: pad, left: pad };
    }

    case 'quote': {
      const p = node.props;
      // Quote has explicit paddingLeft (for the border offset) and padding for the rest
      return { top: p.padding, right: p.padding, bottom: p.padding, left: p.paddingLeft };
    }

    case 'callout': {
      const pad = node.props.padding;
      return { top: pad, right: pad, bottom: pad, left: pad };
    }

    // Leaf nodes with no padding
    case 'data-table':
    case 'chart':
    case 'text':
    case 'heading':
    case 'spacer':
    case 'divider':
    case 'image':
      return ZERO_INSETS;
  }
}

// ─── Gap Extraction ──────────────────────────────────────────────────

/**
 * Extract the gap (x, y) from a SpatialNode's props.
 * Returns { x: horizontal gap, y: vertical gap }.
 *
 * For nodes that don't have a gap property, returns zero.
 */
export function getNodeGap(node: SpatialNode): { x: Pixels; y: Pixels } {
  switch (node.kind) {
    case 'auto-grid': {
      const p = node.props;
      return {
        x: p.gapX !== undefined ? p.gapX : p.gap,
        y: p.gapY !== undefined ? p.gapY : p.gap,
      };
    }

    case 'stack': {
      const g = node.props.gap;
      // Stack has a single gap; direction determines which axis it applies to
      if (node.props.direction === 'horizontal') {
        return { x: g, y: px(0) };
      }
      return { x: px(0), y: g };
    }

    case 'columns': {
      const g = node.props.gap;
      // Columns typically have horizontal gap, but if they collapse to vertical,
      // we need the same gap vertically.
      return { x: g, y: g };
    }

    // Containers that use block flow
    case 'slide':
    case 'canvas':
      return { x: px(0), y: px(8) };
    case 'callout':
    case 'quote':
      return { x: px(0), y: px(8) };

    // Leaf nodes — no gap
    case 'metric-card':
    case 'code-block':
    case 'data-table':
    case 'chart':
    case 'text':
    case 'heading':
    case 'spacer':
    case 'divider':
    case 'image':
      return { x: px(0), y: px(0) };
  }
}

// ─── Margin Extraction ───────────────────────────────────────────────

/**
 * Extract vertical margins from a node.
 * Returns { top: Pixels, bottom: Pixels }.
 */
export function getNodeMargin(node: SpatialNode): { top: Pixels; bottom: Pixels } {
  switch (node.kind) {
    case 'heading':
      return { top: px(0), bottom: node.props.marginBottom };
    case 'divider':
      return { top: node.props.marginTop, bottom: node.props.marginBottom };
    case 'spacer':
      // Spacer's height IS its margin effectively, but we treat it as content height.
      return { top: px(0), bottom: px(0) };
    default:
      return { top: px(0), bottom: px(0) };
  }
}

// ─── Constants ───────────────────────────────────────────────────────

const ZERO_INSETS: EdgeInsets = {
  top: px(0),
  right: px(0),
  bottom: px(0),
  left: px(0),
};
