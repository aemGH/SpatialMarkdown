# ADR-008: Kotlin Android Bridge Architecture

## Context & Problem Statement
The Spatial Markdown Engine's core "Brain" (Constraint Solver, Layout Geometry) relies on `@chenglou/pretext` and runs in pure TypeScript. However, consumers need to render Spatial Markdown inside native Android applications using Jetpack Compose. We needed a way to pipe the layout output natively into Android while preserving the 60fps, zero-reflow layout streaming performance.

Crucially, **no layout logic (measuring text constraints or wrapping text) is allowed to exist in Android**. The Android implementation must be a "dumb" renderer that just paints pixels at exact coordinates provided by the TS engine.

## Considered Options

1. **Path A: Embedded JS Runtime (V8/QuickJS) + Native UI**
   - **Pros:** 100% TS engine reuse. Zero DOM overhead.
   - **Cons:** Requires JNI bindings to bridge `pretext` measurement to Android's `TextPaint`.

2. **Path B: Kotlin Multiplatform (KMP) Rewrite**
   - **Pros:** Maximum performance and memory safety. Native integration.
   - **Cons:** Violates "reuse over rewrite". Would require porting parser, AST, and solver code to Kotlin, fragmenting the engine core.

3. **Path C: Headless WebView Bridge**
   - **Pros:** Immediate execution. WebView handles `pretext` natively via its own DOM Canvas Context. Clean separation via JS-to-Kotlin `RenderCommand` JSON serialization.
   - **Cons:** Higher memory footprint (WebView). JSON serialization latency risk on extremely large documents.

## Decision Outcome
We chose **Path C: Headless WebView Bridge** as the foundational MVP approach.

We created an integration module spanning Layer D and Layer C:
1. **TypeScript Bridge (`src/bridge/android-adapter/`)**: An IIFE build target that injects `SpatialEngine` globally inside the WebView and pushes serialized JSON to `AndroidSpatialBridge.onRenderCommands`.
2. **Kotlin Render Layer (`android/spatial-engine/src/.../ui/SpatialMarkdownCanvas.kt`)**: A Jetpack Compose `<Canvas>` that deserializes `RenderCommand` models via `kotlinx.serialization` and draws them natively. It uses `drawText` strictly with `softWrap = false` to guarantee the engine's exact measurement dictates layout.
3. **Headless Engine Wrapper (`android/spatial-engine/src/.../core/SpatialEngineWebView.kt`)**: A Compose view that wraps an invisible `WebView`, establishing the JS interface and feeding the UI canvas state.

This achieves native Kotlin rendering, allows us to tap into Coil/Glide for image resolving, and avoids touching the pure TypeScript Core (Layer A/B).

## Implementation Rules
- **No Reflow:** All calculations remain in the JS context. The Android UI is purely a "dumb sink" that draws commands.
- **Serialization Mapping:** Any changes to `RenderCommand` in `src/types/render.ts` MUST be replicated in `RenderCommand.kt`.
