/**
 * SpatialPipeline — Top-level orchestrator.
 *
 * Wires together the full layout pipeline:
 *   Tokenizer → AST Builder → [Transforms] → Text Collector →
 *   Measurer → Constraint Solver → Geometry Calculator →
 *   Render Command Builder → Subscriber callbacks.
 *
 * The pipeline is the PUBLIC API surface of the Spatial Markdown Engine.
 * It accepts raw streaming text (via `feed()` or `feedStream()`), drives
 * the layout engine on each animation frame, and delivers render commands
 * to subscribers.
 *
 * Key architectural decisions:
 *   1. **Frame batching** — Multiple `feed()` calls within a single frame
 *      are coalesced into one layout pass via the FrameScheduler.
 *   2. **Streaming-safe** — The tokenizer and AST builder support
 *      incremental input. Partial tags and mid-token boundaries are
 *      handled transparently.
 *   3. **Zero reflow** — All text measurement happens via `pretext`
 *      before geometry calculation. No speculative rendering.
 *
 * @module @spatial-markdown/engine
 */

import type { Pixels, NodeId } from './types/primitives';
import { px } from './types/primitives';
import type { SpatialDocument, SpatialNode } from './types/ast';
import type { LayoutConstraint } from './types/layout';
import type { RenderCommand } from './types/render';
import type { EngineConfig } from './config';
import { mergeConfig } from './config';

// Parser layer
import { createTokenizer } from './parser/tokenizer/index';
import type { Tokenizer } from './parser/tokenizer/index';
import { createASTBuilder } from './parser/ast/index';
import type { ASTBuilder } from './parser/ast/index';
import { runTransforms } from './parser/transforms/index';

// Engine layer
import { createMeasurementCache } from './engine/measurement/index';
import type { MeasurementCache } from './engine/measurement/index';
import { createMeasurer } from './engine/measurement/index';
import type { Measurer } from './engine/measurement/index';
import { collectTextRequests } from './engine/measurement/index';
import type { TextMeasurementRequest } from './engine/measurement/index';
import { createConstraintSolver } from './engine/constraints/index';
import type { ConstraintSolver } from './engine/constraints/index';
import { createGeometryCalculator } from './engine/geometry/index';
import type { GeometryCalculator } from './engine/geometry/index';

// Measurement context injection (forked pretext)
import { setMeasureContext } from './engine/measurement/pretext-fork/measurement.js';
import { autoDetectMeasurementContext } from './engine/measurement/auto-detect';

// Renderer layer
import { buildRenderCommands } from './renderer/command-builder';

// Bridge layer (backpressure) — lazy-loaded to avoid bundling for static usage
import type { RingBuffer } from './bridge/buffer/ring-buffer';
import type { BackpressureController } from './bridge/buffer/backpressure';
import type { StreamToken } from './types/stream';

// Scheduler
import { createFrameScheduler } from './scheduler';
import type { FrameScheduler } from './scheduler';

// ─── Viewport ────────────────────────────────────────────────────────

interface Viewport {
  width: Pixels;
  height: Pixels;
}

const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;

// ─── Public Interface ────────────────────────────────────────────────

export interface SpatialPipeline {
  /**
   * Feed a chunk of raw Spatial Markdown text into the pipeline.
   * Tokens are extracted immediately; layout and rendering are
   * deferred to the next animation frame.
   */
  readonly feed: (text: string) => void;

  /**
   * Connect to a ReadableStream of text chunks (e.g., from an LLM).
   * Each chunk is fed through `feed()` as it arrives. The stream is
   * consumed asynchronously and cannot be cancelled from here —
   * cancel the stream externally if needed.
   */
  readonly feedStream: (stream: ReadableStream<string>) => void;

  /**
   * Subscribe to render command output. The callback fires once per
   * frame with the full set of draw commands for the current state.
   *
   * @returns An unsubscribe function. Call it to remove this callback.
   */
  readonly onRender: (callback: (commands: ReadonlyArray<RenderCommand>) => void) => () => void;

  /**
   * Subscribe to pipeline errors. The callback fires when a layout
   * pass throws an exception. Without this, errors are logged to
   * console.error and silently recovered from.
   *
   * @returns An unsubscribe function. Call it to remove this callback.
   */
  readonly onError: (callback: (error: unknown) => void) => () => void;

