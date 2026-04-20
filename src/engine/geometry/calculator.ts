/**
 * Geometry Calculator — Two-pass absolute positioning.
 *
 * Pass 1 (bottom-up): Determine sizes. Leaf nodes get sizes from measurements
 *   or explicit dimensions. Containers sum children sizes plus padding and gaps.
 *
 * Pass 2 (top-down): Assign positions. Root starts at (0,0). Container nodes
 *   apply their layout algorithm to position children with absolute coordinates.
 *
 * Performance target: < 1ms per frame.
 *
 * @module @spatial/engine/geometry/calculator
 */

import type { Pixels, NodeId } from '../../types/primitives';
import { px } from '../../types/primitives';
import type { LayoutConstraint, LayoutBox, MeasurementResult } from '../../types/layout';
import type { SpatialNode } from '../../types/ast';
import type { EdgeInsets } from '../../types/primitives';
import type { ThemeConfig } from '../../types/theme';
import { getNodePadding, getNodeGap, getNodeMargin } from './box-model';
import {
  METRIC_VALUE_LINE_HEIGHT,
  METRIC_DELTA_LINE_HEIGHT,
  METRIC_FOOTER_LINE_HEIGHT,
  METRIC_VALUE_DELTA_GAP,
  METRIC_DELTA_FOOTER_GAP,
  CALLOUT_TITLE_LINE_HEIGHT,
  QUOTE_CITE_LINE_HEIGHT,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
  TABLE_ROW_HEIGHT_COMPACT,
  CHART_TITLE_LINE_HEIGHT,
  CHART_LEGEND_HEIGHT
} from '../../types/layout-constants';
import {
  layoutBlockFlow,
  layoutFlexRow,
  layoutFlexCol,
  layoutGrid,
} from './layout-algorithms';
import type { ChildSize, ChildPosition } from './layout-algorithms';
import { getVisibleChildren } from '../tree-utils';

// ─── Public Interface ────────────────────────────────────────────────

export interface GeometryCalculator {
  /**
   * Full calculate: compute LayoutBox tree for all nodes.
   */
  calculate(
    roots: ReadonlyArray<SpatialNode>,
    constraints: ReadonlyMap<NodeId, LayoutConstraint>,
    measurements: ReadonlyMap<NodeId, MeasurementResult>,
    theme: ThemeConfig,
  ): LayoutBox[];
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createGeometryCalculator(): GeometryCalculator {
  return {
    calculate(
      roots: ReadonlyArray<SpatialNode>,
      constraints: ReadonlyMap<NodeId, LayoutConstraint>,
      measurements: ReadonlyMap<NodeId, MeasurementResult>,
      theme: ThemeConfig,
    ): LayoutBox[] {
      const boxes: LayoutBox[] = [];

      let yOffset = px(0);

      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (root === undefined) continue;
        if (root.kind === 'text' && root.textBuffer.raw.trim().length === 0) continue;

        // Size pass (bottom-up)
        const sized = computeSize(root, constraints, measurements, theme);

        // Position pass (top-down)
        const box = assignPosition(root, sized, px(0), yOffset, constraints, measurements, theme);
        boxes.push(box);

        yOffset = px(yOffset + box.height);
      }

      return boxes;
    },
  };
}


// ─── Internal Types ──────────────────────────────────────────────────

/** Result of the bottom-up size pass. */
interface SizedNode {
  readonly width: Pixels;
  readonly height: Pixels;
  readonly contentWidth: Pixels;
  readonly contentHeight: Pixels;
  readonly childSizes: ReadonlyArray<SizedNode>;
  readonly childPositions: ReadonlyArray<ChildPosition>;
  readonly children: ReadonlyArray<SpatialNode>;
}

// ─── Pass 1: Size Computation (Bottom-Up) ────────────────────────────

