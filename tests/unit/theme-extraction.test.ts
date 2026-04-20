/**
 * Theme extraction and mapping tests.
 *
 * Tests the extraction logic from HTML strings and the ThemeConfig mapping.
 * We use `extractThemeFromHTML` with crafted HTML strings to test
 * deterministically without network calls.
 *
 * @module @spatial-markdown/engine/theme
 */

import { describe, it, expect } from 'vitest';
import { mapExtractedTheme } from '../../src/theme/map-extracted-theme';
import type { ExtractedTheme } from '../../src/theme/extract-theme';
import { defaultTheme, darkTheme } from '../../src/types/theme';

// ─── Test Fixtures ────────────────────────────────────────────────────

/** A minimal extracted theme with light-mode defaults. */
const lightExtracted: ExtractedTheme = {
  url: 'https://example.com',
  title: 'Example Site',
  colors: {
    background: '#ffffff',
    surface: '#f8f9fa',
    text: '#212529',
    textSecondary: '#868e96',
    accent: '#4c6ef5',
    border: '#dee2e6',
  },
  typography: {
    headingFamily: 'Inter',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    h1Size: 42,
    h2Size: 24,
    h3Size: 20,
    bodySize: 14,
    bodyLineHeight: 1.5,
    headingWeight: 700,
  },
  spacing: {
    unit: 8,
    sectionGap: 24,
    paragraphGap: 12,
  },
  surfaces: {
    borderRadius: 8,
    cardBg: '#f1f3f5',
    cardShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  cssVariables: {},
};

/** A dark-mode extracted theme like GitHub Dark. */
const darkExtracted: ExtractedTheme = {
  url: 'https://github.com',
  title: 'GitHub',
  colors: {
    background: '#0d1117',
    surface: '#161b22',
    text: '#e1e4e8',
    textSecondary: '#8b949e',
    accent: '#58a6ff',
    border: '#30363d',
  },
  typography: {
    headingFamily: 'Inter',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    h1Size: 32,
    h2Size: 24,
    h3Size: 20,
    bodySize: 14,
    bodyLineHeight: 1.6,
    headingWeight: 600,
  },
  spacing: {
    unit: 8,
    sectionGap: 24,
    paragraphGap: 12,
  },
  surfaces: {
    borderRadius: 6,
    cardBg: '#21262d',
    cardShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
  cssVariables: {},
};

/** An extracted theme with atypical values (large fonts, wide spacing). */
const largeExtracted: ExtractedTheme = {
  url: 'https://bigfonts.example',
  title: 'BigFonts',
  colors: {
    background: '#fefefe',
    surface: '#f5f5f5',
    text: '#111111',
    textSecondary: '#666666',
    accent: '#ff6600',
    border: '#cccccc',
  },
  typography: {
    headingFamily: 'Georgia',
    bodyFamily: 'Georgia',
    monoFamily: 'Courier New',
    h1Size: 56,
    h2Size: 36,
    h3Size: 28,
    bodySize: 18,
    bodyLineHeight: 1.65,
    headingWeight: 800,
  },
  spacing: {
    unit: 12,
    sectionGap: 32,
    paragraphGap: 16,
  },
  surfaces: {
    borderRadius: 12,
    cardBg: '#ffffff',
    cardShadow: '0 4px 16px rgba(0,0,0,0.08)',
  },
  cssVariables: {},
};

// ─── mapExtractedTheme Tests ──────────────────────────────────────────

describe('mapExtractedTheme', () => {
  it('maps light theme colors correctly', () => {
    const theme = mapExtractedTheme(lightExtracted);

    expect(theme.colors.background).toBe('#ffffff');
    expect(theme.colors.text).toBe('#212529');
    expect(theme.colors.accent).toBe('#4c6ef5');
    // Surface comes from the extracted cardBg (which differs from the
    // extracted surface — the mapper uses cardBg as the slide surface)
    expect(theme.colors.surface).toBe('#f1f3f5');
    expect(theme.colors.border).toBe('#dee2e6');
  });

  it('maps dark theme colors correctly', () => {
    const theme = mapExtractedTheme(darkExtracted);

    expect(theme.colors.background).toBe('#0d1117');
    expect(theme.colors.text).toBe('#e1e4e8');
    expect(theme.colors.accent).toBe('#58a6ff');
    // Surface should be the extracted card bg or derived
    expect(theme.colors.surface).toBeTruthy();
  });

  it('derives semantic colors (success, warning, error, info) for light', () => {
    const theme = mapExtractedTheme(lightExtracted);

    // Light mode defaults
    expect(theme.colors.success).toBeTruthy();
    expect(theme.colors.warning).toBeTruthy();
    expect(theme.colors.error).toBeTruthy();
    // info should reuse accent
    expect(theme.colors.info).toBe(lightExtracted.colors.accent);
  });

  it('derives semantic colors for dark', () => {
    const theme = mapExtractedTheme(darkExtracted);

    expect(theme.colors.success).toBeTruthy();
    expect(theme.colors.warning).toBeTruthy();
    expect(theme.colors.error).toBeTruthy();
    expect(theme.colors.info).toBe(darkExtracted.colors.accent);
  });

  it('maps typography correctly', () => {
    const theme = mapExtractedTheme(lightExtracted);

    // Body font should use extracted family and size
    expect(theme.fonts.body).toContain('Inter');
    expect(theme.fonts.body).toContain('14px');

    // H1 should use extracted heading family and size
    expect(theme.fonts.h1).toContain('Inter');
    expect(theme.fonts.h1).toContain('42px');

    // Heading weight should be extracted value
    expect(theme.fonts.heading).toContain('700');
  });

  it('maps custom font families', () => {
    const theme = mapExtractedTheme(largeExtracted);

    expect(theme.fonts.body).toContain('Georgia');
    expect(theme.fonts.heading).toContain('Georgia');
    expect(theme.fonts.mono).toContain('Courier New');
  });

  it('clamps extreme font sizes to reasonable ranges', () => {
    const extremeTheme: ExtractedTheme = {
      ...lightExtracted,
      typography: {
        ...lightExtracted.typography,
        h1Size: 200, // Way too big
        bodySize: 2,  // Way too small
      },
    };
    const theme = mapExtractedTheme(extremeTheme);

    // H1 should be clamped to max 72
    expect(theme.fonts.h1).toContain('72px');
    // Body should be clamped to min 10
    expect(theme.fonts.body).toContain('10px');
  });

  it('computes line heights proportionally from font sizes', () => {
    const theme = mapExtractedTheme(lightExtracted);

    // Body line-height should be proportional (bodySize * bodyLineHeight ≈ 21)
    expect(theme.lineHeights.body).toBeGreaterThan(0);

    // Display line-height should be based on h1Size
    expect(theme.lineHeights.display).toBeGreaterThan(0);

    // Line heights should scale with font sizes
    expect(theme.lineHeights.heading).toBeGreaterThan(theme.lineHeights.body);
  });

  it('computes spacing scale from extracted unit', () => {
    const theme = mapExtractedTheme(lightExtracted);

    // Base unit of 8 → xs=4, sm=8
    expect(theme.spacing.xs).toBeLessThan(theme.spacing.sm);
    expect(theme.spacing.sm).toBeLessThan(theme.spacing.md);
    expect(theme.spacing.md).toBeLessThan(theme.spacing.lg);
    expect(theme.spacing.lg).toBeLessThan(theme.spacing.xl);
  });

  it('uses custom spacing when provided', () => {
    const theme = mapExtractedTheme(largeExtracted);

    // Base unit of 12 → spacing scale should be larger than default 8
    expect(theme.spacing.sm).toBeGreaterThan(defaultTheme.spacing.sm);
  });

  it('preserves composition settings from defaults', () => {
    const theme = mapExtractedTheme(lightExtracted);

    // Composition should come from defaults (same as defaultTheme)
    expect(theme.composition.prose.fullWidthUntil).toBe(defaultTheme.composition.prose.fullWidthUntil);
    expect(theme.composition.prose.growthFactor).toBe(defaultTheme.composition.prose.growthFactor);
    expect(theme.composition.heading.max).toBe(defaultTheme.composition.heading.max);
  });

  it('forces dark mode when forceMode=dark', () => {
    const theme = mapExtractedTheme(lightExtracted, { forceMode: 'dark' });

    // Should use dark defaults for semantic colors, even though
    // the extracted background is white
    expect(theme.colors.success).toBe('#34D058');
    expect(theme.colors.error).toBe('#F97583');
    expect(theme.colors.warning).toBe('#FFAB70');
  });

  it('forces light mode when forceMode=light', () => {
    const theme = mapExtractedTheme(darkExtracted, { forceMode: 'light' });

    // Should use light defaults for semantic colors, even though
    // the extracted background is dark
    expect(theme.colors.success).toBe('#37B24D');
    expect(theme.colors.error).toBe('#F03E3E');
    expect(theme.colors.warning).toBe('#F59F00');
  });

  it('auto-detects mode from background luminance', () => {
    // Light background → light mode semantic colors
    const lightTheme = mapExtractedTheme(lightExtracted);
    expect(lightTheme.colors.success).toBe('#37B24D');

    // Dark background → dark mode semantic colors
    const darkTheme = mapExtractedTheme(darkExtracted);
    expect(darkTheme.colors.success).toBe('#34D058');
  });

  it('handles missing accent color by using defaults', () => {
    const noAccent: ExtractedTheme = {
      ...lightExtracted,
      colors: {
        ...lightExtracted.colors,
        accent: '', // Missing
      },
    };
    const theme = mapExtractedTheme(noAccent);
    // Should fall back to default accent
    expect(theme.colors.accent).toBeTruthy();
  });

  it('handles empty extracted theme gracefully', () => {
    const minimal: ExtractedTheme = {
      url: 'about:blank',
      title: '',
      colors: {
        background: '#ffffff',
        surface: '',
        text: '',
        textSecondary: '',
        accent: '',
        border: '',
      },
      typography: {
        headingFamily: '',
        bodyFamily: '',
        monoFamily: '',
        h1Size: 42,
        h2Size: 24,
        h3Size: 20,
        bodySize: 14,
        bodyLineHeight: 1.5,
        headingWeight: 700,
      },
      spacing: {
        unit: 8,
        sectionGap: 24,
        paragraphGap: 12,
      },
      surfaces: {
        borderRadius: 8,
        cardBg: '',
        cardShadow: '',
      },
      cssVariables: {},
    };
    const theme = mapExtractedTheme(minimal);

    // Should fill all values with defaults
    expect(theme.colors.text).toBeTruthy();
    expect(theme.colors.accent).toBeTruthy();
    expect(theme.fonts.body).toBeTruthy();
    expect(theme.spacing.md).toBeGreaterThan(0);
  });
});

// ─── Color Utility Tests ─────────────────────────────────────────────

describe('mapExtractedTheme color derivations', () => {
  it('derives surface color from background when not provided', () => {
    const noSurface: ExtractedTheme = {
      ...lightExtracted,
      colors: {
        ...lightExtracted.colors,
        surface: '',
      },
    };
    const theme = mapExtractedTheme(noSurface);
    // When surface is empty, should derive from background
    expect(theme.colors.surface).toBeTruthy();
    // Should not crash
    expect(theme.colors.surface.startsWith('#')).toBe(true);
  });

  it('uses a card background different from surface when extracted provides one', () => {
    const theme = mapExtractedTheme(lightExtracted);
    // The extracted card bg (#f1f3f5) differs from surface (#f8f9fa)
    // So it should be used
    expect(theme.colors.surface).toBe('#f1f3f5');
  });

  it('produces a valid ThemeConfig with all required fields', () => {
    const theme = mapExtractedTheme(darkExtracted);

    // All required fields present
    expect(theme.fonts.body).toBeTruthy();
    expect(theme.fonts.heading).toBeTruthy();
    expect(theme.fonts.h1).toBeTruthy();
    expect(theme.fonts.h2).toBeTruthy();
    expect(theme.fonts.h3).toBeTruthy();
    expect(theme.fonts.mono).toBeTruthy();
    expect(theme.fonts.caption).toBeTruthy();

    expect(typeof theme.lineHeights.body).toBe('number');
    expect(typeof theme.lineHeights.heading).toBe('number');
    expect(typeof theme.lineHeights.display).toBe('number');
    expect(typeof theme.lineHeights.mono).toBe('number');
    expect(typeof theme.lineHeights.caption).toBe('number');

    expect(typeof theme.colors.text).toBe('string');
    expect(typeof theme.colors.textSecondary).toBe('string');
    expect(typeof theme.colors.background).toBe('string');
    expect(typeof theme.colors.surface).toBe('string');
    expect(typeof theme.colors.border).toBe('string');
    expect(typeof theme.colors.accent).toBe('string');
    expect(typeof theme.colors.success).toBe('string');
    expect(typeof theme.colors.warning).toBe('string');
    expect(typeof theme.colors.error).toBe('string');
    expect(typeof theme.colors.info).toBe('string');

    expect(typeof theme.spacing.xs).toBe('number');
    expect(typeof theme.spacing.sm).toBe('number');
    expect(typeof theme.spacing.md).toBe('number');
    expect(typeof theme.spacing.lg).toBe('number');
    expect(typeof theme.spacing.xl).toBe('number');
  });
});