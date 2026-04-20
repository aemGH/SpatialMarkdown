/**
 * Engine configuration and defaults.
 *
 * @module @spatial-markdown/engine
 */

import type { ThemeConfig } from './types/theme';
import { defaultTheme } from './types/theme';

export interface EngineConfig {
  readonly theme: ThemeConfig;
  readonly measurementCacheSize: number;
  readonly streamBufferCapacity: number;
  readonly backpressureHighWatermark: number;
  readonly backpressureLowWatermark: number;
  readonly textBatchDebounceMs: number;
}

export const defaultConfig: EngineConfig = {
  theme: defaultTheme,
  measurementCacheSize: 2048,
  streamBufferCapacity: 1024,
  backpressureHighWatermark: 0.75,
  backpressureLowWatermark: 0.25,
  textBatchDebounceMs: 8,
};

export function mergeConfig(partial: Partial<EngineConfig>): EngineConfig {
  return { ...defaultConfig, ...partial };
}
