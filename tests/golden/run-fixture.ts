/**
 * Fixture runner — the single source of truth for "feed markup into
 * the engine, get render commands out."
 *
 * This function is host-agnostic by design: it uses only the
 * `createPipeline` API exposed by `src/index.ts`. Any host that can
 * import that module (Node, jsdom, QuickJS via the IIFE bundle)
 * can run it and produce comparable output.
 *
 * The synchronous shape (`feed()` → `flush()` → captured array) is
 * critical: it eliminates scheduler timing from the contract. Two
 * hosts with the same engine code are guaranteed to produce the same
 * commands here, no matter how their event loops differ.
 *
 * @module tests/golden/run-fixture
 */

import { createPipeline } from '../../src/pipeline';
import type { RenderCommand } from '../../src/types/render';
import type { GoldenFixture } from './fixtures/index';
import { createNodeCanvasMeasurementContext } from '../../src/engine/measurement/node-canvas-context';

export interface FixtureResult {
  readonly commands: readonly RenderCommand[];
  /** Wall-clock milliseconds the pipeline took from feed→flush. */
  readonly elapsedMs: number;
}

/**
 * Run a golden fixture through the engine and capture its final
 * render-command output. Resize is applied BEFORE feed so the first
 * (and only) layout pass sees the correct viewport.
 */
export function runFixture(fixture: GoldenFixture): FixtureResult {
  const pipeline = createPipeline({
    measurementContext: createNodeCanvasMeasurementContext(),
  });

  // Resize first so the constraint solver uses the fixture viewport
  // from the beginning. (Resize-after-feed also works, but this path
  // is simpler to reason about.)
  pipeline.resize(fixture.width, fixture.height);

  let captured: readonly RenderCommand[] = [];
  const unsubscribe = pipeline.onRender((commands) => {
    // Defensive copy — the pipeline's array reference may be reused.
    captured = commands.slice();
  });

  const start = performance.now();
  pipeline.feed(fixture.markup);
  pipeline.flush();
  const elapsedMs = performance.now() - start;

  unsubscribe();
  pipeline.destroy();

  return { commands: captured, elapsedMs };
}
