/**
 * Layout Mode Constraint Resolvers
 *
 * Each resolver takes a container SpatialNode and the parent's LayoutConstraint,
 * then computes the LayoutConstraint for each child. These are pure functions —
 * no DOM, no side effects, sub-millisecond execution.
 *
 * @module @spatial/engine/constraints/layout-modes
 */

import type { Pixels } from '../../types/primitives';
import { px } from '../../types/primitives';
import type { LayoutConstraint } from '../../types/layout';
import type {
  SpatialNode,
  AutoGridProps,
  StackProps,
  ColumnsProps,
} from '../../types/ast';
import { getVisibleChildren } from '../tree-utils';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Subtract padding from a dimension, clamped to zero. */
function subtractPadding(
  dimension: Pixels,
  paddingStart: Pixels,
  paddingEnd: Pixels,
): Pixels {
  return px(Math.max(0, dimension - paddingStart - paddingEnd));
}

/** Resolve paddingX/paddingY overrides → horizontal and vertical padding. */
function resolveHorizontalPadding(
  padding: Pixels,
  paddingX: Pixels | undefined,
): Pixels {
  return paddingX !== undefined ? paddingX : padding;
}

function resolveVerticalPadding(
  padding: Pixels,
  paddingY: Pixels | undefined,
): Pixels {
  return paddingY !== undefined ? paddingY : padding;
}

/** Create a uniform constraint for N children. */
function uniformConstraints(
  count: number,
  constraint: LayoutConstraint,
): LayoutConstraint[] {
  const result: LayoutConstraint[] = [];
  for (let i = 0; i < count; i++) {
    result.push(constraint);
  }
  return result;
}

// ─── Block Constraint Resolver ───────────────────────────────────────

/**
 * Block flow: each child gets the full content width of the parent.
 * Used by: slide, canvas, callout, quote, and any container
 * that stacks children vertically with full-width children.
 */
export function resolveBlockConstraints(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
): LayoutConstraint[] {
  const children = getVisibleChildren(node);
  if (children.length === 0) return [];

  // Determine content area from parent constraint and node's own padding
  const { contentWidth, contentHeight } = computeContentArea(node, parentConstraint);

  const childConstraint: LayoutConstraint = {
    maxWidth: contentWidth,
    maxHeight: contentHeight,
    availableWidth: contentWidth,
    availableHeight: contentHeight,
  };

  return uniformConstraints(children.length, childConstraint);
}

// ─── Stack Constraint Resolver ───────────────────────────────────────

/**
 * Stack layout: vertical stacks give full width; horizontal stacks
 * divide width equally among children minus gaps.
 */
export function resolveStackConstraints(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
): LayoutConstraint[] {
  if (node.kind !== 'stack') {
    return resolveBlockConstraints(node, parentConstraint);
  }

  const props: StackProps = node.props;
  const children = getVisibleChildren(node);
  if (children.length === 0) return [];

  const hPad = resolveHorizontalPadding(props.padding, props.paddingX);
  const vPad = resolveVerticalPadding(props.padding, props.paddingY);

  const contentWidth = subtractPadding(parentConstraint.availableWidth, hPad, hPad);
  const contentHeight = subtractPadding(parentConstraint.availableHeight, vPad, vPad);

  if (props.direction === 'vertical') {
    // Vertical stack: each child gets full content width.
    // Available height is shared, but we don't pre-divide — let geometry handle it.
    const totalGap = px(Math.max(0, (children.length - 1)) * props.gap);
    const availHeight = px(Math.max(0, contentHeight - totalGap));

    const childConstraint: LayoutConstraint = {
      maxWidth: contentWidth,
      maxHeight: availHeight,
      availableWidth: contentWidth,
      availableHeight: availHeight,
    };

    return uniformConstraints(children.length, childConstraint);
  }

  // Horizontal stack: divide width by children count minus gaps.
  const childCount = children.length;
  const totalGap = px(Math.max(0, (childCount - 1)) * props.gap);
  const distributableWidth = px(Math.max(0, contentWidth - totalGap));
  const childWidth = px(Math.max(0, distributableWidth / childCount));

  const childConstraint: LayoutConstraint = {
    maxWidth: childWidth,
    maxHeight: contentHeight,
    availableWidth: childWidth,
    availableHeight: contentHeight,
  };

  return uniformConstraints(childCount, childConstraint);
}

// ─── Grid Constraint Resolver ────────────────────────────────────────

/**
 * AutoGrid: compute column count from minChildWidth (or explicit columns),
 * then each child gets (contentWidth - (cols-1)*gapX) / cols.
 */
