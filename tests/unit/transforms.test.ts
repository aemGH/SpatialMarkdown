/**
 * Unit tests for AST transform pipeline modules.
 *
 * @module tests/unit/transforms
 */

import { describe, it, expect } from 'vitest';
import { autoParagraph } from '../../src/parser/transforms/auto-paragraph';
import { resolveFonts } from '../../src/parser/transforms/font-resolver';
import { normalizeHeadings } from '../../src/parser/transforms/heading-levels';
import { resolveListNumbers } from '../../src/parser/transforms/list-numbering';
import { runTransforms } from '../../src/parser/transforms/index';
import { createASTBuilder } from '../../src/parser/ast/builder';
import type { SpatialDocument, SpatialNode } from '../../src/types/ast';
import type { ThemeConfig } from '../../src/types/theme';
import { defaultTheme } from '../../src/types/theme';
import { font, px } from '../../src/types/primitives';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Build a document from a Spatial Markdown string using the pipeline stages. */
function buildDoc(markup: string): SpatialDocument {
  const { createTokenizer } = require('../../src/parser/tokenizer/state-machine');
  const tokenizer = createTokenizer();
  const builder = createASTBuilder();

  const tokens = tokenizer.feed(markup);
  if (tokens.length > 0) builder.push(tokens);

  const finalTokens = tokenizer.flush();
  if (finalTokens.length > 0) builder.push(finalTokens);

  return builder.getDocument();
}

