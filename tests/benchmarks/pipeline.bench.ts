/**
 * Vitest benchmark suite for the Spatial Markdown Engine.
 *
 * Measures throughput of the pure-compute pipeline stages:
 *   1. Tokenizer (streaming text → tokens)
 *   2. AST Builder (tokens → document)
 *   3. Constraint Solver (document → constraints)
 *   4. Geometry Calculator (constraints + mock measurements → layout boxes)
 *   5. Full pipeline (tokenizer → AST → transforms → solver → geometry)
 *   6. Backpressure controller (hysteresis check overhead)
 *   7. Ring buffer (write/read throughput)
 *
 * @module tests/benchmarks/pipeline.bench
 */

import { describe, bench } from 'vitest';
import { createTokenizer } from '../../src/parser/tokenizer/state-machine';
import { createASTBuilder } from '../../src/parser/ast/builder';
import { createConstraintSolver } from '../../src/engine/constraints/solver';
import { createGeometryCalculator } from '../../src/engine/geometry/calculator';
import { createFrameScheduler } from '../../src/scheduler';
import { createRingBuffer } from '../../src/bridge/buffer/ring-buffer';
import { createBackpressureController } from '../../src/bridge/buffer/backpressure';
import { runTransforms } from '../../src/parser/transforms/index';
import { defaultTheme } from '../../src/types/theme';
import { px } from '../../src/types/primitives';
import type { SpatialNode, SpatialDocument } from '../../src/types/ast';
import type { MeasurementResult, LayoutConstraint } from '../../src/types/layout';
import type { NodeId } from '../../src/types/primitives';

// ─── Test Fixtures ─────────────────────────────────────────────────────

/** A moderately complex slide with mixed content. */
const SINGLE_SLIDE = `<Slide padding={32}>
<Heading level={1}>Performance Benchmark</Heading>
<Text>This is a benchmark test for the Spatial Markdown Engine layout pipeline.</Text>
<Stack direction="vertical" gap={8}>
<Text>First item in the stack.</Text>
<Text>Second item in the stack with more content to measure.</Text>
<MetricCard label="Revenue" value="$4.2M" trend="up" />
</Stack>
<Divider />
<Text>Footer content goes here.</Text>
</Slide>`;

/** Multiple slides to stress the pipeline. */
const MULTI_SLIDE = Array.from({ length: 10 }, (_, i) =>
  `<Slide><Heading level={2}>Slide ${i + 1}</Heading><Text>Content for slide ${i + 1} with enough text to trigger measurement.</Text></Slide>`,
).join('');

/** A large batch of streaming-style text chunks. */
const STREAM_CHUNKS = Array.from({ length: 50 }, (_, i) =>
  `<Text>Chunk ${i}: some content here.</Text>`,
).join('');

const VIEWPORT = { width: px(1280), height: px(720) };

// ─── Helpers ───────────────────────────────────────────────────────────

function buildAST(input: string): SpatialDocument {
  const tokenizer = createTokenizer();
  const builder = createASTBuilder();
  builder.push(tokenizer.feed(input));
  builder.push(tokenizer.flush());
  return builder.getDocument();
}

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
  for (const root of roots) {
    walk(root);
  }
  return map;
}

// ─── Tokenizer Benchmarks ──────────────────────────────────────────────

describe('Tokenizer', () => {
  bench('tokenize a single slide', () => {
    const tokenizer = createTokenizer();
    tokenizer.feed(SINGLE_SLIDE);
    tokenizer.flush();
  });

  bench('tokenize 10 slides', () => {
    const tokenizer = createTokenizer();
    tokenizer.feed(MULTI_SLIDE);
    tokenizer.flush();
  });

  bench('tokenize 50 text chunks (streaming simulation)', () => {
    const tokenizer = createTokenizer();
    for (const chunk of STREAM_CHUNKS.split('</Text>').slice(0, -1)) {
      tokenizer.feed(chunk + '</Text>');
    }
    tokenizer.flush();
  });
});

// ─── AST Builder Benchmarks ────────────────────────────────────────────

describe('AST Builder', () => {
  bench('build AST for a single slide', () => {
    const tokenizer = createTokenizer();
    const builder = createASTBuilder();
    builder.push(tokenizer.feed(SINGLE_SLIDE));
    builder.push(tokenizer.flush());
    builder.getDocument();
  });

  bench('build AST for 10 slides', () => {
    const tokenizer = createTokenizer();
    const builder = createASTBuilder();
    builder.push(tokenizer.feed(MULTI_SLIDE));
    builder.push(tokenizer.flush());
    builder.getDocument();
  });
});

