/**
 * Constraint Solver — Top-down constraint propagation.
 *
 * Starts with the viewport as root constraint, walks the tree top-down,
 * and calls the appropriate layout-mode resolver for each container node
 * to generate child constraints. Leaf nodes inherit their parent's constraint.
 *
 * Performance target: < 0.5ms per frame.
 *
 * @module @spatial/engine/constraints/solver
 */

import type { Pixels, NodeId } from '../../types/primitives';
import type { LayoutConstraint } from '../../types/layout';
import type { SpatialNode } from '../../types/ast';
import {
  resolveBlockConstraints,
  resolveStackConstraints,
  resolveGridConstraints,
  resolveColumnsConstraints,
} from './layout-modes';
import { getVisibleChildren } from '../tree-utils';

// ─── Public Interface ────────────────────────────────────────────────

export interface ConstraintSolver {
  /**
   * Full solve: compute constraints for every node in the tree.
   * @param roots  Top-level SpatialNode array (the document's children)
   * @param viewport  Viewport dimensions
   * @returns Map from NodeId → LayoutConstraint
   */
  solve(
    roots: ReadonlyArray<SpatialNode>,
    viewport: Readonly<{ width: Pixels; height: Pixels }>,
  ): Map<NodeId, LayoutConstraint>;

  /**
   * Incremental solve: recompute constraints only for dirty nodes
   * and their descendants. Reuses existing constraints for clean subtrees.
   * @param roots  Top-level SpatialNode array
   * @param viewport  Viewport dimensions
   * @param dirtyNodes  Set of NodeIds that need recomputation
   * @param existing  Previous constraint map to reuse for clean nodes
   * @returns Updated constraint map
   */
  solveDirty(
    roots: ReadonlyArray<SpatialNode>,
    viewport: Readonly<{ width: Pixels; height: Pixels }>,
    dirtyNodes: ReadonlySet<NodeId>,
    existing: ReadonlyMap<NodeId, LayoutConstraint>,
  ): Map<NodeId, LayoutConstraint>;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createConstraintSolver(): ConstraintSolver {
  return {
    solve(
      roots: ReadonlyArray<SpatialNode>,
      viewport: Readonly<{ width: Pixels; height: Pixels }>,
    ): Map<NodeId, LayoutConstraint> {
      const constraints = new Map<NodeId, LayoutConstraint>();

      const rootConstraint: LayoutConstraint = {
        maxWidth: viewport.width,
        maxHeight: viewport.height,
        availableWidth: viewport.width,
        availableHeight: viewport.height,
      };

      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (root === undefined) continue;
        if (root.kind === 'text' && root.textBuffer.raw.trim().length === 0) continue;
        solveNode(root, rootConstraint, constraints);
      }

      return constraints;
    },

    solveDirty(
      roots: ReadonlyArray<SpatialNode>,
      viewport: Readonly<{ width: Pixels; height: Pixels }>,
      dirtyNodes: ReadonlySet<NodeId>,
      existing: ReadonlyMap<NodeId, LayoutConstraint>,
    ): Map<NodeId, LayoutConstraint> {
      // Start with a copy of existing constraints
      const constraints = new Map<NodeId, LayoutConstraint>(existing);

      const rootConstraint: LayoutConstraint = {
        maxWidth: viewport.width,
        maxHeight: viewport.height,
        availableWidth: viewport.width,
        availableHeight: viewport.height,
      };

      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (root === undefined) continue;
        if (root.kind === 'text' && root.textBuffer.raw.trim().length === 0) continue;
        solveDirtyNode(root, rootConstraint, constraints, dirtyNodes);
      }

      return constraints;
    },
  };
}

// ─── Core Traversal ──────────────────────────────────────────────────

/**
 * Full solve for a single node and all descendants.
 * Assigns the parent constraint to this node, then resolves
 * child constraints based on the node's layout mode.
 */
function solveNode(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
  result: Map<NodeId, LayoutConstraint>,
): void {
  // Store this node's constraint (the constraint *imposed on* this node)
  result.set(node.id, parentConstraint);

  // Resolve child constraints based on node kind
const children = getVisibleChildren(node);

  const childConstraints = resolveChildConstraints(node, parentConstraint);

  // Recurse into children
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;

    // Each child gets its computed constraint, or falls back to parent
    const childConstraint = i < childConstraints.length
      ? childConstraints[i]
      : undefined;

    solveNode(
      child,
      childConstraint ?? parentConstraint,
      result,
    );
  }
}

/**
 * Incremental solve: only recompute nodes that are dirty or
 * whose ancestors are dirty. Clean subtrees are skipped entirely.
 */
function solveDirtyNode(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
  result: Map<NodeId, LayoutConstraint>,
  dirtyNodes: ReadonlySet<NodeId>,
): void {
  const isDirty = dirtyNodes.has(node.id) || node.dirty.constraintDirty;

  // Check if this node's constraint changed
  const existingConstraint = result.get(node.id);
  const constraintChanged = existingConstraint === undefined
    || existingConstraint.maxWidth !== parentConstraint.maxWidth
    || existingConstraint.maxHeight !== parentConstraint.maxHeight
    || existingConstraint.availableWidth !== parentConstraint.availableWidth
    || existingConstraint.availableHeight !== parentConstraint.availableHeight;

  if (!isDirty && !constraintChanged) {
    // Nothing to do — this subtree is clean and its constraint hasn't changed
    return;
  }

  // Update this node's constraint
  result.set(node.id, parentConstraint);

  // Resolve child constraints
  const children = getVisibleChildren(node);
  if (children.length === 0) return;

  const childConstraints = resolveChildConstraints(node, parentConstraint);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;

    const childConstraint = i < childConstraints.length
      ? childConstraints[i]
      : undefined;

    solveDirtyNode(
      child,
      childConstraint ?? parentConstraint,
      result,
      dirtyNodes,
    );
  }
}

// ─── Layout Mode Dispatch ────────────────────────────────────────────

/**
 * Given a container node, dispatch to the correct layout-mode resolver
 * to compute child constraints.
 */
function resolveChildConstraints(
  node: SpatialNode,
  parentConstraint: LayoutConstraint,
): LayoutConstraint[] {
  switch (node.kind) {
    // Layout containers with specific modes
    case 'stack':
      return resolveStackConstraints(node, parentConstraint);

    case 'auto-grid':
      return resolveGridConstraints(node, parentConstraint);

    case 'columns':
      return resolveColumnsConstraints(node, parentConstraint);

    // Block-flow containers
    case 'slide':
    case 'canvas':
    case 'callout':
    case 'quote':
      return resolveBlockConstraints(node, parentConstraint);

    // Leaf nodes — no children to constrain
    case 'metric-card':
    case 'code-block':
    case 'data-table':
    case 'chart':
    case 'text':
    case 'heading':
    case 'spacer':
    case 'divider':
    case 'image':
      return [];
  }
}


