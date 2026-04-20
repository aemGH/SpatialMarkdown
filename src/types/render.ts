/**
 * Renderer-agnostic draw commands.
 *
 * @module @spatial/types/render
 */

import type { Pixels, NodeId, FontDescriptor } from './primitives';

export type RenderCommand =
  | FillRectCommand
  | StrokeRectCommand
  | FillTextCommand
  | DrawImageCommand
  | ClipRectCommand
  | RestoreClipCommand
  | DrawLineCommand;

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

export interface DrawImageCommand {
  readonly kind: 'draw-image';
  readonly nodeId: NodeId;
  readonly src: string;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
}

export interface ClipRectCommand {
  readonly kind: 'clip-rect';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly borderRadius: Pixels;
}

export interface RestoreClipCommand {
  readonly kind: 'restore-clip';
  readonly nodeId: NodeId;
}

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
