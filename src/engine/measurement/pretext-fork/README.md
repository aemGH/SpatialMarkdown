# @chenglou/pretext Fork

## Why we forked

Pretext's `measurement.js` hard-creates an `OffscreenCanvas` or `document.createElement('canvas')` context for text measurement. That makes it impossible to run the engine on runtimes without DOM/Canvas (QuickJS, Hermes, raw Node).

## What changed

Only `measurement.js` was modified. All other files (`layout.js`, `analysis.js`, `line-break.js`, `bidi.js`, `rich-inline.js`, generated data) are identical to upstream v0.0.5.

### Changes in `measurement.js`

1. Added `setMeasureContext(ctx)` export.
   - Injects a host-provided object that exposes `measureText(text)` and `font` setter.
   - When injected, `getMeasureContext()` returns it instead of creating a canvas.
   - Re-injecting resets measurement caches.

2. `getMeasureContext()` fallback error message now mentions `setMeasureContext()`.

3. `getEmojiCorrection()` already had a `typeof document` guard; we added a code comment explaining the QuickJS/Node skip path.

## License

MIT (same as upstream). Forked from `@chenglou/pretext@0.0.5`.
