/**
 * Incremental AST Builder — the core of Layer B.
 *
 * Converts a stream of SpatialToken[] batches into a mutable SpatialDocument,
 * emitting ASTDelta events for every mutation. The builder maintains an
 * open-element stack between calls to push(), enabling incremental construction
 * across multiple streaming chunks.
 *
 * Key invariants:
 *   1. The AST is always structurally valid. Unclosed tags are implicitly open.
 *   2. Text appended outside a text-bearing node auto-creates a <Text> wrapper.
 *   3. push() is idempotent in structure — same token sequence always produces
 *      the same tree regardless of batch boundaries.
 *   4. Zero `any`. Zero `as` except branded type constructors.
 *
 * @module @spatial/parser/ast/builder
 */

import type { NodeId } from '../../types/primitives';
import type { SpatialNode, SpatialDocument } from '../../types/ast';
import type { SpatialToken, SpatialTagName } from '../../types/tokens';
import type { ASTDelta } from '../../types/delta';
import { createIdGenerator } from './id-generator';
import type { IdGenerator } from './id-generator';
import { createNode, isContainerKind, isSelfClosingKind, TAG_TO_KIND } from './node-factory';
import { createNodeMap } from './node-map';
import type { NodeMap } from './node-map';

// ─── Public Interface ────────────────────────────────────────────────

export interface ASTBuilder {
  /**
   * Feed a batch of tokens into the builder.
   * Returns deltas describing every mutation performed.
   */
  push(tokens: ReadonlyArray<SpatialToken>): ASTDelta[];

  /** Returns the current (possibly incomplete) document. */
  getDocument(): SpatialDocument;

