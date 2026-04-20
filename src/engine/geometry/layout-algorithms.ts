/**
 * Layout Algorithms — Pure geometric calculations for positioning children.
 *
 * Each algorithm takes an array of child sizes and layout parameters,
 * and returns absolute positions within the container's content area.
 * These are stateless, pure functions. No DOM. Sub-millisecond.
 *
 * @module @spatial/engine/geometry/layout-algorithms
 */

import type { Pixels } from '../../types/primitives';
import { px } from '../../types/primitives';

// ─── Shared Types ────────────────────────────────────────────────────

export interface ChildSize {
  readonly width: Pixels;
  readonly height: Pixels;
  readonly marginTop?: Pixels;
  readonly marginBottom?: Pixels;
}

export interface ChildPosition {
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
}

export type JustifyContent = 'start' | 'center' | 'end' | 'space-between' | 'space-around';
export type AlignItems = 'start' | 'center' | 'end' | 'stretch';

// ─── Block Flow ──────────────────────────────────────────────────────

/**
 * Block flow: children stacked vertically, each taking full container width.
 * Separates children by `gap` pixels.
 *
 * @param childSizes  Intrinsic sizes of each child
 * @param gap         Vertical gap between children
 * @param containerWidth  Width of the content area
 * @returns Positioned children within the container's coordinate space
 */
export function layoutBlockFlow(
  childSizes: ReadonlyArray<ChildSize>,
  gap: Pixels,
  containerWidth: Pixels,
): ChildPosition[] {
  const positions: ChildPosition[] = [];
  let y = px(0);

  for (let i = 0; i < childSizes.length; i++) {
    const child = childSizes[i];
    if (child === undefined) continue;

    // Margin collapse: space between items is max(gap, prev.marginBottom, current.marginTop)
    if (i === 0) {
      y = px(y + (child.marginTop ?? 0));
    } else {
      const prev = childSizes[i - 1]!;
      const marginBetween = Math.max(gap, prev.marginBottom ?? 0, child.marginTop ?? 0);
      y = px(y + marginBetween);
    }

    positions.push({
      x: px(0),
      y,
      width: containerWidth,
      height: child.height,
    });

    y = px(y + child.height);
  }

  return positions;
}

// ─── Flex Row ────────────────────────────────────────────────────────

/**
 * Flex row: children laid out horizontally with justify and cross-axis alignment.
 *
 * @param childSizes     Intrinsic sizes of each child
 * @param gap            Horizontal gap between children
 * @param containerWidth Width of the content area
 * @param containerHeight Height of the content area (for cross-axis alignment)
 * @param justify        Main-axis distribution
 * @param align          Cross-axis alignment
 * @returns Positioned children
 */
export function layoutFlexRow(
  childSizes: ReadonlyArray<ChildSize>,
  gap: Pixels,
  containerWidth: Pixels,
  containerHeight: Pixels,
  justify: JustifyContent,
  align: AlignItems,
): ChildPosition[] {
  if (childSizes.length === 0) return [];

  // Compute total child width and gaps
  let totalChildWidth = 0;
  let maxChildHeight = 0;

  for (let i = 0; i < childSizes.length; i++) {
    const child = childSizes[i];
    if (child === undefined) continue;
    totalChildWidth += child.width;
    if (child.height > maxChildHeight) {
      maxChildHeight = child.height;
    }
  }

  const totalGap = Math.max(0, (childSizes.length - 1)) * gap;
  const usedWidth = totalChildWidth + totalGap;
  const freeSpace = Math.max(0, containerWidth - usedWidth);

  // Cross-axis height for alignment
  const crossHeight = containerHeight > 0
    ? containerHeight
    : px(maxChildHeight);

  // Compute starting X and inter-item spacing based on justify
  let startX: number;
  let interItemExtra: number;

  switch (justify) {
    case 'start':
      startX = 0;
      interItemExtra = 0;
      break;
    case 'center':
      startX = freeSpace / 2;
      interItemExtra = 0;
      break;
    case 'end':
      startX = freeSpace;
      interItemExtra = 0;
      break;
    case 'space-between':
      startX = 0;
      interItemExtra = childSizes.length > 1
        ? freeSpace / (childSizes.length - 1)
        : 0;
      break;
    case 'space-around':
      interItemExtra = childSizes.length > 0
        ? freeSpace / childSizes.length
        : 0;
      startX = interItemExtra / 2;
      break;
  }

  const positions: ChildPosition[] = [];
  let x = startX;

  for (let i = 0; i < childSizes.length; i++) {
    const child = childSizes[i];
    if (child === undefined) continue;

    const childHeight = align === 'stretch' ? crossHeight : child.height;
    const childY = computeCrossAxisOffset(child.height, crossHeight, align);

    positions.push({
      x: px(x),
      y: px(childY),
      width: child.width,
      height: px(childHeight),
    });

    x += child.width + gap;
    if (justify === 'space-between' || justify === 'space-around') {
      x += interItemExtra;
    }
  }

  return positions;
}

// ─── Flex Column ─────────────────────────────────────────────────────

/**
 * Flex column: children laid out vertically with justify and cross-axis alignment.
 *
 * @param childSizes       Intrinsic sizes of each child
 * @param gap              Vertical gap between children
 * @param containerWidth   Width of content area (for cross-axis alignment)
 * @param containerHeight  Height of content area (for main-axis distribution)
 * @param justify          Main-axis (vertical) distribution
 * @param align            Cross-axis (horizontal) alignment
 * @returns Positioned children
 */
