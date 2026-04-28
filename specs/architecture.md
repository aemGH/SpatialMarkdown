# Spatial Markdown Engine — Architecture Specification

> **Status:** Accepted  
> **Version:** 1.1.0  
> **Date:** 2026-04-28  
> **Core Dependency:** `@chenglou/pretext` v0.0.5

> **Canonical type reference:** The source of truth for all types is `src/types/`.
> The AST node taxonomy is defined in `src/types/ast.ts`; tag-level DSL semantics
> are specified in `specs/spatial-spec.md`.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [API Layering](#2-api-layering)
3. [Pipeline Design](#3-pipeline-design)
4. [Type Architecture](#4-type-architecture)
5. [Incremental Update Strategy](#5-incremental-update-strategy)
6. [Module Map](#6-module-map)
7. [Pretext Integration Layer](#7-pretext-integration-layer)
8. [Cross-Platform Bridge Architecture](#8-cross-platform-bridge-architecture)
9. [Stream Adapters](#9-stream-adapters)
10. [Performance Budget](#10-performance-budget)
11. [Architectural Decision Records](#11-architectural-decision-records)

---

## 1. Design Philosophy

### Core Invariants

1. **Pretext is the single source of truth for text geometry.** No DOM reads. No `getBoundingClientRect`. No `offsetHeight`. Every pixel of text height comes from `prepare()` → `layout()`.
2. **Separation of measurement and layout.** `prepare()` is expensive (1–5ms). `layout()` is free (~0.0002ms). Prepare once, layout many times.
3. **Streaming is the default mode.** Every data structure assumes partial data. Every algorithm handles incomplete ASTs. "Batch mode" is streaming with one chunk.
4. **The type system prevents bugs.** Discriminated unions for AST nodes. Branded types for coordinates (`Pixels`, `NodeId`, `FontDescriptor`). Zero `any`.
5. **Dependency flows one direction: down.** `types/` ← `parser/` ← `engine/` ← `renderer/`. `bridge/` sits beside the pipeline, not inside it.
6. **Progressive disclosure.** Three API levels (mount → createApp → createPipeline) where each wraps the one below. No parallel implementations.

### What This Engine Is NOT

- Not a full CSS engine. Constrained subset: block flow, flex, grid, and text inline flow.
- Not a browser. No events, focus, accessibility trees, or DOM APIs.
- Not an AI wrapper or consumer product. This is pure layout infrastructure built for developers.

---

## 2. API Layering

The engine exposes three API levels. Each level is a thin wrapper over the one below — no re-implementations, no parallel code paths.

```text
┌──────────────────────────────────────────────────────────────┐
│  Level 0: mount(target, options)                             │  ← 1–3 lines
│           Auto-canvas, auto-resize, auto-flush               │
├──────────────────────────────────────────────────────────────┤
│  Level 1: createApp({ canvas, ...opts })                     │  ← ~8 lines
│           Owns pipeline + renderer coordination              │
├──────────────────────────────────────────────────────────────┤
│  Level 2: createPipeline() + createCanvasRenderer()          │  ← Full control
│           Manual wiring, custom renderers, SSR               │
└──────────────────────────────────────────────────────────────┘
```

### Level 0 — `mount()` (`src/app/mount.ts`)
- Auto-creates `<canvas>` inside target element
- ResizeObserver on container (width-only)
- Canvas height auto-grows to fit content via `LayoutInfo.contentHeight`
- Stream-end auto-flush
- Returns: `{ feed, feedComplete, feedStream, clear, flush, destroy, app }`
- Escape hatch: `instance.app` → Level 1

### Level 1 — `createApp()` (`src/app/create-app.ts`)
- Developer owns the canvas element
- Coordinates pipeline ↔ renderer resize, content-height, and flush
- Event model: `on('render')`, `on('error')`, `on('resize')`
- Configurable: theme, resize mode, height mode, flush mode
- Escape hatches: `app.pipeline`, `app.renderer` → Level 2

### Level 2 — `createPipeline()` (`src/pipeline.ts`)
- Full manual control over every pipeline stage
- `onRender(commands, info)` callback receives `LayoutInfo` metadata
- Required for: custom renderers, SSR, Android/QuickJS bridge, testing

### Design Rules
- Level 0 calls Level 1 internally; Level 1 calls Level 2 internally.
- If we ever fork the implementation between layers, that's an architecture bug.
- Performance cost of the higher layers: zero (pure wrappers over the same hot path).

---

## 3. Pipeline Design

### Overview

```text
┌─────────┐    ┌────────┐    ┌───────────┐    ┌─────────────┐    ┌──────────────┐
│ Stream  │───▶│ Ring   │───▶│ Tokenizer │───▶│ AST Builder │───▶│ Constraint   │
│ Source  │    │ Buffer │    │ (FSM)     │    │             │    │ Solver       │
└─────────┘    └────────┘    └───────────┘    └─────────────┘    └──────┬───────┘
                                                                        │
┌─────────┐    ┌─────────────┐    ┌───────────────┐    ┌───────────────┐│
│ Target  │◀───│ Render Cmd  │◀───│ Geometry      │◀───│ Pretext       │◀┘
│ Runtime │    │ Builder     │    │ Calculator    │    │ Measurement   │
└─────────┘    └─────────────┘    └───────────────┘    └───────────────┘
```

### Stage-by-Stage

| # | Stage | Input | Output | Budget | Owner |
|---|-------|-------|--------|--------|-------|
| 1 | Stream Buffer | Raw UTF-8 chunks | `StreamToken` | < 0.1ms | `src/bridge/buffer/` |
| 2 | Tokenizer | `StreamToken` | `SpatialToken[]` | < 0.5ms | `src/parser/tokenizer/` |
| 3 | AST Builder | `SpatialToken[]` | `SpatialDocument` (partial or complete) | < 0.5ms | `src/parser/ast/` |
| 4 | Transforms | `SpatialDocument` | `SpatialDocument` (enriched) | < 0.5ms | `src/parser/transforms/` |
| 5 | Constraint Solver | AST + dirty flags | `Map<NodeId, LayoutConstraint>` | < 0.5ms | `src/engine/constraints/` |
| 6 | Measurement | Constrained text nodes | `Map<NodeId, MeasurementResult>` | < 2ms | `src/engine/measurement/` |
| 7 | Geometry Calculator | Measurements + constraints | `LayoutBox[]` + `LayoutInfo` | < 1ms | `src/engine/geometry/` |
| 8 | Render Cmd Builder | `LayoutBox[]` | `RenderCommand[]` | < 0.5ms | `src/renderer/command-builder.ts` |
| 9 | Target Runtime | `RenderCommand[]` | Pixels (Canvas / Compose) | < 8ms | `src/renderer/canvas/` & `android/` |

**Key details:**

- **Stream Buffer**: Accumulates raw text and emits complete tokens at safe boundaries. Signals backpressure when buffer exceeds high watermark (75%).
- **Tokenizer**: 5-state FSM (`text`, `tag-opening`, `tag-attributes`, `tag-closing`, `self-closing`). Never emits partial tags — buffers until syntactically complete.
- **AST Builder**: Maintains open-element stack. Emits `ASTDelta` events.
- **Constraint Solver**: Top-down pass. Supports incremental re-solve via dirty flags.
- **Geometry**: Bottom-up size pass + top-down position pass. Emits `LayoutInfo` (contentHeight, contentWidth, node count) alongside `LayoutBox[]`. Layout modes: block, flex-row, flex-col, grid, absolute.
- **Render Cmds**: Flat, z-ordered `RenderCommand[]`. 7 command types: `fill-rect`, `stroke-rect`, `fill-text`, `draw-image`, `clip-rect`, `restore-clip`, `draw-line`.

---

## 4. Type Architecture

All types are defined in `src/types/` (no runtime code except branded type constructors and theme defaults).

### Key Design Decisions

- **Branded primitives** (`Pixels`, `NodeId`, `FontDescriptor`) prevent unit confusion at compile time.
- **`SpatialNode` discriminated union** with `kind` field as discriminant enables exhaustive `switch` checking. 16 node kinds.
- **`SpatialToken` discriminated union** with 5 token types.
- **`RenderCommand` discriminated union** with 7 command types, all renderer-agnostic.
- **`DirtyFlags`** on each node: `textDirty`, `constraintDirty`, `geometryDirty`, `renderDirty`.
- **`LayoutInfo`**: metadata emitted from the geometry pass (contentHeight, contentWidth, rootCount, nodeCount) that higher-level APIs use for auto-sizing.

### Dependency Graph

```text
types/ ← No dependencies. Pure type declarations.
  │
  ├──► parser/ (tokenizer/, ast/, transforms/)
  ├──► engine/ (constraints/, geometry/, measurement/)
  ├──► bridge/ (buffer/, streaming/, quickjs-adapter/)
  │
  ├──► renderer/ (command-builder, canvas/)
  │
  ├──► streams/ (from-sse, from-openai, from-anthropic, from-gemini)
  │
  └──► app/ (mount, create-app) ← wraps pipeline + renderer
          │
          ▼
      pipeline.ts ← Top-level orchestrator (wires all layers)
      scheduler.ts ← rAF frame scheduler
      config.ts ← Engine config + defaults
```

**Import rules:** `types/` ← everything. `parser/` cannot import `engine/`, `renderer/`, or `bridge/`. `engine/` cannot import `parser/` or `renderer/`. `app/` imports `pipeline` + `renderer`. `streams/` is standalone (no engine imports). `pipeline.ts` imports parser + engine + renderer.

---

## 5. Incremental Update Strategy

### The Problem

Tokens arrive continuously during streaming. Naively remeasuring the entire tree per token would be catastrophic. The engine uses dirty flag propagation (ADR-007) to do minimal work per frame.

### Three-Phase Dirty Propagation

1. **Text Dirty** — content changed → `prepare()` required (1–5ms, cached)
2. **Constraint Dirty** — available width changed → `layout()` required (~0.0002ms)
3. **Geometry Dirty** — child sizes changed → re-position required

### Frame Batching

The pipeline runs on `requestAnimationFrame`. Between frames, tokens accumulate and dirty flags collect. 

**Key insight:** During streaming, typically only 1 text node is actively receiving tokens (the "cursor" node). This means ~1 `prepare()` call per frame. Worst case (viewport resize): every text node needs `layout()` but not `prepare()`.

---

## 6. Module Map

```text
src/
├── types/                     # Shared type declarations (minimal runtime)
│   ├── primitives.ts          # Branded types: Pixels, NodeId, FontDescriptor, Rect, EdgeInsets
│   ├── tokens.ts              # SpatialToken union, SpatialTagName, TokenizerState
│   ├── ast.ts                 # SpatialNode union, all props interfaces, SpatialDocument
│   ├── layout.ts              # LayoutConstraint, MeasurementResult, LayoutBox, LayoutInfo
│   └── render.ts              # RenderCommand union (7 types)
│
├── parser/
│   ├── tokenizer/
│   │   ├── state-machine.ts   # 5-state FSM for tag/text classification
│   │   └── buffer.ts          # Partial-input buffer for split tokens
│   ├── ast/
│   │   ├── builder.ts         # Incremental AST builder
│   │   └── node-map.ts        # O(1) NodeId → SpatialNode lookup
│   └── transforms/            # Ordered transform pipeline
│
├── engine/
│   ├── constraints/
│   │   └── solver.ts          # Top-down constraint solver
│   ├── geometry/
│   │   ├── calculator.ts      # Bottom-up size + top-down position
│   │   └── layout-algorithms.ts # block-flow, flex, grid, absolute
│   └── measurement/
│       ├── cache.ts           # MeasurementCache (LRU, pretext wrapper)
│       └── measurer.ts        # Batch measurement orchestrator
│
├── renderer/
│   ├── command-builder.ts     # LayoutBox[] → RenderCommand[]
│   └── canvas/                # Canvas 2D backend (HiDPI-aware)
│
├── bridge/
│   ├── buffer/                # Ring buffer & backpressure controller
│   ├── streaming/             # WebSocket / SSE network adapters
│   └── quickjs-adapter/       # Android JS Interface adapter
│
├── app/                       # High-level convenience APIs
│   ├── index.ts               # Barrel export
│   ├── mount.ts               # Level 0: mount(target) zero-config
│   └── create-app.ts          # Level 1: createApp({canvas}) production
│
├── streams/                   # LLM stream adapters (tree-shakeable)
│   ├── index.ts               # Barrel export
│   ├── from-sse.ts            # Generic SSE → AsyncIterable<string>
│   ├── from-openai.ts         # OpenAI delta extraction
│   ├── from-anthropic.ts      # Anthropic delta extraction
│   └── from-gemini.ts         # Gemini delta extraction
│
└── pipeline.ts                # Top-level orchestrator: createPipeline()
```

---

## 7. Pretext Integration Layer

### MeasurementCache

LRU cache wrapping `@chenglou/pretext` APIs. Default max: 2048 entries.

- **Cache key**: `text + \x00 + font + \x00 + whiteSpace + \x00 + wordBreak`
- **APIs wrapped**: `prepare()`, `prepareWithSegments()`, `prepareRichInline()`
- **Eviction**: LRU. Employs sentinel nodes (`head`/`tail`) for allocation-free updates.

### Font Loading

Fonts must be loaded before `prepare()` produces correct results. 
1. Pipeline starts → `FontLoader.preload(theme.allFonts)`
2. While fonts load → render with system fallback metrics
3. Font loaded → `invalidateAll()` on cache
4. Next frame → full re-prepare with correct font. **This is the one acceptable layout shift in the system.**

---

## 8. Cross-Platform Bridge Architecture

The engine decouples layout math from the final drawing API via the `RenderCommand[]` Intermediate Representation (IR). This enables the TypeScript engine to operate headless and bridge to various native runtimes.

### Android Kotlin & QuickJS Integration
A core feature of the engine is native mobile rendering without WebViews.
- **QuickJS Host:** The TS engine compiles to a standalone JS bundle (`build:quickjs`) injected into a lightweight embedded QuickJS C-runtime running on Android.
- **Bridging:** As streaming text enters Android over the network, it is passed into QuickJS. The TS engine calculates the layout and returns a serialized JSON array of `RenderCommand` objects.
- **Jetpack Compose:** A native Kotlin renderer reads the commands and draws them directly to an Android Canvas, achieving 60fps native performance with zero garbage collection pauses.

### Web / Node Integration
- **WebSocket / SSE:** Used for streaming byte streams directly into the `ring-buffer` with built-in backpressure hysteresis.
- **Canvas 2D:** The primary web renderer, handling High-DPI scaling and sub-pixel offsets automatically.

---

## 9. Stream Adapters

The `src/streams/` module provides tree-shakeable adapters that convert LLM provider SSE streams into `AsyncIterable<string>`.

### Design Principles
- **Zero core dependency:** Stream adapters do NOT import any engine internals — they're pure I/O transformers.
- **Tree-shakeable:** Only imported adapters are bundled. The `@spatial-markdown/engine/streams` subpath export ensures they don't bloat the core.
- **AsyncIterable output:** All adapters yield `AsyncIterable<string>`, which `feedStream()` accepts natively.
- **Provider-specific:** Each adapter understands a single SSE JSON envelope format.

### Available Adapters
| Adapter | Provider | SSE Event Format |
|---------|----------|------------------|
| `fromSSE(body, extractor)` | Any | Generic — user provides JSON extractor |
| `fromOpenAI(body)` | OpenAI / Azure / Compatible | `choices[0].delta.content` |
| `fromAnthropic(body)` | Anthropic Claude | `content_block_delta.delta.text` |
| `fromGemini(body)` | Google Gemini | `candidates[0].content.parts[].text` |

---

## 10. Performance Budget

### Frame Budget (16ms target at 60fps)

| Stage | Budget | Typical |
|-------|--------|---------|
| Buffer read | 0.1ms | 0.01ms |
| Tokenizer | 0.5ms | 0.1ms |
| AST Builder + Transforms | 0.5ms | 0.05ms |
| Constraint Solver | 0.5ms | 0.01ms |
| Pretext Measurement | 2.0ms | 0.0002ms (cache hit) |
| Geometry Calculator | 1.0ms | 0.1ms |
| Render Command Build | 0.5ms | 0.1ms |
| Target Render (Canvas) | 8.0ms | 2.0ms |
| **Total** | **< 16ms** | |

### Layer Overhead
- **Level 0/1 wrapper cost**: < 0.01ms per frame (function call + ResizeObserver callback)
- **Stream adapter cost**: Zero (runs outside the frame loop, yields tokens to `feed()`)

---

## 11. Architectural Decision Records

### ADR-001: Pretext as Sole Text Measurement Provider
**Status:** Accepted. Uses `@chenglou/pretext` exclusively. No DOM reads. Tradeoff: fonts must be loaded before `prepare()`, and `PreparedText` handles are opaque.

### ADR-002: Discriminated Unions Over Class Hierarchies
**Status:** Accepted. `kind` field as discriminant. Exhaustive `switch`, serializable, no `instanceof`. Tradeoff: verbose — every variant is a separate interface.

### ADR-003: Frame Batching via requestAnimationFrame
**Status:** Accepted. Max 60 pipeline runs/sec regardless of token rate. Only 1 `prepare()` per dirty text node per frame. Tradeoff: up to 16ms latency between token arrival and pixel.

### ADR-004: LRU Cache for PreparedText (2048 entries)
**Status:** Accepted. Bounded memory (~5–10MB). Naturally evicts stale entries. Uses sentinel nodes for O(1) mutations. Configurable via `EngineConfig.measurementCacheSize`.

### ADR-005: Renderer-Agnostic RenderCommand[] IR
**Status:** Accepted. Thin renderer implementations (~200 LOC each). Easy to add new renderers (like Kotlin/Compose). Tradeoff: flat list loses tree structure — clipping needs explicit push/pop.

### ADR-006: WebSocket Primary + SSE Fallback
**Status:** Accepted. WebSocket for bidirectional backpressure. SSE for proxy/CDN compatibility. JSON messages.

### ADR-007: Dirty Flag Propagation Over Full-Tree Diffing
**Status:** Accepted. O(dirty set size) per frame. Four flags: `textDirty`, `constraintDirty`, `geometryDirty`, `renderDirty`. Propagated upward on mutation.

### ADR-008: Android Kotlin Adapter via QuickJS
**Status:** Accepted. See `docs/architecture/ADR-008-Kotlin-Adapter.md`.

### ADR-009: Three-Layer DX API (mount → createApp → createPipeline)
**Status:** Accepted. Each higher layer wraps the one below — no parallel implementations. Zero performance overhead (pure function composition). Stream adapters are a separate subpath export for tree-shaking. Auto-flush uses stream-end signal (not microtask debounce) to avoid firing mid-tag during SSE parsing. ResizeObserver watches width-only; height is always computed from `LayoutInfo.contentHeight`.
