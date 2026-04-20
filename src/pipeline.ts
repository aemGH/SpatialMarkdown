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

// Renderer layer
import { buildRenderCommands } from './renderer/command-builder';

// Bridge layer (backpressure)
import { createRingBuffer } from './bridge/buffer/ring-buffer';
import type { RingBuffer } from './bridge/buffer/ring-buffer';
import { createBackpressureController } from './bridge/buffer/backpressure';
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
   * Update the viewport dimensions. Triggers a full re-layout on the
   * next animation frame.
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

  /** Whether the pipeline has been destroyed */
  let destroyed = false;

  /**
   * Whether we have a previous constraint map from a prior layout pass.
   * When true, we can use solveDirty() for incremental updates instead
   * of a full solve().
   */
  let previousConstraints: Map<NodeId, LayoutConstraint> | null = null;

  // ── Backpressure ──────────────────────────────────────────────

  /**
   * Stream token buffer with hysteresis-based backpressure.
   * When the buffer fills past the high watermark, the backpressure
   * controller signals pause to the upstream producer.
   */
  const STREAM_BUFFER_CAPACITY = 256;
  const streamBuffer: RingBuffer<StreamToken> = createRingBuffer(STREAM_BUFFER_CAPACITY);
  const backpressure: BackpressureController = createBackpressureController({
    highWatermark: 0.75,
    lowWatermark: 0.25,
    onPause: () => {
      // In a real integration, this would signal the WebSocket/SSE adapter
      // to pause reading from the upstream. For now, we simply stop
      // reading from the buffer until utilization drops.
    },
    onResume: () => {
      // Signal to resume reading from upstream.
    },
  });

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
      // Log but don't crash the pipeline — the next feed() will
      // schedule another layout pass that may succeed.
      console.error('[SpatialPipeline] Layout pass error:', error);
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
          while (!streamBuffer.isEmpty()) {
            const token = streamBuffer.read();
            if (token === undefined) break;
            // StreamToken is not yet processed here — it's available
            // for future use if a consumer wants to track offsets.
          }
          backpressure.check(streamBuffer.utilization());

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
          streamBuffer.clear();
        },
      );
    }

    pump();
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

    // A viewport change invalidates all constraints — schedule re-layout
    scheduleLayout();
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
  }

  return {
    feed,
    feedStream,
    onRender,
    resize,
    getDocument,
    flush,
    destroy,
  };
}
