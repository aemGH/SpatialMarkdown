/**
 * Engine configuration and defaults.
 *
 * @module @spatial-markdown/engine
 */

import type { ThemeConfig } from './types/theme';
import { defaultTheme } from './types/theme';
import type { MeasurementContext } from './engine/measurement/measurement-context';

export interface EngineConfig {
  readonly theme: ThemeConfig;
  readonly measurementCacheSize: number;
  readonly streamBufferCapacity: number;
  readonly backpressureHighWatermark: number;
  readonly backpressureLowWatermark: number;
  readonly textBatchDebounceMs: number;
  /**
   * Host-provided text measurement context. When omitted, the engine
   * auto-detects the best available backend (OffscreenCanvas in browser,
   * node-canvas in Node tests). Pass an explicit context when running
   * on QuickJS, Hermes, or other non-browser JS engines.
   */
  readonly measurementContext?: MeasurementContext;
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
