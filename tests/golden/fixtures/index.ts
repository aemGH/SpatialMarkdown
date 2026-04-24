/**
 * Golden fixture set — the contract test corpus.
 *
 * Each fixture is a deterministic input to `createPipeline()` whose
 * render-command output is captured once (Phase 1, in Node) and then
 * compared against later (Phase 2, in QuickJS). The point of this
 * corpus is to pin engine behavior so that host-runtime swaps are
 * provably lossless — byte-identical render commands in, byte-identical
 * commands out.
 *
 * Design rules for adding fixtures:
 *   1. **Deterministic** — no Date.now(), no Math.random(), no DOM.
 *   2. **Self-contained** — no external resources (fonts, images) that
 *      differ between hosts. Use only primitives the engine ships.
 *   3. **Covers one class of node** — tiny, focused fixtures beat big
 *      "kitchen sink" ones for regression triangulation.
 *   4. **Fixed viewport** — dimensions are part of the fixture so the
 *      solver produces stable constraints.
 *
 * @module tests/golden/fixtures
 */
export interface GoldenFixture {
  /** File-safe identifier used for the snapshot filename. */
  readonly id: string;
  /** Human-readable description for test output and debugging. */
  readonly description: string;
  /** Raw Spatial Markdown input. */
  readonly markup: string;
  /** Viewport width in pixels. */
  readonly width: number;
  /** Viewport height in pixels. */
  readonly height: number;
}

export const GOLDEN_FIXTURES: readonly GoldenFixture[] = [
  {
    id: '001-empty-slide',
    description: 'Slide with no children — tests empty-container layout.',
    markup: '<Slide></Slide>',
    width: 800,
    height: 600,
  },
  {
    id: '002-single-heading',
    description: 'Single heading — simplest text measurement path.',
    markup: '<Slide><Heading level={1}>Hello</Heading></Slide>',
    width: 800,
    height: 600,
  },
  {
    id: '003-paragraph-of-text',
    description: 'Bare text inside a slide — auto-paragraph transform.',
    markup: '<Slide>The quick brown fox jumps over the lazy dog.</Slide>',
    width: 800,
    height: 600,
  },
  {
    id: '004-spacer-divider',
    description: 'Spacer and Divider primitives — non-text layout.',
    markup: '<Slide><Spacer height={16} /><Divider /></Slide>',
    width: 800,
    height: 600,
  },
  {
    id: '005-auto-grid',
    description: 'AutoGrid with metric cards — multi-child layout.',
    markup: [
      '<Slide>',
      '<AutoGrid minChildWidth={200} gap={16}>',
      '<MetricCard label="Layout" value="<1ms" sentiment="positive" />',
      '<MetricCard label="Reflows" value="Zero" sentiment="positive" />',
      '</AutoGrid>',
      '</Slide>',
    ].join(''),
    width: 800,
    height: 600,
  },
  {
    id: '006-callout',
    description: 'Callout component — structured text block.',
    markup: [
      '<Slide>',
      '<Callout type="tip" title="Streaming-Safe">',
      'Partial tags split across chunks are buffered automatically.',
      '</Callout>',
      '</Slide>',
    ].join(''),
    width: 800,
    height: 600,
  },
  {
    id: '007-narrow-viewport',
    description: 'Same content at 400px wide — tests constraint re-solve.',
    markup: '<Slide><Heading level={1}>Responsive Headline</Heading></Slide>',
    width: 400,
    height: 800,
  },
  {
    id: '008-full-kitchen-sink',
    description: 'Every major tag in one document — integration contract.',
    markup: [
      '<Slide>',
      '<Heading level={1}>Spatial Markdown Engine</Heading>',
      'A high-performance layout engine for LLM streaming output.',
      '<Spacer height={16} />',
      '<AutoGrid minChildWidth={200} gap={16}>',
      '<MetricCard label="Layout" value="<1ms" sentiment="positive" />',
      '<MetricCard label="Reflows" value="Zero" sentiment="positive" />',
      '</AutoGrid>',
      '<Divider />',
      '<Callout type="tip" title="Streaming-Safe">',
      'Partial tags split across chunks are buffered automatically.',
      '</Callout>',
      '</Slide>',
    ].join(''),
    width: 800,
    height: 600,
  },
] as const;
