# ADR-008: Kotlin Android Bridge Architecture

## Context & Problem Statement
The Spatial Markdown Engine's core "Brain" (Constraint Solver, Layout Geometry) relies on `@chenglou/pretext` and runs in pure TypeScript. However, consumers need to render Spatial Markdown inside native Android applications using Jetpack Compose. We needed a way to pipe the layout output natively into Android while preserving the 60fps, zero-reflow layout streaming performance.

Crucially, **no layout logic (measuring text constraints or wrapping text) is allowed to exist in Android**. The Android implementation must be a "dumb" renderer that just paints pixels at exact coordinates provided by the TS engine.

## Considered Options

1. **Path A: Embedded JS Runtime (QuickJS) + Native UI**
   - **Pros:** 100% TS engine reuse. Zero DOM overhead. Memory-efficient (~2MB JS context). Sub-millisecond cold starts.
   - **Cons:** Requires JNI bindings to bridge `pretext` measurement to Android's `TextPaint`. Requires JS polyfills for environments (timers, logs, segmenter).

2. **Path B: Kotlin Multiplatform (KMP) Rewrite**
   - **Pros:** Maximum performance and memory safety. Native integration.
   - **Cons:** Violates "reuse over rewrite". Would require porting parser, AST, and solver code to Kotlin, fragmenting the engine core.

3. **Path C: Headless WebView Bridge**
   - **Pros:** Immediate execution. WebView handles `pretext` natively via its own DOM Canvas Context.
   - **Cons:** High memory footprint. Multi-process overhead. Cold starts can take >1 second.

## Decision Outcome
We initially chose **Path C: Headless WebView Bridge** as an MVP, but have since migrated entirely to **Path A: Embedded JS Runtime (QuickJS)** for the production implementation.

The QuickJS implementation (`wang.harlon.quickjs:wrapper-android:3.2.4`) handles the TypeScript Engine perfectly with drastic performance improvements (cold start from ~1500ms down to ~250ms). 

The integration module spans Layer D and Layer C:
1. **TypeScript Bridge (`src/bridge/quickjs-adapter/`)**: An IIFE build target loaded into QuickJS that injects `SpatialEngine` globally, utilizes a forked version of pretext mapped to Android's native `TextPaint`, and pushes serialized JSON back to Kotlin.
2. **Kotlin Render Layer (`android/spatial-engine/src/.../ui/SpatialMarkdownCanvas.kt`)**: A Jetpack Compose `Canvas` that deserializes `RenderCommand` models via `kotlinx.serialization` and draws them natively. It uses `drawText` strictly with `softWrap = false` to guarantee the engine's exact measurement dictates layout.
3. **Headless Engine Wrapper (`android/spatial-engine/src/.../core/SpatialEngine.kt`)**: A Kotlin class managing the QuickJS Context lifecycle inside a single dedicated executor thread, handling JNI bounds, injected polyfills, and feed streams.

This achieves high-performance native Kotlin rendering, allows us to tap into Coil/Glide for image resolving, avoids touching the pure TypeScript Core (Layer A/B), and completely circumvents the heavy multi-process overhead of Android WebViews.

## Implementation Rules
- **No Reflow:** All calculations remain in the JS context. The Android UI is purely a "dumb sink" that draws commands.
- **Thread Affinity:** QuickJS requires `QuickJSContext.create()` and all `evaluate()` calls to execute on the same thread. The Kotlin wrapper enforces this using a `ScheduledExecutorService`.
- **Serialization Mapping:** Any changes to `RenderCommand` in `src/types/render.ts` MUST be replicated exactly in `RenderCommand.kt`.
