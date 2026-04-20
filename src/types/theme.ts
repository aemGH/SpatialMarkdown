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
