/**
 * Monotonic NodeId allocator.
 *
 * IDs are never reused. Enables O(1) lookups in the node map.
 * The counter starts at 1 — NodeId(0) is reserved as a sentinel.
 *
 * @module @spatial/parser/ast/id-generator
 */

import { nodeId } from '../../types/primitives';
import type { NodeId } from '../../types/primitives';

// ─── Public Interface ────────────────────────────────────────────────

export interface IdGenerator {
  /** Returns the next unique NodeId. Monotonically increasing. */
  next(): NodeId;
  /** Returns the most recently allocated NodeId (for diagnostics). */
  peek(): NodeId;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createIdGenerator(startAt = 1): IdGenerator {
  let counter = startAt;

  return {
    next(): NodeId {
      return nodeId(counter++);
    },
    peek(): NodeId {
      return nodeId(counter - 1);
    },
  };
}
