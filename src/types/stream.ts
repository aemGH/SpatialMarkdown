/**
 * Stream and bridge protocol types.
 *
 * @module @spatial/types/stream
 */

import type { Timestamp } from './primitives';

// ─── Stream Token ────────────────────────────────────────────────────

/** Raw chunk from the LLM stream, boundary-aligned */
export interface StreamToken {
  readonly kind: 'stream-token';
  readonly text: string;
  readonly offset: number;
  readonly timestamp: Timestamp;
  readonly isFinal: boolean;
}

// ─── Bridge Protocol ─────────────────────────────────────────────────

export const PROTOCOL_VERSION = 1 as const;

/** Messages from Python → TypeScript */
export type UpstreamMessage =
  | StreamChunkMessage
  | StreamEndMessage
  | StreamErrorMessage
  | ConfigUpdateMessage
  | PingMessage;

/** An incremental text chunk from the LLM stream (Python → TS). */
export interface StreamChunkMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'chunk';
  readonly seq: number;
  readonly text: string;
  readonly ts: number;
}

/** Signals that the LLM stream has terminated, with a completion reason. */
export interface StreamEndMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'end';
  readonly seq: number;
  readonly reason: 'complete' | 'cancelled' | 'max-tokens';
}

/** Reports an upstream error with a machine-readable code and human message. */
export interface StreamErrorMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'error';
  readonly seq: number;
  readonly code: string;
  readonly message: string;
}

/** Runtime configuration change (viewport resize, theme switch) from host. */
export interface ConfigUpdateMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'config';
  readonly seq: number;
  readonly viewport?: { width: number; height: number };
  readonly theme?: string;
}

/** Keep-alive ping from host — expects a matching PongMessage in return. */
export interface PingMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'ping';
  readonly seq: number;
  readonly ts: number;
}

/** Messages from TypeScript → Python (WebSocket only) */
export type DownstreamMessage =
  | BackpressurePauseMessage
  | BackpressureResumeMessage
  | AckMessage
  | PongMessage;

/** Tells the host to pause sending because the render buffer is full. */
export interface BackpressurePauseMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'pause';
  readonly reason: 'buffer-full' | 'render-behind';
  readonly bufferUtilization: number;
}

/** Tells the host it may resume sending — buffer pressure has eased. */
export interface BackpressureResumeMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'resume';
}

/** Acknowledges a processed chunk, reporting render latency for flow control. */
export interface AckMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'ack';
  readonly seq: number;
  readonly renderLatencyMs: number;
}

/** Keep-alive pong response sent back to the host. */
export interface PongMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'pong';
  readonly seq: number;
  readonly ts: number;
}
