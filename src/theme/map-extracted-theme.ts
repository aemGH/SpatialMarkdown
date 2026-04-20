/**
 * Theme Mapping — Converts an ExtractedTheme to the engine's ThemeConfig.
 *
 * Maps design tokens scraped from a website into the engine's theme format,
 * filling in gaps with sensible defaults derived from the extracted colors.
 *
 * @module @spatial-markdown/engine/theme
 */

import type { ThemeConfig } from '../types/theme';
import { px, font } from '../types/primitives';
import type { ExtractedTheme } from './extract-theme';

/**
 * Clamp a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Darken a hex color by a factor (0 = no change, 1 = black).
 */
function darkenColor(hex: string, factor: number): string {
  if (!hex.startsWith('#') || hex.length < 4) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = Math.round(parseInt(h.substring(0, 2), 16) * (1 - factor));
  const g = Math.round(parseInt(h.substring(2, 4), 16) * (1 - factor));
  const b = Math.round(parseInt(h.substring(4, 6), 16) * (1 - factor));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Lighten a hex color by a factor (0 = no change, 1 = white).
 */
function lightenColor(hex: string, factor: number): string {
  if (!hex.startsWith('#') || hex.length < 4) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * factor);
  const g = Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * factor);
  const b = Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ─── Sensible Defaults ───────────────────────────────────────────────

const LIGHT_DEFAULTS: ThemeConfig = {
  fonts: {
    body: font('14px Inter'),
    heading: font('700 24px Inter'),
    h1: font('800 42px Inter'),
    h2: font('700 24px Inter'),
    h3: font('600 20px Inter'),
    mono: font('14px "JetBrains Mono", monospace'),
    caption: font('600 12px Inter'),
  },
  lineHeights: {
    body: px(20),
    heading: px(32),
    display: px(46),
    mono: px(20),
    caption: px(16),
  },
  colors: {
    text: '#212529',
    textSecondary: '#868E96',
    background: '#FFFFFF',
    surface: '#F8F9FA',
    border: '#DEE2E6',
    accent: '#4C6EF5',
    success: '#37B24D',
    warning: '#F59F00',
    error: '#F03E3E',
    info: '#4C6EF5',
  },
  spacing: {
    xs: px(4),
    sm: px(8),
    md: px(16),
    lg: px(24),
    xl: px(48),
  },
  composition: {
    prose: {
      fullWidthUntil: px(820),
      growthFactor: 0.4,
      max: px(920),
    },
    heading: {
      fullWidthUntil: px(960),
      growthFactor: 0.55,
      max: px(1120),
    },
  },
};

const DARK_DEFAULTS: ThemeConfig = {
  fonts: {
    body: font('15px Inter'),
    heading: font('700 26px Inter'),
    h1: font('800 42px Inter'),
    h2: font('700 26px Inter'),
    h3: font('600 20px Inter'),
    mono: font('13px "JetBrains Mono", monospace'),
    caption: font('600 11px Inter'),
  },
  lineHeights: {
    body: px(23),
    heading: px(32),
    display: px(46),
    mono: px(20),
    caption: px(16),
  },
  colors: {
    text: '#E1E4E8',
    textSecondary: '#8B949E',
    background: '#0D1117',
    surface: '#161B22',
    border: '#30363D',
    accent: '#58A6FF',
    success: '#34D058',
    warning: '#FFAB70',
    error: '#F97583',
    info: '#79B8FF',
  },
  spacing: {
    xs: px(4),
    sm: px(8),
    md: px(16),
    lg: px(24),
    xl: px(48),
  },
  composition: {
    prose: {
      fullWidthUntil: px(820),
      growthFactor: 0.4,
      max: px(920),
    },
    heading: {
      fullWidthUntil: px(960),
      growthFactor: 0.55,
      max: px(1120),
    },
  },
};

/**
 * Calculate relative luminance of a hex color.
 */
