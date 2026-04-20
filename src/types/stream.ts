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

export interface StreamChunkMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'chunk';
  readonly seq: number;
  readonly text: string;
  readonly ts: number;
}

export interface StreamEndMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'end';
  readonly seq: number;
  readonly reason: 'complete' | 'cancelled' | 'max-tokens';
}

export interface StreamErrorMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'error';
  readonly seq: number;
  readonly code: string;
  readonly message: string;
}

export interface ConfigUpdateMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'config';
  readonly seq: number;
  readonly viewport?: { width: number; height: number };
  readonly theme?: string;
}

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

export interface BackpressurePauseMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'pause';
  readonly reason: 'buffer-full' | 'render-behind';
  readonly bufferUtilization: number;
}

export interface BackpressureResumeMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'resume';
}

export interface AckMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'ack';
  readonly seq: number;
  readonly renderLatencyMs: number;
}

export interface PongMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'pong';
  readonly seq: number;
  readonly ts: number;
}
