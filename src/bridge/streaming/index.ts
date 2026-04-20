/**
 * Streaming Adapters — SSE + WebSocket transport + protocol
 *
 * @module @spatial/bridge/streaming
 */

export {
  serializeDownstream,
  deserializeUpstream,
  validateProtocolVersion,
} from './stream-protocol';

export type { SSEAdapter } from './sse-adapter';
export { createSSEAdapter } from './sse-adapter';

export type { WSAdapter } from './ws-adapter';
export { createWSAdapter } from './ws-adapter';