function luminance(hex: string): number {
  if (!hex.startsWith('#')) return 0.5;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Derive semantic colors that weren't explicitly extracted.
 * Uses the isDark flag to determine whether we're in a dark or light
 * context, then derives missing colors accordingly.
 */
function deriveSemanticColors(accent: string, isDark: boolean): {
  success: string;
  warning: string;
  error: string;
  info: string;
} {
  if (isDark) {
    // Dark mode: use bright, saturated variants
    return {
      success: '#34D058',
      warning: '#FFAB70',
      error: '#F97583',
      info: accent, // reuse accent for info in dark mode
    };
  } else {
    // Light mode: use deeper, more saturated variants
    return {
      success: '#37B24D',
      warning: '#F59F00',
      error: '#F03E3E',
      info: accent, // reuse accent for info
    };
  }
}

/**
 * Compute proportional line heights from font sizes.
 * Uses 1.4x for body text (tighter for slide layout) and 1.3x for headings.
 */
function computeLineHeights(
  bodySize: number,
  h1Size: number,
  h2Size: number,
  h3Size: number,
  bodyLineHeight: number,
): {
  body: number;
  heading: number;
  display: number;
  mono: number;
  caption: number;
} {
  return {
    body: Math.round(bodySize * bodyLineHeight),
    heading: Math.round(Math.max(h2Size, h3Size) * 1.35),
    display: Math.round(h1Size * 1.1),
    mono: Math.round(bodySize * 1.45),
    caption: Math.round(bodySize * 0.85 * 1.35),
  };
}

/**
 * Compute the spacing scale from an extracted base unit.
 *
 * The engine uses xs/sm/md/lg/xl. We derive these proportionally
 * from the extracted unit:
 *   xs = unit
 *   sm = unit * 2
 *   md = unit * 4  (or sectionGap, whichever is more typical)
 *   lg = unit * 6
 *   xl = unit * 12
 */
function computeSpacing(unit: number, sectionGap: number): {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
} {
  // If the unit seems too large (e.g., 24px), scale down
  const base = unit > 12 ? 4 : unit < 4 ? 4 : unit;
  return {
    xs: base,
    sm: base * 2,
    md: clamp(sectionGap > 0 ? sectionGap : base * 4, base * 3, base * 6),
    lg: clamp(Math.round(sectionGap * 1.5), base * 5, base * 8),
    xl: base * 12,
  };
}

// ─── Public API ──────────────────────────────────────────────────────

export interface MappingOptions {
  /**
   * Anchor font: a font that is always available (system fonts).
   * If the extracted website uses a web font that isn't loaded,
   * we fall back to this. Default: 'system-ui, -apple-system, sans-serif'
   */
  fallbackFont?: string;
  /**
   * Whether to force dark mode defaults regardless of the
   * extracted background luminance. Default: auto-detected.
   */
  forceMode?: 'light' | 'dark' | 'auto';
}

function ensureFallback(family: string, isMono: boolean = false): string {
  if (isMono) {
    if (!family.includes('monospace')) return `${family}, ui-monospace, SFMono-Regular, "JetBrains Mono", monospace`;
  } else {
    if (!family.includes('sans-serif') && !family.includes('serif') && !family.includes('system-ui')) {
      return `${family}, system-ui, -apple-system, sans-serif`;
    }
  }
  return family;
}

/**
 * Map an ExtractedTheme to the engine's ThemeConfig.
 *
 * This is the main entry point: provide an `ExtractedTheme` (from
 * `extractThemeFromURL` or `extractThemeFromHTML`) and get back a
 * fully resolved `ThemeConfig` that can be passed directly to
 * `createPipeline({ theme })`.
 *
 * Missing values are filled from sensible defaults matching the
 * detected light/dark mode.
 */
export function mapExtractedTheme(
  extracted: ExtractedTheme,
  options?: MappingOptions,
): ThemeConfig {
  const isDark = options?.forceMode === 'dark'
    ? true
    : options?.forceMode === 'light'
      ? false
      : luminance(extracted.colors.background) < 0.5;

  const defaults = isDark ? DARK_DEFAULTS : LIGHT_DEFAULTS;
  const semanticColors = deriveSemanticColors(
    extracted.colors.accent || defaults.colors.accent,
    isDark,
  );
  const lineHeights = computeLineHeights(
    extracted.typography.bodySize,
    extracted.typography.h1Size,
    extracted.typography.h2Size,
    extracted.typography.h3Size,
    extracted.typography.bodyLineHeight,
  );
  const spacing = computeSpacing(
    extracted.spacing.unit,
    extracted.spacing.sectionGap,
  );

  const headingFamily = ensureFallback(extracted.typography.headingFamily || 'Inter');
  const bodyFamily = ensureFallback(extracted.typography.bodyFamily || 'Inter');
  const monoFamily = ensureFallback(extracted.typography.monoFamily || '"JetBrains Mono", monospace', true);

  const headingWeight = extracted.typography.headingWeight || 700;
  const bodySize = clamp(extracted.typography.bodySize, 10, 24);
  const h1Size = clamp(extracted.typography.h1Size, 24, 72);
  const h2Size = clamp(extracted.typography.h2Size, 16, 48);
  const h3Size = clamp(extracted.typography.h3Size, 14, 36);

  // Derive complement colors if not in extracted
  const slideBg = extracted.colors.background || (isDark ? '#0D1117' : '#FFFFFF');
  const slideSurface = extracted.colors.surface || (isDark ? '#161B22' : '#F8F9FA');

  // Card surface: use the extracted card background if different from surface,
  // otherwise derive a slightly elevated version of the surface
  const cardSurface = extracted.surfaces.cardBg && extracted.surfaces.cardBg !== slideSurface
    ? extracted.surfaces.cardBg
    : isDark
      ? lightenColor(slideBg, 0.06)
      : darkenColor(slideBg, 0.03);

  const theme: ThemeConfig = {
    fonts: {
      body: font(`${bodySize}px ${bodyFamily}`),
      heading: font(`${headingWeight} ${h2Size}px ${headingFamily}`),
      h1: font(`800 ${h1Size}px ${headingFamily}`),
      h2: font(`${headingWeight} ${h2Size}px ${headingFamily}`),
      h3: font(`${Math.max(headingWeight - 100, 400)} ${h3Size}px ${headingFamily}`),
      mono: font(`${Math.max(bodySize - 1, 11)}px ${monoFamily}`),
      caption: font(`600 ${Math.max(Math.round(bodySize * 0.85), 10)}px ${bodyFamily}`),
    },
    lineHeights: {
      body: px(lineHeights.body),
      heading: px(lineHeights.heading),
      display: px(lineHeights.display),
      mono: px(lineHeights.mono),
      caption: px(lineHeights.caption),
    },
    colors: {
      text: extracted.colors.text || defaults.colors.text,
      textSecondary: extracted.colors.textSecondary || defaults.colors.textSecondary,
      background: slideBg,
      surface: cardSurface,
      border: extracted.colors.border || defaults.colors.border,
      accent: extracted.colors.accent || defaults.colors.accent,
      success: semanticColors.success,
      warning: semanticColors.warning,
      error: semanticColors.error,
      info: semanticColors.info,
    },
    spacing: {
      xs: px(spacing.xs),
      sm: px(spacing.sm),
      md: px(spacing.md),
      lg: px(spacing.lg),
      xl: px(spacing.xl),
    },
    composition: defaults.composition,
  };

  return theme;
}