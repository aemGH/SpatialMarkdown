# Spatial Markdown Engine — Architecture Specification

> **Status:** Accepted  
> **Version:** 1.0.0  
> **Date:** 2026-04-14  
> **Core Dependency:** `@chenglou/pretext` v0.0.5

> **Canonical type reference:** The source of truth for all types is `src/types/`.
> The AST node taxonomy is defined in `src/types/ast.ts`; tag-level DSL semantics
> are specified in `specs/spatial-spec.md`.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Pipeline Design](#2-pipeline-design)
3. [Type Architecture](#3-type-architecture)
4. [Incremental Update Strategy](#4-incremental-update-strategy)
5. [Module Map](#5-module-map)
6. [Pretext Integration Layer](#6-pretext-integration-layer)
7. [Bridge Architecture](#7-bridge-architecture)
8. [Performance Budget](#8-performance-budget)
9. [Architectural Decision Records](#9-architectural-decision-records)

---

## 1. Design Philosophy

### Core Invariants

1. **Pretext is the single source of truth for text geometry.** No DOM reads. No `getBoundingClientRect`. No `offsetHeight`. Every pixel of text height comes from `prepare()` → `layout()`.
2. **Separation of measurement and layout.** `prepare()` is expensive (1–5ms). `layout()` is free (~0.0002ms). Prepare once, layout many times.
3. **Streaming is the default mode.** Every data structure assumes partial data. Every algorithm handles incomplete ASTs. "Batch mode" is streaming with one chunk.
4. **The type system prevents bugs.** Discriminated unions for AST nodes. Branded types for coordinates (`Pixels`, `NodeId`, `FontDescriptor`). Zero `any`.
5. **Dependency flows one direction: down.** `types/` ← `parser/` ← `engine/` ← `renderer/`. `bridge/` sits beside the pipeline, not inside it.

### What This Engine Is NOT

- Not a full CSS engine. Constrained subset: block flow, flex, grid, and text inline flow.
- Not a browser. No events, focus, accessibility trees, or DOM APIs.
- Not a Markdown renderer. Produces a render tree, not HTML.

---

## 2. Pipeline Design

### Overview

```
┌─────────┐    ┌────────┐    ┌───────────┐    ┌─────────────┐    ┌──────────────┐
│ LLM     │───▶│ Stream │───▶│ Tokenizer │───▶│ AST Builder │───▶│ Constraint   │
│ Stream  │    │ Buffer │    │           │    │             │    │ Solver       │
└─────────┘    └────────┘    └───────────┘    └─────────────┘    └──────┬───────┘
                                                                        │
┌─────────┐    ┌─────────────┐    ┌───────────────┐    ┌───────────────┐│
│ Renderer│◀───│ Render Cmd  │◀───│ Geometry      │◀───│ Pretext       │◀┘
│         │    │ Builder     │    │ Calculator    │    │ Measurement   │
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
| 7 | Geometry Calculator | Measurements + constraints | `LayoutBox[]` | < 1ms | `src/engine/geometry/` |
| 8 | Render Cmd Builder | `LayoutBox[]` | `RenderCommand[]` | < 0.5ms | `src/renderer/command-builder.ts` |
| 9 | Renderer | `RenderCommand[]` | Pixels (Canvas), Android Jetpack Compose | < 8ms | `src/renderer/canvas/` and `android/` |

**Key details:**

- **Stream Buffer**: Accumulates raw text and emits complete tokens at safe boundaries. Signals backpressure when buffer exceeds high watermark (75%).
- **Tokenizer**: 5-state FSM (`text`, `tag-opening`, `tag-attributes`, `tag-closing`, `self-closing`). Never emits partial tags — buffers until syntactically complete.
- **AST Builder**: Maintains open-element stack. Text tokens append to current open span. Tag-open pushes to stack, tag-close pops. Auto-closes unclosed tags. Emits `ASTDelta` events.
- **Transforms**: Ordered pipeline: `autoParagraph` → `headingLevels` → `fontResolver` → `listNumbering`.
- **Constraint Solver**: Top-down pass. Supports incremental re-solve via dirty flags (only re-solves dirty subtrees).
- **Measurement**: Cache-backed (`MeasurementCache`, LRU, default 2048 entries). Uses `prepare()` for text-dirty nodes, `layout()` for constraint-dirty nodes.
- **Geometry**: Bottom-up size pass + top-down position pass. Layout modes: block, flex-row, flex-col, grid, absolute.
- **Render Cmds**: Flat, z-ordered `RenderCommand[]`. 7 command types: `fill-rect`, `stroke-rect`, `fill-text`, `draw-image`, `clip-rect`, `restore-clip`, `draw-line`.

---

## 3. Type Architecture

All types are defined in `src/types/` (no runtime code except branded type constructors and theme defaults). See the source files directly for the complete definitions.

### Key Design Decisions

- **Branded primitives** (`Pixels`, `NodeId`, `FontDescriptor`) prevent unit confusion at compile time.
- **`SpatialNode` discriminated union** with `kind` field as discriminant enables exhaustive `switch` checking. 16 node kinds: 5 layout containers, 6 content components, 5 primitives.
- **`SpatialToken` discriminated union** with 5 token types: `tag-open`, `tag-close`, `text`, `newline`, `eof`.
- **`RenderCommand` discriminated union** with 7 command types, all renderer-agnostic.
- **`MeasurementResult`** — two variants: `height-only` and `line-detail`.
- **`DirtyFlags`** on each node: `textDirty`, `constraintDirty`, `geometryDirty`, `renderDirty`.

### Dependency Graph

```
types/ ← No dependencies. Pure type declarations.
  │
  ├──► parser/ (tokenizer/, ast/, transforms/)
  ├──► engine/ (constraints/, geometry/, measurement/)
  ├──► bridge/ (buffer/, streaming/, python-adapter/)
  │
  └──► renderer/ (command-builder, canvas/)
          │
          ▼
      pipeline.ts ← Top-level orchestrator (wires all layers)
      scheduler.ts ← rAF frame scheduler
      config.ts ← Engine config + defaults
```

**Import rules:** `types/` ← everything. `parser/` cannot import `engine/`, `renderer/`, or `bridge/`. `engine/` cannot import `parser/` or `renderer/`. `pipeline.ts` imports everything.

---

## 4. Incremental Update Strategy

### The Problem

LLM tokens arrive at 50–200 tokens/second. Naively remeasuring the entire tree per token would be catastrophic. The engine uses dirty flag propagation (ADR-007) to do minimal work per frame.

### Three-Phase Dirty Propagation

1. **Text Dirty** — content changed → `prepare()` required (1–5ms, cached)
2. **Constraint Dirty** — available width changed → `layout()` required (~0.0002ms)
3. **Geometry Dirty** — child sizes changed → re-position required

### Frame Batching

The pipeline runs on `requestAnimationFrame`. Between frames, tokens accumulate and dirty flags collect. At frame start:

1. Freeze dirty set
2. Run AST transforms
3. Solve constraints (incremental if possible)
4. Collect text measurement requests
5. Measure text (cache-backed)
6. Calculate geometry
7. Build render commands
8. Clear dirty flags
9. Notify subscribers

**Key insight:** During streaming, typically only 1 text node is actively receiving tokens (the "cursor" node). This means ~1 `prepare()` call per frame. Worst case (viewport resize): every text node needs `layout()` but not `prepare()` — for 100 nodes that's ~0.02ms.

### PreparedText Cache

- **Key**: `text + font + whiteSpace + wordBreak`
- **Strategy**: LRU eviction, 2048 entries (configurable via `EngineConfig.measurementCacheSize`)
- **States**: EMPTY → READY → STALE → READY. Old handle kept alive during re-prepare to prevent layout shift.
- **Invalidation**: Text change invalidates specific key. Font change invalidates by font. Viewport resize needs no invalidation (`layout()` only).

---

## 5. Module Map

```
src/
├── types/                     # Shared type declarations (minimal runtime)
│   ├── primitives.ts          # Branded types: Pixels, NodeId, FontDescriptor, Rect, EdgeInsets
│   ├── tokens.ts              # SpatialToken union, SpatialTagName, TokenizerState
│   ├── ast.ts                 # SpatialNode union, all props interfaces, SpatialDocument
│   ├── delta.ts               # ASTDelta events (node-added, node-closed, text-appended, node-removed)
│   ├── layout.ts              # LayoutConstraint, MeasurementResult, LayoutBox
│   ├── layout-constants.ts    # Font/spacing constants for MetricCard, Callout, etc.
│   ├── render.ts              # RenderCommand union (7 types)
│   ├── stream.ts              # StreamToken, bridge protocol messages
│   ├── theme.ts               # ThemeConfig, defaultTheme, darkTheme
│   └── index.ts               # Barrel re-export
│
├── parser/
│   ├── tokenizer/
│   │   ├── state-machine.ts   # 5-state FSM for tag/text classification
│   │   ├── patterns.ts        # Regex patterns for DSL syntax
│   │   ├── buffer.ts          # Partial-input buffer for split tokens
│   │   └── index.ts           # Public API: createTokenizer() → Tokenizer
│   ├── ast/
│   │   ├── builder.ts         # Incremental AST builder (open-stack, delta emission)
│   │   ├── id-generator.ts    # Monotonic NodeId allocator
│   │   ├── node-factory.ts    # Factory functions per node kind (applies defaults)
│   │   ├── node-map.ts        # O(1) NodeId → SpatialNode lookup
│   │   ├── validators.ts      # Structural validation (nesting rules)
│   │   └── index.ts
│   └── transforms/
│       ├── auto-paragraph.ts  # Wraps bare text in text nodes
│       ├── heading-levels.ts  # Normalizes heading levels
│       ├── font-resolver.ts   # Resolves FontDescriptors from theme
│       ├── list-numbering.ts  # Ordered list numbering
│       └── index.ts           # Ordered transform pipeline
│
├── engine/
│   ├── constraints/
│   │   ├── solver.ts          # Top-down constraint solver (full + incremental)
│   │   ├── layout-modes.ts    # Constraint resolvers: block, flex, grid, columns, canvas
│   │   └── index.ts
│   ├── geometry/
│   │   ├── calculator.ts      # Bottom-up size + top-down position
│   │   ├── layout-algorithms.ts # Pure geometry: block-flow, flex, grid, absolute
│   │   ├── box-model.ts       # Padding/margin computation
│   │   ├── tree-differ.ts     # LayoutBox tree structural diff
│   │   └── index.ts
│   ├── measurement/
│   │   ├── cache.ts           # MeasurementCache (LRU, pretext wrapper)
│   │   ├── measurer.ts        # Batch measurement orchestrator
│   │   ├── text-collector.ts  # Extracts text measurement requests from AST
│   │   ├── font-loader.ts     # Font loading orchestration
│   │   └── index.ts
│   ├── readable-width.ts      # Prose-width calculation (composition rules)
│   └── tree-utils.ts          # AST traversal helpers
│
├── renderer/
│   ├── command-builder.ts     # LayoutBox[] → RenderCommand[]
│   ├── canvas/
│   │   ├── canvas-renderer.ts # Canvas 2D backend (HiDPI-aware)
│   │   └── index.ts
├── bridge/
│   ├── buffer/
│   │   ├── ring-buffer.ts     # Fixed-size ring buffer (FIFO)
│   │   ├── backpressure.ts    # Hysteresis controller (75%/25%)
│   │   └── index.ts
│   ├── streaming/
│   │   ├── sse-adapter.ts     # Server-Sent Events adapter
│   │   ├── ws-adapter.ts      # WebSocket adapter
│   │   ├── stream-protocol.ts # JSON message serialization
│   │   └── index.ts
│   ├── python-adapter/
│       ├── python-sdk-types.ts # TypeScript types mirroring Python SDK contract
│       └── index.ts
│   └── quickjs-adapter/     # Android JS Interface adapter for embedded QuickJS
│       └── index.ts
│
├── theme/
│   ├── extract-theme.ts       # Extract theme tokens from URL/HTML
│   ├── map-extracted-theme.ts # Map extracted tokens to ThemeConfig
│   └── index.ts
│
├── pipeline.ts                # Top-level orchestrator: createPipeline()
├── scheduler.ts               # rAF frame scheduler (coalesces updates)
├── config.ts                  # EngineConfig + defaults
└── index.ts                   # Library entry point (barrel export)
```

---

## 6. Pretext Integration Layer

### MeasurementCache

LRU cache wrapping `@chenglou/pretext` APIs. Default max: 2048 entries.

- **Cache key**: `text + \x00 + font + \x00 + whiteSpace + \x00 + wordBreak`
- **APIs wrapped**: `prepare()`, `prepareWithSegments()`, `prepareRichInline()`
- **Eviction**: LRU. During streaming, the "active" paragraph is accessed every frame; old paragraphs naturally evict.

### Invalidation Strategy

| Event | Action |
|-------|--------|
| Text content change | Invalidate specific key, re-prepare |
| Font/theme change | `invalidateByFont()` — clear all entries for that font |
| Viewport resize | No invalidation needed — only `layout()` is re-called |
| Font loading complete | `invalidateAll()` — all prior measurements are wrong |

### Font Loading

Fonts must be loaded before `prepare()` produces correct results. Strategy:
1. Pipeline starts → `FontLoader.preload(theme.allFonts)`
2. While fonts load → render with system fallback metrics (accept wrong measurements for 1–3 frames)
3. Font loaded → `invalidateAll()` on cache
4. Next frame → full re-prepare with correct font
5. **This is the one acceptable layout shift in the system.**

---

## 7. Bridge Architecture

### Protocol: WebSocket with SSE Fallback

```
Python Agent ──WebSocket──▶ TypeScript Engine
               ◀─────────
             OR:
             ──SSE────────▶
             ◀─HTTP POST──  (backpressure/config)
```

WebSocket: bidirectional, lower latency, supports backpressure signals.  
SSE: unidirectional fallback, works through proxies/CDNs.

### Message Format

JSON-based, versioned (`PROTOCOL_VERSION = 1`). See `src/types/stream.ts` for the full type definitions.

- **Upstream** (Python → TS): `chunk`, `end`, `error`, `config`, `ping`
- **Downstream** (TS → Python, WebSocket only): `pause`, `resume`, `ack`, `pong`

### Buffer Management

Ring buffer (default capacity: 256 in pipeline, configurable to 1024 via `EngineConfig.streamBufferCapacity`). Backpressure hysteresis: pause at 75%, resume at 25%.

---

## 8. Performance Budget

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
| Canvas Render | 8.0ms | 2.0ms |
| **Total** | **< 16ms** | |

### Critical Targets

| Metric | Target |
|--------|--------|
| Token-to-pixel latency (streaming) | < 16ms (1 frame) |
| Full re-layout on resize (500 nodes) | < 5ms |
| `prepare()` cache hit ratio in streaming | > 95% |
| Memory per 1000 LayoutBox nodes | < 2MB |
| Frame drops during streaming at 60fps | 0 |

---

## 9. Architectural Decision Records

### ADR-001: Pretext as Sole Text Measurement Provider
**Status:** Accepted. Uses `@chenglou/pretext` exclusively. No DOM reads. Tradeoff: fonts must be loaded before `prepare()`, and `PreparedText` handles are opaque.

### ADR-002: Discriminated Unions Over Class Hierarchies
**Status:** Accepted. `kind` field as discriminant. Exhaustive `switch`, serializable, no `instanceof`. Tradeoff: verbose — every variant is a separate interface.

### ADR-003: Frame Batching via requestAnimationFrame
**Status:** Accepted. Max 60 pipeline runs/sec regardless of token rate. Only 1 `prepare()` per dirty text node per frame. Tradeoff: up to 16ms latency between token arrival and pixel.

### ADR-004: LRU Cache for PreparedText (2048 entries)
**Status:** Accepted. Bounded memory (~5–10MB). Naturally evicts stale entries during streaming. Configurable via `EngineConfig.measurementCacheSize`.

### ADR-005: Renderer-Agnostic RenderCommand[] IR
**Status:** Accepted. Thin renderer implementations (~200 LOC each). Easy to add new renderers. Tradeoff: flat list loses tree structure — clipping needs explicit push/pop.

### ADR-006: WebSocket Primary + SSE Fallback
**Status:** Accepted. WebSocket for bidirectional backpressure. SSE for proxy/CDN compatibility. JSON messages.

### ADR-007: Dirty Flag Propagation Over Full-Tree Diffing
**Status:** Accepted. O(dirty set size) per frame. Four flags: `textDirty`, `constraintDirty`, `geometryDirty`, `renderDirty`. Propagated upward on mutation.
