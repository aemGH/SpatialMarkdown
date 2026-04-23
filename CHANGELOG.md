# Changelog

All notable changes to `@spatial-markdown/engine` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-23

Initial public release of the Spatial Markdown layout engine.

### Added

#### Core Pipeline

- Full layout pipeline: Tokenizer → AST Builder → Transforms → Constraint Solver → Measurement → Geometry → Render Commands.
- Streaming tokenizer (finite state machine) with incremental AST builder — handles partial tags across chunk boundaries.
- Constraint solver with incremental dirty-tracking (see [ADR-007](specs/ADR-007.md)).
- DOM-less text measurement via `@chenglou/pretext`.
- Synchronous `render()` one-liner for static document rendering.
- `onError` subscriber for pipeline error handling.
- Frame scheduler with `requestAnimationFrame` batching and Node.js `setTimeout` fallback.

#### Spatial Markdown Tags

- 16 built-in tags: `<Slide>`, `<AutoGrid>`, `<Stack>`, `<Columns>`, `<Canvas>`, `<MetricCard>`, `<CodeBlock>`, `<DataTable>`, `<Chart>`, `<Quote>`, `<Callout>`, `<Text>`, `<Heading>`, `<Spacer>`, `<Divider>`, `<Image>`.

#### Renderers

- Canvas 2D renderer with HiDPI / device-pixel-ratio support.
- SVG renderer (DOM mode + string serialization for SSR and export).
- React renderer: `<SpatialView>` component and `useSpatialPipeline` hook.

#### Theming

- Theme system with four presets: `defaultTheme`, `darkTheme`, `highContrastTheme`, `warmTheme`.
- `createTheme()` deep-merge utility for building custom themes.
- `extractThemeFromURL()` for extracting theme tokens from a URL or HTML source.

#### Bridge Layer

- WebSocket and SSE streaming adapters (lazy-loaded).
- Ring buffer with backpressure controller for high-throughput streams.
- Python SDK type contract for cross-language integration.

#### Build & Quality

- Full ESM + CJS + `.d.ts` builds via Vite library mode.
- Strict TypeScript throughout — no `any`, branded types, discriminated unions.
- 173 unit and integration tests.
- Benchmark suite for layout performance regression tracking.

[0.1.0]: https://github.com/spatial-markdown/engine/releases/tag/v0.1.0
