# @spatial-markdown/engine

A DOM-less, multi-pass layout engine designed for asynchronous streaming text. It calculates pure geometry via a custom AST and renders strictly to Canvas and Android Jetpack Compose, bypassing browser reflows entirely.

## Quick Start

### 2 Lines — Zero Config

```ts
import { mount } from '@spatial-markdown/engine';

const sm = mount('#output', { theme: 'dark' });
sm.feed('<Slide><Heading level={1}>Hello World</Heading></Slide>');
```

### Stream from an LLM — 3 Lines

```ts
import { mount } from '@spatial-markdown/engine';
import { fromOpenAI } from '@spatial-markdown/engine/streams';

const sm = mount('#output', { theme: 'dark' });
const response = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages }) });
await sm.feedStream(fromOpenAI(response.body!));
```

### Static Render — 1 Line

```ts
import { render } from '@spatial-markdown/engine';

const commands = render('<Slide><Heading level={1}>Hello</Heading></Slide>', { width: 800 });
```

---

## Three API Levels

The engine provides progressive disclosure — start simple, go deeper only when you need to:

| Level | API | Use Case | Lines |
|-------|-----|----------|-------|
| **0** | `mount(target, options)` | Prototypes, demos, blogs | 2–3 |
| **1** | `createApp({ canvas })` | Production apps | ~8 |
| **2** | `createPipeline()` + `createCanvasRenderer()` | Custom renderers, SSR, Android | ~40 |

### Level 0 — `mount()` (Zero Config)

Auto-creates a canvas, auto-resizes to container, auto-flushes, handles everything.

```ts
import { mount } from '@spatial-markdown/engine';

const sm = mount('#chat', { theme: 'auto' });

// Feed static content
sm.feedComplete('<Slide>...</Slide>');

// Or stream from any source
await sm.feedStream(asyncIterable);

// Cleanup
sm.destroy();
```

### Level 1 — `createApp()` (Production)

You own the canvas. The engine owns the coordination (resize, content-height, flush).

```ts
import { createApp } from '@spatial-markdown/engine';

const app = createApp({
  canvas: document.querySelector('#canvas')!,
  theme: 'dark',
  height: 'fit-content',  // canvas auto-grows to content
  resize: 'observe',      // ResizeObserver on parent
});

app.on('render', ({ layout, renderTimeMs }) => {
  console.log(`Content: ${layout.contentHeight}px, rendered in ${renderTimeMs.toFixed(1)}ms`);
});

// Stream from LLM
const res = await fetch('/api/llm', { method: 'POST', body: prompt });
await app.feedStream(res.body!);

// Access Level 2 primitives when needed
app.pipeline.getDocument();  // inspect AST
app.renderer.setDPR(3);     // force DPR

app.destroy();
```

### Level 2 — `createPipeline()` (Advanced)

Full manual control. Build custom renderers, SSR pipelines, or Android bridges.

```ts
import { createPipeline } from '@spatial-markdown/engine';
import { createCanvasRenderer } from '@spatial-markdown/engine/canvas';

const pipeline = createPipeline({ theme: darkTheme });
const renderer = createCanvasRenderer(canvas);

pipeline.onRender((commands, info) => {
  renderer.resize(viewportWidth, Math.ceil(info.contentHeight + 32));
  renderer.render(commands);
});

pipeline.resize(800, 600);
pipeline.feed(markup);
pipeline.flush();
pipeline.destroy();
```

---

## Stream Adapters

Connect to any LLM provider with one import:

```ts
import { fromOpenAI, fromAnthropic, fromGemini, fromSSE } from '@spatial-markdown/engine/streams';

// OpenAI / Azure / Compatible providers
await sm.feedStream(fromOpenAI(response.body!));

// Anthropic (Claude)
await sm.feedStream(fromAnthropic(response.body!));

// Google Gemini
await sm.feedStream(fromGemini(response.body!));

// Custom SSE — extract any field
await sm.feedStream(fromSSE(response.body!, (data) => data?.text as string));
```

