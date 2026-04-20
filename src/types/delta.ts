/**
 * AST delta events for incremental updates during streaming.
 *
 * @module @spatial/types/delta
 */

import type { NodeId } from './primitives';
import type { NodeKind } from './ast';

export type ASTDelta =
  | NodeAddedDelta
  | NodeClosedDelta
  | TextAppendedDelta
  | NodeRemovedDelta;

export interface NodeAddedDelta {
  readonly kind: 'node-added';
  readonly nodeId: NodeId;
  readonly parentId: NodeId;
  readonly index: number;
  readonly nodeKind: NodeKind;
}

export interface NodeClosedDelta {
  readonly kind: 'node-closed';
  readonly nodeId: NodeId;
}

export interface TextAppendedDelta {
  readonly kind: 'text-appended';
  readonly nodeId: NodeId;
  readonly appendedText: string;
  readonly newFullText: string;
}

export interface NodeRemovedDelta {
  readonly kind: 'node-removed';
  readonly nodeId: NodeId;
  readonly parentId: NodeId;
}