  /**
   * Update the viewport dimensions. If the pipeline already has
   * content, the layout pass runs synchronously and subscribers
   * receive updated render commands before this call returns.
   *
   * No `flush()` or `feed()` required after resize — it just works.
   *
   * ```ts
   * renderer.resize(newWidth, newHeight);
   * pipeline.resize(newWidth, newHeight);
   * // onRender has already fired with the re-laid-out commands
   * ```
   */
  readonly resize: (width: number, height: number) => void;

  /**
   * Returns the current SpatialDocument (the live AST). This is a
   * snapshot of the document at the time of the call — it may be
   * mid-stream and contain open (streaming) nodes.
   */
  readonly getDocument: () => SpatialDocument;

  /**
   * Synchronously execute any pending layout pass. Useful for tests,
   * demos, and SSR where you need the render output immediately
   * without waiting for requestAnimationFrame.
   */
  readonly flush: () => void;

  /**
   * Tear down the pipeline. Cancels any pending animation frame,
   * clears all subscribers, and releases references. After calling
   * destroy(), the pipeline must not be used.
   */
  readonly destroy: () => void;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createPipeline(partialConfig?: Partial<EngineConfig>): SpatialPipeline {
  const config: EngineConfig = partialConfig !== undefined
    ? mergeConfig(partialConfig)
    : mergeConfig({});

  // ── Inject measurement context into forked pretext ─────────────
  //    Must happen before any measurement call.
  const measureCtx = autoDetectMeasurementContext(config.measurementContext);
  setMeasureContext(measureCtx);

  // ── Instantiate pipeline stages ────────────────────────────────

  const tokenizer: Tokenizer = createTokenizer();
  const astBuilder: ASTBuilder = createASTBuilder();
  const cache: MeasurementCache = createMeasurementCache(config.measurementCacheSize);
  const measurer: Measurer = createMeasurer(cache);
  const constraintSolver: ConstraintSolver = createConstraintSolver();
  const geometryCalc: GeometryCalculator = createGeometryCalculator();
  const scheduler: FrameScheduler = createFrameScheduler();

  // ── Mutable pipeline state ─────────────────────────────────────

  const viewport: Viewport = {
    width: px(DEFAULT_VIEWPORT_WIDTH),
    height: px(DEFAULT_VIEWPORT_HEIGHT),
  };

  /** Subscribers for render output */
  const renderSubscribers: Set<(commands: ReadonlyArray<RenderCommand>) => void> = new Set();

  /** Subscribers for error events */
  const errorSubscribers: Set<(error: unknown) => void> = new Set();

  /** Whether the pipeline has been destroyed */
  let destroyed = false;

  /**
   * Whether we have a previous constraint map from a prior layout pass.
   * When true, we can use solveDirty() for incremental updates instead
   * of a full solve().
   */
  let previousConstraints: Map<NodeId, LayoutConstraint> | null = null;

  // ── Backpressure (lazy-initialized on first feedStream call) ──

  /**
   * Stream token buffer with hysteresis-based backpressure.
   * Lazy-initialized to avoid bundling bridge code for static usage.
   */
  let streamBuffer: RingBuffer<StreamToken> | null = null;
  let backpressure: BackpressureController | null = null;

  async function ensureStreamInfra(): Promise<{
    buffer: RingBuffer<StreamToken>;
    bp: BackpressureController;
  }> {
    if (streamBuffer !== null && backpressure !== null) {
      return { buffer: streamBuffer, bp: backpressure };
    }

    const { createRingBuffer } = await import('./bridge/buffer/ring-buffer');
    const { createBackpressureController } = await import('./bridge/buffer/backpressure');

    const STREAM_BUFFER_CAPACITY = 256;
    streamBuffer = createRingBuffer(STREAM_BUFFER_CAPACITY);
    backpressure = createBackpressureController({
      highWatermark: 0.75,
      lowWatermark: 0.25,
      onPause: () => {
        // In a real integration, this would signal the WebSocket/SSE adapter
        // to pause reading from the upstream.
      },
      onResume: () => {
        // Signal to resume reading from upstream.
      },
    });

    return { buffer: streamBuffer, bp: backpressure };
  }

  // ── Core layout-and-render pass ────────────────────────────────

  /**
   * The frame callback. Runs the full layout pipeline:
   *   1. Get the current AST document
   *   2. Run AST transforms (auto-paragraph, font resolution, etc.)
   *   3. Collect dirty node IDs from the AST (ADR-007)
   *   4. Solve constraints (incremental if previous state exists)
   *   5. Collect text measurement requests (using resolved widths)
   *   6. Measure text via pretext
   *   7. Calculate geometry (bottom-up size, top-down position)
   *   8. Build render commands
   *   9. Notify subscribers
   */
  function executeLayoutPass(): void {
    if (destroyed) return;

    try {
      // 1. Snapshot the document
      const doc: SpatialDocument = astBuilder.getDocument();
      const roots = doc.children;

      if (roots.length === 0) {
        // Nothing to render — notify subscribers with empty commands
        notifySubscribers([]);
        return;
      }

      // 2. Run AST transform pipeline (auto-paragraph, font resolution, etc.)
      runTransforms(doc, config.theme);

      // 3. Collect dirty node IDs for incremental constraint solving (ADR-007)
      const dirtyNodes: Set<NodeId> = new Set();
      collectDirtyNodes(roots, dirtyNodes);

      // 4. Solve constraints — use incremental path when possible
      let constraints: Map<NodeId, LayoutConstraint>;

      if (previousConstraints !== null && dirtyNodes.size > 0) {
        // Incremental: only re-solve dirty subtrees and their descendants
        constraints = constraintSolver.solveDirty(roots, viewport, dirtyNodes, previousConstraints);
      } else {
        // Full solve: first frame, viewport change, or all nodes dirty
        constraints = constraintSolver.solve(roots, viewport);
      }

      // Cache the constraint map for incremental use next frame
      previousConstraints = constraints;

      // 5. Collect text measurement requests from ALL nodes
      const measurementRequests: TextMeasurementRequest[] = [];
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        if (root === undefined) continue;
        const nodeRequests = collectTextRequests(root, constraints, config.theme);
        for (let j = 0; j < nodeRequests.length; j++) {
          const req = nodeRequests[j];
          if (req !== undefined) {
            measurementRequests.push(req);
          }
        }
      }

      // 6. Measure text (cache-backed, pretext-powered) using real widths
      const measurements = measurer.measureNodes(measurementRequests);

      // 7. Calculate geometry (size + position)
      const boxes = geometryCalc.calculate(roots, constraints, measurements, config.theme);

      // 8. Build renderer-agnostic draw commands
      //    Pass nodeIndex so the command-builder can access AST props
      //    for structured components (MetricCard, Callout, etc.)
      const commands = buildRenderCommands(boxes, config.theme, doc.nodeIndex);

      // 9. Clear dirty flags after successful layout pass
      clearDirtyFlags(roots);

      // 10. Fire subscriber callbacks
      notifySubscribers(commands);
    } catch (error: unknown) {
      // Notify error subscribers; fall back to console.error if none.
      if (errorSubscribers.size > 0) {
        errorSubscribers.forEach((callback) => {
          callback(error);
        });
      } else {
        console.error('[SpatialPipeline] Layout pass error:', error);
      }
    }
  }

