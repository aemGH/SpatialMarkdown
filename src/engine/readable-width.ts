import type { Pixels } from '../types/primitives';
import { px } from '../types/primitives';
import type { ThemeConfig } from '../types/theme';

function resolveReadableWidth(
  availableWidth: Pixels,
  policy: {
    readonly fullWidthUntil: Pixels;
    readonly growthFactor: number;
    readonly max: Pixels;
  },
): Pixels {
  if (availableWidth <= policy.fullWidthUntil) {
    return availableWidth;
  }

  const softened = policy.fullWidthUntil + (availableWidth - policy.fullWidthUntil) * policy.growthFactor;
  return px(Math.min(availableWidth, Math.min(policy.max, softened)));
}

export function resolveProseWidth(availableWidth: Pixels, theme: ThemeConfig): Pixels {
  return resolveReadableWidth(availableWidth, theme.composition.prose);
}

export function resolveHeadingWidth(availableWidth: Pixels, theme: ThemeConfig): Pixels {
  return resolveReadableWidth(availableWidth, theme.composition.heading);
}