export function resolveGridConstraints(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
): LayoutConstraint[] {
  if (node.kind !== 'auto-grid') {
    return resolveBlockConstraints(node, parentConstraint);
  }

  const props: AutoGridProps = node.props;
  const children = getVisibleChildren(node);
  if (children.length === 0) return [];

  const padding = props.padding;
  const contentWidth = subtractPadding(parentConstraint.availableWidth, padding, padding);
  const contentHeight = subtractPadding(parentConstraint.availableHeight, padding, padding);

  const gapX = props.gapX !== undefined ? props.gapX : props.gap;

  // Determine column count
  let cols: number;
  if (props.columns === 'auto') {
    // Compute how many columns of minChildWidth fit with gaps
    if (props.minChildWidth <= 0) {
      cols = 1;
    } else {
      // Formula: contentWidth >= cols * minChildWidth + (cols-1) * gapX
      // => contentWidth + gapX >= cols * (minChildWidth + gapX)
      // => cols = floor((contentWidth + gapX) / (minChildWidth + gapX))
      cols = Math.max(
        1,
        Math.floor((contentWidth + gapX) / (props.minChildWidth + gapX)),
      );
    }
  } else {
    cols = Math.max(1, props.columns);
  }

  const totalGapX = px(Math.max(0, (cols - 1)) * gapX);
  const childWidth = px(Math.max(0, (contentWidth - totalGapX) / cols));

  const childConstraint: LayoutConstraint = {
    maxWidth: childWidth,
    maxHeight: contentHeight,
    availableWidth: childWidth,
    availableHeight: contentHeight,
  };

  return uniformConstraints(children.length, childConstraint);
}

// ─── Columns Constraint Resolver ─────────────────────────────────────

/**
 * Columns: parse widths string like "1fr 2fr" or "300px auto",
 * compute proportional widths per column.
 *
 * Width spec grammar:
 *   - "1fr"   → fractional unit
 *   - "300px" → fixed pixel width
 *   - "auto"  → treated as 1fr
 *   - Whitespace separated, one per child
 *   - If fewer specs than children, remaining children get 1fr
 *   - If more specs than children, extra specs are ignored
 */
export function resolveColumnsConstraints(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
): LayoutConstraint[] {
  if (node.kind !== 'columns') {
    return resolveBlockConstraints(node, parentConstraint);
  }

  const props: ColumnsProps = node.props;
  const children = getVisibleChildren(node);
  if (children.length === 0) return [];

  const padding = props.padding;
  const contentWidth = subtractPadding(parentConstraint.availableWidth, padding, padding);
  const contentHeight = subtractPadding(parentConstraint.availableHeight, padding, padding);
  const gap = props.gap;

  // Parse width specs
  const specs = parseColumnWidths(props.widths, children.length);

  // Calculate total gap
  const totalGap = px(Math.max(0, (children.length - 1)) * gap);

  // First pass: sum fixed pixels, count total fr units
  let fixedTotal = 0;
  let frTotal = 0;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (spec === undefined) continue;
    if (spec.unit === 'px') {
      fixedTotal += spec.value;
    } else {
      frTotal += spec.value;
    }
  }

  // Remaining space for fr units
  const remainingForFr = Math.max(0, contentWidth - totalGap - fixedTotal);
  const pxPerFr = frTotal > 0 ? remainingForFr / frTotal : 0;

  // Responsive breakpoint: if any fr-based column would be narrower than
  // MIN_COLUMN_WIDTH, collapse ALL columns to full-width stacked layout.
  const MIN_COLUMN_WIDTH = 150;
  let shouldCollapse = false;
  if (frTotal > 0 && children.length > 1) {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (spec === undefined || spec.unit === 'fr') {
        const fr = spec?.value ?? 1;
        if (fr * pxPerFr < MIN_COLUMN_WIDTH) {
          shouldCollapse = true;
          break;
        }
      }
    }
  }

  if (shouldCollapse) {
    // Collapse: every child gets full content width (stacked vertically)
    const result: LayoutConstraint[] = [];
    for (let i = 0; i < children.length; i++) {
      result.push({
        maxWidth: contentWidth,
        maxHeight: contentHeight,
        availableWidth: contentWidth,
        availableHeight: contentHeight,
      });
    }
    return result;
  }

  // Second pass: compute per-child constraints
  const result: LayoutConstraint[] = [];

  for (let i = 0; i < children.length; i++) {
    const spec = specs[i];
    let childWidth: Pixels;

    if (spec === undefined || spec.unit === 'fr') {
      const fr = spec?.value ?? 1;
      childWidth = px(Math.max(0, fr * pxPerFr));
    } else {
      // Fixed px — clamp to available width
      childWidth = px(Math.min(spec.value, contentWidth));
    }

    result.push({
      maxWidth: childWidth,
      maxHeight: contentHeight,
      availableWidth: childWidth,
      availableHeight: contentHeight,
    });
  }

  return result;
}

