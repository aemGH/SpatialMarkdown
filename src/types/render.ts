/**
 * Renderer-agnostic draw commands.
 *
 * @module @spatial/types/render
 */

import type { Pixels, NodeId, FontDescriptor } from './primitives';

/** Renderer-agnostic draw command — consumed by Canvas, SVG, and React backends. */
export type RenderCommand =
  | FillRectCommand
  | StrokeRectCommand
  | FillTextCommand
  | DrawImageCommand
  | ClipRectCommand
  | RestoreClipCommand
  | DrawLineCommand;

/** Fills a rounded rectangle with a solid color. */
export interface FillRectCommand {
  readonly kind: 'fill-rect';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly color: string;
  readonly borderRadius: Pixels;
}

/** Strokes the outline of a rounded rectangle. */
export interface StrokeRectCommand {
  readonly kind: 'stroke-rect';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly color: string;
  readonly lineWidth: Pixels;
  readonly borderRadius: Pixels;
}

/** Draws a text string at a given position with font, color, and max-width constraints. */
export interface FillTextCommand {
  readonly kind: 'fill-text';
  readonly nodeId: NodeId;
  readonly text: string;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly font: FontDescriptor;
  readonly color: string;
  readonly maxWidth: Pixels;
  readonly lineHeight: Pixels;
}

/** Draws a raster image into the specified rectangle. */
export interface DrawImageCommand {
  readonly kind: 'draw-image';
  readonly nodeId: NodeId;
  readonly src: string;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
}

/** Pushes a rectangular clip region onto the rendering context. */
export interface ClipRectCommand {
  readonly kind: 'clip-rect';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly borderRadius: Pixels;
}

/** Pops the most recent clip region, restoring the previous clipping state. */
export interface RestoreClipCommand {
  readonly kind: 'restore-clip';
  readonly nodeId: NodeId;
}

/** Draws a straight line between two points with a given color and width. */
export interface DrawLineCommand {
  readonly kind: 'draw-line';
  readonly nodeId: NodeId;
  readonly x1: Pixels;
  readonly y1: Pixels;
  readonly x2: Pixels;
  readonly y2: Pixels;
  readonly color: string;
  readonly lineWidth: Pixels;
}
