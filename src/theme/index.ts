/**
 * @spatial-markdown/engine/theme — Theme extraction and mapping.
 *
 * Extract design tokens from any website URL and produce a ThemeConfig
 * that can be used directly with `createPipeline({ theme })`.
 *
 * @example
 * ```ts
 * import { extractThemeFromURL, mapExtractedTheme } from '@spatial-markdown/engine/theme';
 *
 * const extracted = await extractThemeFromURL('https://stripe.com');
 * const theme = mapExtractedTheme(extracted);
 *
 * const pipeline = createPipeline({ theme });
 * ```
 */

export { extractThemeFromURL, extractThemeFromHTML } from './extract-theme';
export type { ExtractedTheme, ExtractedColors, ExtractedTypography, ExtractedSpacing, ExtractedSurfaces, ExtractionOptions } from './extract-theme';
export { mapExtractedTheme } from './map-extracted-theme';
export type { MappingOptions } from './map-extracted-theme';