/**
 * Branded primitive types for the Spatial Markdown Engine.
 * Prevents mixing px with unitless numbers, node IDs with raw ints, etc.
 *
 * @module @spatial/types/primitives
 */

/** Pixel value — prevents mixing px with unitless numbers */
export type Pixels = number & { readonly __brand: 'Pixels' };

/** Millisecond timestamp */
export type Timestamp = number & { readonly __brand: 'Timestamp' };

/** Monotonically increasing ID for nodes */
export type NodeId = number & { readonly __brand: 'NodeId' };

/** Frame sequence number */
export type FrameId = number & { readonly __brand: 'FrameId' };

/** CSS font shorthand string (e.g., '16px Inter') */
export type FontDescriptor = string & { readonly __brand: 'FontDescriptor' };

// ─── Constructor Helpers ─────────────────────────────────────────────

export function px(n: number): Pixels {
  return n as Pixels;
}

export function nodeId(n: number): NodeId {
  return n as NodeId;
}

export function frameId(n: number): FrameId {
  return n as FrameId;
}

export function timestamp(n: number): Timestamp {
  return n as Timestamp;
}

export function font(s: string): FontDescriptor {
  return s as FontDescriptor;
}

// ─── Geometry Primitives ─────────────────────────────────────────────

export interface Rect {
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
}

export interface EdgeInsets {
  readonly top: Pixels;
  readonly right: Pixels;
  readonly bottom: Pixels;
  readonly left: Pixels;
}
