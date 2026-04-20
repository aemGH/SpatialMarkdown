/**
 * AST text extraction for measurement.
 *
 * Walks a `SpatialNode` tree and produces one `TextMeasurementRequest`
 * per text-bearing node. The measurer uses these requests to drive
 * `pretext.prepare()` + `pretext.layout()`.
 *
 * Text-bearing node kinds:
 *   text, heading, code-block, quote, callout, data-table, chart
 *
 * Container-only nodes (slide, auto-grid, stack, columns, canvas) and
 * non-text primitives (spacer, divider, image, metric-card) are skipped
 * — they get their geometry from constraints and children, not text
 * measurement.
 *
 * @module @spatial/engine/measurement/text-collector
 */

import type { SpatialNode, TextBuffer } from '../../types/ast';
import type { Pixels, NodeId, FontDescriptor } from '../../types/primitives';
import type { LayoutConstraint } from '../../types/layout';
import type { ThemeConfig } from '../../types/theme';
import { px } from '../../types/primitives';
import { getNodePadding } from '../geometry/box-model';
import { resolveHeadingWidth, resolveProseWidth } from '../readable-width';
import {
  METRIC_VALUE_FONT,
  METRIC_VALUE_LINE_HEIGHT,
} from '../../types/layout-constants';

// ─── Request Type ────────────────────────────────────────────────────

