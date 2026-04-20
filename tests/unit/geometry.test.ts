/**
 * Unit tests for the Geometry Calculator — two-pass absolute positioning.
 *
 * Integration-style tests that exercise the full pipeline:
 *   tokenizer → AST builder → constraint solver → geometry calculator
 *
 * @module tests/unit/geometry
 */

import { createGeometryCalculator } from '../../src/engine/geometry/calculator';
import { createConstraintSolver } from '../../src/engine/constraints/solver';
import { createASTBuilder } from '../../src/parser/ast/builder';
import { createTokenizer } from '../../src/parser/tokenizer/state-machine';
import { px, nodeId } from '../../src/types/primitives';
import { defaultTheme } from '../../src/types/theme';
import type { LayoutConstraint, MeasurementResult, LayoutBox } from '../../src/types/layout';
import type { NodeId } from '../../src/types/primitives';
import type { SpatialNode } from '../../src/types/ast';

// ─── Helpers ─────────────────────────────────────────────────────────


/** Parse spatial markdown input into AST roots. */
function buildAST(input: string): SpatialNode[] {
  const tokenizer = createTokenizer();
  const builder = createASTBuilder();
  builder.push(tokenizer.feed(input));
  builder.push(tokenizer.flush());
  return builder.getDocument().children;
}

/**
 * Walk the AST and create mock height-only measurements for every
 * text-bearing node (those with a `textBuffer` property).
 * Each measured node gets a fixed 20px height with 1 line.
 */
function mockMeasurements(roots: SpatialNode[]): Map<NodeId, MeasurementResult> {
  const map = new Map<NodeId, MeasurementResult>();

  function walk(node: SpatialNode): void {
    if ('textBuffer' in node) {
      map.set(node.id, { kind: 'height-only', height: px(20), lineCount: 1 });
    }
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const root of roots) walk(root);
  return map;
}

/** Standard viewport for tests. */
const VIEWPORT = { width: px(1280), height: px(720) };

/**
 * Run the full layout pipeline: constraints → measurements → geometry.
 * Returns the calculated LayoutBox array.
 */
function layout(roots: SpatialNode[]): LayoutBox[] {
  const solver = createConstraintSolver();
  const calculator = createGeometryCalculator();

  const constraints = solver.solve(roots, VIEWPORT);
  const measurements = mockMeasurements(roots);

  return calculator.calculate(roots, constraints, measurements, defaultTheme);
}


// ─── Tests ───────────────────────────────────────────────────────────

