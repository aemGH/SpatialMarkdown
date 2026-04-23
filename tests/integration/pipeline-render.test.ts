/**
 * End-to-end integration test: feed a realistic Spatial Markdown
 * document → verify the pipeline produces a non-empty RenderCommand
 * list.
 *
 * jsdom alone does not implement `HTMLCanvasElement.getContext('2d')`,
 * which breaks `@chenglou/pretext`'s font measurement stage. Installing
 * the `canvas` package (node-canvas) lets jsdom detect and use a real
 * Cairo-backed 2D context that pretext can drive for font metrics.
 *
 * This test is the single correctness gate that says "the pipeline is
 * wired correctly all the way from tokens to draw commands." It catches
 * the failure mode that went silent in the unit tests: pretext throws
 * during measurement, the pipeline's try/catch swallows the error,
 * subscribers receive an empty command list, AST-level assertions
 * still pass, but no pixels would have been produced in a real browser.
 *
 * @module @spatial/engine/integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPipeline } from '../../src/pipeline';
import type { SpatialPipeline } from '../../src/pipeline';
import type { RenderCommand } from '../../src/types/render';

// ─── Preset: compact but covers every major tag ──────────────────────

const FULL_PRESET = `<Slide>
  <Heading level={1}>Spatial Markdown Engine</Heading>
  A high-performance layout engine for LLM streaming output.
  <Spacer height={16} />
  <AutoGrid minChildWidth={200} gap={16}>
    <MetricCard label="Layout" value="<1ms" sentiment="positive" />
    <MetricCard label="Reflows" value="Zero" sentiment="positive" />
  </AutoGrid>
  <Divider />
  <Callout type="tip" title="Streaming-Safe">
    Partial tags split across chunks are buffered automatically.
  </Callout>
</Slide>`;

// ─── Helper: run the pipeline synchronously and capture commands ─────

function captureCommands(
  pipeline: SpatialPipeline,
): ReadonlyArray<RenderCommand> {
  let captured: ReadonlyArray<RenderCommand> = [];
  const unsubscribe = pipeline.onRender((commands) => {
    captured = commands;
  });
  pipeline.flush();
  unsubscribe();
  return captured;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Pipeline end-to-end rendering', () => {
  let pipeline: SpatialPipeline;

  beforeEach(() => {
    pipeline = createPipeline();
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('produces a non-empty RenderCommand list for a realistic document', () => {
    pipeline.feed(FULL_PRESET);
    const commands = captureCommands(pipeline);

    // Headline assertion: measurement + geometry + command-building
    // actually completed end-to-end. This is the contract that jsdom
    // unit tests could not verify because pretext's canvas context
    // was null.
    expect(commands.length).toBeGreaterThan(0);

    const kinds = new Set(commands.map((c) => c.kind));

    // Every rendered slide paints a background rectangle.
    expect(kinds.has('fill-rect')).toBe(true);

    // Every non-empty document emits at least one text command.
    expect(kinds.has('fill-text')).toBe(true);

    // The Divider primitive should emit a line.
    expect(kinds.has('draw-line')).toBe(true);
  });

  it('emits text commands with non-empty content', () => {
    pipeline.feed(FULL_PRESET);
    const commands = captureCommands(pipeline);

    const textCommands = commands.filter((c) => c.kind === 'fill-text');
    expect(textCommands.length).toBeGreaterThan(0);

    // At least one text command should contain real content. This
    // catches the degenerate case where measurement silently produces
    // zero-width empty lines.
    const hasMeaningfulText = textCommands.some(
      (c) => c.kind === 'fill-text' && c.text.trim().length > 0,
    );
    expect(hasMeaningfulText).toBe(true);
  });

  it('re-renders synchronously on resize without flush or re-feed', () => {
    // Core contract: resize() with existing content must fire onRender
    // synchronously. No flush(), no re-feed. It just works.
    pipeline.resize(800, 600);
    pipeline.feed(FULL_PRESET);
    pipeline.flush();

    let commands800: ReadonlyArray<RenderCommand> = [];
    const unsub800 = pipeline.onRender((cmds) => { commands800 = cmds; });
    // Force a render to capture the 800px state
    pipeline.flush();
    unsub800();
    expect(commands800.length).toBeGreaterThan(0);

    // Now resize to 400px — NO flush, NO feed. Just resize.
    let commands400: ReadonlyArray<RenderCommand> = [];
    const unsub400 = pipeline.onRender((cmds) => { commands400 = cmds; });
    pipeline.resize(400, 600);
    unsub400();

    // onRender must have fired synchronously during resize()
    expect(commands400.length).toBeGreaterThan(0);

    // The layout should differ — slide background width should match viewport
    const slideBg800 = commands800.find(c => c.kind === 'fill-rect' && c.width > 700);
    const slideBg400 = commands400.find(c => c.kind === 'fill-rect' && c.width < 500);
    expect(slideBg800).toBeDefined();
    expect(slideBg400).toBeDefined();
  });

  it('places every command at non-negative coordinates', () => {
    pipeline.feed(FULL_PRESET);
    const commands = captureCommands(pipeline);

    for (const cmd of commands) {
      switch (cmd.kind) {
        case 'fill-rect':
        case 'stroke-rect':
        case 'clip-rect':
        case 'draw-image':
          expect(cmd.x).toBeGreaterThanOrEqual(0);
          expect(cmd.y).toBeGreaterThanOrEqual(0);
          expect(cmd.width).toBeGreaterThan(0);
          expect(cmd.height).toBeGreaterThan(0);
          break;
        case 'fill-text':
          expect(cmd.x).toBeGreaterThanOrEqual(0);
          expect(cmd.y).toBeGreaterThanOrEqual(0);
          break;
        case 'draw-line':
          expect(cmd.x1).toBeGreaterThanOrEqual(0);
          expect(cmd.y1).toBeGreaterThanOrEqual(0);
          break;
        case 'restore-clip':
          // No coordinates — always valid.
          break;
      }
    }
  });
});
