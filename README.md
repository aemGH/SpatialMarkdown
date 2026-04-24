# @spatial-markdown/engine

A high-performance, zero-reflow layout engine for structured documents. Renders
pixel-perfect Canvas or Android Jetpack Compose output at 60fps from a simple tag vocabulary.

```
Tag vocabulary -> AST -> Pretext measurement -> Geometry -> Canvas / Android
```

Built on [`@chenglou/pretext`](https://github.com/chenglou/pretext) for DOM-less
text measurement. All geometry is calculated off-DOM before rendering, so the
browser never thrashes layout — and incremental or streamed content never shifts
a pixel already on screen.

Strict TypeScript. Zero `any`. ESM + CJS + `.d.ts` for every subpath.

---

## Quickstart

```bash
npm install @spatial-markdown/engine @chenglou/pretext
```

The simplest path is the synchronous `render()` one-liner — give it markup and
a viewport, get back a `RenderCommand[]` that any renderer can draw.

```ts
import { render } from '@spatial-markdown/engine';
import { createCanvasRenderer } from '@spatial-markdown/engine/canvas';

const commands = render(`
  <Slide>
    <Heading level={1}>Hello, Spatial Markdown!</Heading>
    <AutoGrid minChildWidth={180} gap={16}>
      <MetricCard label="Reflows" value="0" sentiment="positive" />
      <MetricCard label="FPS" value="60" sentiment="positive" />
    </AutoGrid>
  </Slide>
`, { width: 800, height: 600 });

const renderer = createCanvasRenderer(document.querySelector('canvas')!);
renderer.render(commands);
```

That's the whole hello-world. No pipelines, no async, no subscribers — just
`markup + viewport → commands`. Use this for dashboards, reports, static
documents, or any case where you have the full input up front.

## Use cases

The engine is general-purpose. Anywhere you need fast, predictable, structured
layout without touching CSS, it fits:

- **Dashboards** — metric grids, data tables, charts with guaranteed alignment.
- **Slide decks & presentations** — `<Slide>` is a first-class content frame.
- **Document rendering** — long-form prose with headings, quotes, callouts, code.
- **Data visualization** — `<Chart>` + `<DataTable>` on a pretext-measured grid.
- **LLM streaming UIs** — incremental parsing means partial model output renders
  at 60fps without reflow. See the [streaming API](#streaming-api) below.

## Streaming API

For token-by-token input (LLMs, server-sent events, WebSocket feeds), use
`createPipeline()`. It owns an incremental parser, a ring buffer, and a
subscriber model.

```ts
import { createPipeline } from '@spatial-markdown/engine';
import { createCanvasRenderer } from '@spatial-markdown/engine/canvas';

const renderer = createCanvasRenderer(document.querySelector('canvas')!);
const pipeline = createPipeline();
pipeline.resize(800, 600);

pipeline.onRender((commands) => renderer.render(commands));
pipeline.onError((err) => console.error('[spatial]', err));

// feed partial chunks as they arrive — the engine re-lays-out incrementally
for await (const chunk of llmStream) {
  pipeline.feed(chunk);
}
pipeline.flush();
```

The pipeline only redraws what changed, respects backpressure, and is
safe to feed mid-tag — the FSM tokenizer suspends until the chunk closes.

Resize is synchronous — call `pipeline.resize()` during a drag or
animation and `onRender` fires immediately with the re-laid-out commands.
No `flush()`, no re-feed, no special handling. It just works.

## Architecture

| Layer | Source | Role |
|---|---|---|
| **Engine** | `src/engine/` | Pretext measurement, constraint solver, geometry calculator. Pure TS, no DOM. |
| **Parser** | `src/parser/` | Streaming tokenizer (FSM) → incremental AST builder → transform passes. |
| **Renderer** | `src/renderer/` | Canvas 2D, Android Jetpack Compose — all consume the same `RenderCommand[]`. |
| **Bridge** | `src/bridge/` | WebSocket + SSE adapters, ring buffer, backpressure, Python SDK types. |

Full details in [`specs/architecture.md`](./specs/architecture.md) and
[`specs/spatial-spec.md`](./specs/spatial-spec.md).

## Renderers

- **Canvas 2D** (`@spatial-markdown/engine/canvas`) — highest perf, best for
  streaming artifacts. Ships with DPR-aware HiDPI rendering.
- **Android Kotlin/Compose** (`android/spatial-engine/`) — Jetpack Compose implementation
  using a high-performance embedded QuickJS Engine. Feeds `RenderCommand` output into a native Android canvas at 60fps with zero layout shift.

## Tag vocabulary

**16 built-in components that guarantee layout correctness.** No CSS surprises,
no cascade bugs, no runtime errors from unknown tags. The closed taxonomy is
the feature — it's what lets the engine prove layout correctness ahead of time
and lets upstream producers (humans or LLMs) stay inside a structurally-valid
grammar.

**Layout containers**
- `<Slide>` — **the top-level content frame.** Despite the name, it's used for
  any bounded document: a dashboard screen, a report page, a card surface, a
  slide. Establishes padding, theme context, and a root stacking block.
- `<Stack>` — vertical flow with gap.
- `<Columns>` — equal or weighted horizontal columns.
- `<AutoGrid>` — responsive grid with `minChildWidth`.
- `<Canvas>` — absolute-positioning escape hatch.

**Content components**
- `<MetricCard>`, `<DataTable>`, `<Chart>`, `<CodeBlock>`, `<Quote>`, `<Callout>`

**Primitives**
- `<Heading>`, `<Text>`, `<Divider>`, `<Spacer>`, `<Image>`

Full grammar with props and layout rules in
[`specs/spatial-spec.md`](./specs/spatial-spec.md).

## Themes

Four built-in presets cover most needs, and `createTheme()` produces custom
themes with full type safety.

```ts
import {
  render,
  defaultTheme,
  darkTheme,
  highContrastTheme,
  warmTheme,
  createTheme,
} from '@spatial-markdown/engine';

// use a preset
const commands = render(markup, { width: 800, height: 600, theme: darkTheme });

// or build your own by extending a preset
const brandTheme = createTheme({
  colors: { accent: '#ff3366', surface: '#0b0b10' },
}, defaultTheme);
```

Themes control color, typography, spacing scale, and component-level tokens
(card radius, divider weight, etc.). They never affect layout geometry — only
paint — so you can swap themes on a running pipeline without re-measuring.

## Error handling

Every pipeline exposes `onError` for parser, measurement, and layout failures.
The engine never throws into your render path; errors are surfaced via the
subscriber and the pipeline continues with the last known-good AST.

```ts
pipeline.onError((err) => {
  // err is the raw error thrown during the layout pass.
  // The pipeline recovers and continues with the last known-good AST.
  console.error('[spatial]', err);
});
```

Without an `onError` subscriber, errors are logged to `console.error` and
silently recovered from. With one, you get full control over error reporting.

## Node.js / SSR

Pretext runs in Node, so the engine does too.

- **Canvas measurement** can use
  [`node-canvas`](https://github.com/Automattic/node-canvas) (`canvas` package)
  for platform-accurate font metrics on the server. The engine's test suite
  already uses this approach.

```ts
// server.ts
import { render } from '@spatial-markdown/engine';

const commands = render(markup, { width: 1200, height: 630 });
// Pass `commands` to your Android or Canvas client
```

## Performance

| Stage | Budget | Measured (mean, 10-slide doc) |
|---|---|---|
| Tokenize + AST build | < 1 ms | ~0.05 ms |
| Constraint solve | < 0.5 ms | ~0.12 ms |
| Pretext measurement (cache hit) | < 0.5 ms | ~0.02 ms |
| Geometry | < 1 ms | ~0.14 ms |
| **Full pipeline** | **< 16 ms** | **~0.15 ms** |

Run `npm run test:bench` to reproduce on your machine.

## Live demos

```bash
# Showcase — stress-test theater (streaming, resize, zero-reflow proof)
npm run showcase

# Gemini-powered live chat + canvas (bring your own API key)
npm run gemini
```

The **Showcase** demo is the best place to start — it runs four stress
scenarios that demonstrate the engine's superpowers: firehose streaming,
live responsive resize, incremental zero-reflow proof, and a combined
stress test. No API key required.

The Gemini demo pipes `streamGenerateContent` token-by-token into the
engine and renders to canvas in real time. Great for feeling what a
"website-as-a-response" actually looks like.

## Status & scope

**v0.1 — ready for internal tools, dashboards, and demos.** 173 tests pass.
Typecheck clean in strict mode. Canvas and Android native renderers ship. Build
produces ESM + CJS + `.d.ts` for all subpaths. New in this release: synchronous
`render()` entry point, four theme presets + `createTheme()`, `onError`
subscriber.

**Not yet production-ready for public clients:**
- Accessibility tree (canvas rendering has no a11y by default — on roadmap
  as a parallel hidden DOM renderer)
- Visual regression testing harness not yet wired into CI
- `@chenglou/pretext` is pre-1.0 — one transitive dependency risk

**Not in scope:**
- A general Markdown/MDX alternative. This is a geometry-first structured engine.
- A full CSS engine. We implement block, flex, grid, absolute, inline — no floats,
  no transforms, no cascading.
- A general-purpose UI framework. No events, no focus management, no routing.

## Scripts

```
npm run dev           # library dev mode (Vite)
npm run showcase      # stress-test showcase demo
npm run gemini        # Gemini live chat demo
npm run build         # ESM + CJS + .d.ts to dist/
npm test              # 173 unit + integration tests
npm run test:bench    # performance benchmarks
npm run test:coverage # v8 coverage (80% thresholds)
npm run typecheck     # strict tsc --noEmit
```

## Contributing

Issues, reproductions, and PRs are all welcome. Please read
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development workflow, the
performance budget that every PR must respect, and the process for proposing
new tags (spoiler: the bar is intentionally high — the closed vocabulary is a
feature, not an oversight).

## License

MIT (see `LICENSE`).

## Credits

Core text measurement: [`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext).
