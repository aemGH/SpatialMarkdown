/**
 * @spatial/bridge — Integration Layer
 *
 * Layer D: Python ↔ TypeScript streaming bridge.
 * Owner: @backend-architect
 *
 * Provides:
 * - Ring buffer + backpressure for flow control
 * - SSE + WebSocket adapters for transport
 * - Protocol serialization/deserialization
 * - Python SDK type contract
 */

export * from './buffer/index';
export * from './streaming/index';
export * from './python-adapter/index';