  /** O(1) node lookup by ID. */
  getNode(id: NodeId): SpatialNode | undefined;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createASTBuilder(): ASTBuilder {
  const idGen: IdGenerator = createIdGenerator();
  const nodeMap: NodeMap = createNodeMap();

  // The document-level children and open stack
  const rootChildren: SpatialNode[] = [];
  const openStack: SpatialNode[] = [];

  // ─── Helpers ─────────────────────────────────────────────────────

  function currentTop(): SpatialNode | undefined {
    return openStack[openStack.length - 1];
  }

  function hasTextBuffer(node: SpatialNode): node is SpatialNode & { textBuffer: { raw: string; lastPrepareLength: number } } {
    return 'textBuffer' in node;
  }

  /**
   * Returns the mutable children array for a container node, or null if the node
   * is a leaf. This helper exists because TypeScript cannot narrow discriminated
   * unions through a boolean helper on `kind`.
   */
  function getContainerChildren(node: SpatialNode): SpatialNode[] | null {
    switch (node.kind) {
      case 'slide':
      case 'auto-grid':
      case 'stack':
      case 'columns':
      case 'canvas':
      case 'quote':
      case 'callout':
        return node.children;
      default:
        return null;
    }
  }

  /**
   * Adds a child node to either the current stack top or the document root.
   * Returns the parent's NodeId (or null if added to root) and the child index.
   */
  function addChild(child: SpatialNode): { parentId: NodeId | null; index: number } {
    const top = currentTop();
    if (top !== undefined) {
      // Verify parent can accept children (containers + quote + callout)
      const parentChildren = getContainerChildren(top);
      if (parentChildren !== null) {
        const idx = parentChildren.length;
        parentChildren.push(child);
        top.dirty.geometryDirty = true;
        return { parentId: top.id, index: idx };
      }
      // If top is a leaf text-bearing node (text, heading, code-block, etc.)
      // that can't have children, we need to close it first and add to its parent.
      // However, the spec says text tokens append to text buffers, not create children.
      // For tag-open tokens arriving while a leaf is open, we close the leaf implicitly.
      // This case is handled by the caller.
    }
    const idx = rootChildren.length;
    rootChildren.push(child);
    return { parentId: null, index: idx };
  }

  /**
   * Auto-creates a Text node for bare text content that lands outside a text-bearing node.
   * Returns the deltas generated.
   */
  function autoCreateTextNode(text: string, offset: number): ASTDelta[] {
    const deltas: ASTDelta[] = [];
    const top = currentTop();

    // If current top is a non-container node that isn't text-bearing,
    // we shouldn't be here — but defensively handle it.
    const parentId = top !== undefined ? top.id : null;
    const id = idGen.next();
    const emptyAttrs: ReadonlyMap<string, string> = new Map();
    const textNode = createNode('Text', id, parentId, emptyAttrs, offset);

    nodeMap.set(id, textNode);

    const { index } = addChild(textNode);
    openStack.push(textNode);

    deltas.push({
      kind: 'node-added',
      nodeId: id,
      parentId: parentId ?? id, // root-level nodes use their own id as a sentinel
      index,
      nodeKind: 'text',
    });

    // Now append the text
    if (hasTextBuffer(textNode)) {
      textNode.textBuffer.raw += text;
      textNode.dirty.textDirty = true;
      deltas.push({
        kind: 'text-appended',
        nodeId: id,
        appendedText: text,
        newFullText: textNode.textBuffer.raw,
      });
    }

    return deltas;
  }

  /**
   * Closes the node at the top of the open stack.
   * Returns a NodeClosedDelta or undefined if stack is empty.
   */
  function closeTopNode(): ASTDelta | undefined {
    const node = openStack.pop();
    if (node === undefined) return undefined;
    node.status = 'closed';
    return { kind: 'node-closed', nodeId: node.id };
  }

  // ─── Token Processors ───────────────────────────────────────────

  function processTagOpen(
    tag: SpatialTagName,
    attributes: ReadonlyMap<string, string>,
    selfClosing: boolean,
    offset: number,
    deltas: ASTDelta[],
  ): void {
    const kind = TAG_TO_KIND[tag];
    const top = currentTop();

    // If current top is a leaf text-bearing node (text, heading, code-block, etc. but NOT quote/callout)
    // and we're opening a new tag, auto-close the leaf first.
    if (top !== undefined && !isContainerKind(top.kind)) {
      const closeDelta = closeTopNode();
      if (closeDelta !== undefined) deltas.push(closeDelta);
    }

    const parentNode = currentTop();
    const parentId = parentNode !== undefined ? parentNode.id : null;
    const id = idGen.next();
    const node = createNode(tag, id, parentId, attributes, offset);

    nodeMap.set(id, node);

    const { index } = addChild(node);

    deltas.push({
      kind: 'node-added',
      nodeId: id,
      parentId: parentId ?? id,
      index,
      nodeKind: kind,
    });

    if (selfClosing || isSelfClosingKind(kind)) {
      // Self-closing: mark closed immediately, don't push to stack
      node.status = 'closed';
      deltas.push({ kind: 'node-closed', nodeId: id });
    } else {
      // Push onto the open stack
      openStack.push(node);
    }
  }

  function processTagClose(
    tag: SpatialTagName,
    deltas: ASTDelta[],
  ): void {
    const targetKind = TAG_TO_KIND[tag];

    // Walk the stack to find the matching open tag.
    // Close everything above it (implicit close for misnested tags).
    let foundIndex = -1;
    for (let i = openStack.length - 1; i >= 0; i--) {
      const stackNode = openStack[i];
      if (stackNode !== undefined && stackNode.kind === targetKind) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      // No matching open tag — ignore the close tag (per spec: parser warning, treat as text).
      return;
    }

    // Close all nodes from the top of the stack down to (and including) the matched node.
    while (openStack.length > foundIndex) {
      const closeDelta = closeTopNode();
      if (closeDelta !== undefined) deltas.push(closeDelta);
    }
  }

  function processText(
    text: string,
    offset: number,
    deltas: ASTDelta[],
  ): void {
    if (text.length === 0) return;

    const top = currentTop();

    if (top !== undefined && hasTextBuffer(top)) {
      // Append to the current text-bearing node's buffer
      top.textBuffer.raw += text;
      top.dirty.textDirty = true;
      deltas.push({
        kind: 'text-appended',
        nodeId: top.id,
        appendedText: text,
        newFullText: top.textBuffer.raw,
      });
      return;
    }

    if (top !== undefined && isContainerKind(top.kind)) {
      // Inside a container but no text-bearing node is open — auto-create Text
      deltas.push(...autoCreateTextNode(text, offset));
      return;
    }

    if (top === undefined) {
      // At root level — auto-create Text
      deltas.push(...autoCreateTextNode(text, offset));
      return;
    }

    // Top is a non-container, non-text-bearing node (e.g., spacer, divider, image, metric-card).
    // These shouldn't receive text. Close the current top and create a text node.
    const closeDelta = closeTopNode();
    if (closeDelta !== undefined) deltas.push(closeDelta);
    deltas.push(...autoCreateTextNode(text, offset));
  }

  function processNewline(
    count: number,
    offset: number,
    deltas: ASTDelta[],
  ): void {
    // Newlines are treated as text content — '\n' repeated `count` times
    const newlineText = '\n'.repeat(count);
    processText(newlineText, offset, deltas);
  }

  function processEOF(deltas: ASTDelta[]): void {
    // Close all remaining open tags
    while (openStack.length > 0) {
      const closeDelta = closeTopNode();
      if (closeDelta !== undefined) deltas.push(closeDelta);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────

  return {
    push(tokens: ReadonlyArray<SpatialToken>): ASTDelta[] {
      const deltas: ASTDelta[] = [];

      for (const token of tokens) {
        switch (token.kind) {
          case 'tag-open':
            processTagOpen(token.tag, token.attributes, token.selfClosing, token.offset, deltas);
            break;
          case 'tag-close':
            processTagClose(token.tag, deltas);
            break;
          case 'text':
            processText(token.content, token.offset, deltas);
            break;
          case 'newline':
            processNewline(token.count, token.offset, deltas);
            break;
          case 'eof':
            processEOF(deltas);
            break;
        }
      }

      return deltas;
    },

    getDocument(): SpatialDocument {
      return {
        version: '1.0',
        children: rootChildren,
        nodeIndex: nodeMap.raw,
        openStack: [...openStack],
      };
    },

    getNode(id: NodeId): SpatialNode | undefined {
      return nodeMap.get(id);
    },
  };
}