// ─── Constraint Solver Benchmarks ──────────────────────────────────────

describe('Constraint Solver', () => {
  bench('solve constraints for a single slide', () => {
    const solver = createConstraintSolver();
    const doc = buildAST(SINGLE_SLIDE);
    solver.solve(doc.children, VIEWPORT);
  });

  bench('solve constraints for 10 slides', () => {
    const solver = createConstraintSolver();
    const doc = buildAST(MULTI_SLIDE);
    solver.solve(doc.children, VIEWPORT);
  });
});

// ─── Geometry Calculator Benchmarks ────────────────────────────────────

describe('Geometry Calculator', () => {
  bench('calculate geometry for a single slide', () => {
    const doc = buildAST(SINGLE_SLIDE);
    const solver = createConstraintSolver();
    const calculator = createGeometryCalculator();
    const constraints = solver.solve(doc.children, VIEWPORT);
    const measurements = mockMeasurements(doc.children);
    calculator.calculate(doc.children, constraints, measurements, defaultTheme);
  });

  bench('calculate geometry for 10 slides', () => {
    const doc = buildAST(MULTI_SLIDE);
    const solver = createConstraintSolver();
    const calculator = createGeometryCalculator();
    const constraints = solver.solve(doc.children, VIEWPORT);
    const measurements = mockMeasurements(doc.children);
    calculator.calculate(doc.children, constraints, measurements, defaultTheme);
  });
});

// ─── Full Pipeline (no render) Benchmarks ──────────────────────────────

describe('Full Pipeline (parser + engine)', () => {
  bench('full pipeline for a single slide', () => {
    const tokenizer = createTokenizer();
    const builder = createASTBuilder();
    const solver = createConstraintSolver();
    const calculator = createGeometryCalculator();

    const tokens = tokenizer.feed(SINGLE_SLIDE);
    builder.push(tokens);
    builder.push(tokenizer.flush());

    const doc = builder.getDocument();
    runTransforms(doc, defaultTheme);
    const constraints = solver.solve(doc.children, VIEWPORT);
    const measurements = mockMeasurements(doc.children);
    calculator.calculate(doc.children, constraints, measurements, defaultTheme);
  });

  bench('full pipeline for 10 slides', () => {
    const tokenizer = createTokenizer();
    const builder = createASTBuilder();
    const solver = createConstraintSolver();
    const calculator = createGeometryCalculator();

    const tokens = tokenizer.feed(MULTI_SLIDE);
    builder.push(tokens);
    builder.push(tokenizer.flush());

    const doc = builder.getDocument();
    runTransforms(doc, defaultTheme);
    const constraints = solver.solve(doc.children, VIEWPORT);
    const measurements = mockMeasurements(doc.children);
    calculator.calculate(doc.children, constraints, measurements, defaultTheme);
  });
});

// ─── Backpressure Controller Benchmark ─────────────────────────────────

describe('Backpressure Controller', () => {
  bench('10,000 hysteresis checks ( Around buffer thresholds )', () => {
    const ctrl = createBackpressureController({
      highWatermark: 0.75,
      lowWatermark: 0.25,
      onPause: () => {},
      onResume: () => {},
    });

    for (let i = 0; i < 10_000; i++) {
      const utilization = (i % 100) / 100; // Oscillate 0–0.99
      ctrl.check(utilization);
    }
  });
});

// ─── Ring Buffer Benchmark ─────────────────────────────────────────────

describe('Ring Buffer', () => {
  bench('write 10,000 items to a capacity-1024 buffer', () => {
    const buf = createRingBuffer<number>(1024);
    for (let i = 0; i < 10_000; i++) {
      buf.write(i);
      if (buf.isFull()) {
        while (!buf.isEmpty()) {
          buf.read();
        }
      }
    }
  });

  bench('alternating write/read 10,000 cycles', () => {
    const buf = createRingBuffer<number>(256);
    for (let i = 0; i < 10_000; i++) {
      buf.write(i);
      buf.read();
    }
  });
});

// ─── Frame Scheduler Benchmark ─────────────────────────────────────────

describe('Frame Scheduler', () => {
  bench('schedule and flush 1,000 callbacks', () => {
    const scheduler = createFrameScheduler();
    let counter = 0;

    for (let i = 0; i < 1_000; i++) {
      scheduler.scheduleUpdate(() => { counter++; });
      scheduler.flush();
    }

    scheduler.destroy();
  });
});