function computeSize(
  node: SpatialNode,
  constraints: ReadonlyMap<NodeId, LayoutConstraint>,
  measurements: ReadonlyMap<NodeId, MeasurementResult>,
  theme: ThemeConfig,
): SizedNode {
  const constraint = constraints.get(node.id);
  const availableWidth = constraint?.availableWidth ?? px(0);
  const availableHeight = constraint?.availableHeight ?? px(0);
  const padding = getNodePadding(node);
  const gap = getNodeGap(node);

  // Leaf nodes: size from measurement or explicit dimensions
  if (isLeafNode(node)) {
    const leafSize = computeLeafSize(node, availableWidth, availableHeight, measurements, theme);
    return {
      width: leafSize.width,
      height: leafSize.height,
      contentWidth: px(Math.max(0, leafSize.width - padding.left - padding.right)),
      contentHeight: px(Math.max(0, leafSize.height - padding.top - padding.bottom)),
      childSizes: [],
      childPositions: [],
      children: [],
    };
  }

  // Container nodes: recurse into children first
  const children = getVisibleChildren(node);

  const childSizedNodes: SizedNode[] = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;
    childSizedNodes.push(computeSize(child, constraints, measurements, theme));
  }


  // Convert to ChildSize array for layout algorithms
  const childSizes: ChildSize[] = childSizedNodes.map((s, i) => {
    const childNode = children[i]!;
    const margins = getNodeMargin(childNode);

    return {
      width: s.width,
      height: s.height,
      marginTop: margins.top,
      marginBottom: margins.bottom,
    };
  });

  // Compute content area dimensions (available width minus padding)
  const contentWidth = px(Math.max(0, availableWidth - padding.left - padding.right));

  // Apply layout algorithm to get child positions and determine content height
  const childPositions = computeChildPositions(
    node,
    childSizes,
    contentWidth,
    availableHeight,
    gap,
    padding,
    measurements,
    theme,
  );

  // Content height: the bounding box of all positioned children, 
  // or the intrinsic content height if there are no children.
  const intrinsicHeight = getIntrinsicTopOffset(node, measurements, theme);
  const boundingHeight = computeContentBoundingHeight(childPositions);
  const contentHeight = childPositions.length > 0 ? boundingHeight : intrinsicHeight;

  // Container width: constrained to available
  const containerWidth = availableWidth;

  // Container height: content + vertical padding
  // For nodes with explicit height, use that instead
  const explicitHeight = getExplicitHeight(node, availableHeight);
  let containerHeight = explicitHeight !== null
    ? explicitHeight
    : px(contentHeight + padding.top + padding.bottom);

  // If this is a slide with no explicit height, ensure it is at least the available height
  if (node.kind === 'slide' && explicitHeight === null) {
    containerHeight = px(Math.max(containerHeight, availableHeight));
  }

  return {
    width: containerWidth,
    height: containerHeight,
    contentWidth,
    contentHeight: px(contentHeight),
    childSizes: childSizedNodes,
    childPositions,
    children,
  };
}

// ─── Pass 2: Position Assignment (Top-Down) ──────────────────────────

function assignPosition(
  node: SpatialNode,
  sized: SizedNode,
  x: Pixels,
  y: Pixels,
  constraints: ReadonlyMap<NodeId, LayoutConstraint>,
  measurements: ReadonlyMap<NodeId, MeasurementResult>,
  theme: ThemeConfig,
  overrideWidth?: Pixels,
  overrideHeight?: Pixels,
): LayoutBox {
  const padding = getNodePadding(node);
  const measurement = measurements.get(node.id) ?? null;

  const contentX = px(x + padding.left);
  const contentY = px(y + padding.top);

  // Recurse into children
  const childBoxes = assignChildPositions(
    node,
    sized,
    contentX,
    contentY,
    constraints,
    measurements,
    theme,
  );


  // Determine clipping and scrollable from node kind
  const clipChildren = shouldClipChildren(node);
  const scrollable = isScrollable(node);

  return {
    nodeId: node.id,
    kind: node.kind,
    x,
    y,
    // CRITICAL: Use dimensions from childPositions if available, 
    // as layout algorithms (like Grid or Columns) may have resized the child.
    width: overrideWidth ?? sized.width,
    height: overrideHeight ?? sized.height,
    contentX,
    contentY,
    contentWidth: sized.contentWidth,
    contentHeight: sized.contentHeight,
    children: childBoxes,
    measurement,
    clipChildren,
    scrollable,
  };
}

