/**
 * @spatial-markdown/engine — High-level convenience APIs.
 *
 * Level 0: mount()      — Zero-config, auto-creates canvas
 * Level 1: createApp()  — Production API, you own the canvas
 */

export { mount } from './mount';
export type { MountOptions, MountedInstance } from './mount';

export { createApp } from './create-app';
export type {
  CreateAppOptions,
  SpatialApp,
  ThemeInput,
  RenderInfo,
  ResizeInfo,
} from './create-app';
