# Project Manifest: Spatial Markdown Engine

## Overview

A high-performance TypeScript layout engine that renders LLM streaming output as structured spatial documents at 60fps with zero layout shift.

## Tech Stack

- **Language**: TypeScript (strict mode, no `any`)
- **Core Dependency**: `@chenglou/pretext` v0.0.5 (DOM-less text measurement)
- **Build**: Vite 6 (library mode, ESM + CJS, minified with esbuild)
- **Test**: Vitest 3 (unit + integration + benchmarks)
- **Lint**: oxlint
- **Format**: Prettier
- **Package**: `@spatial-markdown/engine`

## Architecture

| Layer | Source | Role |
|-------|--------|------|
| Types | `src/types/` | Shared type declarations (branded types, discriminated unions, theme) |
| Parser | `src/parser/` | Streaming tokenizer (FSM) → incremental AST builder → transform passes |
| Engine | `src/engine/` | Constraint solver, pretext measurement, geometry calculator. Pure TS, no DOM. |
| Renderer | `src/renderer/` | Canvas 2D, Android Jetpack Compose backends — all consume `RenderCommand[]` |
| Bridge | `src/bridge/` | WebSocket/SSE adapters, ring buffer, backpressure controller, Android JS Interface adapter (`src/bridge/quickjs-adapter/`) |
| Theme | `src/theme/` | Theme extraction from URLs/HTML, mapping to `ThemeConfig` |
| Pipeline | `src/pipeline.ts` | Top-level orchestrator wiring all layers |

**Pipeline**: `feed()` → Tokenizer → AST Builder → Transforms → Constraint Solver → Measurement → Geometry → Render Commands → Subscribers. Batched per `requestAnimationFrame`.

**Performance target**: Token-to-pixel < 16ms (60fps). Full pipeline measured at ~0.15ms mean for a 10-slide document.

## Specs

- **DSL Specification**: [`specs/spatial-spec.md`](./specs/spatial-spec.md) — tag taxonomy, attributes, layout/streaming behavior, defaults, parser error handling.
- **Architecture**: [`specs/architecture.md`](./specs/architecture.md) — pipeline design, module map, incremental update strategy, pretext integration, performance budgets, ADRs.
- **System Prompt Guide**: [`specs/system-prompt-guide.md`](./specs/system-prompt-guide.md) — guidance for constructing LLM prompts that produce valid Spatial Markdown.

## Public API

```ts
import { createPipeline } from '@spatial-markdown/engine';

const pipeline = createPipeline();
pipeline.onRender((commands) => { /* draw */ });
pipeline.feed('<Slide><Heading level={1}>Hello</Heading></Slide>');
pipeline.flush();

// Stream mode:
pipeline.feedStream(readableStream);

// Resize:
pipeline.resize(width, height);

// Cleanup:
pipeline.destroy();
```

**Subpath exports**: `@spatial-markdown/engine/canvas`, `/bridge`, `/types`.
