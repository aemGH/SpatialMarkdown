/**
 * Shared AST tree walking utilities.
 *
 * Used by the constraint solver, geometry calculator, and layout-mode
 * resolvers to filter empty text nodes from children lists.
 *
 * @module @spatial/engine/tree-utils
 */

import type { SpatialNode } from '../types/ast';

/**
 * Safely extract visible children from any SpatialNode.
 * Filters out empty text nodes (whitespace-only).
 *
 * This function is the SINGLE source of truth for child-list
 * extraction — do not duplicate it.
 */
export function getVisibleChildren(node: SpatialNode): readonly SpatialNode[] {
  let rawChildren: readonly SpatialNode[] = [];
  switch (node.kind) {
    case 'slide':
    case 'auto-grid':
    case 'stack':
    case 'columns':
    case 'canvas':
    case 'quote':
    case 'callout':
      rawChildren = node.children;
      break;
    default:
      return [];
  }

  return rawChildren.filter(child => {
    if (child.kind === 'text') {
      return child.textBuffer.raw.trim().length > 0;
    }
    return true;
  });
}