// ─── Pass 2 Child Position Helper ────────────────────────────────────

/**
 * Assign absolute positions to children.
 */
function assignChildPositions(
  _node: SpatialNode,
  sized: SizedNode,
  contentX: Pixels,
  contentY: Pixels,
  constraints: ReadonlyMap<NodeId, LayoutConstraint>,
  measurements: ReadonlyMap<NodeId, MeasurementResult>,
  theme: ThemeConfig,
): LayoutBox[] {
  const children = sized.children;
  const boxes: LayoutBox[] = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;

    const childSized = sized.childSizes[i];
    const childPos = sized.childPositions[i];

    if (childSized === undefined || childPos === undefined) continue;

    // Child position is relative to the content area
    const childAbsX = px(contentX + childPos.x);
    const childAbsY = px(contentY + childPos.y);

    // Create the child's box, using dimensions from childPos which 
    // represents the "allocated" space from the layout algorithm.
    const childBox = assignPosition(
      child,
      childSized,
      childAbsX,
      childAbsY,
      constraints,
      measurements,
      theme,
      childPos.width,
      childPos.height,
    );

    boxes.push(childBox);
  }

  return boxes;
}


// ─── Layout Algorithm Dispatch ───────────────────────────────────────

function computeChildPositions(
  node: SpatialNode,
  childSizes: ReadonlyArray<ChildSize>,
  contentWidth: Pixels,
  _availableHeight: Pixels,
  gap: { x: Pixels; y: Pixels },
  padding: EdgeInsets,
  measurements: ReadonlyMap<NodeId, MeasurementResult>,
  theme: ThemeConfig,
): ChildPosition[] {
  // Intrinsic offset for nodes with text content/titles that precede children
  const intrinsicOffset = getIntrinsicTopOffset(node, measurements, theme);
  const hasChildren = childSizes.length > 0;
  const gapBeforeChildren = (intrinsicOffset > 0 && hasChildren) ? theme.spacing.xs : 0;
  const totalOffset = intrinsicOffset + gapBeforeChildren;

  if (!hasChildren) {
    return [];
  }

  // Content height for flex alignment (total minus padding and intrinsic content)
  const childrenAvailableHeight = px(Math.max(0, _availableHeight - padding.top - padding.bottom - totalOffset));

  let positions: ChildPosition[] = [];

  switch (node.kind) {
    case 'stack': {
      const props = node.props;
      if (props.direction === 'horizontal') {
        positions = layoutFlexRow(
          childSizes,
          props.gap,
          contentWidth,
          childrenAvailableHeight,
          props.justify,
          props.align,
        );
      } else {
        positions = layoutFlexCol(
          childSizes,
          props.gap,
          contentWidth,
          childrenAvailableHeight,
          props.justify,
          props.align,
        );
      }
      break;
    }

    case 'auto-grid': {
      const props = node.props;
      const gapX = props.gapX !== undefined ? props.gapX : props.gap;
      const gapY = props.gapY !== undefined ? props.gapY : props.gap;

      // Determine column count
      let cols: number;
      if (props.columns === 'auto') {
        if (props.minChildWidth <= 0) {
          cols = 1;
        } else {
          cols = Math.max(
            1,
            Math.floor((contentWidth + gapX) / (props.minChildWidth + gapX)),
          );
        }
      } else {
        cols = Math.max(1, props.columns);
      }

      positions = layoutGrid(childSizes, cols, gapX, gapY, contentWidth);
      break;
    }

    case 'columns': {
      const props = node.props;
      // If all children have the same width as contentWidth, the constraint
      // solver collapsed the columns → use vertical block flow instead.
      const isCollapsed = childSizes.length > 1 && childSizes.every(
        (c) => c !== undefined && Math.abs(c.width - contentWidth) < 1
      );
      if (isCollapsed) {
        positions = layoutBlockFlow(childSizes, props.gap, contentWidth);
      } else {
        positions = layoutColumnsRow(childSizes, props.gap, contentWidth, childrenAvailableHeight, props.valign);
      }
      break;
    }

    case 'quote':
    case 'slide':
    case 'canvas':
      positions = layoutBlockFlow(childSizes, gap.y, contentWidth);
      break;

    case 'callout': {
      positions = layoutBlockFlow(childSizes, gap.y, contentWidth);
      break;
    }

    default:
      return [];
  }

  // Apply total offset (intrinsic content + gap)
  if (totalOffset > 0) {
    return positions.map(pos => ({
      ...pos,
      y: px(pos.y + totalOffset),
    }));
  }

  return positions;
}