---

## Motivation

Standard HTML/DOM architectures suffer from constant layout thrashing (reflows) when text streams in dynamically. This engine was built from first principles to solve this by moving layout calculations entirely out of the DOM. By treating text rendering as a geometry problem, it guarantees strictly zero layout shift during continuous text streams.

## Core Architecture

The pipeline is structured as a one-way data flow, decoupling text parsing, measurement, constraint solving, and rendering.

```
Stream Buffer → FSM Tokenizer → AST Builder → Constraint Solver → Geometry Calculator → RenderCommand[] → Canvas / Kotlin Runtime
```

### 1. Chunk-Safe FSM Tokenizer
Instead of relying on fragile Regular Expressions, the parser uses a 5-state Push-Down Automaton (State Machine). Because text streams arrive in unpredictable byte chunks, the tokenizer buffers partial states (e.g., `<CodeB`) and resumes seamlessly without re-evaluating the entire string, avoiding O(n²) parsing performance degradation.

### 2. Multi-Pass Constraint Solver
Layout is calculated mathematically before a single pixel is painted. 
- **Pass 1 (Bottom-Up):** Child nodes determine their intrinsic sizes via `@chenglou/pretext`.
- **Pass 2 (Top-Down):** Parent containers (Grid, FlexRow, Stack) push absolute coordinate constraints `(x, y, width, height)` down to their children.

### 3. LRU Measurement Cache
Text measurement is the most expensive operation in layout. The engine implements a hand-rolled LRU cache utilizing a doubly-linked list mapped to a `Map` for guaranteed `O(1)` reads/writes. It uses sentinel nodes (`head` and `tail`) to eliminate branch checks during memory surgery, and zero-allocation composite keys (separated by null bytes `\x00`) to prevent cache collisions.

### 4. Cross-Platform Runtimes (Canvas & Android QuickJS)
The engine does not output HTML. It outputs a flat array of z-ordered `RenderCommand` objects (e.g., `fill-rect`, `fill-text`, `clip-rect`). 
- **Web:** A High-DPI aware Canvas 2D backend blindly paints these commands, managing sub-pixel offsets for crisp 1px borders.
- **Android:** An embedded QuickJS engine runs the TypeScript layout pipeline natively, bridging the resulting `RenderCommand` array to Android's Jetpack Compose for native 60fps mobile rendering.

## Type Safety

The codebase enforces a strict "Zero `any`" policy. 
- **Discriminated Unions:** The entire component tree and command structure are strictly typed unions.
- **Branded Types:** Numeric values are cast to branded generics (`Pixels`, `NodeId`, `FontDescriptor`) to prevent unit confusion at compile time.
- **Immutability:** Extensive use of `ReadonlyArray` and `ReadonlyMap` ensures layout constraints cannot be mutated mid-flight.

## Performance Benchmarks

Targeting a 16ms frame budget (60fps), the engine heavily relies on dirty-flag propagation (`textDirty`, `constraintDirty`) to calculate only the exact subset of the UI that changed.

| Stage | Budget | Measured (mean, 10-slide doc) |
|---|---|---|
| Tokenize + AST build | < 1 ms | ~0.05 ms |
| Constraint solve | < 0.5 ms | ~0.12 ms |
| Pretext measurement (cache hit) | < 0.5 ms | ~0.02 ms |
| Geometry | < 1 ms | ~0.14 ms |
| **Full pipeline** | **< 16 ms** | **~0.15 ms** |

*Run `npm run test:bench` to reproduce locally.*

## Development

```bash
npm run dev           # library dev mode (Vite)
npm run build         # ESM + CJS + .d.ts to dist/
npm test              # Unit + integration tests
npm run test:bench    # Performance benchmarks
npm run typecheck     # strict tsc --noEmit
```

## License

MIT. Built on [`@chenglou/pretext`](https://github.com/chenglou/pretext) for DOM-less text measurement.
