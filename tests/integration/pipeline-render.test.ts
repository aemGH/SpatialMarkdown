/**
 * End-to-end integration test: feed a realistic Spatial Markdown
 * document -> verify the pipeline produces a non-empty RenderCommand
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
import { createNodeCanvasMeasurementContext } from '../../src/engine/measurement/node-canvas-context';

const FULL_PRESET = `
<Slide>
  <Heading level={1}>Integration Test</Heading>
  <Text>This is a full end-to-end test of the pipeline.</Text>
  <AutoGrid minChildWidth={200} gap={16}>
    <MetricCard label="Status" value="Passing" />
    <MetricCard label="Pipeline" value="Green" />
  </AutoGrid>
</Slide>
`;

function captureCommands(pipeline: SpatialPipeline): ReadonlyArray<RenderCommand> {
  let captured: ReadonlyArray<RenderCommand> = [];
  const unsubscribe = pipeline.onRender((cmds) => {
    captured = cmds;
  });
  pipeline.flush();
  unsubscribe();
  return captured;
}

// === Tests ===================================================================

describe('Pipeline end-to-end rendering', () => {
  let pipeline: SpatialPipeline;

  beforeEach(() => {
    pipeline = createPipeline({ measurementContext: createNodeCanvasMeasurementContext() });
    pipeline.resize(800, 600);
  });

  afterEach(() => {
    pipeline.destroy();
  });

  it('produces a non-empty RenderCommand list for a realistic document', () => {
    pipeline.feed(FULL_PRESET);
    const commands = captureCommands(pipeline);

    expect(commands).toBeDefined();
    expect(commands.length).toBeGreaterThan(0);
    
    // Smoke check some commands we expect to see
    const kinds = commands.map(c => c.kind);
    expect(kinds).toContain('fill-rect'); // Backgrounds
    expect(kinds).toContain('fill-text'); // Text nodes
  });
});