export function layoutFlexCol(
  childSizes: ReadonlyArray<ChildSize>,
  gap: Pixels,
  containerWidth: Pixels,
  containerHeight: Pixels,
  justify: JustifyContent,
  align: AlignItems,
): ChildPosition[] {
  if (childSizes.length === 0) return [];

  // Compute total child height and gaps
  let totalChildHeight = 0;
  let maxChildWidth = 0;

  for (let i = 0; i < childSizes.length; i++) {
    const child = childSizes[i];
    if (child === undefined) continue;
    totalChildHeight += child.height;
    if (child.width > maxChildWidth) {
      maxChildWidth = child.width;
    }
  }

  const totalGap = Math.max(0, (childSizes.length - 1)) * gap;
  const usedHeight = totalChildHeight + totalGap;
  const freeSpace = Math.max(0, containerHeight - usedHeight);

  const crossWidth = containerWidth > 0
    ? containerWidth
    : px(maxChildWidth);

  // Compute starting Y and inter-item spacing based on justify
  let startY: number;
  let interItemExtra: number;

  switch (justify) {
    case 'start':
      startY = 0;
      interItemExtra = 0;
      break;
    case 'center':
      startY = freeSpace / 2;
      interItemExtra = 0;
      break;
    case 'end':
      startY = freeSpace;
      interItemExtra = 0;
      break;
    case 'space-between':
      startY = 0;
      interItemExtra = childSizes.length > 1
        ? freeSpace / (childSizes.length - 1)
        : 0;
      break;
    case 'space-around':
      interItemExtra = childSizes.length > 0
        ? freeSpace / childSizes.length
        : 0;
      startY = interItemExtra / 2;
      break;
  }

  const positions: ChildPosition[] = [];
  let y = startY;

  for (let i = 0; i < childSizes.length; i++) {
    const child = childSizes[i];
    if (child === undefined) continue;

    // Margin collapse for vertical flex
    if (i === 0) {
      y += (child.marginTop ?? 0);
    } else {
      const prev = childSizes[i - 1]!;
      const marginBetween = Math.max(gap, prev.marginBottom ?? 0, child.marginTop ?? 0);
      y += marginBetween;
    }

    const childWidth = align === 'stretch' ? crossWidth : child.width;
    const childX = computeCrossAxisOffsetHorizontal(child.width, crossWidth, align);

    positions.push({
      x: px(childX),
      y: px(y),
      width: px(childWidth),
      height: child.height,
    });

    y += child.height;
    if (justify === 'space-between' || justify === 'space-around') {
      y += interItemExtra;
    }
  }

  return positions;
}

// ─── Grid Layout ─────────────────────────────────────────────────────

/**
 * Grid layout: place children into a grid with fixed column count.
 * Rows are auto-sized to the tallest child in each row.
 *
 * @param childSizes     Intrinsic sizes of each child
 * @param cols           Number of columns
 * @param gapX           Horizontal gap between cells
 * @param gapY           Vertical gap between rows
 * @param containerWidth Width of the content area
 * @returns Positioned children in grid cells
 */
export function layoutGrid(
  childSizes: ReadonlyArray<ChildSize>,
  cols: number,
  gapX: Pixels,
  gapY: Pixels,
  containerWidth: Pixels,
): ChildPosition[] {
  if (childSizes.length === 0 || cols <= 0) return [];

  const effectiveCols = Math.max(1, cols);

  // Compute cell width
  const totalGapX = (effectiveCols - 1) * gapX;
  const cellWidth = px(Math.max(0, (containerWidth - totalGapX) / effectiveCols));

  // Compute row heights (tallest child per row)
  const rowCount = Math.ceil(childSizes.length / effectiveCols);
  const rowHeights: number[] = [];

  for (let row = 0; row < rowCount; row++) {
    let maxHeight = 0;
    for (let col = 0; col < effectiveCols; col++) {
      const idx = row * effectiveCols + col;
      const child = idx < childSizes.length ? childSizes[idx] : undefined;
      if (child !== undefined && child.height > maxHeight) {
        maxHeight = child.height;
      }
    }
    rowHeights.push(maxHeight);
  }

  // Position children
  const positions: ChildPosition[] = [];
  let y = 0;

  for (let row = 0; row < rowCount; row++) {
    const rowHeight = rowHeights[row] ?? 0;

    for (let col = 0; col < effectiveCols; col++) {
      const idx = row * effectiveCols + col;
      if (idx >= childSizes.length) break;

      const x = col * (cellWidth + gapX);

      positions.push({
        x: px(x),
        y: px(y),
        width: cellWidth,
        height: px(rowHeight),
      });
    }

    y += rowHeight + (row < rowCount - 1 ? gapY : 0);
  }

  return positions;
}

// ─── Cross-Axis Alignment Helpers ────────────────────────────────────

/**
 * Compute vertical offset for cross-axis alignment in a row context.
 */
function computeCrossAxisOffset(
  childHeight: number,
  containerHeight: number,
  align: AlignItems,
): number {
  switch (align) {
    case 'start':
    case 'stretch':
      return 0;
    case 'center':
      return Math.max(0, (containerHeight - childHeight) / 2);
    case 'end':
      return Math.max(0, containerHeight - childHeight);
  }
}

/**
 * Compute horizontal offset for cross-axis alignment in a column context.
 */
function computeCrossAxisOffsetHorizontal(
  childWidth: number,
  containerWidth: number,
  align: AlignItems,
): number {
  switch (align) {
    case 'start':
    case 'stretch':
      return 0;
    case 'center':
      return Math.max(0, (containerWidth - childWidth) / 2);
    case 'end':
      return Math.max(0, containerWidth - childWidth);
  }
}