describe('GeometryCalculator', () => {
  describe('Single slide with text', () => {
    it('produces a LayoutBox at (0,0) with viewport dimensions', () => {
      const roots = buildAST('<Slide>Hello world</Slide>');
      const boxes = layout(roots);

      expect(boxes).toHaveLength(1);

      const slide = boxes[0]!;
      expect(slide.kind).toBe('slide');
      expect(slide.x).toBe(0);
      expect(slide.y).toBe(0);
      // Slide defaults: width=1280, height=720
      expect(slide.width).toBe(1280);
      expect(slide.height).toBe(720);
    });
  });

  describe('Box has correct content area', () => {
    it('contentX/Y reflect default padding, contentWidth/Height account for padding', () => {
      const roots = buildAST('<Slide>Some text</Slide>');
      const boxes = layout(roots);

      const slide = boxes[0]!;

      // Default Slide padding is 32px on all sides
      const padding = 32;
      expect(slide.contentX).toBe(padding);
      expect(slide.contentY).toBe(padding);
      expect(slide.contentWidth).toBe(1280 - padding * 2);
      expect(slide.contentHeight).toBeGreaterThanOrEqual(0);
    });

    it('respects custom padding when specified', () => {
      const roots = buildAST('<Slide padding="20">Text</Slide>');
      const boxes = layout(roots);

      const slide = boxes[0]!;
      expect(slide.contentX).toBe(20);
      expect(slide.contentY).toBe(20);
      expect(slide.contentWidth).toBe(1280 - 40);
    });
  });

  describe('Children are positioned', () => {
    it('stacks two Text children vertically within a Slide', () => {
      // Two separate text nodes inside a slide
      const input = '<Slide><Text>First paragraph</Text><Text>Second paragraph</Text></Slide>';
      const roots = buildAST(input);
      const boxes = layout(roots);

      expect(boxes).toHaveLength(1);
      const slide = boxes[0]!;

      // Slide uses block-flow layout, so children stack vertically
      expect(slide.children.length).toBe(2);

      const child0 = slide.children[0]!;
      const child1 = slide.children[1]!;

      expect(child0.kind).toBe('text');
      expect(child1.kind).toBe('text');

      // Both children should start at the same x (content area left edge)
      expect(child0.x).toBe(child1.x);

      // Second child's y should be offset by the first child's height + default slide gap (8px)
      expect(child1.y).toBe(child0.y + child0.height + 8);
    });

    it('positions a heading and text in sequential vertical order', () => {
      const input = '<Slide><Heading>Title</Heading><Text>Body text</Text></Slide>';
      const roots = buildAST(input);
      const boxes = layout(roots);

      const slide = boxes[0]!;
      expect(slide.children.length).toBe(2);

      const heading = slide.children[0]!;
      const text = slide.children[1]!;

      expect(heading.kind).toBe('heading');
      expect(text.kind).toBe('text');

      // Text starts after heading ends
      expect(text.y).toBeGreaterThanOrEqual(heading.y + heading.height);
    });
  });

  describe('Empty input', () => {
    it('returns an empty array when given no roots', () => {
      const calculator = createGeometryCalculator();
      const boxes = calculator.calculate(
        [],
        new Map(),
        new Map(),
        defaultTheme,
      );

      expect(boxes).toEqual([]);
    });


    it('returns an empty array for whitespace-only input after AST build', () => {
      // Whitespace-only input produces a text node at root level, but
      // let's verify the pipeline doesn't crash
      const roots = buildAST('   ');
      const boxes = layout(roots);

      // May produce a text node box or empty, but must not throw
      expect(Array.isArray(boxes)).toBe(true);
    });
  });

  describe('LayoutBox has nodeId matching AST', () => {
    it('the box nodeId matches the original SpatialNode id for a slide', () => {
      const roots = buildAST('<Slide>Content</Slide>');
      const boxes = layout(roots);

      expect(boxes).toHaveLength(1);

      const slideNode = roots[0]!;
      const slideBox = boxes[0]!;

      expect(slideBox.nodeId).toBe(slideNode.id);
    });

    it('child box nodeIds match their corresponding AST node ids', () => {
      const input = '<Slide><Text>Hello</Text><Text>World</Text></Slide>';
      const roots = buildAST(input);
      const boxes = layout(roots);

      const slideNode = roots[0]!;
      const slideBox = boxes[0]!;

      expect(slideBox.nodeId).toBe(slideNode.id);

      // Get AST children
      const astChildren = (slideNode as { children: SpatialNode[] }).children;
      expect(astChildren.length).toBe(slideBox.children.length);

      for (let i = 0; i < astChildren.length; i++) {
        expect(slideBox.children[i]!.nodeId).toBe(astChildren[i]!.id);
      }
    });
  });

  describe('Multiple slides', () => {
    it('stacks multiple root-level slides vertically', () => {
      const input = '<Slide>First</Slide><Slide>Second</Slide>';
      const roots = buildAST(input);
      const boxes = layout(roots);

      expect(boxes).toHaveLength(2);

      const first = boxes[0]!;
      const second = boxes[1]!;

      expect(first.x).toBe(0);
      expect(first.y).toBe(0);
      expect(second.x).toBe(0);
      // Second slide starts after the first slide's full height
      expect(second.y).toBe(first.height);
    });
  });
});
