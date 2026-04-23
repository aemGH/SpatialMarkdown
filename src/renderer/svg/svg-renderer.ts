/**
 * SVG Renderer — RenderCommand[] → SVG DOM or string output.
 *
 * Produces SVG elements from renderer-agnostic draw commands.
 * Supports both live DOM output and serialized string output
 * for server-side rendering or file export.
 *
 * @module @spatial/renderer/svg/svg-renderer
 */

import type {
  RenderCommand,
  FillRectCommand,
  StrokeRectCommand,
  FillTextCommand,
  DrawImageCommand,
  ClipRectCommand,
  DrawLineCommand,
} from '../../types/render';
import type { Pixels } from '../../types/primitives';

// ─── Constants ───────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// ─── Public Interface ────────────────────────────────────────────────

export interface SVGRenderer {
  /**
   * Render commands into an SVGElement (DOM mode).
   * Creates a fresh SVG element each call.
   */
  readonly render: (
    commands: ReadonlyArray<RenderCommand>,
    width: Pixels,
    height: Pixels,
  ) => SVGElement;

  /**
   * Render commands into an SVG string (serialization mode).
   * Useful for server-side rendering, file export, or clipboard.
   */
  readonly renderToString: (
    commands: ReadonlyArray<RenderCommand>,
    width: Pixels,
    height: Pixels,
  ) => string;
}

// ─── Clip Path Tracking ──────────────────────────────────────────────

/**
 * Manages clip path definitions and nesting during SVG construction.
 * Each ClipRectCommand opens a new <g> with a clipPath; RestoreClipCommand
 * closes the innermost <g>.
 */
interface ClipContext {
  /** Monotonically increasing counter for unique clip path IDs. */
  nextClipId: number;
  /** Stack of <defs> clip path IDs to track nesting. */
  readonly groupStack: SVGGElement[];
}

function createClipContext(): ClipContext {
  return {
    nextClipId: 0,
    groupStack: [],
  };
}

// ─── DOM Element Builders ────────────────────────────────────────────

function createSVGElement(
  tag: string,
  attrs: ReadonlyArray<readonly [string, string]>,
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of attrs) {
    el.setAttribute(key, value);
  }
  return el;
}

function buildFillRect(cmd: FillRectCommand): SVGElement {
  const attrs: Array<readonly [string, string]> = [
    ['x', String(cmd.x)],
    ['y', String(cmd.y)],
    ['width', String(cmd.width)],
    ['height', String(cmd.height)],
    ['fill', cmd.color],
  ];

  if (cmd.borderRadius > 0) {
    attrs.push(['rx', String(cmd.borderRadius)]);
    attrs.push(['ry', String(cmd.borderRadius)]);
  }

  return createSVGElement('rect', attrs);
}

function buildStrokeRect(cmd: StrokeRectCommand): SVGElement {
  const attrs: Array<readonly [string, string]> = [
    ['x', String(cmd.x)],
    ['y', String(cmd.y)],
    ['width', String(cmd.width)],
    ['height', String(cmd.height)],
    ['fill', 'none'],
    ['stroke', cmd.color],
    ['stroke-width', String(cmd.lineWidth)],
  ];

  if (cmd.borderRadius > 0) {
    attrs.push(['rx', String(cmd.borderRadius)]);
    attrs.push(['ry', String(cmd.borderRadius)]);
  }

  return createSVGElement('rect', attrs);
}

