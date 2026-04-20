/**
 * Unit tests for the constraint solver.
 *
 * @module tests/unit/constraint-solver
 */

import { createConstraintSolver } from '../../src/engine/constraints/solver';
import { createASTBuilder } from '../../src/parser/ast/builder';
import { createTokenizer } from '../../src/parser/tokenizer/state-machine';
import { px } from '../../src/types/primitives';
import type { SpatialNode } from '../../src/types/ast';
import type { Pixels } from '../../src/types/primitives';

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Parse a Spatial Markdown string through tokenizer → AST builder
 * and return the document's top-level children.
 */
function buildAST(input: string): SpatialNode[] {
  const tokenizer = createTokenizer();
  const builder = createASTBuilder();

  const tokens = tokenizer.feed(input);
  builder.push(tokens);

  const finalTokens = tokenizer.flush();
  builder.push(finalTokens);

  return builder.getDocument().children;
}

/** Standard test viewport. */
const VIEWPORT = { width: px(1280), height: px(720) } as const;

/** Get children from a container node. */
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

// ─── Tests ───────────────────────────────────────────────────────────

describe('Constraint Solver', () => {
  describe('single slide', () => {
    it('should assign viewport-width constraint to a top-level Slide', () => {
      const solver = createConstraintSolver();
      const roots = buildAST('<Slide>Hello</Slide>');

      expect(roots).toHaveLength(1);
      const constraints = solver.solve(roots, VIEWPORT);

      const slide = roots[0]!;
      const slideConstraint = constraints.get(slide.id);

      expect(slideConstraint).toBeDefined();
      expect(slideConstraint!.maxWidth).toBe(VIEWPORT.width);
      expect(slideConstraint!.maxHeight).toBe(VIEWPORT.height);
    });
  });

  describe('nested stack', () => {
    it('should reduce the available width for a Stack by the Slide padding', () => {
      const solver = createConstraintSolver();
      const roots = buildAST('<Slide><Stack><Text>content</Text></Stack></Slide>');

      expect(roots).toHaveLength(1);
      const constraints = solver.solve(roots, VIEWPORT);

      const slide = roots[0]!;
      const slideChildren = getChildren(slide);
      expect(slideChildren.length).toBeGreaterThanOrEqual(1);

      const stack = slideChildren[0]!;
      expect(stack.kind).toBe('stack');

      const stackConstraint = constraints.get(stack.id);
      expect(stackConstraint).toBeDefined();

      // Slide default padding is 32px (both sides = 64px total)
      // So Stack's available width should be Slide contentWidth = 1280 - 32*2 = 1216
      // BUT the constraint *on* the stack is what the slide's block resolver gave it.
      // resolveBlockConstraints subtracts the slide's padding from its own width (default 1280).
      // Slide props: width=1280, height=720, padding=32, paddingX=undefined, paddingY=undefined
      // contentWidth = 1280 - 32 - 32 = 1216
      const expectedWidth = px(1280 - 32 * 2);
      expect(stackConstraint!.maxWidth).toBe(expectedWidth);
      expect(stackConstraint!.availableWidth).toBe(expectedWidth);
    });
  });

  describe('AutoGrid', () => {
    it('should compute child column widths from minChildWidth', () => {
      const solver = createConstraintSolver();
      // AutoGrid with default minChildWidth=200, default gap=16
      const roots = buildAST(
        '<AutoGrid minChildWidth="200"><Text>A</Text><Text>B</Text></AutoGrid>',
      );

      expect(roots).toHaveLength(1);
      const constraints = solver.solve(roots, VIEWPORT);

      const grid = roots[0]!;
      expect(grid.kind).toBe('auto-grid');

      const gridChildren = getChildren(grid);
      expect(gridChildren.length).toBeGreaterThanOrEqual(2);

      // The grid itself gets viewport constraint
      const gridConstraint = constraints.get(grid.id);
      expect(gridConstraint).toBeDefined();

      // Children should get computed column widths.
      // AutoGrid: default padding=0, gap=12, minChildWidth=200
      // contentWidth = 1280 (no padding on auto-grid by default)
      // gapX = 12 (default gap)
      // cols = floor((1280 + 12) / (200 + 12)) = floor(1292 / 212) = 6
      // totalGapX = (6-1) * 12 = 60
      // childWidth = (1280 - 60) / 6 = 1220 / 6 = 203.33333333333334
      const childA = gridChildren[0]!;
      const childConstraint = constraints.get(childA.id);
      expect(childConstraint).toBeDefined();
      expect(childConstraint!.maxWidth).toBe(px(1220 / 6));
    });
  });

  describe('empty input', () => {
    it('should return an empty constraint map for empty roots', () => {
      const solver = createConstraintSolver();
      const constraints = solver.solve([], VIEWPORT);

      expect(constraints.size).toBe(0);
    });
  });

  describe('multiple roots', () => {
    it('should assign viewport constraints to both Slide roots', () => {
      const solver = createConstraintSolver();
      const roots = buildAST('<Slide>First</Slide><Slide>Second</Slide>');

      expect(roots).toHaveLength(2);
      const constraints = solver.solve(roots, VIEWPORT);

      const slide1 = roots[0]!;
      const slide2 = roots[1]!;

      const c1 = constraints.get(slide1.id);
      const c2 = constraints.get(slide2.id);

      expect(c1).toBeDefined();
      expect(c2).toBeDefined();
      expect(c1!.maxWidth).toBe(VIEWPORT.width);
      expect(c2!.maxWidth).toBe(VIEWPORT.width);
      expect(c1!.maxHeight).toBe(VIEWPORT.height);
      expect(c2!.maxHeight).toBe(VIEWPORT.height);
    });
  });
});
