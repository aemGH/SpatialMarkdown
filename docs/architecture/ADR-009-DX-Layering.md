# ADR-009 — DX Layering: `mount()` and `createApp()`

**Status:** Proposed
**Date:** 2026-04-28
**Author:** @software-architect
**Layer:** A (Brain) + cross-cutting DX
**Supersedes:** —

---

## Context

Today the only public API is `createPipeline()` + `createCanvasRenderer()`. Each demo
re-implements the same boilerplate:

```
mergeConfig → createPipeline → createCanvasRenderer
  → ResizeObserver → onRender → renderer.render → computeContentHeight
  → resize canvas → pipeline.resize → flush on stream end → destroy chain
```

That boilerplate is roughly 60 lines per demo and four classes of bugs:

1. Forgotten `flush()` at end-of-stream → tokenizer tail never emitted.
2. ResizeObserver fired before `pipeline.resize()` → one-frame layout flash.
3. Manual `computeContentHeight()` doing an O(n) scan over `RenderCommand[]`
   on every frame, on top of the geometry pass that already knew the answer.
4. `destroy()` ordering — renderer destroyed before pipeline still pumping.

We want two new layers without touching the hot path of Layer 2 (`createPipeline`)
which holds the **0.15 ms / frame** budget.

---

## Decision Summary

| Level | Function                  | Owns                           | New code? |
| ----- | ------------------------- | ------------------------------ | --------- |
| 0     | `mount(target, options)`  | DOM canvas + observer + app    | Yes       |
| 1     | `createApp({canvas,...})` | pipeline + renderer + glue     | Yes       |
| 2     | `createPipeline()` / `createCanvasRenderer()` | unchanged behavior, **+1 additive output** | Minor    |

Dependency direction is strictly **0 → 1 → 2**. Level 2 has zero awareness of
the higher layers. Level 1 has zero DOM dependency (canvas is injected).

---

## Q1 — Auto-flush semantics

### Problem
`flush()` exists for two distinct reasons that the proposal conflates:

- **Tokenizer tail flush** — emit any text the tokenizer is holding because it
  was waiting for a tag-start or newline. Required when input is *complete*.
- **Synchronous frame flush** — bypass rAF for tests/SSR.

A blanket `queueMicrotask` after every `feed()` would fire mid-SSE-loop, run
the tokenizer-tail path on a partial tag (e.g., `<Headi`), and then have to
re-tokenize when the rest arrives the next microtask. That defeats the whole
point of the streaming tokenizer.

### Recommendation — **B: tie auto-flush to stream-end, not idle**

1. **Inside `feed()`** — do nothing extra. The pipeline's own rAF scheduler
   already coalesces N feeds per frame. Adding microtask debouncing on top is
   redundant and risks the partial-tag bug above.