  /**
   * Fire all registered render callbacks with the given commands.
   * Iteration is safe against mid-callback unsubscription because
   * we snapshot the subscriber set via forEach.
   */
  function notifySubscribers(commands: ReadonlyArray<RenderCommand>): void {
    renderSubscribers.forEach((callback) => {
      callback(commands);
    });
  }

  // ── Dirty flag helpers (ADR-007) ──────────────────────────────

  /**
   * Walk the AST and collect all NodeIds whose dirty flags indicate
   * they need recomputation. A node is dirty if any of its dirty
   * flags are true, OR if it's a new/streaming node (status === 'streaming').
   */
  function collectDirtyNodes(roots: ReadonlyArray<SpatialNode>, result: Set<NodeId>): void {
    for (let i = 0; i < roots.length; i++) {
      const node = roots[i];
      if (node === undefined) continue;
      collectDirtyNodesRecursive(node, result);
    }
  }

  function collectDirtyNodesRecursive(node: SpatialNode, result: Set<NodeId>): void {
    const { textDirty, constraintDirty, geometryDirty, renderDirty } = node.dirty;

    // A node is dirty if any flag is set, or if it's still streaming
    if (textDirty || constraintDirty || geometryDirty || renderDirty || node.status === 'streaming') {
      result.add(node.id);
    }

    // Recurse into children for containers
    switch (node.kind) {
      case 'slide':
      case 'auto-grid':
      case 'stack':
      case 'columns':
      case 'canvas':
      case 'quote':
      case 'callout':
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (child !== undefined) {
            collectDirtyNodesRecursive(child, result);
          }
        }
        break;
      default:
        // Leaf nodes — no children
        break;
    }
  }

  /**
   * Clear all dirty flags after a successful layout pass.
   * This prevents unnecessary re-computation in subsequent frames
   * unless new changes arrive.
   */
  function clearDirtyFlags(roots: ReadonlyArray<SpatialNode>): void {
    for (let i = 0; i < roots.length; i++) {
      const node = roots[i];
      if (node === undefined) continue;
      clearDirtyFlagsRecursive(node);
    }
  }

  function clearDirtyFlagsRecursive(node: SpatialNode): void {
    node.dirty.textDirty = false;
    node.dirty.constraintDirty = false;
    node.dirty.geometryDirty = false;
    node.dirty.renderDirty = false;

    switch (node.kind) {
      case 'slide':
      case 'auto-grid':
      case 'stack':
      case 'columns':
      case 'canvas':
      case 'quote':
      case 'callout':
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (child !== undefined) {
            clearDirtyFlagsRecursive(child);
          }
        }
        break;
      default:
        break;
    }
  }

  /**
   * Mark the pipeline as needing a layout pass and schedule it
   * on the next animation frame (if not already scheduled).
   */
  function scheduleLayout(): void {
    if (destroyed) return;
    scheduler.scheduleUpdate(executeLayoutPass);
  }

  // ── Public API ─────────────────────────────────────────────────

  function feed(text: string): void {
    if (destroyed) return;
    if (text.length === 0) return;

    // a. Tokenize
    const tokens = tokenizer.feed(text);

    // b. Build AST — the builder creates nodes and sets dirty flags
    //    (geometryDirty is set on new nodes; textDirty on text appends)
    if (tokens.length > 0) {
      astBuilder.push(tokens);
    }

    // c. Schedule layout on next frame
    scheduleLayout();
  }

  function feedStream(stream: ReadableStream<string>): void {
    if (destroyed) return;

    // Lazy-init bridge infrastructure, then start pumping.
    ensureStreamInfra().then(({ buffer, bp }) => {
      if (destroyed) return;

      const reader = stream.getReader();

      function pump(): void {
        reader.read().then(
          (result) => {
            if (destroyed) {
              reader.cancel().catch(() => {
                // Swallow cancel errors after destroy
              });
              return;
            }

            if (result.done) {
              // Stream ended — flush the tokenizer to emit any trailing
              // partial content and EOF
              const finalTokens = tokenizer.flush();
              if (finalTokens.length > 0) {
                astBuilder.push(finalTokens);
                scheduleLayout();
              }
              return;
            }

            // Feed the chunk through the normal pipeline path
            feed(result.value);

            // Check backpressure after each write. If the stream buffer
            // is above the high watermark, the onPause callback has been
            // invoked (which can signal the upstream to pause). When it
            // drops below the low watermark, onResume fires.
            // We drain the stream buffer before the next pump cycle.
            while (!buffer.isEmpty()) {
              const token = buffer.read();
              if (token === undefined) break;
              // StreamToken is not yet processed here — it's available
              // for future use if a consumer wants to track offsets.
            }
            bp.check(buffer.utilization());

            // Continue pumping
            pump();
          },
          (_error: unknown) => {
            // Stream errored — flush what we have and stop.
            const finalTokens = tokenizer.flush();
            if (finalTokens.length > 0) {
              astBuilder.push(finalTokens);
              scheduleLayout();
            }
            buffer.clear();
          },
        );
      }

      pump();
    }).catch((_error: unknown) => {
      // If bridge modules fail to load, fall back to simple streaming
      // without backpressure support.
      const reader = stream.getReader();

      function simplePump(): void {
        reader.read().then(
          (result) => {
            if (destroyed) return;
            if (result.done) {
              const finalTokens = tokenizer.flush();
              if (finalTokens.length > 0) {
                astBuilder.push(finalTokens);
                scheduleLayout();
              }
              return;
            }
            feed(result.value);
            simplePump();
          },
          () => {
            const finalTokens = tokenizer.flush();
            if (finalTokens.length > 0) {
              astBuilder.push(finalTokens);
              scheduleLayout();
            }
          },
        );
      }

      simplePump();
    });
  }

  function onRender(
    callback: (commands: ReadonlyArray<RenderCommand>) => void,
  ): () => void {
    if (destroyed) {
      // Return a no-op unsubscribe
      return () => { /* destroyed */ };
    }

    renderSubscribers.add(callback);

    // If there's already content, schedule a layout pass so the new
    // subscriber gets an initial render
    const doc = astBuilder.getDocument();
    if (doc.children.length > 0) {
      scheduleLayout();
    }

    // Return unsubscribe function
    return () => {
      renderSubscribers.delete(callback);
    };
  }

  function onError(
    callback: (error: unknown) => void,
  ): () => void {
    if (destroyed) {
      return () => { /* destroyed */ };
    }

    errorSubscribers.add(callback);

    return () => {
      errorSubscribers.delete(callback);
    };
  }

  function resize(width: number, height: number): void {
    if (destroyed) return;

    const newWidth = px(Math.max(0, width));
    const newHeight = px(Math.max(0, height));

    // Skip if dimensions haven't actually changed
    if (viewport.width === newWidth && viewport.height === newHeight) {
      return;
    }

    viewport.width = newWidth;
    viewport.height = newHeight;

    // Viewport change invalidates all constraints — clear the
    // previous constraint cache to force a full solve next frame
    previousConstraints = null;

    // Mark all root nodes as dirty so the incremental solver
    // recomputes them even if they weren't individually changed
    const doc = astBuilder.getDocument();
    for (let i = 0; i < doc.children.length; i++) {
      const root = doc.children[i];
      if (root !== undefined) {
        root.dirty.constraintDirty = true;
      }
    }

    // If the AST already has content, execute the layout pass
    // synchronously so the subscriber sees the result immediately.
    // This is what makes drag-resize and animation feel instant —
    // the consumer should never have to call flush() after resize().
    //
    // If the AST is empty (no content fed yet), just schedule for
    // later — the next feed() + frame will pick it up.
    if (doc.children.length > 0) {
      executeLayoutPass();
    } else {
      scheduleLayout();
    }
  }

  function getDocument(): SpatialDocument {
    return astBuilder.getDocument();
  }

  function flush(): void {
    if (destroyed) return;

    // Flush any remaining buffered text in the tokenizer (e.g., bare text
    // that hasn't been emitted because no tag-start or newline followed it).
    const finalTokens = tokenizer.flush();
    if (finalTokens.length > 0) {
      astBuilder.push(finalTokens);
    }

    scheduler.flush();
  }

  function destroy(): void {
    if (destroyed) return;

    destroyed = true;
    scheduler.destroy();
    renderSubscribers.clear();
    errorSubscribers.clear();

    // Clear lazy stream infrastructure if it was initialized
    if (streamBuffer !== null) {
      streamBuffer.clear();
    }
  }

  return {
    feed,
    feedStream,
    onRender,
    onError,
    resize,
    getDocument,
    flush,
    destroy,
  };
}

