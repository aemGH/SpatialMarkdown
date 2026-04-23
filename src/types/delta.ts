/**
 * AST delta events for incremental updates during streaming.
 *
 * @module @spatial/types/delta
 */

import type { NodeId } from './primitives';
import type { NodeKind } from './ast';

/** Incremental AST mutation event emitted during streaming to drive layout updates. */
export type ASTDelta =
  | NodeAddedDelta
  | NodeClosedDelta
  | TextAppendedDelta
  | NodeRemovedDelta;

/** A new node was inserted into the AST at the given parent and index. */
export interface NodeAddedDelta {
  readonly kind: 'node-added';
  readonly nodeId: NodeId;
  readonly parentId: NodeId;
  readonly index: number;
  readonly nodeKind: NodeKind;
}

/** A streaming node's closing tag was received — no more content will arrive. */
export interface NodeClosedDelta {
  readonly kind: 'node-closed';
  readonly nodeId: NodeId;
}

/** New text was appended to a node's text buffer during streaming. */
export interface TextAppendedDelta {
  readonly kind: 'text-appended';
  readonly nodeId: NodeId;
  readonly appendedText: string;
  readonly newFullText: string;
}

/** A node was removed from the AST (e.g. during error recovery or rewrite). */
export interface NodeRemovedDelta {
  readonly kind: 'node-removed';
  readonly nodeId: NodeId;
  readonly parentId: NodeId;
}