/**
 * Get the vertical space occupied by a node's own content (title, textBuffer)
 * that appears before its children.
 */
function getIntrinsicTopOffset(
  node: SpatialNode,
  measurements: ReadonlyMap<NodeId, MeasurementResult>,
  theme: ThemeConfig,
): number {
  const measurement = measurements.get(node.id);
  const textH = measurement !== undefined ? measurement.height : 0;

  switch (node.kind) {
    case 'callout': {
      const hasTitle = node.props.title.length > 0;
      const titleH = hasTitle ? CALLOUT_TITLE_LINE_HEIGHT : 0;
      const titleBodyGap = (hasTitle && textH > 0) ? theme.spacing.xs : 0;
      const bodyH = textH;
      return titleH + titleBodyGap + bodyH;
    }
    case 'quote': {
      // Body text + optional citation line below.
      const hasCite = node.props.cite !== undefined && node.props.cite.length > 0;
      const citeH = hasCite ? QUOTE_CITE_LINE_HEIGHT + theme.spacing.xs : 0;
      return textH + citeH;
    }
    default:
      return 0;
  }
}

/**
 * Layout children in a columns row. Each child already has its width
 * determined by the constraint solver. We just place them horizontally
 * with gap and vertical alignment.
 */
function layoutColumnsRow(
  childSizes: ReadonlyArray<ChildSize>,
  gap: Pixels,
  _containerWidth: Pixels,
  containerHeight: Pixels,
  valign: 'top' | 'center' | 'bottom' | 'stretch',
): ChildPosition[] {
  if (childSizes.length === 0) return [];

  // Find max height for cross-axis alignment
  let maxHeight = 0;
  for (let i = 0; i < childSizes.length; i++) {
    const child = childSizes[i];
    if (child !== undefined && child.height > maxHeight) {
      maxHeight = child.height;
    }
  }

  const crossHeight = containerHeight > 0 ? containerHeight : px(maxHeight);

  const positions: ChildPosition[] = [];
  let x = 0;

  for (let i = 0; i < childSizes.length; i++) {
    const child = childSizes[i];
    if (child === undefined) continue;

    let childY: number;
    let childHeight: number;

    switch (valign) {
      case 'top':
        childY = 0;
        childHeight = child.height;
        break;
      case 'center':
        childY = Math.max(0, (crossHeight - child.height) / 2);
        childHeight = child.height;
        break;
      case 'bottom':
        childY = Math.max(0, crossHeight - child.height);
        childHeight = child.height;
        break;
      case 'stretch':
        childY = 0;
        childHeight = crossHeight;
        break;
    }

    positions.push({
      x: px(x),
      y: px(childY),
      width: child.width,
      height: px(childHeight),
    });

    x += child.width + (i < childSizes.length - 1 ? gap : 0);
  }

  return positions;
}

// ─── Leaf Node Size Computation ──────────────────────────────────────

