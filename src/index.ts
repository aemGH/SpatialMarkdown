/**
 * @spatial-markdown/engine — Library entry point.
 *
 * High-performance Spatial Markdown layout engine
 * powered by @chenglou/pretext.
 *
 * Three API levels for progressive disclosure:
 *
 * Level 0 — Zero-config (mount):
 * ```ts
 * import { mount } from '@spatial-markdown/engine';
 * const sm = mount('#output', { theme: 'dark' });
 * sm.feed('<Slide><Heading level={1}>Hello World</Heading></Slide>');
 * ```
 *
 * Level 1 — Production (createApp):
 * ```ts
 * import { createApp } from '@spatial-markdown/engine';
 * const app = createApp({ canvas, theme: 'dark' });
 * app.feedComplete('<Slide>...</Slide>');
 * ```
 *
 * Level 2 — Advanced (createPipeline):
 * ```ts
 * import { createPipeline } from '@spatial-markdown/engine';
 * const pipeline = createPipeline();
 * pipeline.onRender((commands, info) => { /* custom rendering *\/ });
 * pipeline.feed(markup);
 * pipeline.flush();
 * ```
 *
 * @module @spatial-markdown/engine
 */

// ─── Level 0: Zero-Config ────────────────────────────────────────────
export { mount } from './app/index';
export type { MountOptions, MountedInstance } from './app/index';

// ─── Level 1: Production ─────────────────────────────────────────────
export { createApp } from './app/index';
export type {
  CreateAppOptions,
  SpatialApp,
  ThemeInput,
  RenderInfo,
  ResizeInfo,
} from './app/index';

// ─── Level 2: Advanced ───────────────────────────────────────────────
export { createPipeline, render } from './pipeline';
export type { SpatialPipeline, RenderOptions } from './pipeline';

// ─── Types (re-export everything) ────────────────────────────────────
export * from './types/index';

// ─── Config ──────────────────────────────────────────────────────────
export { defaultConfig, mergeConfig } from './config';
export type { EngineConfig } from './config';

// ─── Theme Extraction ────────────────────────────────────────────────
export { extractThemeFromURL, extractThemeFromHTML, mapExtractedTheme } from './theme/index';
export type { ExtractedTheme, ExtractedColors, ExtractedTypography, ExtractedSpacing, ExtractedSurfaces, ExtractionOptions, MappingOptions } from './theme/index';
