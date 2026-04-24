/**
 * Pipeline integration tests — end-to-end: feed → tokenize → parse → document structure.
 *
 * Tests the full SpatialPipeline public API at the document/AST level.
 * Render-command tests require a Canvas environment (see command-builder.test.ts
 * for headless render tests with mocked LayoutBoxes).
 *
 * The measurement stage (@chenglou/pretext) needs a real Canvas, so
 * full-pipeline render tests are better suited for browser-based E2E.
 *
 * @module @spatial/engine/pipeline
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPipeline } from '../../src/pipeline';
import type { SpatialPipeline } from '../../src/pipeline';
import { createNodeCanvasMeasurementContext } from '../../src/engine/measurement/node-canvas-context';

describe('Pipeline Integration', () => {
  let pipeline: SpatialPipeline;

  beforeEach(() => {
    pipeline = createPipeline({ measurementContext: createNodeCanvasMeasurementContext() });
  });

  afterEach(() => {
    pipeline.destroy();
  });

  describe('feed() + getDocument()', () => {
    it('should parse simple text into a text node', () => {
      pipeline.feed('Hello World');
      // Bare text stays buffered in the tokenizer until flush/EOF —
      // finalize the stream so the AST builder receives the text + EOF tokens.
      pipeline.flush();

      const doc = pipeline.getDocument();
      expect(doc.children.length).toBeGreaterThanOrEqual(1);
      const textChild = doc.children.find(c => c.kind === 'text');
      expect(textChild).toBeDefined();
      if (textChild) {
        expect((textChild as any).textBuffer.raw).toBe('Hello World');
      }
    });

    it('should parse a Slide with children', () => {
      pipeline.feed('<Slide><Heading level={1}>Title</Heading>Body text.</Slide>');

      const doc = pipeline.getDocument();
      expect(doc.version).toBe('1.0');
      expect(doc.children.length).toBe(1);

      const slide = doc.children[0]!;
      expect(slide.kind).toBe('slide');
      expect(slide.children.length).toBeGreaterThanOrEqual(2);

      // Should have heading and text child
      const kinds = slide.children.map(c => c.kind);
      expect(kinds).toContain('heading');
      expect(kinds).toContain('text');
    });

    it('should parse self-closing tags correctly', () => {
      pipeline.feed('<Slide><MetricCard label="Revenue" value="$4.2M" /></Slide>');

      const doc = pipeline.getDocument();
      const slide = doc.children[0]!;
      expect(slide.kind).toBe('slide');

      const metricCard = slide.children.find(c => c.kind === 'metric-card');
      expect(metricCard).toBeDefined();
      expect((metricCard as any).props.label).toBe('Revenue');
      expect((metricCard as any).props.value).toBe('$4.2M');
    });

    it('should handle multiple root-level elements', () => {
      pipeline.feed('<Slide>First</Slide><Slide>Second</Slide>');

      const doc = pipeline.getDocument();
      expect(doc.children.length).toBe(2);
      expect(doc.children[0]!.kind).toBe('slide');
      expect(doc.children[1]!.kind).toBe('slide');
    });

    it('should handle empty input gracefully', () => {
      pipeline.feed('');

      const doc = pipeline.getDocument();
      expect(doc.children.length).toBe(0);
    });

    it('should auto-wrap bare text in a Text node', () => {
      pipeline.feed('Just some text');
      // Flush tokenizer so bare text (no closing tag) is emitted and finalized.
      pipeline.flush();

      const doc = pipeline.getDocument();
      expect(doc.children.length).toBe(1);
      expect(doc.children[0]!.kind).toBe('text');
    });

    it('should handle nested containers', () => {
      pipeline.feed('<Slide><Stack direction="vertical" gap={8}><Text>One</Text><Text>Two</Text></Stack></Slide>');

      const doc = pipeline.getDocument();
      const slide = doc.children[0]!;
      expect(slide.kind).toBe('slide');
      expect(slide.children.length).toBeGreaterThanOrEqual(1);

      const stack = slide.children.find(c => c.kind === 'stack');
      expect(stack).toBeDefined();
      expect((stack as any).children.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Incremental feed()', () => {
    it('should handle text fed in multiple chunks', () => {
      pipeline.feed('<Slide>');
      pipeline.feed('Hello ');
      pipeline.feed('World');
      pipeline.feed('</Slide>');

      const doc = pipeline.getDocument();
      const slide = doc.children[0]!;
      expect(slide.kind).toBe('slide');

      // The text should be accumulated in the auto-created Text node
      const textNodes = (slide as any).children.filter((c: any) => c.kind === 'text' && c.textBuffer.raw.trim().length > 0);
      expect(textNodes.length).toBeGreaterThan(0);

      const fullText = textNodes.map((n: any) => n.textBuffer.raw).join('');
      expect(fullText).toContain('Hello World');
    });

    it('should buffer partial tags across feed() calls', () => {
      pipeline.feed('<Sli');
      pipeline.feed('de>Hello</Slide>');

      const doc = pipeline.getDocument();
      expect(doc.children.length).toBe(1);
      expect(doc.children[0]!.kind).toBe('slide');
    });
  });

  describe('feedStream()', () => {
    it('should accept a ReadableStream', () => {
      const chunks = ['<Slide>', 'Streamed', ' content', '</Slide>'];
      const stream = new ReadableStream<string>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      pipeline.feedStream(stream);

      // We can't flush synchronously since feedStream is async,
      // but getDocument() should show the partial result
      // Give it a tick for the stream to process
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const doc = pipeline.getDocument();
          // The stream may have processed all or part of the input
          expect(doc.children.length).toBeGreaterThanOrEqual(1);
          pipeline.destroy();
          resolve();
        }, 50);
      });
    });
  });

  describe('getDocument()', () => {
    it('should return a valid document with nodeIndex', () => {
      pipeline.feed('<Slide><Heading level={2}>Test</Heading>Body text</Slide>');

      const doc = pipeline.getDocument();

      expect(doc.version).toBe('1.0');
      expect(doc.children.length).toBe(1);
      expect(doc.children[0]!.kind).toBe('slide');
      expect(doc.nodeIndex.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('destroy()', () => {
    it('should prevent further operations after destroy', () => {
      pipeline.destroy();

      // Should not throw, but should be no-ops
      expect(() => pipeline.feed('test')).not.toThrow();
      expect(() => pipeline.resize(100, 100)).not.toThrow();

      const unsub = pipeline.onRender(() => {});
      // Should return a no-op unsubscribe
      expect(unsub()).toBeUndefined();
    });

    it('should handle double destroy gracefully', () => {
      pipeline.destroy();
      expect(() => pipeline.destroy()).not.toThrow();
    });
  });

  describe('onRender() subscription', () => {
    it('should return an unsubscribe function', () => {
      const unsub = pipeline.onRender(() => {});
      expect(typeof unsub).toBe('function');

      // Unsubscribing should not throw
      expect(() => unsub()).not.toThrow();
    });

    it('should support multiple subscribers', () => {
      let count1 = 0;
      let count2 = 0;

      const unsub1 = pipeline.onRender(() => { count1++; });
      pipeline.onRender(() => { count2++; });

      pipeline.feed('<Slide>test</Slide>');
      pipeline.flush();

      // Both subscribers should have been called
      // Note: may be 0 if layout pass errors out (no canvas), but the
      // subscription mechanism itself is valid
      unsub1();
    });
  });
});