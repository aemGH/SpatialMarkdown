# @spatial-markdown/engine

A high-performance layout engine for LLM streaming output. Renders structured,
pixel-perfect documents in real time at 60fps with zero layout shift.

```
LLM stream → Spatial Markdown DSL → Pretext measurement → Canvas / SVG / React
```

Built on [`@chenglou/pretext`](https://github.com/chenglou/pretext) for
DOM-less text measurement. Strict TypeScript, zero `any`.

All text geometry is calculated off-DOM via pretext before rendering. The browser
never computes layout, so incremental LLM output never shifts a pixel already on
screen.

---

## Quickstart

```bash
npm install @spatial-markdown/engine @chenglou/pretext
```

```ts
import { createPipeline } from '@spatial-markdown/engine';
import { createCanvasRenderer } from '@spatial-markdown/engine/canvas';

const canvas = document.querySelector('canvas')!;
const renderer = createCanvasRenderer(canvas);
const pipeline = createPipeline();

pipeline.onRender((commands) => renderer.render(commands));

pipeline.feed(`
  <Slide>
    <Heading level={1}>Hello, Spatial Markdown!</Heading>
    The engine measures text via pretext — zero reflow.
    <AutoGrid minChildWidth={180} gap={16}>
      <MetricCard label="Reflows" value="0" sentiment="positive" />
      <MetricCard label="FPS" value="60" sentiment="positive" />
    </AutoGrid>
  </Slide>
`);
pipeline.flush();
```

## Live demos

```bash
# Preset gallery (pick from 5 canned documents; see streaming simulation)
npm run demo

# Gemini-powered live chat → canvas (bring your own API key)
npm run gemini
```

The Gemini demo pipes `streamGenerateContent` token-by-token into the
engine and renders to canvas in real time. Great for feeling what a
"website-as-a-response" actually looks like.

## Architecture

| Layer | Source | Role |
|---|---|---|
| **Engine** | `src/engine/` | Pretext measurement, constraint solver, geometry calculator. Pure TS, no DOM. |
| **Parser** | `src/parser/` | Streaming tokenizer (FSM) → incremental AST builder → transform passes. |
| **Renderer** | `src/renderer/` | Canvas 2D, SVG, React — all consume the same `RenderCommand[]`. |
| **Bridge** | `src/bridge/` | WebSocket + SSE adapters, ring buffer, backpressure, Python SDK types. |

Full details in [`specs/architecture.md`](./specs/architecture.md) and
[`specs/spatial-spec.md`](./specs/spatial-spec.md).

## Renderers

- **Canvas 2D** (`@spatial-markdown/engine/canvas`) — highest perf, best for
  streaming artifacts. Ships with DPR-aware HiDPI rendering.
- **SVG** (`@spatial-markdown/engine/svg`) — DOM mode for live apps,
  string mode for SSR / export / clipboard.
- **React** (`@spatial-markdown/engine/react`) — `<SpatialView>` component
  + `useSpatialPipeline` hook. Emits SVG-in-React for composability and
  text selection.

```tsx
import { SpatialView, useSpatialPipeline } from '@spatial-markdown/engine/react';

function Demo() {
  const { commands, pipeline } = useSpatialPipeline();
  useEffect(() => {
    pipeline?.feed('<Slide><Heading level={1}>Hi</Heading></Slide>');
    pipeline?.flush();
  }, [pipeline]);
  return <SpatialView commands={commands} width={800} height={600} />;
}
```

## Tag vocabulary (short list — full spec in `specs/spatial-spec.md`)

**Layout containers:** `<Slide>`, `<Stack>`, `<Columns>`, `<AutoGrid>`, `<Canvas>`
**Content components:** `<MetricCard>`, `<DataTable>`, `<Chart>`, `<CodeBlock>`, `<Quote>`, `<Callout>`
**Primitives:** `<Heading>`, `<Text>`, `<Divider>`, `<Spacer>`, `<Image>`

Closed taxonomy — no custom tags, no extensibility by design. The narrow
vocabulary is what lets LLMs produce structurally-valid output and lets
the engine guarantee zero layout shift.

## Performance

| Stage | Budget | Measured (mean, 10-slide doc) |
|---|---|---|
| Tokenize + AST build | < 1 ms | ~0.05 ms |
| Constraint solve | < 0.5 ms | ~0.12 ms |
| Pretext measurement (cache hit) | < 0.5 ms | ~0.02 ms |
| Geometry | < 1 ms | ~0.14 ms |
| **Full pipeline** | **< 16 ms** | **~0.15 ms** |

Run `npm run test:bench` to reproduce on your machine.

## Status & scope

**v0.1 — ready for internal tools and demos.** 173 tests pass. Typecheck
clean in strict mode. Canvas and SVG renderers ship; React renderer ships.
Build produces ESM + CJS + `.d.ts` for all subpaths.

**Not yet production-ready for public clients:**
- Accessibility tree (canvas rendering has no a11y by default — on roadmap
  as a parallel hidden DOM renderer)
- SSR story exists for SVG, not yet documented end-to-end
- Visual regression testing harness not yet wired into CI
- `@chenglou/pretext` is pre-1.0 — one transitive dependency risk

**Not in scope:**
- A general Markdown/MDX alternative. This is a canvas-first streaming engine.
- A full CSS engine. We implement block, flex, grid, absolute, inline — no floats,
  no transforms, no cascading.
- A general-purpose UI framework. No events, no focus management, no routing.

## Scripts

```
npm run dev           # library dev mode (Vite)
npm run demo          # preset gallery demo
npm run gemini        # Gemini live chat demo
npm run build         # ESM + CJS + .d.ts to dist/
npm test              # 173 unit + integration tests
npm run test:bench    # performance benchmarks
npm run test:coverage # v8 coverage (80% thresholds)
npm run typecheck     # strict tsc --noEmit
```

## License

MIT (see `LICENSE`).

## Credits

Core text measurement: [`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext).
