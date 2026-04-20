/**
 * Unit tests for the incremental AST builder.
 *
 * @module tests/unit/ast-builder
 */

import { createASTBuilder } from '../../src/parser/ast/builder';
import type { SpatialToken } from '../../src/types/tokens';
import type { ASTDelta } from '../../src/types/delta';
import type { SpatialNode, SpatialDocument } from '../../src/types/ast';

// ─── Token Factories ─────────────────────────────────────────────────

function tagOpen(
  tag: SpatialToken extends infer T ? T extends { kind: 'tag-open'; tag: infer N } ? N : never : never,
  attrs: Map<string, string> = new Map(),
  selfClosing = false,
  offset = 0,
): SpatialToken {
  return { kind: 'tag-open', tag, attributes: attrs, selfClosing, offset };
}

function tagClose(
  tag: SpatialToken extends infer T ? T extends { kind: 'tag-close'; tag: infer N } ? N : never : never,
  offset = 0,
): SpatialToken {
  return { kind: 'tag-close', tag, offset };
}

function textToken(content: string, offset = 0): SpatialToken {
  return { kind: 'text', content, offset };
}

function eofToken(offset = 0): SpatialToken {
  return { kind: 'eof', offset };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Find a child node by kind (shallow). */
function findChild(doc: SpatialDocument, kind: SpatialNode['kind']): SpatialNode | undefined {
  return doc.children.find((n) => n.kind === kind);
}

/** Get the first child of a container node. */
function firstChild(node: SpatialNode): SpatialNode | undefined {
  switch (node.kind) {
    case 'slide':
    case 'auto-grid':
    case 'stack':
    case 'columns':
    case 'canvas':
    case 'quote':
    case 'callout':
      return node.children[0];
    default:
      return undefined;
  }
}

/** Get children of a container node. */
function getChildren(node: SpatialNode): readonly SpatialNode[] {
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
      return [];
  }
}

/** Check if a node has a textBuffer. */
function getTextBuffer(node: SpatialNode): { raw: string; lastPrepareLength: number } | undefined {
  if ('textBuffer' in node) {
    return node.textBuffer as { raw: string; lastPrepareLength: number };
  }
  return undefined;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('AST Builder', () => {
  describe('document structure', () => {
    it('should produce an empty document with no tokens pushed', () => {
      const builder = createASTBuilder();
      const doc = builder.getDocument();

      expect(doc.version).toBe('1.0');
      expect(doc.children).toHaveLength(0);
      expect(doc.nodeIndex.size).toBe(0);
    });

    it('should create a single node for a tag-open/close pair', () => {
      const builder = createASTBuilder();
      builder.push([tagOpen('Slide'), tagClose('Slide')]);
      const doc = builder.getDocument();

      expect(doc.children).toHaveLength(1);
      const slide = doc.children[0];
      expect(slide).toBeDefined();
      expect(slide!.kind).toBe('slide');
      expect(slide!.status).toBe('closed');
    });

    it('should nest tags correctly', () => {
      const builder = createASTBuilder();
      builder.push([
        tagOpen('Slide'),
        tagOpen('Text'),
        textToken('hello'),
        tagClose('Text'),
        tagClose('Slide'),
      ]);
      const doc = builder.getDocument();

      expect(doc.children).toHaveLength(1);
      const slide = doc.children[0]!;
      expect(slide.kind).toBe('slide');

      const slideChildren = getChildren(slide);
      expect(slideChildren).toHaveLength(1);

      const textNode = slideChildren[0]!;
      expect(textNode.kind).toBe('text');

      const tb = getTextBuffer(textNode);
      expect(tb).toBeDefined();
      expect(tb!.raw).toBe('hello');
    });

    it('should auto-create a text node for bare text inside a container', () => {
      const builder = createASTBuilder();
      builder.push([
        tagOpen('Slide'),
        textToken('hello'),
        tagClose('Slide'),
      ]);
      const doc = builder.getDocument();

      const slide = doc.children[0]!;
      const slideChildren = getChildren(slide);
      expect(slideChildren.length).toBeGreaterThanOrEqual(1);

      // Should auto-create a text node wrapping the bare text
      const textChild = slideChildren[0]!;
      expect(textChild.kind).toBe('text');

      const tb = getTextBuffer(textChild);
      expect(tb).toBeDefined();
      expect(tb!.raw).toBe('hello');
    });
  });

  describe('delta emissions', () => {
    it('should emit NodeAddedDelta for each tag-open', () => {
      const builder = createASTBuilder();
      const deltas = builder.push([tagOpen('Slide')]);

      const nodeAdded = deltas.filter((d) => d.kind === 'node-added');
      expect(nodeAdded.length).toBeGreaterThanOrEqual(1);

      const addedDelta = nodeAdded[0]!;
      expect(addedDelta.kind).toBe('node-added');
      expect(addedDelta.nodeKind).toBe('slide');
    });
  });

  describe('streaming text append', () => {
    it('should append text across multiple push() calls within the same text node', () => {
      const builder = createASTBuilder();

      // Open a text-bearing node
      builder.push([tagOpen('Slide'), tagOpen('Text')]);

      // First text chunk
      builder.push([textToken('hello')]);

      // Second text chunk
      builder.push([textToken(' world')]);

      // Close
      builder.push([tagClose('Text'), tagClose('Slide')]);

      const doc = builder.getDocument();
      const slide = doc.children[0]!;
      const slideChildren = getChildren(slide);
      const textNode = slideChildren[0]!;

      const tb = getTextBuffer(textNode);
      expect(tb).toBeDefined();
      expect(tb!.raw).toBe('hello world');
    });
  });

  describe('self-closing nodes', () => {
    it('should mark self-closing nodes as closed immediately', () => {
      const builder = createASTBuilder();
      builder.push([tagOpen('Spacer', new Map(), true)]);

      const doc = builder.getDocument();
      expect(doc.children).toHaveLength(1);
      const spacer = doc.children[0]!;
      expect(spacer.kind).toBe('spacer');
      expect(spacer.status).toBe('closed');
    });
  });

  describe('EOF handling', () => {
    it('should close all open nodes on EOF', () => {
      const builder = createASTBuilder();
      builder.push([tagOpen('Slide')]);

      // Slide is still open
      const docBefore = builder.getDocument();
      expect(docBefore.children[0]!.status).toBe('streaming');

      // Push EOF — should auto-close
      builder.push([eofToken()]);
      const docAfter = builder.getDocument();
      expect(docAfter.children[0]!.status).toBe('closed');
    });
  });

  describe('node index', () => {
    it('should register all created nodes in the nodeIndex', () => {
      const builder = createASTBuilder();
      builder.push([
        tagOpen('Slide'),
        tagOpen('Text'),
        textToken('hi'),
        tagClose('Text'),
        tagClose('Slide'),
      ]);
      const doc = builder.getDocument();

      // At minimum: slide + text node (which was explicitly opened)
      expect(doc.nodeIndex.size).toBeGreaterThanOrEqual(2);

      // Every child reachable from the tree should be in the index
      const slide = doc.children[0]!;
      expect(doc.nodeIndex.has(slide.id)).toBe(true);

      const textChild = getChildren(slide)[0]!;
      expect(doc.nodeIndex.has(textChild.id)).toBe(true);

      // Also accessible via getNode()
      expect(builder.getNode(slide.id)).toBe(slide);
      expect(builder.getNode(textChild.id)).toBe(textChild);
    });
  });
});
