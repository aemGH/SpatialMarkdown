/**
 * AST structural validation.
 *
 * Checks nesting rules, required props, and structural invariants.
 * Intended for debug builds and tests — not for hot-path execution.
 *
 * @module @spatial/parser/ast/validators
 */

import type { NodeId } from '../../types/primitives';
import type {
  SpatialNode,
  SpatialDocument,
  NodeKind,
} from '../../types/ast';

// ─── Validation Error ────────────────────────────────────────────────

export interface ValidationError {
  readonly nodeId: NodeId;
  readonly message: string;
}

// ─── Nesting Rules ───────────────────────────────────────────────────

/**
 * Layout containers: can contain any node type.
 * Content components (quote, callout): can contain primitives and text.
 * Leaf text-bearing nodes (text, heading, code-block, data-table, chart): no children.
 * Leaf non-text nodes (metric-card, spacer, divider, image): no children.
 */

type LayoutContainerKind = 'slide' | 'auto-grid' | 'stack' | 'columns' | 'canvas';
type ContentContainerKind = 'quote' | 'callout';
type LeafTextKind = 'text' | 'heading' | 'code-block' | 'data-table' | 'chart';
type LeafEmptyKind = 'metric-card' | 'spacer' | 'divider' | 'image';

const LAYOUT_CONTAINER_KINDS: ReadonlySet<NodeKind> = new Set<LayoutContainerKind>([
  'slide', 'auto-grid', 'stack', 'columns', 'canvas',
]);

const CONTENT_CONTAINER_KINDS: ReadonlySet<NodeKind> = new Set<ContentContainerKind>([
  'quote', 'callout',
]);

const LEAF_TEXT_KINDS: ReadonlySet<NodeKind> = new Set<LeafTextKind>([
  'text', 'heading', 'code-block', 'data-table', 'chart',
]);

const LEAF_EMPTY_KINDS: ReadonlySet<NodeKind> = new Set<LeafEmptyKind>([
  'metric-card', 'spacer', 'divider', 'image',
]);

const PRIMITIVE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'text', 'heading', 'spacer', 'divider', 'image',
]);

// ─── Allowed Children Per Kind ───────────────────────────────────────

function isAllowedChild(parentKind: NodeKind, childKind: NodeKind): boolean {
  // Layout containers accept anything
  if (LAYOUT_CONTAINER_KINDS.has(parentKind)) return true;

  // Content containers (quote, callout) accept primitives and text-bearing leaves
  if (CONTENT_CONTAINER_KINDS.has(parentKind)) {
    return PRIMITIVE_KINDS.has(childKind) || childKind === 'text';
  }

  // Leaf nodes should not have children at all
  if (LEAF_TEXT_KINDS.has(parentKind)) return false;
  if (LEAF_EMPTY_KINDS.has(parentKind)) return false;

  return false;
}

// ─── Node Validator ──────────────────────────────────────────────────

function validateNode(
  node: SpatialNode,
  parentKind: NodeKind | null,
  errors: ValidationError[],
): void {
  // Rule 1: Check nesting validity
  if (parentKind !== null && !isAllowedChild(parentKind, node.kind)) {
    errors.push({
      nodeId: node.id,
      message: `Invalid nesting: '${node.kind}' cannot be a child of '${parentKind}'.`,
    });
  }

  // Rule 2: Leaf nodes with children: [] must have empty children
  if (LEAF_EMPTY_KINDS.has(node.kind) && node.children.length > 0) {
    errors.push({
      nodeId: node.id,
      message: `Leaf node '${node.kind}' must not have children, but has ${node.children.length}.`,
    });
  }

  // Rule 3: Leaf text nodes must have empty children array
  if (LEAF_TEXT_KINDS.has(node.kind) && node.children.length > 0) {
    errors.push({
      nodeId: node.id,
      message: `Text-bearing leaf '${node.kind}' must not have children, but has ${node.children.length}.`,
    });
  }

  // Rule 4: Text-bearing nodes must have a textBuffer
  if (LEAF_TEXT_KINDS.has(node.kind) || CONTENT_CONTAINER_KINDS.has(node.kind)) {
    if (!('textBuffer' in node)) {
      errors.push({
        nodeId: node.id,
        message: `Text-bearing node '${node.kind}' is missing its textBuffer.`,
      });
    }
  }

  // Rule 5: MetricCard must have label and value
  if (node.kind === 'metric-card') {
    if (node.props.label === '') {
      errors.push({
        nodeId: node.id,
        message: `MetricCard is missing required 'label' attribute.`,
      });
    }
    if (node.props.value === '') {
      errors.push({
        nodeId: node.id,
        message: `MetricCard is missing required 'value' attribute.`,
      });
    }
  }

  // Rule 6: Image must have src
  if (node.kind === 'image') {
    if (node.props.src === '') {
      errors.push({
        nodeId: node.id,
        message: `Image is missing required 'src' attribute.`,
      });
    }
  }

  // Rule 7: Chart type must be valid (already enforced by factory, but double-check)
  if (node.kind === 'chart') {
    const validTypes: ReadonlySet<string> = new Set(['bar', 'line', 'pie', 'area', 'scatter']);
    if (!validTypes.has(node.props.type)) {
      errors.push({
        nodeId: node.id,
        message: `Chart has invalid type '${node.props.type}'.`,
      });
    }
  }

  // Rule 8: Heading level must be 1-6 (already enforced by factory)
  if (node.kind === 'heading') {
    if (node.props.level < 1 || node.props.level > 6) {
      errors.push({
        nodeId: node.id,
        message: `Heading has invalid level ${node.props.level}. Must be 1-6.`,
      });
    }
  }

  // Rule 9: Closed nodes should not be in the open stack
  // (This is checked at document level, not per-node)

  // Recurse into children
  for (const child of node.children) {
    validateNode(child, node.kind, errors);
  }
}

// ─── Document Validator ──────────────────────────────────────────────

export function validateDocument(doc: SpatialDocument): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate each root-level node
  for (const child of doc.children) {
    validateNode(child, null, errors);
  }

  // Cross-check: nodeIndex should contain every node in the tree
  const treeNodeIds = new Set<NodeId>();
  function collectIds(node: SpatialNode): void {
    treeNodeIds.add(node.id);
    for (const child of node.children) {
      collectIds(child);
    }
  }
  for (const child of doc.children) {
    collectIds(child);
  }

  // Check for orphaned index entries (in index but not in tree)
  for (const [indexedId] of doc.nodeIndex) {
    if (!treeNodeIds.has(indexedId)) {
      errors.push({
        nodeId: indexedId,
        message: `Node ${indexedId} is in nodeIndex but not in the document tree (orphaned).`,
      });
    }
  }

  // Check for missing index entries (in tree but not in index)
  for (const treeId of treeNodeIds) {
    if (!doc.nodeIndex.has(treeId)) {
      errors.push({
        nodeId: treeId,
        message: `Node ${treeId} is in the document tree but missing from nodeIndex.`,
      });
    }
  }

  // Check that open stack nodes are actually in streaming state
  for (const openNode of doc.openStack) {
    if (openNode.status !== 'streaming') {
      errors.push({
        nodeId: openNode.id,
        message: `Node ${openNode.id} is in openStack but has status '${openNode.status}' instead of 'streaming'.`,
      });
    }
  }

  return errors;
}
