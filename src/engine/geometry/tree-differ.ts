/**
 * Tree Differ — Structural diff between old and new LayoutBox trees.
 *
 * Compares two LayoutBox arrays by nodeId, position, and size.
 * Produces a minimal set of diffs used by the render command builder
 * to emit only changed RenderCommands.
 *
 * Performance target: < 0.1ms for incremental diffs.
 *
 * @module @spatial/engine/geometry/tree-differ
 */

import type { NodeId, Pixels } from '../../types/primitives';
import type { LayoutBox } from '../../types/layout';

// ─── Diff Types ──────────────────────────────────────────────────────

export type LayoutDiffKind = 'added' | 'removed' | 'moved' | 'resized';

export interface LayoutDiff {
  readonly kind: LayoutDiffKind;
  readonly nodeId: NodeId;
  /** Present for 'added', 'moved', and 'resized' diffs. */
  readonly box: LayoutBox | null;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Diff two LayoutBox trees and return a minimal set of changes.
 *
 * Comparison strategy:
 * 1. Build a flat index of the old tree (nodeId → LayoutBox)
 * 2. Walk the new tree. For each node:
 *    - If not in old index → 'added'
 *    - If in old index but position changed → 'moved'
 *    - If in old index but size changed → 'resized'
 *    - If unchanged → skip
 * 3. Remaining old nodes not in new tree → 'removed'
 *
 * This is a flat comparison — we don't track parent/child hierarchy
 * changes, only per-node geometry deltas. The render layer handles
 * the rest.
 */
export function diffLayoutTrees(
  oldBoxes: ReadonlyArray<LayoutBox>,
  newBoxes: ReadonlyArray<LayoutBox>,
): LayoutDiff[] {
  // Build old index
  const oldIndex = new Map<NodeId, LayoutBox>();
  indexTree(oldBoxes, oldIndex);

  // Track which old nodes were visited
  const visitedOld = new Set<NodeId>();

  // Walk new tree and compare
  const diffs: LayoutDiff[] = [];
  collectDiffs(newBoxes, oldIndex, visitedOld, diffs);

  // Any old nodes not visited are 'removed'
  for (const [nodeId] of oldIndex) {
    if (!visitedOld.has(nodeId)) {
      diffs.push({
        kind: 'removed',
        nodeId,
        box: null,
      });
    }
  }

  return diffs;
}

// ─── Internals ───────────────────────────────────────────────────────

/**
 * Recursively flatten the LayoutBox tree into a Map<NodeId, LayoutBox>.
 */
function indexTree(
  boxes: ReadonlyArray<LayoutBox>,
  index: Map<NodeId, LayoutBox>,
): void {
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (box === undefined) continue;
    index.set(box.nodeId, box);
    if (box.children.length > 0) {
      indexTree(box.children, index);
    }
  }
}

/**
 * Walk the new tree and collect diffs against the old index.
 */
function collectDiffs(
  newBoxes: ReadonlyArray<LayoutBox>,
  oldIndex: ReadonlyMap<NodeId, LayoutBox>,
  visitedOld: Set<NodeId>,
  diffs: LayoutDiff[],
): void {
  for (let i = 0; i < newBoxes.length; i++) {
    const newBox = newBoxes[i];
    if (newBox === undefined) continue;

    const oldBox = oldIndex.get(newBox.nodeId);

    if (oldBox === undefined) {
      // New node — not present in old tree
      diffs.push({
        kind: 'added',
        nodeId: newBox.nodeId,
        box: newBox,
      });
    } else {
      visitedOld.add(newBox.nodeId);

      // Check for position change
      const positionChanged = !pixelsEqual(oldBox.x, newBox.x)
        || !pixelsEqual(oldBox.y, newBox.y);

      // Check for size change
      const sizeChanged = !pixelsEqual(oldBox.width, newBox.width)
        || !pixelsEqual(oldBox.height, newBox.height);

      if (positionChanged && sizeChanged) {
        // Both moved and resized — emit 'resized' (supersedes 'moved')
        diffs.push({
          kind: 'resized',
          nodeId: newBox.nodeId,
          box: newBox,
        });
      } else if (positionChanged) {
        diffs.push({
          kind: 'moved',
          nodeId: newBox.nodeId,
          box: newBox,
        });
      } else if (sizeChanged) {
        diffs.push({
          kind: 'resized',
          nodeId: newBox.nodeId,
          box: newBox,
        });
      }
      // else: unchanged, no diff emitted
    }

    // Recurse into children
    if (newBox.children.length > 0) {
      collectDiffs(newBox.children, oldIndex, visitedOld, diffs);
    }
  }
}

// ─── Comparison Utilities ────────────────────────────────────────────

/**
 * Compare two Pixels values with a small epsilon to avoid
 * floating-point noise from layout math.
 */
function pixelsEqual(a: Pixels, b: Pixels): boolean {
  return Math.abs(a - b) < 0.01;
}
