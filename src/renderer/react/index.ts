/**
 * React Renderer — RenderCommand[] → React component tree
 *
 * Public API:
 *   - `<SpatialView>` — drop-in component that renders commands as SVG
 *   - `useSpatialPipeline` — lifecycle-managed pipeline hook
 *   - `renderCommandsToReact` — low-level element-tree builder for
 *     consumers who want to compose with custom SVG decorations
 *
 * @module @spatial/renderer/react
 */

export { SpatialView, renderCommandsToReact } from './react-renderer';
export type { SpatialViewProps } from './react-renderer';

export { useSpatialPipeline } from './use-spatial-pipeline';
export type { UseSpatialPipelineResult } from './use-spatial-pipeline';