function computeLeafSize(
  node: SpatialNode,
  availableWidth: Pixels,
  availableHeight: Pixels,
  measurements: ReadonlyMap<NodeId, MeasurementResult>,
  theme: ThemeConfig,
): { width: Pixels; height: Pixels } {
  const measurement = measurements.get(node.id);

  switch (node.kind) {
    case 'text': {
      // Text size comes from measurement
      const height = measurement !== null && measurement !== undefined
        ? measurement.height
        : px(0);
      return { width: availableWidth, height };
    }

    case 'heading': {
      const height = measurement !== null && measurement !== undefined
        ? measurement.height
        : px(0);
      return {
        width: availableWidth,
        height: px(height),
      };
    }

    case 'spacer':
      return {
        width: node.props.width > 0 ? node.props.width : availableWidth,
        height: node.props.height,
      };

    case 'divider': {
      const p = node.props;
      if (p.direction === 'horizontal') {
        return {
          width: px(Math.max(0, availableWidth - p.indent - p.indent)),
          height: px(p.thickness),
        };
      }
      // Vertical divider
      return {
        width: px(p.thickness),
        height: availableHeight,
      };
    }

    case 'image': {
      const p = node.props;
      const imgWidth = p.width === 'fill' ? availableWidth : p.width;

      let imgHeight: Pixels;
      if (p.height === 'auto') {
        // Parse aspect ratio "16:9" or "4:3"
        const ratio = parseAspectRatio(p.aspectRatio);
        imgHeight = ratio > 0 ? px(imgWidth / ratio) : px(imgWidth * 0.5625); // default 16:9
      } else {
        imgHeight = p.height;
      }

      return { width: imgWidth, height: imgHeight };
    }

    case 'metric-card': {
      // MetricCard has a deterministic height calculation:
      // padding + caption(label) + xs-gap + value
      //  [+ value-delta-gap + delta]
      //  [+ delta-footer-gap + footer]
      // + padding
      // Delta and footer now stack on separate lines for visual clarity.
      const p = node.props;
      const paddingTotal = p.padding * 2;
      const captionH = theme.lineHeights.caption;
      const spacing1 = theme.spacing.xs;
      const valueH = METRIC_VALUE_LINE_HEIGHT;

      let height = paddingTotal + captionH + spacing1 + valueH;

      if (p.delta !== undefined) {
        height += METRIC_VALUE_DELTA_GAP + METRIC_DELTA_LINE_HEIGHT;
      }
      if (p.footer !== undefined) {
        // If delta precedes footer, use a tight gap; otherwise use the value→delta gap.
        const gap = p.delta !== undefined ? METRIC_DELTA_FOOTER_GAP : METRIC_VALUE_DELTA_GAP;
        height += gap + METRIC_FOOTER_LINE_HEIGHT;
      }

      return { width: availableWidth, height: px(height) };
    }


    case 'code-block': {
      const p = node.props;
      let height = measurement !== null && measurement !== undefined
        ? px(measurement.height + p.padding * 2)
        : px(p.padding * 2 + p.lineHeight);
      
      // Account for title
      if (p.title !== undefined && p.title.length > 0) {
        height = px(height + CALLOUT_TITLE_LINE_HEIGHT + theme.spacing.xs);
      }
        
      const maxH = p.maxHeight;
      return {
        width: availableWidth,
        height: maxH !== undefined ? px(Math.min(height, maxH)) : height,
      };
    }

    case 'data-table': {
      // Deterministic height from row count. Rows are newline-separated in
      // the textBuffer. We count non-blank rows; the header row is always
      // present (derived from `columns`) regardless of body.
      const p = node.props;
      const rowH = p.compact ? TABLE_ROW_HEIGHT_COMPACT : TABLE_ROW_HEIGHT;
      const rows = countDataTableRows(node);
      const height = px(TABLE_HEADER_HEIGHT + rows * rowH);
      const maxH = p.maxHeight;
      return {
        width: availableWidth,
        height: maxH !== undefined ? px(Math.min(height, maxH)) : height,
      };
    }

    case 'chart': {
      // Reserve deterministic space: title + plot area + legend.
      const p = node.props;
      const w = p.width === 'fill' ? availableWidth : p.width;
      const titleH = p.title !== undefined && p.title.length > 0 ? CHART_TITLE_LINE_HEIGHT + theme.spacing.xs : 0;
      const legendH = p.showLegend ? CHART_LEGEND_HEIGHT : 0;
      // `p.height` is the TOTAL chart height per the spec — plot + title + legend.
      // Guarantee at least 160px of plot area.
      const requested = p.height;
      const minH = titleH + legendH + 160;
      return { width: w, height: px(Math.max(requested, minH)) };
    }

    // Quote and callout are containers that may appear as leaves if they have
    // no child elements — but they can still have textBuffer content that was
    // measured. Use the intrinsic height plus padding for correct sizing.
    case 'quote':
    case 'callout': {
      const intrinsicH = getIntrinsicTopOffset(node, measurements, theme);
      const padding = getNodePadding(node);
      return { 
        width: availableWidth, 
        height: px(intrinsicH + padding.top + padding.bottom) 
      };
    }

    // Layout containers should not reach leaf sizing, but handle for exhaustiveness
    case 'slide':
    case 'auto-grid':
    case 'stack':
    case 'columns':
    case 'canvas':
      return { width: availableWidth, height: availableHeight };
  }
}