/** Get children of a container node. */
function getChildren(node: SpatialNode): SpatialNode[] {
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

// ─── Auto-Paragraph ─────────────────────────────────────────────────

describe('autoParagraph', () => {
  it('should merge consecutive text siblings inside a Slide', () => {
    // Build a doc with two adjacent text nodes inside a Slide.
    // The markup '<Slide>A</Slide>' auto-creates one text node.
    // We need streaming-style input to produce two adjacent text nodes.
    const builder = createASTBuilder();
    // Manually construct: <Slide><Text>A</Text><Text>B</Text></Slide>
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'A', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 17 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 24 },
      { kind: 'text', content: 'B', offset: 30 },
      { kind: 'tag-close', tag: 'Text', offset: 31 },
      { kind: 'tag-close', tag: 'Slide', offset: 38 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;
    expect(slide.kind).toBe('slide');

    // Before autoParagraph: should have 2 text children
    const childrenBefore = getChildren(slide);
    expect(childrenBefore.length).toBe(2);
    expect(childrenBefore[0]!.kind).toBe('text');
    expect(childrenBefore[1]!.kind).toBe('text');

    const deltas = autoParagraph(doc);

    // After autoParagraph: should have 1 merged text child
    const childrenAfter = getChildren(slide);
    expect(childrenAfter.length).toBe(1);
    expect(childrenAfter[0]!.kind).toBe('text');

    // The merged text should contain both texts
    const mergedBuffer = (childrenAfter[0] as SpatialNode & { textBuffer: { raw: string } }).textBuffer;
    expect(mergedBuffer.raw).toBe('AB');

    // Deltas should report the merge
    const removedDeltas = deltas.filter(d => d.kind === 'node-removed');
    expect(removedDeltas.length).toBe(1);

    const appendedDeltas = deltas.filter(d => d.kind === 'text-appended');
    expect(appendedDeltas.length).toBe(1);
    expect((appendedDeltas[0] as { newFullText: string }).newFullText).toBe('AB');
  });

  it('should not merge non-text siblings', () => {
    const builder = createASTBuilder();
    // <Slide><Text>A</Text><Heading level={1}>B</Heading></Slide>
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'A', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 17 },
      { kind: 'tag-open', tag: 'Heading', attributes: new Map([['level', '1']]), selfClosing: false, offset: 24 },
      { kind: 'text', content: 'B', offset: 45 },
      { kind: 'tag-close', tag: 'Heading', offset: 46 },
      { kind: 'tag-close', tag: 'Slide', offset: 56 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;
    const childrenBefore = getChildren(slide);
    expect(childrenBefore.length).toBe(2);

    autoParagraph(doc);

    const childrenAfter = getChildren(slide);
    // Heading is not a text node, so no merge should happen
    expect(childrenAfter.length).toBe(2);
  });

  it('should return empty deltas for an empty document', () => {
    const builder = createASTBuilder();
    const doc = builder.getDocument();
    const deltas = autoParagraph(doc);
    expect(deltas).toEqual([]);
  });

  it('should return empty deltas when there are no consecutive text siblings', () => {
    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'hello', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 21 },
      { kind: 'tag-close', tag: 'Slide', offset: 28 },
    ]);

    const doc = builder.getDocument();
    const deltas = autoParagraph(doc);
    // Only one text node inside the slide — nothing to merge
    expect(deltas).toEqual([]);
  });

  it('should merge three consecutive text siblings into one', () => {
    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'A', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 17 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 24 },
      { kind: 'text', content: 'B', offset: 30 },
      { kind: 'tag-close', tag: 'Text', offset: 31 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 38 },
      { kind: 'text', content: 'C', offset: 44 },
      { kind: 'tag-close', tag: 'Text', offset: 45 },
      { kind: 'tag-close', tag: 'Slide', offset: 52 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;

    const childrenBefore = getChildren(slide);
    expect(childrenBefore.length).toBe(3);

    const deltas = autoParagraph(doc);

    const childrenAfter = getChildren(slide);
    expect(childrenAfter.length).toBe(1);
    const mergedBuffer = (childrenAfter[0] as SpatialNode & { textBuffer: { raw: string } }).textBuffer;
    expect(mergedBuffer.raw).toBe('ABC');

    // Two nodes should have been removed (absorbed into the first)
    const removedDeltas = deltas.filter(d => d.kind === 'node-removed');
    expect(removedDeltas.length).toBe(2);
  });

  it('should remove absorbed nodes from the nodeIndex', () => {
    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'A', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 17 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 24 },
      { kind: 'text', content: 'B', offset: 30 },
      { kind: 'tag-close', tag: 'Text', offset: 31 },
      { kind: 'tag-close', tag: 'Slide', offset: 38 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;
    const secondTextId = getChildren(slide)[1]!.id;

    // Second text node should be in the index before merge
    expect(doc.nodeIndex.has(secondTextId)).toBe(true);

    autoParagraph(doc);

    // After merge, the absorbed node should be gone from the index
    expect(doc.nodeIndex.has(secondTextId)).toBe(false);

    // The surviving node should still be in the index
    const firstTextId = getChildren(slide)[0]!.id;
    expect(doc.nodeIndex.has(firstTextId)).toBe(true);
  });

  it('should handle nested containers independently', () => {
    const builder = createASTBuilder();
    // <Slide><Stack><Text>A</Text><Text>B</Text></Stack><Text>C</Text><Text>D</Text></Slide>
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Stack', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 20 },
      { kind: 'text', content: 'A', offset: 26 },
      { kind: 'tag-close', tag: 'Text', offset: 27 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 34 },
      { kind: 'text', content: 'B', offset: 40 },
      { kind: 'tag-close', tag: 'Text', offset: 41 },
      { kind: 'tag-close', tag: 'Stack', offset: 48 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 58 },
      { kind: 'text', content: 'C', offset: 64 },
      { kind: 'tag-close', tag: 'Text', offset: 65 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 72 },
      { kind: 'text', content: 'D', offset: 78 },
      { kind: 'tag-close', tag: 'Text', offset: 79 },
      { kind: 'tag-close', tag: 'Slide', offset: 86 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;

    autoParagraph(doc);

    // Stack should have merged A+B into one text node
    const stack = getChildren(slide).find(c => c.kind === 'stack')!;
    expect(stack).toBeDefined();
    const stackChildren = getChildren(stack);
    expect(stackChildren.length).toBe(1);
    const stackBuffer = (stackChildren[0] as SpatialNode & { textBuffer: { raw: string } }).textBuffer;
    expect(stackBuffer.raw).toBe('AB');

    // Slide should have merged C+D into one text node (alongside the Stack)
    const slideTexts = getChildren(slide).filter(c => c.kind === 'text');
    expect(slideTexts.length).toBe(1);
    const slideBuffer = (slideTexts[0]! as SpatialNode & { textBuffer: { raw: string } }).textBuffer;
    expect(slideBuffer.raw).toBe('CD');
  });

  it('should skip text nodes separated by non-text nodes', () => {
    const builder = createASTBuilder();
    // <Slide><Text>A</Text><Spacer /><Text>B</Text></Slide>
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'A', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 17 },
      { kind: 'tag-open', tag: 'Spacer', attributes: new Map(), selfClosing: true, offset: 24 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 40 },
      { kind: 'text', content: 'B', offset: 46 },
      { kind: 'tag-close', tag: 'Text', offset: 47 },
      { kind: 'tag-close', tag: 'Slide', offset: 54 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;

    autoParagraph(doc);

    // Spacer separates the two text nodes, so they should NOT be merged
    const children = getChildren(slide);
    const textNodes = children.filter(c => c.kind === 'text');
    expect(textNodes.length).toBe(2);
  });
});

