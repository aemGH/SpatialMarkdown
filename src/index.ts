/**
 * @spatial-markdown/engine — Library entry point.
 *
 * High-performance Spatial Markdown layout engine
 * powered by @chenglou/pretext.
 *
 * @example
 * ```ts
 * import { createPipeline } from '@spatial-markdown/engine';
 *
 * const pipeline = createPipeline();
 *
 * pipeline.onRender((commands) => {
 *   // Render commands to canvas, React, or SVG
 * });
 *
 * pipeline.feed('<Slide><Heading level={1}>Hello World</Heading></Slide>');
 *
 * // Or connect to an LLM stream:
 * pipeline.feedStream(llmResponseStream);
 *
 * // Update viewport on resize:
 * pipeline.resize(window.innerWidth, window.innerHeight);
 *
 * // Clean up when done:
 * pipeline.destroy();
 * ```
 */

// Types (re-export everything)
export * from './types/index';

// Config
export { defaultConfig, mergeConfig } from './config';
export type { EngineConfig } from './config';

// Pipeline (public API)
export { createPipeline, render } from './pipeline';
export type { SpatialPipeline, RenderOptions } from './pipeline';

// Theme Extraction (re-export for convenience)
export { extractThemeFromURL, extractThemeFromHTML, mapExtractedTheme } from './theme/index';
export type { ExtractedTheme, ExtractedColors, ExtractedTypography, ExtractedSpacing, ExtractedSurfaces, ExtractionOptions, MappingOptions } from './theme/index';