export interface TextMeasurementRequest {
  readonly nodeId: NodeId;
  readonly text: string;
  readonly font: FontDescriptor;
  readonly maxWidth: Pixels;
  readonly lineHeight: Pixels;
  readonly whiteSpace: 'normal' | 'pre-wrap';
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_MAX_WIDTH: Pixels = px(Infinity);

function resolveHeadingFont(node: Extract<SpatialNode, { kind: 'heading' }>, theme: ThemeConfig): FontDescriptor {
  switch (node.props.level) {
    case 1:
      return theme.fonts.h1;
    case 2:
      return theme.fonts.h2;
    case 3:
      return theme.fonts.h3;
    default:
      return theme.fonts.heading;
  }
}

function resolveHeadingLineHeight(node: Extract<SpatialNode, { kind: 'heading' }>, theme: ThemeConfig): Pixels {
  return node.props.level === 1 ? theme.lineHeights.display : theme.lineHeights.heading;
}

function resolveMeasureWidth(node: SpatialNode, maxWidth: Pixels, theme: ThemeConfig): Pixels {
  switch (node.kind) {
    case 'text':
      return resolveProseWidth(maxWidth, theme);
    case 'heading':
      return resolveHeadingWidth(maxWidth, theme);
    case 'quote':
    case 'callout':
      return resolveProseWidth(maxWidth, theme);
    default:
      return maxWidth;
  }
}

// ─── Collector ───────────────────────────────────────────────────────

/**
 * Recursively collect `TextMeasurementRequest`s from a spatial AST node
 * and all of its descendants.
 *
 * Only nodes with a `textBuffer` that has content produce a request.
 * Children of container nodes are walked recursively. The `maxWidth` for
 * leaf requests is taken from the `constraints` map; if missing, it
 * defaults to `Infinity`.
 */
export function collectTextRequests(
  node: SpatialNode,
  constraints: Map<NodeId, LayoutConstraint>,
  theme: ThemeConfig,
): ReadonlyArray<TextMeasurementRequest> {
  const requests: TextMeasurementRequest[] = [];
  collectFromNode(node, constraints, theme, requests);
  return requests;
}

// ─── Internal Walk ───────────────────────────────────────────────────

function collectFromNode(
  node: SpatialNode,
  constraints: Map<NodeId, LayoutConstraint>,
  theme: ThemeConfig,
  out: TextMeasurementRequest[],
): void {
  const constraint = constraints.get(node.id);
  const availableWidth = constraint?.availableWidth ?? DEFAULT_MAX_WIDTH;
  const padding = getNodePadding(node);
  const maxWidth = px(Math.max(0, availableWidth - padding.left - padding.right));
  const measureWidth = resolveMeasureWidth(node, maxWidth, theme);

  switch (node.kind) {
    // ── Text-bearing primitives ───────────────────────────────────
    case 'text': {
      const text = extractText(node.textBuffer);
      if (text.trim() !== '') {
        out.push({
          nodeId: node.id,
          text,
          font: node.props.font,
          maxWidth: measureWidth,
          lineHeight: node.props.lineHeight,
          whiteSpace: node.props.whiteSpace,
        });
      }
      return;
    }

    case 'heading': {
      const text = extractText(node.textBuffer);
      if (text !== '') {
        out.push({
          nodeId: node.id,
          text,
          font: resolveHeadingFont(node, theme),
          maxWidth: measureWidth,
          lineHeight: resolveHeadingLineHeight(node, theme),
          whiteSpace: 'normal',
        });
      }
      return;
    }

    case 'code-block': {
      const text = extractRawText(node.textBuffer);
      if (text !== '') {
        // Account for line number gutter (32px) when measuring code width
        const lineNumberGutter = node.props.showLineNumbers ? px(32) : px(0);
        const codeMaxWidth = px(Math.max(0, maxWidth - lineNumberGutter));
        out.push({
          nodeId: node.id,
          text,
          font: node.props.font,
          maxWidth: codeMaxWidth,
          lineHeight: node.props.lineHeight,
          whiteSpace: 'pre-wrap', // Always preserve newlines in code blocks
        });
      }
      return;
    }

    // ── Content components with text + children ───────────────────
    case 'quote': {
      const text = extractText(node.textBuffer);
      if (text !== '') {
        out.push({
          nodeId: node.id,
          text,
          font: node.props.font,
          maxWidth: measureWidth,
          lineHeight: node.props.lineHeight,
          whiteSpace: 'normal',
        });
      }
      for (const child of node.children) {
        collectFromNode(child, constraints, theme, out);
      }
      return;
    }

    case 'callout': {
      const text = extractText(node.textBuffer);
      if (text !== '') {
        out.push({
          nodeId: node.id,
          text,
          font: theme.fonts.body,
          maxWidth: measureWidth,
          lineHeight: theme.lineHeights.body,
          whiteSpace: 'normal',
        });
      }
      for (const child of node.children) {
        collectFromNode(child, constraints, theme, out);
      }
      return;
    }

    case 'data-table': {
      const text = extractText(node.textBuffer);
      if (text !== '') {
        out.push({
          nodeId: node.id,
          text,
          font: node.props.font,
          maxWidth,
          lineHeight: node.props.lineHeight,
          whiteSpace: 'normal',
        });
      }
      return;
    }

    case 'chart': {
      // Chart textBuffer contains serialised data; measure for label sizing.
      const text = extractText(node.textBuffer);
      if (text !== '') {
        out.push({
          nodeId: node.id,
          text,
          font: theme.fonts.caption,
          maxWidth,
          lineHeight: theme.lineHeights.caption,
          whiteSpace: 'normal',
        });
      }
      return;
    }

    // ── Layout containers — recurse only ──────────────────────────
    case 'slide':
    case 'auto-grid':
    case 'stack':
    case 'columns':
    case 'canvas': {
      for (const child of node.children) {
        collectFromNode(child, constraints, theme, out);
      }
      return;
    }

    // ── MetricCard — synthesize measurement text from props ─────
    case 'metric-card': {
      // MetricCard has no textBuffer; its display content lives in props.
      // Compose a synthetic string for pretext to measure so the geometry
      // calculator can size the card correctly.
      const mp = node.props;
      const parts: string[] = [mp.label, mp.value];
      if (mp.delta !== undefined) {
        parts.push(mp.delta);
      }
      const syntheticText = parts.join('\n');
      if (syntheticText.length > 0) {
        out.push({
          nodeId: node.id,
          text: syntheticText,
          font: METRIC_VALUE_FONT,
          maxWidth,
          lineHeight: METRIC_VALUE_LINE_HEIGHT,
          whiteSpace: 'normal',
        });
      }
      return;
    }


    // ── Non-text primitives — no measurement needed ───────────────
    case 'spacer':
    case 'divider':
    case 'image': {
      return;
    }
  }

  // Exhaustive check — TypeScript will error here if a new NodeKind is
  // added to the union but not handled above.
  const _exhaustive: never = node;
  return _exhaustive;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Strip common Markdown inline formatting that LLMs often inject:
 *   **bold** → bold
 *   __bold__ → bold
 *   *italic* → italic
 *   _italic_ → italic
 *   `code` → code
 *   [text](url) → text
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')    // **bold**
    .replace(/__(.+?)__/g, '$1')          // __bold__
    .replace(/\*(.+?)\*/g, '$1')          // *italic*
    .replace(/_(.+?)_/g, '$1')            // _italic_
    .replace(/`([^`]+)`/g, '$1')          // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url)
    .replace(/<br\s*\/?>/gi, '\n')        // <br /> → newline
    .replace(/<[^>]+>/g, '');             // strip all remaining HTML tags
}

function extractText(buffer: TextBuffer): string {
  return stripMarkdown(buffer.raw);
}

function extractRawText(buffer: TextBuffer): string {
  return buffer.raw;
}