function buildFillText(cmd: FillTextCommand): SVGElement {
  const lines = cmd.text.split('\n');

  let textAnchor = 'start';
  if (cmd.align === 'right') textAnchor = 'end';
  if (cmd.align === 'center') textAnchor = 'middle';

  // Single line: simple <text> element
  if (lines.length <= 1) {
    const text = createSVGElement('text', [
      ['x', String(cmd.x)],
      ['y', String(cmd.y)],
      ['font', cmd.font],
      ['fill', cmd.color],
      ['dominant-baseline', 'text-before-edge'],
      ['text-anchor', textAnchor],
    ]);

    if (cmd.maxWidth > 0) {
      text.setAttribute('textLength', String(cmd.maxWidth));
      text.setAttribute('lengthAdjust', 'spacing');
    }

    text.textContent = lines[0] ?? '';
    return text;
  }

  // Multi-line: use <text> with <tspan> children
  const textGroup = createSVGElement('text', [
    ['font', cmd.font],
    ['fill', cmd.color],
    ['dominant-baseline', 'text-before-edge'],
    ['text-anchor', textAnchor],
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    const tspan = document.createElementNS(SVG_NS, 'tspan');
    tspan.setAttribute('x', String(cmd.x));
    tspan.setAttribute('y', String(cmd.y + cmd.lineHeight * i));
    tspan.textContent = line;
    textGroup.appendChild(tspan);
  }

  return textGroup;
}

function buildDrawImage(cmd: DrawImageCommand): SVGElement {
  const el = createSVGElement('image', [
    ['x', String(cmd.x)],
    ['y', String(cmd.y)],
    ['width', String(cmd.width)],
    ['height', String(cmd.height)],
  ]);

  // Set href via both modern and legacy attributes
  el.setAttribute('href', cmd.src);
  el.setAttributeNS(XLINK_NS, 'xlink:href', cmd.src);

  return el;
}

function buildDrawLine(cmd: DrawLineCommand): SVGElement {
  return createSVGElement('line', [
    ['x1', String(cmd.x1)],
    ['y1', String(cmd.y1)],
    ['x2', String(cmd.x2)],
    ['y2', String(cmd.y2)],
    ['stroke', cmd.color],
    ['stroke-width', String(cmd.lineWidth)],
    ['stroke-linecap', 'round'],
  ]);
}

/**
 * Opens a clipping group: creates a <clipPath> inside <defs> and
 * wraps subsequent elements in a <g clip-path="...">.
 *
 * Returns the <g> that should receive child elements.
 */
function openClipGroup(
  cmd: ClipRectCommand,
  parent: SVGElement,
  clipCtx: ClipContext,
): SVGGElement {
  const clipId = `spatial-clip-${clipCtx.nextClipId++}`;

  // Create <defs> with <clipPath>
  const defs = document.createElementNS(SVG_NS, 'defs');
  const clipPath = document.createElementNS(SVG_NS, 'clipPath');
  clipPath.setAttribute('id', clipId);

  const clipRect = createSVGElement('rect', [
    ['x', String(cmd.x)],
    ['y', String(cmd.y)],
    ['width', String(cmd.width)],
    ['height', String(cmd.height)],
  ]);

  if (cmd.borderRadius > 0) {
    clipRect.setAttribute('rx', String(cmd.borderRadius));
    clipRect.setAttribute('ry', String(cmd.borderRadius));
  }

  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);
  parent.appendChild(defs);

  // Create clipped <g>
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('clip-path', `url(#${clipId})`);
  parent.appendChild(group);

  clipCtx.groupStack.push(group);
  return group;
}

// ─── DOM-based Rendering ─────────────────────────────────────────────

function renderToDom(
  commands: ReadonlyArray<RenderCommand>,
  width: Pixels,
  height: Pixels,
): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const clipCtx = createClipContext();

  // Current target for appending elements
  function getCurrentParent(): SVGElement {
    const stackLen = clipCtx.groupStack.length;
    if (stackLen > 0) {
      const top = clipCtx.groupStack[stackLen - 1];
      if (top !== undefined) return top;
    }
    return svg;
  }

  for (const cmd of commands) {
    const parent = getCurrentParent();

    switch (cmd.kind) {
      case 'fill-rect':
        parent.appendChild(buildFillRect(cmd));
        break;

      case 'stroke-rect':
        parent.appendChild(buildStrokeRect(cmd));
        break;

      case 'fill-text':
        parent.appendChild(buildFillText(cmd));
        break;

      case 'draw-image':
        parent.appendChild(buildDrawImage(cmd));
        break;

      case 'clip-rect':
        openClipGroup(cmd, parent, clipCtx);
        break;

      case 'restore-clip':
        clipCtx.groupStack.pop();
        break;

      case 'draw-line':
        parent.appendChild(buildDrawLine(cmd));
        break;
    }
  }

  return svg;
}

// ─── String-based Rendering ──────────────────────────────────────────