// ─── Column Width Parsing ────────────────────────────────────────────

interface ColumnSpec {
  readonly value: number;
  readonly unit: 'fr' | 'px';
}

function parseColumnWidths(
  widths: string,
  childCount: number,
): ReadonlyArray<ColumnSpec> {
  const tokens = widths.trim().split(/\s+/);
  const result: ColumnSpec[] = [];

  for (let i = 0; i < childCount; i++) {
    const token = i < tokens.length ? tokens[i] : undefined;

    if (token === undefined || token === 'auto' || token === '') {
      // Default: 1fr
      result.push({ value: 1, unit: 'fr' });
    } else if (token.endsWith('fr')) {
      const numStr = token.slice(0, -2);
      const value = parseFloat(numStr);
      result.push({
        value: Number.isFinite(value) && value > 0 ? value : 1,
        unit: 'fr',
      });
    } else if (token.endsWith('px')) {
      const numStr = token.slice(0, -2);
      const value = parseFloat(numStr);
      result.push({
        value: Number.isFinite(value) && value >= 0 ? value : 0,
        unit: 'px',
      });
    } else {
      // Try parsing as a bare number (treated as px)
      const value = parseFloat(token);
      if (Number.isFinite(value) && value >= 0) {
        result.push({ value, unit: 'px' });
      } else {
        // Fallback: 1fr
        result.push({ value: 1, unit: 'fr' });
      }
    }
  }

  return result;
}

// ─── Shared Utilities ────────────────────────────────────────────────

/**
 * Compute the content area (width, height) of a node given its parent constraint.
 * This deducts the node's own padding from the available space.
 */
function computeContentArea(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
): { contentWidth: Pixels; contentHeight: Pixels } {
  switch (node.kind) {
    case 'slide': {
      const p = node.props;
      const hPad = resolveHorizontalPadding(p.padding, p.paddingX);
      const vPad = resolveVerticalPadding(p.padding, p.paddingY);
      // Slides define their own dimensions
      const w = p.width > 0 ? p.width : parentConstraint.availableWidth;
      const h = p.height > 0 ? p.height : parentConstraint.availableHeight;
      return {
        contentWidth: subtractPadding(w, hPad, hPad),
        contentHeight: subtractPadding(h, vPad, vPad),
      };
    }
    case 'auto-grid': {
      const p = node.props;
      return {
        contentWidth: subtractPadding(parentConstraint.availableWidth, p.padding, p.padding),
        contentHeight: subtractPadding(parentConstraint.availableHeight, p.padding, p.padding),
      };
    }
    case 'stack': {
      const p = node.props;
      const hPad = resolveHorizontalPadding(p.padding, p.paddingX);
      const vPad = resolveVerticalPadding(p.padding, p.paddingY);
      return {
        contentWidth: subtractPadding(parentConstraint.availableWidth, hPad, hPad),
        contentHeight: subtractPadding(parentConstraint.availableHeight, vPad, vPad),
      };
    }
    case 'columns': {
      const p = node.props;
      return {
        contentWidth: subtractPadding(parentConstraint.availableWidth, p.padding, p.padding),
        contentHeight: subtractPadding(parentConstraint.availableHeight, p.padding, p.padding),
      };
    }
    case 'canvas': {
      const p = node.props;
      const w = p.width === 'fill' ? parentConstraint.availableWidth : p.width;
      const h = p.height === 'auto' ? parentConstraint.availableHeight : p.height;
      return {
        contentWidth: subtractPadding(w, p.padding, p.padding),
        contentHeight: subtractPadding(h, p.padding, p.padding),
      };
    }
    case 'callout': {
      const p = node.props;
      return {
        contentWidth: subtractPadding(parentConstraint.availableWidth, p.padding, p.padding),
        contentHeight: subtractPadding(parentConstraint.availableHeight, p.padding, p.padding),
      };
    }
    case 'quote': {
      const p = node.props;
      // Quotes have paddingLeft + padding on right
      return {
        contentWidth: subtractPadding(parentConstraint.availableWidth, p.paddingLeft, p.padding),
        contentHeight: subtractPadding(parentConstraint.availableHeight, p.padding, p.padding),
      };
    }
    default: {
      // Leaf nodes — return parent's constraint as content area
      return {
        contentWidth: parentConstraint.availableWidth,
        contentHeight: parentConstraint.availableHeight,
      };
    }
  }
}
