/**
 * TypeScript type contract mirroring the Python SDK API surface.
 *
 * These types define the shape of configuration, request, and response
 * objects exchanged between the Python SDK and the TypeScript engine.
 * The Python SDK should generate JSON payloads conforming to these
 * interfaces — any drift is a protocol contract violation.
 *
 * These are pure type declarations (no runtime code) to keep the
 * Python adapter layer zero-cost at bundle time.
 *
 * @module @spatial/bridge/python-adapter/python-sdk-types
 */

// ─── SDK Configuration ───────────────────────────────────────────────

/** Configuration for the Python SDK connection to the TS engine. */
export interface PythonSDKConfig {
  /** WebSocket or SSE endpoint URL. */
  readonly endpoint: string;

  /** Transport mechanism — WebSocket for bidirectional, SSE for unidirectional. */
  readonly transport: 'ws' | 'sse';

  /** Optional viewport dimensions for initial layout constraint. */
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
}

// ─── Render Request ──────────────────────────────────────────────────

/**
 * A render request sent from the Python SDK to the TS engine.
 * Contains the Spatial Markdown content string and optional
 * config overrides for this specific render pass.
 */
export interface PythonRenderRequest {
  /** Spatial Markdown content to parse and render. */
  readonly content: string;

  /** Optional per-request config overrides (merged with the global SDK config). */
  readonly config?: Partial<PythonSDKConfig> | undefined;
}

// ─── Render Response ─────────────────────────────────────────────────

/**
 * Response returned from the TS engine to the Python SDK after
 * a render pass completes (or fails).
 */
export interface PythonRenderResponse {
  /** 'ok' on successful render, 'error' if the render pass failed. */
  readonly status: 'ok' | 'error';

  /** Wall-clock time for the full render pipeline in milliseconds. */
  readonly renderTimeMs: number;

  /** Total number of layout nodes produced by the render pass. */
  readonly nodeCount: number;
}
