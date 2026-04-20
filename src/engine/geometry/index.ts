/**
 * Geometry Calculator — Bottom-up absolute positioning.
 *
 * @module @spatial/engine/geometry
 */

export type { GeometryCalculator } from './calculator';
export { createGeometryCalculator } from './calculator';

export type {
  ChildSize,
  ChildPosition,
  JustifyContent,
  AlignItems,
} from './layout-algorithms';
export {
  layoutBlockFlow,
  layoutFlexRow,
  layoutFlexCol,
  layoutGrid,
} from './layout-algorithms';

export { getNodePadding, getNodeGap } from './box-model';

export type { LayoutDiff, LayoutDiffKind } from './tree-differ';
export { diffLayoutTrees } from './tree-differ';