/**
 * Count the non-blank data rows in a DataTable's textBuffer.
 * Each newline-separated non-empty line is a row.
 */
function countDataTableRows(node: SpatialNode): number {
  if (node.kind !== 'data-table') return 0;
  const raw = node.textBuffer.raw;
  if (raw.length === 0) return 0;
  let count = 0;
  for (const line of raw.split('\n')) {
    if (line.trim().length > 0) count++;
  }
  return count;
}

// ─── Bounding Box ────────────────────────────────────────────────────

function computeContentBoundingHeight(positions: ReadonlyArray<ChildPosition>): number {
  if (positions.length === 0) return 0;

  let maxBottom = 0;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (pos === undefined) continue;
    const bottom = pos.y + pos.height;
    if (bottom > maxBottom) {
      maxBottom = bottom;
    }
  }

  return maxBottom;
}

// ─── Node Classification ─────────────────────────────────────────────

function isLeafNode(node: SpatialNode): boolean {
  switch (node.kind) {
    case 'metric-card':
    case 'code-block':
    case 'data-table':
    case 'chart':
    case 'text':
    case 'heading':
    case 'spacer':
    case 'divider':
    case 'image':
      return true;
    case 'quote':
    case 'callout':
      // These are containers but with textBuffer — treat as containers
      // since they can hold children. Use visible children for consistency.
      return getVisibleChildren(node).length === 0;
    default:
      return false;
  }
}

function shouldClipChildren(node: SpatialNode): boolean {
  switch (node.kind) {
    case 'canvas':
      return node.props.overflow === 'clip';
    case 'code-block':
      return true; // Always clip code blocks to prevent text bleed-out on long lines
    case 'data-table':
      return node.props.maxHeight !== undefined;
    case 'slide':
      return true;
    default:
      return false;
  }
}

function isScrollable(node: SpatialNode): boolean {
  switch (node.kind) {
    case 'code-block':
      return node.props.maxHeight !== undefined || !node.props.wrap;
    case 'data-table':
      return node.props.maxHeight !== undefined;
    default:
      return false;
  }
}

function getExplicitHeight(node: SpatialNode, _availableHeight: Pixels): Pixels | null {
  switch (node.kind) {
    case 'slide':
      return node.props.height > 0 ? node.props.height : null;
    case 'canvas':
      return node.props.height !== 'auto' ? node.props.height : null;
    case 'chart':
      return node.props.height;
    default:
      return null;
  }
}

// ─── Aspect Ratio Parsing ────────────────────────────────────────────

function parseAspectRatio(ratio: string): number {
  if (!ratio) return 0;

  // Try "W:H" format
  const colonIdx = ratio.indexOf(':');
  if (colonIdx > 0) {
    const w = parseFloat(ratio.slice(0, colonIdx));
    const h = parseFloat(ratio.slice(colonIdx + 1));
    if (Number.isFinite(w) && Number.isFinite(h) && h > 0) {
      return w / h;
    }
  }

  // Try "W/H" format
  const slashIdx = ratio.indexOf('/');
  if (slashIdx > 0) {
    const w = parseFloat(ratio.slice(0, slashIdx));
    const h = parseFloat(ratio.slice(slashIdx + 1));
    if (Number.isFinite(w) && Number.isFinite(h) && h > 0) {
      return w / h;
    }
  }

  // Try bare decimal
  const value = parseFloat(ratio);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  return 0;
}
