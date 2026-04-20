/**
 * `useSpatialPipeline` — React hook for streaming Spatial Markdown.
 *
 * Manages pipeline lifecycle, subscribes to render output, and returns
 * the latest command list plus the pipeline handle so components can
 * call `feed()`, `feedStream()`, `resize()`, etc.
 *
 * @module @spatial/renderer/react/use-spatial-pipeline
 */

import { useEffect, useRef, useState } from 'react';
import type { RenderCommand } from '../../types/render';
import type { EngineConfig } from '../../config';
import type { SpatialPipeline } from '../../pipeline';
import { createPipeline } from '../../pipeline';

export interface UseSpatialPipelineResult {
  /** Latest render commands — empty array until the first frame. */
  readonly commands: ReadonlyArray<RenderCommand>;
  /**
   * The live pipeline handle. Use this to `feed()` text, attach a
   * stream, or `resize()` the viewport.
   *
   * Null until the effect has mounted (SSR / first render).
   */
  readonly pipeline: SpatialPipeline | null;
}

/**
 * Create and manage a Spatial Markdown pipeline bound to a React
 * component's lifecycle.
 *
 * The pipeline is created on mount and destroyed on unmount. Config
 * changes after mount are ignored — recreate the component with a
 * different `key` to reset.
 *
 * @example
 * ```tsx
 * function MyView() {
 *   const { commands, pipeline } = useSpatialPipeline();
 *
 *   useEffect(() => {
 *     if (pipeline === null) return;
 *     pipeline.feed('<Slide><Heading level={1}>Hello</Heading></Slide>');
 *     pipeline.flush();
 *   }, [pipeline]);
 *
 *   return <SpatialView commands={commands} width={800} height={600} />;
 * }
 * ```
 */
export function useSpatialPipeline(
  config?: Partial<EngineConfig>,
): UseSpatialPipelineResult {
  const [commands, setCommands] = useState<ReadonlyArray<RenderCommand>>([]);
  const pipelineRef = useRef<SpatialPipeline | null>(null);
  // Force re-render once the pipeline is attached so consumers see
  // a non-null handle after mount.
  const [, setReady] = useState(false);

  useEffect(() => {
    const pipeline = createPipeline(config);
    pipelineRef.current = pipeline;

    const unsubscribe = pipeline.onRender((next) => {
      // Copy into a new array so React sees a fresh reference.
      setCommands(next.slice());
    });

    setReady(true);

    return () => {
      unsubscribe();
      pipeline.destroy();
      pipelineRef.current = null;
    };
    // Config is intentionally captured once at mount — see JSDoc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    commands,
    pipeline: pipelineRef.current,
  };
}