// ─── Font Resolver ────────────────────────────────────────────────────

describe('resolveFonts', () => {
  it('should flag text nodes with mismatched font as dirty', () => {
    // Create a theme with a custom body font
    const customTheme: ThemeConfig = {
      ...defaultTheme,
      fonts: {
        ...defaultTheme.fonts,
        body: font('16px "Custom Font"'),
      },
    };

    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'hello', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 21 },
      { kind: 'tag-close', tag: 'Slide', offset: 28 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;
    const textNode = getChildren(slide)[0]!;

    // Reset dirty flags to check what resolveFonts sets
    textNode.dirty.textDirty = false;
    textNode.dirty.constraintDirty = false;

    resolveFonts(doc, customTheme);

    // The text node's font (from factory defaults) should differ from customTheme.fonts.body
    expect(textNode.dirty.textDirty).toBe(true);
    expect(textNode.dirty.constraintDirty).toBe(true);
  });

  it('should not flag text nodes when font matches theme', () => {
    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'hello', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 21 },
      { kind: 'tag-close', tag: 'Slide', offset: 28 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;
    const textNode = getChildren(slide)[0]!;

    // Reset dirty flags
    textNode.dirty.textDirty = false;
    textNode.dirty.constraintDirty = false;

    // Use the default theme — body font should match factory defaults
    resolveFonts(doc, defaultTheme);

    expect(textNode.dirty.textDirty).toBe(false);
    expect(textNode.dirty.constraintDirty).toBe(false);
  });

  it('should walk into nested containers', () => {
    const customTheme: ThemeConfig = {
      ...defaultTheme,
      fonts: {
        ...defaultTheme.fonts,
        mono: font('12px "Custom Mono"'),
      },
    };

    const builder = createASTBuilder();
    // <Slide><Stack><CodeBlock>hello</CodeBlock></Stack></Slide>
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Stack', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'tag-open', tag: 'CodeBlock', attributes: new Map(), selfClosing: false, offset: 20 },
      { kind: 'text', content: 'console.log("hi")', offset: 30 },
      { kind: 'tag-close', tag: 'CodeBlock', offset: 48 },
      { kind: 'tag-close', tag: 'Stack', offset: 58 },
      { kind: 'tag-close', tag: 'Slide', offset: 66 },
    ]);

    const doc = builder.getDocument();
    const slide = doc.children[0]!;
    const stack = getChildren(slide)[0]!;
    const codeBlock = getChildren(stack)[0]!;

    codeBlock.dirty.textDirty = false;
    codeBlock.dirty.constraintDirty = false;

    resolveFonts(doc, customTheme);

    // CodeBlock font (factory default) should differ from customTheme.fonts.mono
    expect(codeBlock.dirty.textDirty).toBe(true);
    expect(codeBlock.dirty.constraintDirty).toBe(true);
  });

  it('should not flag nodes without font props', () => {
    const builder = createASTBuilder();
    // <Slide><Spacer /></Slide>
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Spacer', attributes: new Map(), selfClosing: true, offset: 10 },
      { kind: 'tag-close', tag: 'Slide', offset: 20 },
    ]);

    const doc = builder.getDocument();
    const customTheme: ThemeConfig = {
      ...defaultTheme,
      fonts: {
        ...defaultTheme.fonts,
        body: font('99px "Custom"'),
      },
    };

    // Should not throw or flag anything — Spacer has no font prop
    expect(() => resolveFonts(doc, customTheme)).not.toThrow();
  });

  it('should return void (no return value)', () => {
    const builder = createASTBuilder();
    const doc = builder.getDocument();
    const result = resolveFonts(doc, defaultTheme);
    expect(result).toBeUndefined();
  });
});

