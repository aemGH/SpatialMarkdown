/**
 * Ring Buffer + Backpressure — Stream flow control
 *
 * @module @spatial/bridge/buffer
 */

export type { RingBuffer } from './ring-buffer';
export { createRingBuffer } from './ring-buffer';

export type { BackpressureController, BackpressureOptions } from './backpressure';
export { createBackpressureController } from './backpressure';