/**
 * Escapes a string for safe inclusion in XML/SVG attributes.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes a string for safe inclusion as XML/SVG text content.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fillRectToString(cmd: FillRectCommand): string {
  let s = `<rect x="${cmd.x}" y="${cmd.y}" width="${cmd.width}" height="${cmd.height}" fill="${escapeAttr(cmd.color)}"`;
  if (cmd.borderRadius > 0) {
    s += ` rx="${cmd.borderRadius}" ry="${cmd.borderRadius}"`;
  }
  s += '/>';
  return s;
}

function strokeRectToString(cmd: StrokeRectCommand): string {
  let s = `<rect x="${cmd.x}" y="${cmd.y}" width="${cmd.width}" height="${cmd.height}" fill="none" stroke="${escapeAttr(cmd.color)}" stroke-width="${cmd.lineWidth}"`;
  if (cmd.borderRadius > 0) {
    s += ` rx="${cmd.borderRadius}" ry="${cmd.borderRadius}"`;
  }
  s += '/>';
  return s;
}

function fillTextToString(cmd: FillTextCommand): string {
  const lines = cmd.text.split('\n');
  const fontAttr = escapeAttr(cmd.font);
  const colorAttr = escapeAttr(cmd.color);

  let textAnchor = 'start';
  if (cmd.align === 'right') textAnchor = 'end';
  if (cmd.align === 'center') textAnchor = 'middle';

  if (lines.length <= 1) {
    const textContent = escapeText(lines[0] ?? '');
    return `<text x="${cmd.x}" y="${cmd.y}" font="${fontAttr}" fill="${colorAttr}" dominant-baseline="text-before-edge" text-anchor="${textAnchor}">${textContent}</text>`;
  }

  // Multi-line with <tspan>s
  let s = `<text font="${fontAttr}" fill="${colorAttr}" dominant-baseline="text-before-edge" text-anchor="${textAnchor}">`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const yPos = cmd.y + cmd.lineHeight * i;
    s += `<tspan x="${cmd.x}" y="${yPos}">${escapeText(line)}</tspan>`;
  }
  s += '</text>';
  return s;
}

function drawImageToString(cmd: DrawImageCommand): string {
  return `<image x="${cmd.x}" y="${cmd.y}" width="${cmd.width}" height="${cmd.height}" href="${escapeAttr(cmd.src)}"/>`;
}

function drawLineToString(cmd: DrawLineCommand): string {
  return `<line x1="${cmd.x1}" y1="${cmd.y1}" x2="${cmd.x2}" y2="${cmd.y2}" stroke="${escapeAttr(cmd.color)}" stroke-width="${cmd.lineWidth}" stroke-linecap="round"/>`;
}

function clipRectToStringOpen(cmd: ClipRectCommand, clipId: string): string {
  let clipRect = `<rect x="${cmd.x}" y="${cmd.y}" width="${cmd.width}" height="${cmd.height}"`;
  if (cmd.borderRadius > 0) {
    clipRect += ` rx="${cmd.borderRadius}" ry="${cmd.borderRadius}"`;
  }
  clipRect += '/>';

  return `<defs><clipPath id="${clipId}">${clipRect}</clipPath></defs><g clip-path="url(#${clipId})">`;
}

function renderToSvgString(
  commands: ReadonlyArray<RenderCommand>,
  width: Pixels,
  height: Pixels,
): string {
  const parts: string[] = [];
  let clipIdCounter = 0;

  parts.push(
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );

  for (const cmd of commands) {
    switch (cmd.kind) {
      case 'fill-rect':
        parts.push(fillRectToString(cmd));
        break;

      case 'stroke-rect':
        parts.push(strokeRectToString(cmd));
        break;

      case 'fill-text':
        parts.push(fillTextToString(cmd));
        break;

      case 'draw-image':
        parts.push(drawImageToString(cmd));
        break;

      case 'clip-rect': {
        const clipId = `spatial-clip-${clipIdCounter++}`;
        parts.push(clipRectToStringOpen(cmd, clipId));
        break;
      }

      case 'restore-clip':
        parts.push('</g>');
        break;

      case 'draw-line':
        parts.push(drawLineToString(cmd));
        break;
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

// ─── Renderer Factory ────────────────────────────────────────────────

/**
 * Creates an SVG rendering backend.
 *
 * Supports two output modes:
 * - `render()` — returns an SVGElement for DOM insertion.
 * - `renderToString()` — returns a serialized SVG string for SSR or export.
 *
 * @returns An SVGRenderer instance.
 *
 * @example
 * ```ts
 * const renderer = createSVGRenderer();
 * const svgEl = renderer.render(commands, px(800), px(600));
 * document.body.appendChild(svgEl);
 *
 * // Or for string output:
 * const svgString = renderer.renderToString(commands, px(800), px(600));
 * ```
 */
export function createSVGRenderer(): SVGRenderer {
  return {
    render(
      commands: ReadonlyArray<RenderCommand>,
      width: Pixels,
      height: Pixels,
    ): SVGElement {
      return renderToDom(commands, width, height);
    },

    renderToString(
      commands: ReadonlyArray<RenderCommand>,
      width: Pixels,
      height: Pixels,
    ): string {
      return renderToSvgString(commands, width, height);
    },
  };
}
