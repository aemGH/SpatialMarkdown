/**
 * Auto-Paragraph Transform
 *
 * Merges consecutive 'text' nodes that share the same parent into a single
 * text node. This handles fragmentation from streaming — when the builder
 * receives text in multiple chunks separated by newline tokens, it can
 * create adjacent Text nodes that should logically be one paragraph.
 *
 * Invariant: Only merges siblings of kind 'text'. Never touches headings,
 * code-blocks, or other text-bearing kinds — those are semantically distinct.
 *
 * Mutation strategy:
 *   - Merges textBuffer.raw from consecutive text nodes into the first
 *   - Splices removed nodes from the parent's children array
 *   - Removes absorbed nodes from doc.nodeIndex
 *   - Marks the surviving node's dirty.textDirty = true
 *   - Emits NodeRemovedDelta for each absorbed node + TextAppendedDelta
 *     for the surviving node
 *
 * @module @spatial/parser/transforms/auto-paragraph
 */

import type { SpatialDocument, SpatialNode } from '../../types/ast';
import type { ASTDelta } from '../../types/delta';
import type { NodeId } from '../../types/primitives';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Type guard: node has a mutable children array (containers). */
function hasChildren(node: SpatialNode): node is SpatialNode & { children: SpatialNode[] } {
  switch (node.kind) {
    case 'slide':
    case 'auto-grid':
    case 'stack':
    case 'columns':
    case 'canvas':
    case 'quote':
    case 'callout':
      return true;
    default:
      return false;
  }
}

/** Type guard: node is a plain text node with a textBuffer. */
function isTextNode(node: SpatialNode): node is SpatialNode & {
  readonly kind: 'text';
  textBuffer: { raw: string; lastPrepareLength: number };
} {
  return node.kind === 'text';
}

// ─── Core: merge consecutive text siblings ───────────────────────────

function mergeTextRun(
  children: SpatialNode[],
  parentId: NodeId,
  nodeIndex: Map<NodeId, SpatialNode>,
  deltas: ASTDelta[],
): void {
  let writeIdx = 0;
  let readIdx = 0;

  while (readIdx < children.length) {
    const current = children[readIdx];

    if (current === undefined || !isTextNode(current)) {
      // Non-text node — keep as-is, advance both pointers
      if (readIdx !== writeIdx) {
        children[writeIdx] = children[readIdx]!;
      }
      writeIdx++;
      readIdx++;
      continue;
    }

    // current is a text node — scan ahead for consecutive text siblings
    const anchor = current;
    let mergedAny = false;
    readIdx++;

    while (readIdx < children.length) {
      const next = children[readIdx];
      if (next === undefined || !isTextNode(next)) break;

      // Absorb `next` into `anchor`
      const appendedText = next.textBuffer.raw;
      anchor.textBuffer.raw += appendedText;
      mergedAny = true;

      // Remove absorbed node from the index
      nodeIndex.delete(next.id);

      deltas.push({
        kind: 'node-removed',
        nodeId: next.id,
        parentId,
      });

      readIdx++;
    }

    if (mergedAny) {
      anchor.dirty.textDirty = true;

      deltas.push({
        kind: 'text-appended',
        nodeId: anchor.id,
        appendedText: '', // Full merge — appendedText is ambiguous; newFullText is authoritative
        newFullText: anchor.textBuffer.raw,
      });
    }

    // Write the anchor (possibly merged) to the compacted position.
    // When nodes were absorbed, writeIdx lags behind readIdx, so we
    // need to shift the anchor down into the compacted slot.
    children[writeIdx] = anchor;
    writeIdx++;
  }

  // Truncate the children array to remove absorbed slots
  if (writeIdx < children.length) {
    children.length = writeIdx;
  }
}

// ─── Tree Walker ─────────────────────────────────────────────────────

function walkAndMerge(
  node: SpatialNode,
  nodeIndex: Map<NodeId, SpatialNode>,
  deltas: ASTDelta[],
): void {
  if (!hasChildren(node)) return;

  // First, recurse into child containers (depth-first, bottom-up)
  for (const child of node.children) {
    walkAndMerge(child, nodeIndex, deltas);
  }

  // Then merge consecutive text nodes at this level
  if (node.children.length > 1) {
    mergeTextRun(node.children, node.id, nodeIndex, deltas);
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Merges consecutive sibling text nodes into a single text node.
 *
 * Pure in the functional sense: takes the document, mutates in place,
 * returns deltas describing every mutation.
 *
 * Time: O(n) where n = total node count.
 * Space: O(d) where d = tree depth (call stack).
 */
export function autoParagraph(doc: SpatialDocument): ASTDelta[] {
  const deltas: ASTDelta[] = [];

  // Process each root-level child
  for (const rootChild of doc.children) {
    walkAndMerge(rootChild, doc.nodeIndex, deltas);
  }

  // Also merge consecutive text nodes at the root level.
  // Root children don't have a parentId in the normal sense.
  // We skip root-level merging because root text nodes are edge cases
  // (the builder usually wraps them in auto-created Text nodes inside
  // containers). If needed, the caller can wrap root in a virtual container.

  return deltas;
}