2. **Inside `feedStream()` / `feedAsyncIterable()`** — when the stream's
   `done` signal arrives (or the AsyncIterable's `return`), Level 2 already
   calls `flushTokenizerTail()` (`pipeline.ts:541-544`). Level 1 must not
   add a second flush; it should observe a new `onStreamEnd` event instead.

3. **`createApp()` exposes `flush()` explicitly** — it remains a manual
   tool for tests/SSR and for callers that use bare `feed()` (no stream).
   We add one new ergonomic surface: `await app.feedComplete(text)` which
   is sugar for `feed(text); flush();`.

4. **`mount()` enables `autoFlushOnStreamEnd: true` by default** — since
   `mount()` is the high-DX entrypoint, it should "just work" for the
   stream-completion case. The flag exists so SSR/tests can disable it.

**Why not microtask debounce?** The 60 fps rAF cadence already gives us
~16 ms batching. A microtask is ~0 ms — it would fire between every two
chunks of an SSE parser, every loop iteration, and every promise tick of
an `AsyncIterable`. Either it does nothing useful (the rAF still wins)
or it fires mid-token and corrupts the tokenizer.

---

## Q2 — Content height auto-calculation

### Problem
Demos do:

```ts
function computeContentHeight(commands: RenderCommand[]): number {
  let max = 0;
  for (const cmd of commands) max = Math.max(max, cmd.y + (cmd.height ?? 0));
  return max;
}
```

That's O(n) over the *render commands*, which is 5–10× the size of the
layout box tree. The geometry pass already knows `yOffset` after the last
root in `calculator.ts:71-86`.

### Recommendation — **A: emit `contentHeight` from the geometry pass**

This is a Level 2 change, but it is **purely additive** and costs ~0 ns
because we already compute `yOffset` while iterating. Change the
return type:

```ts
// Before
calculate(...): LayoutBox[]

// After
calculate(...): LayoutLayout
interface LayoutLayout {
  readonly boxes: LayoutBox[];
  readonly contentWidth: Pixels;   // max box.x + box.width across roots
  readonly contentHeight: Pixels;  // final yOffset
}
```

Pipeline then surfaces it on the render callback signature:

```ts
// Additive — old single-arg callbacks still work via overload
onRender(callback: (commands: ReadonlyArray<RenderCommand>, layout: LayoutInfo) => void)
interface LayoutInfo {
  readonly contentWidth: Pixels;
  readonly contentHeight: Pixels;
  readonly viewport: { width: Pixels; height: Pixels };
}
```

Level 1 (`createApp`) consumes `layout.contentHeight` and resizes the
canvas when `height: 'fit-content'` is set. Level 0 (`mount`) wires
that to the canvas DOM element.

**Risk:** Changing the calculator's return type ripples to `pipeline.ts`
and `ssr/index.ts`. Mitigation: keep the current `boxes` array as the
first field so destructuring patterns can migrate incrementally. The
SSR path (`render()`) drops the rest.

**Performance:** zero cost. We're emitting a number we already had.

---

## Q3 — ResizeObserver placement

### Problem
Three observable surfaces, each with different semantics:

|   | Watching            | Reports             | Issue with `fit-content` height |
| - | ------------------- | ------------------- | --- |
| a | canvas parent       | parent contentBox   | parent height tracks content → feedback loop if content height drives parent |
| b | the canvas itself   | canvas box (logical)| changes when *we* set width/height → infinite loop |
| c | the target div      | target's contentBox | same as (a) when target is the parent |

### Recommendation — **a, with width-only observation**

The observer must report the **available width** the layout should fit
into. Height is *output*, never input, when `height: 'fit-content'`.
We therefore decouple the two axes:

1. Observe `target` (== canvas's parent in `mount()`).
2. **Read only `contentBoxSize[0].inlineSize`** (i.e., width). Ignore
   `blockSize`. This breaks the feedback loop by construction.
3. When `height: 'fixed'` is configured, *also* read block size and
   pipe it to `pipeline.resize(width, height)`.
4. When `height: 'fit-content'`, we drive height from
   `layout.contentHeight` (Q2), not from the observer.

```ts
// Pseudocode for createApp's resize handler
const ro = new ResizeObserver(entries => {
  const w = entries[0].contentBoxSize[0].inlineSize;
  if (heightMode === 'fixed') {
    const h = entries[0].contentBoxSize[0].blockSize;
    applyResize(w, h);
  } else {
    applyResize(w, lastContentHeight);
  }
});
ro.observe(target, { box: 'content-box' });
```

And the `onRender` handler:

```ts
pipeline.onRender((cmds, layout) => {
  if (heightMode === 'fit-content' && layout.contentHeight !== lastContentHeight) {
    lastContentHeight = layout.contentHeight;
    canvas.style.height = `${layout.contentHeight}px`;
    renderer.resize(lastWidth, layout.contentHeight);
    pipeline.resize(lastWidth, layout.contentHeight);
    // Note: pipeline.resize triggers a synchronous re-layout (pipeline.ts:658-662),
    // which would re-enter onRender. Guard with a re-entry flag.
  }
  renderer.render(cmds);
});
```

**Re-entry guard is mandatory.** `pipeline.resize()` calls
`executeLayoutPass()` synchronously when the AST is non-empty. Without
a flag, a content-height-driven resize would recurse into the same
`onRender`. The guard allows one re-entry (the corrected layout) and
rejects deeper.

**Why not observe the canvas?** ResizeObserver on an element whose size
*we* mutate is a known anti-pattern. Some browsers throttle the loop,
others log "ResizeObserver loop completed with undelivered notifications".
Observing the parent and writing to the child is the canonical pattern.

---

## Q4 — `feedStream` accepting `AsyncIterable<string>`

### Problem
Today: `feedStream(stream: ReadableStream<string | StreamToken>)`.
Proposal: also accept `AsyncIterable<string>` (what `for await` consumes).

### Recommendation — **A: convert at the Level 2 boundary, via overload**

```ts
// Level 2 (pipeline.ts)
readonly feedStream: {
  (stream: ReadableStream<string | StreamToken>, options?: FeedStreamOptions): void;
  (iterable: AsyncIterable<string | StreamToken>, options?: FeedStreamOptions): void;
};
```

Implementation routes both shapes through the existing reader-based pump:

```ts
function feedStream(input, options) {
  const stream = isReadableStream(input)
    ? input
    : ReadableStream.from(input);  // native since Node 20 / Chrome 120 / Safari 17.4
  // ...existing pump logic unchanged
}
```

`ReadableStream.from()` is now baseline (we can ship a 3-line polyfill for
older runtimes — the Node 18 LTS path). This is the cheapest possible
adapter: zero per-chunk overhead.

**Why not Level 1 only?** Two reasons:

1. The pump logic (backpressure, `cancelActiveStream`, watermark hooks) lives
   in Level 2. Duplicating it in Level 1 would diverge.
2. Users who never call `mount()` or `createApp()` still benefit from the
   cleaner API.

**Why not native overloads inside the pump?** Two code paths means two test
matrices and two backpressure stories. AsyncIterable doesn't have a
backpressure protocol — `ReadableStream.from()` gives us
`reader.cancel()` and pull-based reads for free.

---

## Q5 — Stream adapter utilities (`fromSSE`, `fromOpenAI`)

### Problem
Two SSE-shaped things in the codebase will create confusion:

1. The existing **bridge SSE adapter**
   (`src/bridge/streaming/sse-adapter.ts`) — returns
   `ReadableStream<StreamToken>` from the *spatial protocol*
   (`UpstreamMessage` envelopes). This is for talking to a server that
   already knows about Spatial Markdown.
2. The proposed **`fromSSE` / `fromOpenAI`** — returns
   `AsyncIterable<string>` from *generic* OpenAI/Anthropic SSE shapes
   (`data: {choices:[{delta:{content:"..."}}]}`). This is for talking
   to off-the-shelf LLM providers.

These solve different problems and must stay separate.

### Recommendation — **A: separate subpath export `@spatial-markdown/engine/streams`**

```
package.json
{
  "exports": {
    ".":          "./dist/index.js",
    "./streams":  "./dist/streams/index.js",
    "./renderer": "./dist/renderer/index.js",
    "./ssr":      "./dist/ssr/index.js"
  }
}
```

Why subpath, not top-level named export:

- **Tree-shaking is unreliable across barrel files** when the consumer
  uses `import * as` or has `sideEffects: true` somewhere transitively.
  A subpath export gives Vite/Rollup a hard split point.
- **Provider SDKs evolve** (OpenAI changed its delta envelope twice).
  Bumping `engine/streams` independently of `engine` core is safer.
- **Bundle hygiene** — confirms Layer-A code stays under its budget;
  adapter code lives in its own chunk.

Why not separate npm package:

- Versioning churn — every core change forces a coordinated release.
- Discovery cost — users want one install line.

The existing bridge adapters (`sse-adapter.ts`, `ws-adapter.ts`) are
**not exported** today and should remain internal. They serve the
spatial protocol, not the generic LLM use case.

```
src/streams/                       ← new folder
  index.ts                         ← re-exports below
  from-sse.ts                      ← generic SSE event-stream parser
  from-openai.ts                   ← OpenAI delta extractor (uses from-sse)
  from-anthropic.ts                ← Anthropic delta extractor
  from-async-iterable.ts           ← passthrough helper / type guard
```

Each module is self-contained (no imports from `pipeline.ts` or `engine/*`).
Their output type is `AsyncIterable<string>`, consumed by the Q4 overload.

---

## Q6 — `mount()` and the auto-created canvas

### Recommendations

**Container query support — yes, but via CSS, not JS.**
The created canvas has `style="display:block; width:100%;"` and lets the
parent's CSS (including container queries) determine the inline size.
Width is read by the ResizeObserver. No extra JS plumbing.

**Multiple `mount()` on the same target — error, with an explicit override.**
Silent replace hides bugs (double-mount in React StrictMode). We attach a
`__spatialMounted` Symbol to the target element on mount and:

```ts
mount(target, { ... })            // throws if __spatialMounted is set
mount(target, { replace: true })  // calls existing instance.destroy() first
```

React StrictMode users pass `replace: true`, or wrap in `useEffect` with a
cleanup. The error message names the symbol and points to docs.

**Cleanup on `destroy()` — three things must happen, in order:**

1. Disconnect the ResizeObserver (otherwise it fires during teardown).
2. `app.destroy()` (which destroys pipeline then renderer in that order —
   pipeline first so no in-flight `onRender` hits a destroyed renderer).
3. Remove the canvas element via `target.removeChild(canvas)` only if we
   created it. If the user passed their own `canvas` to `createApp()`,
   we don't own it and we don't remove it.
4. Delete the `__spatialMounted` Symbol from the target.

**`willReadFrequently: false`** (the default).
We never call `getImageData`. Setting it `true` forces a software-rendered
canvas in Chrome (no GPU compositing) and would tank the 60 fps target.
If a future feature (selection rendering, hit-testing via pixels) needs
it, we expose `canvasOptions: CanvasRenderingContext2DSettings` on
`createApp`/`mount` for opt-in.

---

## TypeScript Interfaces — exact signatures

### Level 0: `mount`

`src/app/mount.ts`

```ts
import type { CreateAppOptions, SpatialApp } from './create-app';

export interface MountOptions extends Omit<CreateAppOptions, 'canvas'> {
  /** Replace an existing mounted instance on this target. Default: false (throws). */
  readonly replace?: boolean;
  /** Optional Canvas 2D context settings. Default: { willReadFrequently: false }. */
  readonly canvasOptions?: CanvasRenderingContext2DSettings;
  /** ClassName(s) to apply to the auto-created canvas element. */
  readonly canvasClassName?: string;
}

export interface MountedApp extends SpatialApp {
  /** The auto-created canvas element. Read-only — do not mutate width/height directly. */
  readonly canvas: HTMLCanvasElement;
  /** The target the app was mounted on. */
  readonly target: HTMLElement;
}

export function mount(target: HTMLElement, options?: MountOptions): MountedApp;
```

### Level 1: `createApp`

`src/app/create-app.ts`

```ts
import type { EngineConfig } from '../config';
import type { SpatialPipeline, FeedStreamOptions } from '../pipeline';
import type { CanvasRenderer } from '../renderer/canvas/canvas-renderer';
import type { RenderCommand } from '../types/render';
import type { Pixels } from '../types/primitives';
import type { StreamToken } from '../types/stream';
import type { LayoutInfo } from '../types/layout';

export type HeightMode = 'fixed' | 'fit-content';

export interface CreateAppOptions extends Partial<EngineConfig> {
  /** Required: the canvas to render into. `mount()` creates one for you. */
  readonly canvas: HTMLCanvasElement;
  /** What element to observe for available-width changes. Default: canvas.parentElement. */
  readonly resizeTarget?: HTMLElement;
  /**
   * 'fixed' — canvas height is driven by the resize observer / explicit `resize()`.
   * 'fit-content' — canvas height tracks `layout.contentHeight` from the geometry pass.
   * Default: 'fit-content'.
   */
  readonly height?: HeightMode;
  /** When `height: 'fixed'` and no observer fires, this is the initial height. Default: 600. */
  readonly initialHeight?: number;
  /** When `height: 'fixed'`, cap the canvas height. Useful for scrollable viewports. */
  readonly maxHeight?: number;
  /** Auto-flush the tokenizer tail when a `feedStream` source signals completion. Default: true. */
  readonly autoFlushOnStreamEnd?: boolean;
  /** Disable the built-in ResizeObserver (caller will drive `resize()` manually). Default: false. */
  readonly manualResize?: boolean;
}

export interface SpatialApp {
  /** Forwarded from pipeline.feed(). */
  readonly feed: (text: string) => void;

  /** Accepts ReadableStream OR AsyncIterable (Q4). */
  readonly feedStream: (
    source: ReadableStream<string | StreamToken> | AsyncIterable<string | StreamToken>,
    options?: FeedStreamOptions,
  ) => void;

  /** Sugar for `feed(text); flush();` — useful for tests and one-shot rendering. */
  readonly feedComplete: (text: string) => void;

  /** Manually resize. No-op if `manualResize: false` and the observer is driving it. */
  readonly resize: (width: number, height?: number) => void;

  /** Synchronous tokenizer-tail flush + scheduler flush. */
  readonly flush: () => void;

  /** Subscribe to render commands AND layout info. Returns unsubscribe. */
  readonly onRender: (
    cb: (commands: ReadonlyArray<RenderCommand>, layout: LayoutInfo) => void,
  ) => () => void;

  /** Subscribe to pipeline errors. Returns unsubscribe. */
  readonly onError: (cb: (error: unknown) => void) => () => void;

  /** Fires once when a `feedStream` source completes (after final flush). */
  readonly onStreamEnd: (cb: () => void) => () => void;

  /** The current measured content height (driven by the geometry pass). */
  readonly getContentHeight: () => Pixels;

  /** Escape hatch — for advanced users who need raw pipeline/renderer access. */
  readonly pipeline: SpatialPipeline;
  readonly renderer: CanvasRenderer;

  /** Tear down pipeline → renderer → observer, in that order. */
  readonly destroy: () => void;
}

export function createApp(options: CreateAppOptions): SpatialApp;
```

### New shared type

`src/types/layout.ts` (extend existing module)

```ts
export interface LayoutInfo {
  readonly contentWidth: Pixels;
  readonly contentHeight: Pixels;
  readonly viewport: { readonly width: Pixels; readonly height: Pixels };
}
```

### Streams subpath

`src/streams/index.ts`

```ts
export { fromSSE } from './from-sse';
export type { SSEOptions } from './from-sse';

export { fromOpenAI } from './from-openai';
export { fromAnthropic } from './from-anthropic';

export { isAsyncIterable } from './from-async-iterable';
```

```ts
// from-sse.ts
export interface SSEOptions {
  /** Header to identify the chunk's text payload, default: 'data'. */
  readonly dataField?: string;
  /** Stop the stream when this value is received, default: '[DONE]'. */
  readonly doneSentinel?: string;
  /** AbortSignal to cancel the underlying fetch. */
  readonly signal?: AbortSignal;
}
export function fromSSE(response: Response, options?: SSEOptions): AsyncIterable<string>;

// from-openai.ts
export function fromOpenAI(response: Response, options?: { signal?: AbortSignal }): AsyncIterable<string>;
```

---

## File Layout

```
src/
├── app/                           ← NEW (Level 0/1, DOM-aware)
│   ├── index.ts                   ← re-exports mount + createApp
│   ├── mount.ts                   ← Level 0
│   ├── create-app.ts              ← Level 1
│   ├── resize-observer.ts         ← width-only observer wrapper
│   └── height-controller.ts       ← fit-content vs fixed logic + re-entry guard
│
├── streams/                       ← NEW (subpath export)
│   ├── index.ts
│   ├── from-sse.ts
│   ├── from-openai.ts
│   ├── from-anthropic.ts
│   └── from-async-iterable.ts
│
├── pipeline.ts                    ← MODIFIED: feedStream overload, onRender layout arg
├── scheduler.ts                   ← unchanged
├── config.ts                      ← unchanged
├── index.ts                       ← MODIFIED: export createApp, mount, LayoutInfo
│
├── engine/
│   └── geometry/
│       ├── calculator.ts          ← MODIFIED: return { boxes, contentWidth, contentHeight }
│       └── index.ts               ← MODIFIED: export new return type
│
├── renderer/                      ← unchanged
├── parser/                        ← unchanged
├── bridge/                        ← unchanged (internal SSE adapter stays internal)
├── types/
│   ├── layout.ts                  ← MODIFIED: add LayoutInfo
│   └── ...                        ← unchanged
└── ssr/index.ts                   ← MODIFIED: destructure { boxes } from new return
```

`package.json` exports map adds `./streams`, `./renderer`, `./ssr` subpaths.

---

## Required Changes to Level 2

Minimal, all additive on the public surface:

1. **`engine/geometry/calculator.ts`**
   `calculate()` returns `{ boxes, contentWidth, contentHeight }` instead
   of bare `LayoutBox[]`. Internal: track `maxX` alongside the existing
   `yOffset` accumulator. ~5 lines changed.

2. **`pipeline.ts` `executeLayoutPass`**
   Destructure new shape, pass `LayoutInfo` as 2nd arg to subscribers.
   Old callers' single-arg callbacks still work (extra args are ignored
   in JS — TS-side we widen with overload).

3. **`pipeline.ts` `feedStream`**
   Add overload accepting `AsyncIterable`. One-line normalization with
   `ReadableStream.from(input)`. Add a polyfill module
   `src/parser/polyfill-readable-from.ts` for Node 18.

4. **`ssr/index.ts`**
   `const { boxes } = calc.calculate(...)` — drop the rest. Trivial.

No changes to `parser/`, `renderer/`, `bridge/`, or `engine/measurement|constraints|geometry/box-model|tree-differ`.

---

## Performance Risks vs. the 0.15 ms / frame Budget

| Risk                                                               | Severity | Mitigation                                                                 |
| ------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------- |
| `LayoutInfo` allocation per frame (one tiny object)                | P3       | Negligible — a 3-field object is ~40 bytes; the existing array allocation dominates. Could pool if benchmarks regress. |
| `ResizeObserver` callback re-entering `pipeline.resize` synchronously | P1       | Re-entry guard in `height-controller.ts`. Verified by Layer E benchmark — observer fires post-layout in the same task; the synchronous resize is single-shot. |
| `ReadableStream.from(asyncIterable)` per-chunk overhead             | P2       | Native impl in modern engines is roughly equivalent to a hand-rolled reader pump; benchmark before/after. Add a micro-benchmark to Layer E suite (`feedStream-async-iterable.bench.ts`). |
| `AbortSignal` plumbing in `fromSSE` adds an event listener          | P3       | Listener is on the controller, not the hot path. |
| `mount()` running ResizeObserver on a hidden target                 | P2       | Initial entry has `inlineSize: 0` → first paint would be empty. Guard: defer the first `pipeline.resize` until `inlineSize > 0`, or accept the user's `initialWidth` option. |
| Microtask flooding from a misuse of `feedComplete` in a loop        | P3       | Document. `feedComplete` is for one-shot use; loops should use `feed`. |
| Subpath export accidentally bundled into core via TS import path    | P1       | Lint rule: forbid imports from `../streams` outside of test files; `streams/*` may not import from `pipeline.ts` or anything below `engine/`. Enforce via `eslint-plugin-boundaries` or a custom rule. |

**Net expected impact:** within 5% of current frame time, dominated by the
existing geometry+measurement passes. The new code paths only run inside
the browser DOM-driven layer (Levels 0/1), not inside `executeLayoutPass`.

---

## Consequences

**Easier**
- Demos drop from ~60 to ~5 lines. No more `computeContentHeight` in userland.
- SSR path `render()` becomes a thin wrapper over `feedComplete()` if we
  refactor it that way (out of scope for this ADR).
- Provider integration: `app.feedStream(fromOpenAI(response))` ships a
  working LLM-to-canvas demo in 3 lines.

**Harder**
- Two more concepts in the public surface. We mitigate by recommending
  `mount()` as the default in README and reserving `createPipeline` for
  the "I'm building a new renderer" advanced section.
- Geometry calculator's return type change is a breaking change for any
  external code that called it directly. We don't export it today, so
  internal-only — but Layer-E benchmarks need updating.

**Reversible?**
- Yes. `mount()` and `createApp()` are pure additions. The geometry
  calculator change is the only non-additive piece, and reverting it
  (returning `boxes` only) just means Level 1 falls back to scanning
  commands the old way. Cost: the 0.15 ms hot path gets ~0.01 ms heavier.

---

## Open Questions (deferred)

- Should `mount()` ship with a built-in scroll container when
  `maxHeight` is set, or leave that to userland CSS?
- Should `onStreamEnd` fire *before* or *after* the final `onRender`?
  (Recommendation: after — consumers expect "everything is painted".)
- Do we need a `pause()`/`resume()` API on `SpatialApp` for backpressure
  exposure to userland, or is `FeedStreamOptions.onPause` enough?

These are not blockers for this ADR; revisit after first user feedback.
