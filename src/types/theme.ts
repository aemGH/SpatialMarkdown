/**
 * Theme configuration and defaults.
 *
 * @module @spatial/types/theme
 */

import type { Pixels, FontDescriptor } from './primitives';
import { px, font } from './primitives';

export interface ThemeConfig {
  readonly fonts: {
    readonly body: FontDescriptor;
    readonly heading: FontDescriptor;
    readonly h1: FontDescriptor;
    readonly h2: FontDescriptor;
    readonly h3: FontDescriptor;
    readonly mono: FontDescriptor;
    readonly caption: FontDescriptor;
  };
  readonly lineHeights: {
    readonly body: Pixels;
    readonly heading: Pixels;
    readonly display: Pixels;
    readonly mono: Pixels;
    readonly caption: Pixels;
  };
  readonly colors: {
    readonly text: string;
    readonly textSecondary: string;
    readonly background: string;
    readonly surface: string;
    readonly border: string;
    readonly accent: string;
    readonly success: string;
    readonly warning: string;
    readonly error: string;
    readonly info: string;
  };
  readonly spacing: {
    readonly xs: Pixels;
    readonly sm: Pixels;
    readonly md: Pixels;
    readonly lg: Pixels;
    readonly xl: Pixels;
  };
  readonly composition: {
    readonly prose: {
      readonly fullWidthUntil: Pixels;
      readonly growthFactor: number;
      readonly max: Pixels;
    };
    readonly heading: {
      readonly fullWidthUntil: Pixels;
      readonly growthFactor: number;
      readonly max: Pixels;
    };
  };
}

export const defaultTheme: ThemeConfig = {
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

export const darkTheme: ThemeConfig = {
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
  spacing: defaultTheme.spacing,
  composition: defaultTheme.composition,
};

/** High-contrast theme for accessibility-sensitive contexts. */
export const highContrastTheme: ThemeConfig = {
  fonts: defaultTheme.fonts,
  lineHeights: defaultTheme.lineHeights,
  colors: {
    text: '#000000',
    textSecondary: '#333333',
    background: '#FFFFFF',
    surface: '#F0F0F0',
    border: '#000000',
    accent: '#0000CC',
    success: '#006600',
    warning: '#CC6600',
    error: '#CC0000',
    info: '#0000CC',
  },
  spacing: defaultTheme.spacing,
  composition: defaultTheme.composition,
};

/** Warm neutral theme — earthy tones, softer feel. */
export const warmTheme: ThemeConfig = {
  fonts: {
    body: font('15px "Georgia", serif'),
    heading: font('700 26px "Georgia", serif'),
    h1: font('700 42px "Georgia", serif'),
    h2: font('700 24px "Georgia", serif'),
    h3: font('600 20px "Georgia", serif'),
    mono: font('14px "Fira Code", monospace'),
    caption: font('600 12px "Georgia", serif'),
  },
  lineHeights: {
    body: px(24),
    heading: px(34),
    display: px(50),
    mono: px(20),
    caption: px(16),
  },
  colors: {
    text: '#3D2C1E',
    textSecondary: '#7A6A5B',
    background: '#FDF8F0',
    surface: '#F5EDE0',
    border: '#D6C9B6',
    accent: '#B85C38',
    success: '#4E8B3A',
    warning: '#C68E17',
    error: '#A63D40',
    info: '#4A6FA5',
  },
  spacing: defaultTheme.spacing,
  composition: defaultTheme.composition,
};

// ─── Theme Utilities ─────────────────────────────────────────────────

/** Deep-partial type for ThemeConfig overrides. */
export type ThemeOverrides = {
  readonly fonts?: Partial<ThemeConfig['fonts']>;
  readonly lineHeights?: Partial<ThemeConfig['lineHeights']>;
  readonly colors?: Partial<ThemeConfig['colors']>;
  readonly spacing?: Partial<ThemeConfig['spacing']>;
  readonly composition?: {
    readonly prose?: Partial<ThemeConfig['composition']['prose']>;
    readonly heading?: Partial<ThemeConfig['composition']['heading']>;
  };
};

/**
 * Create a new theme by deep-merging overrides onto a base theme.
 * Unlike Object.assign or spread, this merges nested objects correctly
 * so you can override just `colors.accent` without wiping other colors.
 *
 * @param overrides - Partial theme values to apply.
 * @param base      - Base theme to merge onto. Default: defaultTheme.
 * @returns A complete ThemeConfig with overrides applied.
 *
 * @example
 * ```ts
 * const brandTheme = createTheme({
 *   colors: { accent: '#FF6600', info: '#FF6600' },
 *   fonts: { body: font('15px "Helvetica Neue", sans-serif') },
 * });
 * ```
 */
export function createTheme(
  overrides: ThemeOverrides,
  base: ThemeConfig = defaultTheme,
): ThemeConfig {
  return {
    fonts: {
      ...base.fonts,
      ...overrides.fonts,
    },
    lineHeights: {
      ...base.lineHeights,
      ...overrides.lineHeights,
    },
    colors: {
      ...base.colors,
      ...overrides.colors,
    },
    spacing: {
      ...base.spacing,
      ...overrides.spacing,
    },
    composition: {
      prose: {
        ...base.composition.prose,
        ...overrides.composition?.prose,
      },
      heading: {
        ...base.composition.heading,
        ...overrides.composition?.heading,
      },
    },
  };
}
