/**
 * O(1) NodeId → SpatialNode lookup table.
 *
 * A thin wrapper over Map<NodeId, SpatialNode> that provides a
 * domain-specific API and avoids tree traversal for random access.
 * Updated by the builder on every mutation.
 *
 * @module @spatial/parser/ast/node-map
 */

import type { NodeId } from '../../types/primitives';
import type { SpatialNode } from '../../types/ast';

// ─── Public Interface ────────────────────────────────────────────────

export interface NodeMap {
  /** Register a node by its ID. Overwrites if already present. */
  set(id: NodeId, node: SpatialNode): void;

  /** Retrieve a node by ID, or undefined if not found. */
  get(id: NodeId): SpatialNode | undefined;

  /** Remove a node from the index. Returns true if it existed. */
  delete(id: NodeId): boolean;

  /** Check if a node with the given ID exists. */
  has(id: NodeId): boolean;

  /** Current number of indexed nodes. */
  readonly size: number;

  /** Iterate over all indexed nodes. */
  values(): IterableIterator<SpatialNode>;

  /** Returns the underlying Map (read-only access for SpatialDocument.nodeIndex). */
  readonly raw: Map<NodeId, SpatialNode>;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createNodeMap(): NodeMap {
  const map = new Map<NodeId, SpatialNode>();

  return {
    set(id: NodeId, node: SpatialNode): void {
      map.set(id, node);
    },

    get(id: NodeId): SpatialNode | undefined {
      return map.get(id);
    },

    delete(id: NodeId): boolean {
      return map.delete(id);
    },

    has(id: NodeId): boolean {
      return map.has(id);
    },

    get size(): number {
      return map.size;
    },

    values(): IterableIterator<SpatialNode> {
      return map.values();
    },

    get raw(): Map<NodeId, SpatialNode> {
      return map;
    },
  };
}