// ─── Heading Levels (no-op) ──────────────────────────────────────────

describe('normalizeHeadings', () => {
  it('should return an empty array for any document', () => {
    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Heading', attributes: new Map([['level', '1']]), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'Title', offset: 30 },
      { kind: 'tag-close', tag: 'Heading', offset: 35 },
      { kind: 'tag-close', tag: 'Slide', offset: 44 },
    ]);

    const doc = builder.getDocument();
    const deltas = normalizeHeadings(doc);
    expect(deltas).toEqual([]);
  });

  it('should return an empty array for an empty document', () => {
    const builder = createASTBuilder();
    const doc = builder.getDocument();
    const deltas = normalizeHeadings(doc);
    expect(deltas).toEqual([]);
  });
});

// ─── List Numbering (no-op) ──────────────────────────────────────────

describe('resolveListNumbers', () => {
  it('should return an empty array for any document', () => {
    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'Item 1', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 22 },
      { kind: 'tag-close', tag: 'Slide', offset: 30 },
    ]);

    const doc = builder.getDocument();
    const deltas = resolveListNumbers(doc);
    expect(deltas).toEqual([]);
  });

  it('should return an empty array for an empty document', () => {
    const builder = createASTBuilder();
    const doc = builder.getDocument();
    const deltas = resolveListNumbers(doc);
    expect(deltas).toEqual([]);
  });
});

// ─── runTransforms (integration) ──────────────────────────────────────

describe('runTransforms', () => {
  it('should run the full pipeline and return aggregated deltas', () => {
    const builder = createASTBuilder();
    builder.push([
      { kind: 'tag-open', tag: 'Slide', attributes: new Map(), selfClosing: false, offset: 0 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 10 },
      { kind: 'text', content: 'A', offset: 16 },
      { kind: 'tag-close', tag: 'Text', offset: 17 },
      { kind: 'tag-open', tag: 'Text', attributes: new Map(), selfClosing: false, offset: 24 },
      { kind: 'text', content: 'B', offset: 30 },
      { kind: 'tag-close', tag: 'Text', offset: 31 },
      { kind: 'tag-close', tag: 'Slide', offset: 38 },
    ]);

    const doc = builder.getDocument();

    const deltas = runTransforms(doc, defaultTheme);

    // autoParagraph should have produced deltas (node-removed, text-appended)
    // normalizeHeadings and resolveListNumbers are no-ops
    // resolveFonts may produce dirty flags but no deltas
    expect(deltas.length).toBeGreaterThan(0);

    // The merged text node should have 'AB' as its content
    const slide = doc.children[0]!;
    const textNodes = getChildren(slide).filter(c => c.kind === 'text');
    expect(textNodes.length).toBe(1);
    const buffer = (textNodes[0]! as SpatialNode & { textBuffer: { raw: string } }).textBuffer;
    expect(buffer.raw).toBe('AB');
  });
});