// ─── Convenience: Synchronous one-shot render ────────────────────────

/**
 * Options for the synchronous `render()` convenience function.
 */
export interface RenderOptions {
  /** Viewport width in pixels. Default: 800. */
  readonly width?: number;
  /** Viewport height in pixels. Default: 600. */
  readonly height?: number;
  /** Theme configuration. Default: built-in light theme. */
  readonly theme?: EngineConfig['theme'];
}

/**
 * Render Spatial Markdown to draw commands in a single synchronous call.
 *
 * This is the simplest way to use the engine — no pipeline lifecycle,
 * no subscriptions, no cleanup. Feed markup in, get render commands out.
 *
 * For streaming or incremental usage, use `createPipeline()` instead.
 *
 * @param markup  - Spatial Markdown string (e.g., `<Slide><Heading level={1}>Hello</Heading></Slide>`)
 * @param options - Optional viewport dimensions and theme.
 * @returns A flat array of renderer-agnostic RenderCommands.
 *
 * @example
 * ```ts
 * import { render } from '@spatial-markdown/engine';
 *
 * const commands = render('<Slide><Heading level={1}>Hello</Heading></Slide>', {
 *   width: 800,
 *   height: 600,
 * });
 *
 * // Pass commands to any renderer:
 * // createCanvasRenderer(canvas).render(commands);
 * // createSVGRenderer().renderToString(commands, px(800), px(600));
 * ```
 */
export function render(
  markup: string,
  options?: RenderOptions,
): RenderCommand[] {
  const { width = 800, height = 600, theme } = options ?? {};

  const pipeline = createPipeline(theme !== undefined ? { theme } : undefined);
  pipeline.resize(width, height);

  let result: RenderCommand[] = [];

  pipeline.onRender((commands) => {
    // Copy the commands since we'll destroy the pipeline
    result = commands.slice() as RenderCommand[];
  });

  pipeline.feed(markup);
  pipeline.flush();
  pipeline.destroy();

  return result;
}
