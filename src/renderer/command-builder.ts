/**
 * Command Builder — Converts LayoutBox tree → flat RenderCommand[].
 *
 * Walks the LayoutBox tree depth-first, emitting renderer-agnostic draw
 * commands that can be consumed by any backend (Canvas, SVG, React).
 *
 * @module @spatial/renderer/command-builder
 */

import type { LayoutBox, MeasurementResult, LineDetailMeasurement } from '../types/layout';
import type { NodeKind, SpatialNode, MetricCardProps, CalloutProps, DividerProps, QuoteProps, CodeBlockProps, ImageProps, DataTableProps, ChartProps } from '../types/ast';
import type { ThemeConfig } from '../types/theme';
import type {
  RenderCommand,
  FillRectCommand,
  DrawImageCommand,
  ClipRectCommand,
  RestoreClipCommand,
} from '../types/render';
import type { Pixels, FontDescriptor, NodeId } from '../types/primitives';
import { px } from '../types/primitives';
import {
  METRIC_VALUE_FONT,
  METRIC_DELTA_FONT,
  METRIC_FOOTER_FONT,
  METRIC_VALUE_LINE_HEIGHT,
  METRIC_DELTA_LINE_HEIGHT,
  METRIC_FOOTER_LINE_HEIGHT,
  METRIC_VALUE_DELTA_GAP,
  METRIC_DELTA_FOOTER_GAP,
  CALLOUT_TITLE_FONT,
  CALLOUT_TITLE_LINE_HEIGHT,
  QUOTE_FONT,
  QUOTE_LINE_HEIGHT,
  QUOTE_CITE_FONT,
  QUOTE_CITE_LINE_HEIGHT,
  TABLE_HEADER_FONT,
  TABLE_BODY_FONT,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
  TABLE_ROW_HEIGHT_COMPACT,
  TABLE_CELL_PADDING_X,
  CHART_TITLE_FONT,
  CHART_TITLE_LINE_HEIGHT,
  CHART_LABEL_FONT,
  CHART_LABEL_LINE_HEIGHT,
  CHART_LEGEND_HEIGHT,
  CHART_AXIS_LABEL_HEIGHT
} from '../types/layout-constants';
import { resolveHeadingWidth, resolveProseWidth } from '../engine/readable-width';

// ─── Theme-based Background Color Mapping ────────────────────────────

/**
 * Extracts the background color from a SpatialNode's props, if the node
 * kind has a background property. Returns undefined for nodes without
 * a background prop.
 */
function getNodeBackground(node: SpatialNode): string | undefined {
  switch (node.kind) {
    case 'slide':
      return node.props.background;
    case 'canvas':
      return node.props.background;
    case 'metric-card':
      return node.props.background;
    case 'code-block':
      return node.props.background;
    case 'callout':
      // Callout doesn't have a background prop — its background comes from the theme
      return undefined;
    case 'quote':
      // Quote doesn't have a background prop — uses theme surface
      return undefined;
    default:
      return undefined;
  }
}


/**
 * Returns the background color for a given node kind, or null if no
 * background should be painted.
 */
function getBackgroundColor(
  kind: NodeKind,
  theme: ThemeConfig,
): string | null {
  switch (kind) {
    case 'slide':
      return theme.colors.background;
    case 'metric-card':
    case 'code-block':
      return theme.colors.surface;
    case 'callout':
      // Callout gets a more subtle tinted background
      return `${theme.colors.info}0D`;
    case 'quote':
      return theme.colors.surface;
    case 'canvas':
      return theme.colors.background;
    // DataTable and Chart paint their own backgrounds inside dedicated
    // emitters (header row tint, alternating stripes, plot frame, etc.).
    case 'data-table':
    case 'chart':
    // Layout containers without explicit backgrounds
    case 'auto-grid':
    case 'stack':
    case 'columns':
    // Primitives without backgrounds
    case 'text':
    case 'heading':
    case 'spacer':
    case 'divider':
    case 'image':
      return null;
  }
}

/**
 * Determines whether a node kind carries text content that should
 * be rendered via a generic FillTextCommand from measurement data.
 *
 * MetricCard and Callout are excluded here — they have dedicated
 * rendering functions that handle their structured content.
 */
function isTextBearing(kind: NodeKind): boolean {
  switch (kind) {
    case 'text':
    case 'heading':
      return true;
    // MetricCard, Callout, Quote, and CodeBlock are rendered by dedicated emitters
    case 'code-block':
    case 'quote':
    case 'callout':
    case 'metric-card':
    case 'slide':
    case 'auto-grid':
    case 'stack':
    case 'columns':
    case 'canvas':
    case 'data-table':
    case 'chart':
    case 'spacer':
    case 'divider':
    case 'image':
      return false;
  }
}

/**
 * Returns the font descriptor for a given node kind from the theme.
 */
function getFontForKind(
  kind: NodeKind,
  theme: ThemeConfig,
  node?: SpatialNode
): FontDescriptor {
  switch (kind) {
    case 'heading': {
      if (node && node.kind === 'heading') {
        const level = node.props.level;
        if (level === 1) return theme.fonts.h1;
        if (level === 2) return theme.fonts.h2;
        if (level === 3) return theme.fonts.h3;
      }
      return theme.fonts.heading;
    }
    case 'code-block':
      return theme.fonts.mono;
    case 'text':
    case 'quote':
    case 'callout':
    case 'metric-card':
      return theme.fonts.body;
    default:
      return theme.fonts.body;
  }
}

/**
 * Returns the line height for a given node kind from the theme.
 */
function getLineHeightForKind(
  kind: NodeKind,
  theme: ThemeConfig,
  node?: SpatialNode
): Pixels {
  switch (kind) {
    case 'heading': {
      if (node && node.kind === 'heading') {
        const level = node.props.level;
        if (level === 1) return theme.lineHeights.display;
      }
      return theme.lineHeights.heading;
    }
    case 'code-block':
      return theme.lineHeights.mono;
    case 'text':
    case 'quote':
    case 'callout':
    case 'metric-card':
      return theme.lineHeights.body;
    default:
      return theme.lineHeights.body;
  }
}

/**
 * Returns the text color for a given node kind from the theme.
 */
function getTextColor(
  kind: NodeKind,
  theme: ThemeConfig,
  node?: SpatialNode
): string {
  switch (kind) {
    case 'heading': {
      if (node && node.kind === 'heading') {
        if (node.props.level === 1) return theme.colors.accent;
      }
      return theme.colors.text;
    }
    case 'code-block':
      return theme.colors.text;
    case 'text':
    case 'quote':
    case 'callout':
    case 'metric-card':
      return theme.colors.text;
    default:
      return theme.colors.text;
  }
}

/**
 * Returns the default border radius for a given node kind.
 */
function getBorderRadius(kind: NodeKind, theme: ThemeConfig): Pixels {
  switch (kind) {
    case 'metric-card':
    case 'callout':
    case 'code-block':
      return theme.spacing.sm;
    case 'slide':
    case 'canvas':
      return px(0);
    default:
      return px(0);
  }
}

// ─── Measurement Helpers ─────────────────────────────────────────────

function isLineDetail(m: MeasurementResult): m is LineDetailMeasurement {
  return m.kind === 'line-detail';
}

// ─── Text Emission ──────────────────────────────────────────────────

/**
 * Emits one FillTextCommand per line of text in the measurement.
 */
function emitTextLines(
  box: LayoutBox,
  measurement: MeasurementResult,
  font: FontDescriptor,
  color: string,
  lineHeight: Pixels,
  startY: Pixels,
  out: RenderCommand[],
  x: Pixels,
  maxWidth: Pixels,
): void {
  if (isLineDetail(measurement)) {
    measurement.lines.forEach((line, index) => {
      out.push({
        kind: 'fill-text',
        nodeId: box.nodeId,
        text: line.text,
        x: x,
        y: px(startY + index * lineHeight),
        font,
        color,
        maxWidth,
        lineHeight,
      });
    });
  }
}

// ─── Command Emitters ────────────────────────────────────────────────

function emitFillRect(
  box: LayoutBox,
  color: string,
  borderRadius: Pixels,
): FillRectCommand {
  return {
    kind: 'fill-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color,
    borderRadius,
  };
}

function emitClipRect(box: LayoutBox, borderRadius: Pixels): ClipRectCommand {
  return {
    kind: 'clip-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    borderRadius,
  };
}

function emitRestoreClip(box: LayoutBox): RestoreClipCommand {
  return {
    kind: 'restore-clip',
    nodeId: box.nodeId,
  };
}

// removed emitFillText and emitDrawLine

function emitDrawImage(box: LayoutBox, src: string): DrawImageCommand {
  return {
    kind: 'draw-image',
    nodeId: box.nodeId,
    src,
    x: box.contentX,
    y: box.contentY,
    width: box.contentWidth,
    height: box.contentHeight,
  };
}

// ─── Core Tree Walker ────────────────────────────────────────────────

function getRenderTextMaxWidth(
  box: LayoutBox,
  kind: NodeKind,
  theme: ThemeConfig,
  node?: SpatialNode,
): Pixels {
  if (kind === 'text') {
    return resolveProseWidth(box.contentWidth, theme);
  }

  if (kind === 'heading' && node?.kind === 'heading') {
    return resolveHeadingWidth(box.contentWidth, theme);
  }

  return box.contentWidth;
}

/**
 * True when a node (recursively) contains no actual visible content.
 * A subtree counts as empty when every descendant is either a whitespace
 * text node, an empty primitive (Spacer/Divider aside), or another empty
 * container. Used to detect LLM-emitted ghost components.
 */
function hasAnyRenderableContent(node: SpatialNode): boolean {
  // Anything with a non-whitespace textBuffer is real content.
  if ('textBuffer' in node && node.textBuffer.raw.trim().length > 0) {
    return true;
  }

  // Primitives that always paint something regardless of text.
  if (node.kind === 'divider' || node.kind === 'image' || node.kind === 'metric-card' || node.kind === 'chart' || node.kind === 'data-table' || node.kind === 'spacer') {
    // MetricCard/Chart/DataTable always have attribute-driven visuals.
    // Divider/Image are always renderable. Spacer is invisible but is a
    // deliberate layout tool — counts as "intentional content".
    return true;
  }

  // Recurse into children.
  if ('children' in node) {
    for (const child of node.children) {
      if (hasAnyRenderableContent(child)) return true;
    }
  }

  return false;
}

/**
 * Determine whether a content component is "empty" — produced by the LLM
 * without any actual content. We skip background + border rendering for
 * these nodes so they don't manifest as ghost boxes on the canvas.
 *
 * A component is considered empty when:
 *   - Callout:    no title AND no body text AND no renderable descendants
 *   - Quote:      no body text AND no cite AND no renderable descendants
 *   - CodeBlock:  no body text AND no title
 *   - DataTable:  no body rows (the header alone isn't enough to be useful)
 *   - Chart:      no body data lines
 *   - MetricCard: always populated via required attributes (never empty)
 */
function isEmptyContentComponent(node: SpatialNode | undefined): boolean {
  if (node === undefined) return false;
  switch (node.kind) {
    case 'callout': {
      const hasTitle = node.props.title.length > 0;
      const hasBody = node.textBuffer.raw.trim().length > 0;
      if (hasTitle || hasBody) return false;
      return !node.children.some(hasAnyRenderableContent);
    }
    case 'quote': {
      const hasBody = node.textBuffer.raw.trim().length > 0;
      const hasCite = node.props.cite !== undefined && node.props.cite.length > 0;
      if (hasBody || hasCite) return false;
      return !node.children.some(hasAnyRenderableContent);
    }
    case 'code-block': {
      const hasBody = node.textBuffer.raw.trim().length > 0;
      const hasTitle = node.props.title !== undefined && node.props.title.length > 0;
      return !hasBody && !hasTitle;
    }
    case 'data-table': {
      // Skip when there are no data rows (header alone = not a useful table).
      const raw = node.textBuffer.raw;
      if (raw.trim().length === 0) return true;
      for (const line of raw.split('\n')) {
        if (line.trim().length > 0) return false;
      }
      return true;
    }
    case 'chart': {
      // Need at least a header line + one data line to draw anything.
      const raw = node.textBuffer.raw;
      const lines = raw.split('\n').filter(l => l.trim().length > 0);
      return lines.length < 2;
    }
    default:
      return false;
  }
}

/**
 * Recursively walks a single LayoutBox, appending RenderCommands to the output array.
 */
function walkBox(
  box: LayoutBox,
  theme: ThemeConfig,
  nodeIndex: ReadonlyMap<NodeId, SpatialNode>,
  out: RenderCommand[],
): void {
  const { kind } = box;
  const astNode = nodeIndex.get(box.nodeId);

  // Skip ghost/empty content components — an LLM-emitted <Callout /> or
  // <Quote></Quote> would otherwise render as a confusing outlined box.
  const isEmpty = isEmptyContentComponent(astNode);

  // 1. Background fill & Border
  let bgColor: string | null = getBackgroundColor(kind, theme);

  // Override with AST props background if provided
  if (astNode !== undefined) {
    const propsBg = getNodeBackground(astNode);
    if (propsBg !== undefined && propsBg !== 'transparent') {
      bgColor = propsBg;
    }
  }

  if (!isEmpty && bgColor !== null && bgColor !== 'transparent') {
    const borderRadius = getBorderRadius(kind, theme);
    out.push(emitFillRect(box, bgColor, borderRadius));

    if (kind === 'metric-card' || kind === 'callout' || kind === 'code-block' || kind === 'quote') {
      out.push({
        kind: 'stroke-rect',
        nodeId: box.nodeId,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        color: theme.colors.border,
        lineWidth: px(1),
        borderRadius,
      });
    }
  }

  // 2. Clipping
  if (box.clipChildren) {
    const borderRadius = getBorderRadius(kind, theme);
    out.push(emitClipRect(box, borderRadius));
  }

  // 3. Divider (before children, since divider is a leaf)
  if (kind === 'divider') {
    if (astNode !== undefined && astNode.kind === 'divider') {
      emitDividerCommands(box, astNode.props, theme, out);
    } else {
      emitDividerCommands(box, undefined, theme, out);
    }
  }

  // 4. Image
  if (kind === 'image') {
    if (astNode !== undefined && astNode.kind === 'image') {
      emitImageCommands(box, astNode.props, out);
    } else {
      emitImageCommands(box, undefined, out);
    }
  }

  // 5. MetricCard — dedicated structured rendering
  if (kind === 'metric-card') {
    if (astNode !== undefined && astNode.kind === 'metric-card') {
      emitMetricCardCommands(box, astNode.props, theme, out);
    }
  }

  // 6. Callout — dedicated rendering (title + accent stripe)
  if (kind === 'callout' && !isEmpty) {
    if (astNode !== undefined && astNode.kind === 'callout') {
      emitCalloutCommands(box, astNode.props, theme, out);
    }
  }

  // 6b. Quote — dedicated rendering (accent stripe)
  if (kind === 'quote' && !isEmpty) {
    if (astNode !== undefined && astNode.kind === 'quote') {
      emitQuoteCommands(box, astNode.props, theme, out);
    }
  }

  // 6c. CodeBlock — dedicated rendering (title, line numbers)
  if (kind === 'code-block' && !isEmpty) {
    if (astNode !== undefined && astNode.kind === 'code-block') {
      emitCodeBlockCommands(box, astNode.props, theme, out);
    }
  }

  // 6d. DataTable — dedicated rendering (header row + body rows + dividers)
  if (kind === 'data-table' && !isEmpty) {
    if (astNode !== undefined && astNode.kind === 'data-table') {
      emitDataTableCommands(box, astNode.props, astNode.textBuffer.raw, theme, out);
    }
  }

  // 6e. Chart — dedicated rendering (title, plot area, legend)
  if (kind === 'chart' && !isEmpty) {
    if (astNode !== undefined && astNode.kind === 'chart') {
      emitChartCommands(box, astNode.props, astNode.textBuffer.raw, theme, out);
    }
  }

  // 7. Text-bearing nodes with measurement data
  if (isTextBearing(kind) && box.measurement !== null) {
    const fontDescriptor = getFontForKind(kind, theme, astNode);
    const color = getTextColor(kind, theme, astNode);
    const lineHeight = getLineHeightForKind(kind, theme, astNode);
    const renderMaxWidth = getRenderTextMaxWidth(box, kind, theme, astNode);
    emitTextLines(box, box.measurement, fontDescriptor, color, lineHeight, box.contentY, out, box.contentX, renderMaxWidth);
  }

  // 8. Recurse into children
  for (const child of box.children) {
    walkBox(child, theme, nodeIndex, out);
  }

  // 9. Restore clip (after children)
  if (box.clipChildren) {
    out.push(emitRestoreClip(box));
  }
}

/**
 * Emits draw commands for divider nodes.
 * Supports both horizontal and vertical orientations based on box dimensions or props.
 */
function emitDividerCommands(
  box: LayoutBox,
  props: DividerProps | undefined,
  theme: ThemeConfig,
  out: RenderCommand[],
): void {
  // Determine orientation: props take precedence, fallback to box dimensions
  const isHorizontal = props?.direction === 'vertical' ? false : (props?.direction === 'horizontal' ? true : box.contentWidth >= box.contentHeight);
  const color = props?.color ?? theme.colors.border;
  const thickness = props?.thickness ?? px(2);

  if (isHorizontal) {
    // Center the line in its allocated height.
    // We account for marginTop if available to ensure the line is visually centered.
    const centerY = props
      ? px(box.contentY + props.marginTop + thickness / 2)
      : px(box.contentY + box.contentHeight / 2);

    out.push({
      kind: 'draw-line',
      nodeId: box.nodeId,
      x1: box.contentX,
      y1: centerY,
      x2: px(box.contentX + box.contentWidth),
      y2: centerY,
      color,
      lineWidth: thickness,
    });
  } else {
    // Vertical divider
    const centerX = px(box.contentX + box.contentWidth / 2);
    out.push({
      kind: 'draw-line',
      nodeId: box.nodeId,
      x1: centerX,
      y1: box.contentY,
      x2: centerX,
      y2: px(box.contentY + box.contentHeight),
      color,
      lineWidth: thickness,
    });
  }
}

/**
 * Emits draw commands for Quote nodes.
 *
 * Renders a prominent left accent stripe, italic serif body text (to
 * clearly distinguish a quote from a callout or card), and an optional
 * attribution line underneath.
 */
function emitQuoteCommands(
  box: LayoutBox,
  props: QuoteProps,
  theme: ThemeConfig,
  out: RenderCommand[],
): void {
  // Pull-quotes earn a more saturated accent than plain border color.
  const accentColor = props.borderColor
    ?? (props.variant === 'pull' || props.variant === 'highlight'
      ? theme.colors.accent
      : theme.colors.border);
  const stripeWidth = px(3);
  const borderRadius = getBorderRadius('quote', theme);

  // 1. Clip content to card bounds
  out.push(emitClipRect(box, borderRadius));

  // 2. Left accent stripe
  out.push({
    kind: 'fill-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: stripeWidth,
    height: box.height,
    color: accentColor,
    borderRadius: px(0),
  });

  let currentY = box.contentY;

  // 3. Body text — italic serif for clear "quote" identity
  if (box.measurement !== null) {
    emitTextLines(
      box,
      box.measurement,
      QUOTE_FONT,
      theme.colors.text,
      QUOTE_LINE_HEIGHT,
      currentY,
      out,
      box.contentX,
      box.contentWidth
    );
    currentY = px(currentY + box.measurement.height);
  }

  // 4. Citation line (if provided)
  if (props.cite !== undefined && props.cite.length > 0) {
    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: `— ${props.cite}`,
      x: box.contentX,
      y: px(currentY + theme.spacing.xs),
      font: QUOTE_CITE_FONT,
      color: theme.colors.textSecondary,
      maxWidth: box.contentWidth,
      lineHeight: QUOTE_CITE_LINE_HEIGHT,
    });
  }

  // 5. Restore clip
  out.push(emitRestoreClip(box));
}

/**
 * Emits draw commands for image nodes.
 * Uses the src from the AST node props when available,
 * falling back to an empty placeholder if unavailable.
 */
function emitImageCommands(
  box: LayoutBox,
  props: ImageProps | undefined,
  out: RenderCommand[],
): void {
  const src = props?.src ?? '';
  if (src.length === 0) {
    // No image source — nothing to draw
    return;
  }
  out.push(emitDrawImage(box, src));
}

/**
 * Sentinel colors for MetricCard sentiments.
 */
function getSentimentColor(
  sentiment: 'positive' | 'negative' | 'neutral',
  theme: ThemeConfig,
): string {
  switch (sentiment) {
    case 'positive':
      return theme.colors.success;
    case 'negative':
      return theme.colors.error;
    case 'neutral':
      return theme.colors.textSecondary;
  }
}

/**
 * Emits draw commands for MetricCard nodes.
 * Renders structured content: label (caption), value (large bold), delta (colored).
 */
function emitMetricCardCommands(
  box: LayoutBox,
  props: MetricCardProps,
  theme: ThemeConfig,
  out: RenderCommand[],
): void {
  const borderRadius = getBorderRadius('metric-card', theme);

  // 1. Clip content to card bounds
  out.push(emitClipRect(box, borderRadius));

  let currentY = box.contentY;

  // 2. Label (small, secondary color)
  out.push({
    kind: 'fill-text',
    nodeId: box.nodeId,
    text: props.label.toUpperCase(),
    x: box.contentX,
    y: currentY,
    font: theme.fonts.caption,
    color: theme.colors.textSecondary,
    maxWidth: box.contentWidth,
    lineHeight: theme.lineHeights.caption,
  });
  currentY = px(currentY + theme.lineHeights.caption + theme.spacing.sm);

  // 3. Value (large, bold, primary color)
  out.push({
    kind: 'fill-text',
    nodeId: box.nodeId,
    text: props.value,
    x: box.contentX,
    y: currentY,
    font: METRIC_VALUE_FONT,
    color: theme.colors.text,
    maxWidth: box.contentWidth,
    lineHeight: METRIC_VALUE_LINE_HEIGHT,
  });
  currentY = px(currentY + METRIC_VALUE_LINE_HEIGHT + METRIC_VALUE_DELTA_GAP);

  // 4. Delta (sentiment-colored, with optional trend arrow) — own line
  if (props.delta !== undefined) {
    const sentimentColor = getSentimentColor(props.sentiment, theme);
    let d = props.delta;
    if (props.trend === 'up') d = `▲ ${d}`;
    else if (props.trend === 'down') d = `▼ ${d}`;
    else if (props.trend === 'flat') d = `— ${d}`;

    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: d,
      x: box.contentX,
      y: currentY,
      font: METRIC_DELTA_FONT,
      color: sentimentColor,
      maxWidth: box.contentWidth,
      lineHeight: METRIC_DELTA_LINE_HEIGHT,
    });
    currentY = px(currentY + METRIC_DELTA_LINE_HEIGHT + METRIC_DELTA_FOOTER_GAP);
  }

  // 5. Footer (small caption, secondary color) — own line
  if (props.footer !== undefined && props.footer.length > 0) {
    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: props.footer,
      x: box.contentX,
      y: currentY,
      font: METRIC_FOOTER_FONT,
      color: theme.colors.textSecondary,
      maxWidth: box.contentWidth,
      lineHeight: METRIC_FOOTER_LINE_HEIGHT,
    });
  }

  // 6. Restore clip
  out.push(emitRestoreClip(box));
}

// ─── Callout Fonts ───────────────────────────────────────────────────

/**
 * Sentinel colors for Callout types.
 */
function getCalloutAccentColor(
  type: 'info' | 'warning' | 'error' | 'success' | 'tip' | 'note',
  theme: ThemeConfig,
): string {
  switch (type) {
    case 'info':
      return theme.colors.info;
    case 'warning':
      return theme.colors.warning;
    case 'error':
      return theme.colors.error;
    case 'success':
      return theme.colors.success;
    case 'tip':
      return theme.colors.accent;
    case 'note':
      return theme.colors.textSecondary;
  }
}

/**
 * Callout type icons.
 *
 * We avoid emoji and rare Unicode (which render inconsistently on
 * Canvas across OSes) in favor of a single ASCII-safe glyph that we
 * paint inside a colored circular badge — see `emitCalloutIconBadge`.
 * This gives every Callout a crisp, brand-consistent marker regardless
 * of available system fonts.
 */
function getCalloutGlyph(
  type: 'info' | 'warning' | 'error' | 'success' | 'tip' | 'note',
): string {
  switch (type) {
    case 'info':
      return 'i';
    case 'warning':
      return '!';
    case 'error':
      return '×';
    case 'success':
      return '✓';
    case 'tip':
      return '★';
    case 'note':
      return '§';
  }
}

/** Pre-computed per-glyph x-offset inside the badge (manual optical centering). */
function glyphCenterOffset(glyph: string): number {
  switch (glyph) {
    case 'i':  return 7;   // thin vertical letter
    case '!':  return 7;
    case '×':  return 5;
    case '✓':  return 4;
    case '★':  return 4;
    case '§':  return 5;
    default:   return 5;
  }
}

/**
 * Paints a circular icon badge at (cx, cy) with the given glyph centered.
 * Returns the width consumed (diameter + right gap) so the caller can
 * advance its text cursor.
 */
function emitCalloutIconBadge(
  box: LayoutBox,
  accent: string,
  glyph: string,
  cx: Pixels,
  cy: Pixels,
  out: RenderCommand[],
): Pixels {
  const diameter = 18;
  // Vertically align badge center with title cap-line center.
  const badgeY = px(cy + (CALLOUT_TITLE_LINE_HEIGHT - diameter) / 2);

  // Filled circle (fully rounded rect)
  out.push({
    kind: 'fill-rect',
    nodeId: box.nodeId,
    x: cx,
    y: badgeY,
    width: px(diameter),
    height: px(diameter),
    color: accent,
    borderRadius: px(diameter / 2),
  });

  // Glyph: manually positioned to be optically centered inside the badge.
  out.push({
    kind: 'fill-text',
    nodeId: box.nodeId,
    text: glyph,
    x: px(cx + glyphCenterOffset(glyph)),
    y: px(badgeY + 2),
    font: 'bold 12px Inter, system-ui, sans-serif' as unknown as FontDescriptor,
    color: '#ffffff',
    maxWidth: px(diameter),
    lineHeight: px(diameter),
  });

  return px(diameter + 8); // badge width + gap
}

/**
 * Emits draw commands for Callout nodes.
 * Renders a left accent stripe, icon badge, title, and the callout's
 * own textBuffer body text (below the title, above any child nodes).
 */
function emitCalloutCommands(
  box: LayoutBox,
  props: CalloutProps,
  theme: ThemeConfig,
  out: RenderCommand[],
): void {
  const accentColor = getCalloutAccentColor(props.type, theme);
  const stripeWidth = px(4);
  const borderRadius = getBorderRadius('callout', theme);

  // 1. Clip content to card bounds
  out.push(emitClipRect(box, borderRadius));

  // 2. Left accent stripe (full height)
  out.push({
    kind: 'fill-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: stripeWidth,
    height: box.height,
    color: accentColor,
    borderRadius: px(0),
  });

  let currentY = box.contentY;
  let titleX = box.contentX;

  // 3. Icon badge (before title, when requested)
  if (props.icon && props.title.length > 0) {
    const glyph = getCalloutGlyph(props.type);
    const consumed = emitCalloutIconBadge(box, accentColor, glyph, box.contentX, currentY, out);
    titleX = px(box.contentX + consumed);
  }

  // 4. Title line
  if (props.title.length > 0) {
    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: props.title,
      x: titleX,
      y: currentY,
      font: CALLOUT_TITLE_FONT,
      color: accentColor,
      maxWidth: px(box.contentWidth - (titleX - box.contentX)),
      lineHeight: CALLOUT_TITLE_LINE_HEIGHT,
    });
    currentY = px(currentY + CALLOUT_TITLE_LINE_HEIGHT + theme.spacing.sm);
  }

  // 5. Body text from the callout's own textBuffer measurement
  if (box.measurement !== null) {
    emitTextLines(
      box,
      box.measurement,
      theme.fonts.body,
      theme.colors.text,
      theme.lineHeights.body,
      currentY,
      out,
      box.contentX,
      box.contentWidth
    );
  }

  // 6. Restore clip
  out.push(emitRestoreClip(box));
}

/**
 * Emits draw commands for CodeBlock nodes.
 * Renders the optional title bar, code lines, and optional line numbers.
 */
function emitCodeBlockCommands(
  box: LayoutBox,
  props: CodeBlockProps,
  theme: ThemeConfig,
  out: RenderCommand[],
): void {
  // Note: walkBox already applies clip-rect for code-block (clipChildren = true),
  // so we don't add another clip here to avoid stack mismatches.

  let currentY = box.contentY;

  // 1. Title line
  if (props.title !== undefined && props.title.length > 0) {
    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: props.title,
      x: box.contentX,
      y: currentY,
      font: CALLOUT_TITLE_FONT,
      color: theme.colors.textSecondary,
      maxWidth: box.contentWidth,
      lineHeight: CALLOUT_TITLE_LINE_HEIGHT,
    });
    currentY = px(currentY + CALLOUT_TITLE_LINE_HEIGHT + theme.spacing.xs);
  }

  // 2. Body text (with or without line numbers)
  if (box.measurement !== null && isLineDetail(box.measurement)) {
    const lines = box.measurement.lines;
    const lineNumberWidth = props.showLineNumbers ? px(32) : px(0);
    const codeX = px(box.contentX + lineNumberWidth);
    const codeMaxWidth = px(box.contentWidth - lineNumberWidth);

    lines.forEach((line, index) => {
      const lineY = px(currentY + index * props.lineHeight);
      
      // Render line number
      if (props.showLineNumbers) {
        out.push({
          kind: 'fill-text',
          nodeId: box.nodeId,
          text: String(props.startLine + index),
          x: box.contentX,
          y: lineY,
          font: props.font,
          color: theme.colors.textSecondary,
          maxWidth: lineNumberWidth,
          lineHeight: props.lineHeight,
        });
      }

      // Render code line — maxWidth prevents overflow past container
      out.push({
        kind: 'fill-text',
        nodeId: box.nodeId,
        text: line.text,
        x: codeX,
        y: lineY,
        font: props.font,
        color: theme.colors.text,
        maxWidth: codeMaxWidth,
        lineHeight: props.lineHeight,
      });
    });
  }
}

// ─── DataTable Rendering ─────────────────────────────────────────────

interface TableColumnSpec {
  readonly label: string;
  readonly align: 'left' | 'center' | 'right';
}

/**
 * Parse the `columns` attribute. Supports "Label" and "Label:right" syntax.
 */
function parseTableColumns(spec: string): TableColumnSpec[] {
  const cols: TableColumnSpec[] = [];
  for (const raw of spec.split('|')) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const [label, align] = trimmed.split(':');
    let resolvedAlign: 'left' | 'center' | 'right' = 'left';
    if (align === 'right') resolvedAlign = 'right';
    else if (align === 'center') resolvedAlign = 'center';
    cols.push({ label: (label ?? '').trim(), align: resolvedAlign });
  }
  return cols;
}

/**
 * X-offset (from cell left) where text should start, given the column
 * alignment and a text width.
 */
function textXForAlign(
  cellX: number,
  cellWidth: number,
  align: 'left' | 'center' | 'right',
  padding: number,
): number {
  if (align === 'right') return cellX + cellWidth - padding;
  if (align === 'center') return cellX + cellWidth / 2;
  return cellX + padding;
}

/**
 * Emits DataTable commands: header row (tinted background + bold labels),
 * body rows (alternating stripes when `striped`), row dividers, and cells
 * with per-column alignment. Column widths are proportional (equal by
 * default) — a good enough approximation without full auto-sizing.
 */
function emitDataTableCommands(
  box: LayoutBox,
  props: DataTableProps,
  body: string,
  theme: ThemeConfig,
  out: RenderCommand[],
): void {
  const cols = parseTableColumns(props.columns);
  if (cols.length === 0) return;

  const rows: string[][] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const cells = line.split('|').map(c => c.trim());
    // Pad or truncate to column count
    while (cells.length < cols.length) cells.push('');
    rows.push(cells.slice(0, cols.length));
  }

  const rowH = props.compact ? TABLE_ROW_HEIGHT_COMPACT : TABLE_ROW_HEIGHT;
  const tableWidth = box.width;
  const colWidth = tableWidth / cols.length;
  const borderRadius = theme.spacing.sm;
  const borderColor = theme.colors.border;

  // 1. Clip + outer card
  out.push(emitClipRect(box, borderRadius));
  out.push({
    kind: 'fill-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: theme.colors.surface,
    borderRadius,
  });

  // 2. Header row — tinted strip
  out.push({
    kind: 'fill-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: TABLE_HEADER_HEIGHT,
    color: theme.colors.background,
    borderRadius: px(0),
  });

  // 3. Header divider line (under header)
  out.push({
    kind: 'draw-line',
    nodeId: box.nodeId,
    x1: box.x,
    y1: px(box.y + TABLE_HEADER_HEIGHT),
    x2: px(box.x + box.width),
    y2: px(box.y + TABLE_HEADER_HEIGHT),
    color: borderColor,
    lineWidth: px(1),
  });

  // 4. Header cell text
  const headerTextY = px(box.y + (TABLE_HEADER_HEIGHT - 12) / 2);
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    const cellX = box.x + i * colWidth;
    const textX = textXForAlign(cellX, colWidth, col.align, TABLE_CELL_PADDING_X);
    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: col.label.toUpperCase(),
      x: px(textX),
      y: headerTextY,
      font: TABLE_HEADER_FONT,
      color: theme.colors.textSecondary,
      maxWidth: px(colWidth - TABLE_CELL_PADDING_X * 2),
      lineHeight: px(14),
    });
  }

  // 5. Body rows — striping, dividers, cell text
  let rowY = box.y + TABLE_HEADER_HEIGHT;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;

    // Striping (skip on first row for clean contrast with header)
    if (props.striped && r % 2 === 1) {
      out.push({
        kind: 'fill-rect',
        nodeId: box.nodeId,
        x: box.x,
        y: px(rowY),
        width: box.width,
        height: rowH,
        color: theme.colors.background,
        borderRadius: px(0),
      });
    }

    // Cell text
    const cellTextY = px(rowY + (rowH - 14) / 2);
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]!;
      const cellX = box.x + i * colWidth;
      const textX = textXForAlign(cellX, colWidth, col.align, TABLE_CELL_PADDING_X);
      const cellValue = row[i] ?? '';
      out.push({
        kind: 'fill-text',
        nodeId: box.nodeId,
        text: cellValue,
        x: px(textX),
        y: cellTextY,
        font: TABLE_BODY_FONT,
        color: theme.colors.text,
        maxWidth: px(colWidth - TABLE_CELL_PADDING_X * 2),
        lineHeight: px(16),
      });
    }

    rowY += rowH;

    // Row divider (except after last row — the outer clip rounds the corner)
    if (r < rows.length - 1) {
      out.push({
        kind: 'draw-line',
        nodeId: box.nodeId,
        x1: px(box.x + TABLE_CELL_PADDING_X),
        y1: px(rowY),
        x2: px(box.x + box.width - TABLE_CELL_PADDING_X),
        y2: px(rowY),
        color: borderColor,
        lineWidth: px(1),
      });
    }
  }

  // 6. Outer border
  out.push({
    kind: 'stroke-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: borderColor,
    lineWidth: px(1),
    borderRadius,
  });

  // 7. Restore clip
  out.push(emitRestoreClip(box));
}

// ─── Chart Rendering ─────────────────────────────────────────────────

interface ChartSeries {
  readonly name: string;
  readonly values: ReadonlyArray<number>;
}

interface ChartData {
  readonly labels: ReadonlyArray<string>;
  readonly series: ReadonlyArray<ChartSeries>;
}

/**
 * Parse CSV-like chart body.
 *   First line = header: `Label,Col1,Col2,...`
 *     - The first cell becomes a prefix label we ignore.
 *     - Remaining cells become the X-axis labels.
 *   Subsequent lines = `SeriesName,v1,v2,...`.
 *
 * Also supports the `Region,Growth\nEMEA,24\nAPAC,12` shape (single series,
 * with row labels as X-axis categories). We detect this when there is only
 * one column of numbers and the rows' first cell is non-numeric.
 */
function parseChartData(body: string): ChartData {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return { labels: [], series: [] };

  const headerCells = lines[0]!.split(',').map(c => c.trim());
  const bodyRows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));

  // Detect single-series "Category,Value" shape.
  const allRowsBinary = bodyRows.every(r => r.length === 2 && !Number.isNaN(Number(r[1])));
  if (allRowsBinary && headerCells.length === 2) {
    const values = bodyRows.map(r => Number(r[1]));
    const labels = bodyRows.map(r => r[0] ?? '');
    return {
      labels,
      series: [{ name: headerCells[1] ?? 'Value', values }],
    };
  }

  // Generic multi-series shape: header's first cell is the "row name" column,
  // remaining header cells are X-axis labels.
  const labels = headerCells.slice(1);
  const series: ChartSeries[] = bodyRows.map(r => ({
    name: r[0] ?? '',
    values: r.slice(1).map(v => {
      const n = Number(v);
      return Number.isNaN(n) ? 0 : n;
    }),
  }));
  return { labels, series };
}

/** Parse comma-separated color list with a sensible fallback palette. */
function parseChartColors(spec: string): string[] {
  const fallback = ['#4C6EF5', '#F76707', '#37B24D', '#F03E3E', '#AE3EC9'];
  const colors = spec.split(',').map(c => c.trim()).filter(c => c.length > 0);
  return colors.length > 0 ? colors : fallback;
}

function formatTick(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

/**
 * Emit Chart commands. Supports bar, line, and area types with multi-series
 * data. Pie and scatter render as a graceful bar fallback for now — the
 * whole system is more useful with a working renderer for the common cases
 * than a partial one that crashes on edge cases.
 */
function emitChartCommands(
  box: LayoutBox,
  props: ChartProps,
  body: string,
  theme: ThemeConfig,
  out: RenderCommand[],
): void {
  const data = parseChartData(body);
  if (data.series.length === 0 || data.labels.length === 0) return;

  const colors = parseChartColors(props.colors);
  const borderColor = theme.colors.border;
  const gridColor = `${theme.colors.border}80`; // 50% alpha grid lines
  const borderRadius = theme.spacing.sm;

  // 1. Clip + outer surface
  out.push(emitClipRect(box, borderRadius));
  out.push({
    kind: 'fill-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: theme.colors.surface,
    borderRadius,
  });

  let currentY = box.y + props.padding;

  // 2. Title
  if (props.title !== undefined && props.title.length > 0) {
    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: props.title,
      x: px(box.x + props.padding),
      y: px(currentY),
      font: CHART_TITLE_FONT,
      color: theme.colors.text,
      maxWidth: px(box.width - props.padding * 2),
      lineHeight: CHART_TITLE_LINE_HEIGHT,
    });
    currentY += CHART_TITLE_LINE_HEIGHT + theme.spacing.xs;
  }

  // 3. Determine plot rectangle
  const legendH = props.showLegend && data.series.length > 1 ? CHART_LEGEND_HEIGHT : 0;
  const xAxisH = CHART_AXIS_LABEL_HEIGHT;
  const yAxisW = 40; // reserved for y-tick labels
  const plotX = box.x + props.padding + yAxisW;
  const plotY = currentY;
  const plotW = box.width - props.padding * 2 - yAxisW;
  const plotH = (box.y + box.height - props.padding) - plotY - xAxisH - legendH;

  if (plotW <= 0 || plotH <= 0) {
    out.push(emitRestoreClip(box));
    return;
  }

  // 4. Y-axis range
  let maxVal = 0;
  let minVal = 0;
  for (const s of data.series) {
    for (const v of s.values) {
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    }
  }
  if (maxVal === minVal) {
    maxVal = minVal + 1;
  }
  // Pad top by 10% for headroom.
  const yMax = maxVal + (maxVal - minVal) * 0.1;
  const yMin = minVal < 0 ? minVal : 0;
  const yRange = yMax - yMin;

  // 5. Gridlines + Y tick labels (4 ticks)
  if (props.showGrid) {
    const tickCount = 4;
    for (let t = 0; t <= tickCount; t++) {
      const frac = t / tickCount;
      const tickY = plotY + plotH - frac * plotH;
      const tickVal = yMin + frac * yRange;

      out.push({
        kind: 'draw-line',
        nodeId: box.nodeId,
        x1: px(plotX),
        y1: px(tickY),
        x2: px(plotX + plotW),
        y2: px(tickY),
        color: gridColor,
        lineWidth: px(1),
      });

      out.push({
        kind: 'fill-text',
        nodeId: box.nodeId,
        text: formatTick(tickVal),
        x: px(plotX - 6 - 28), // right-align-ish: glyph width fudge
        y: px(tickY - 6),
        font: CHART_LABEL_FONT,
        color: theme.colors.textSecondary,
        maxWidth: px(28),
        lineHeight: CHART_LABEL_LINE_HEIGHT,
      });
    }
  }

  // 6. Plot data
  const type = props.type;
  const renderAsBars = type === 'bar' || type === 'scatter' || type === 'pie';
  const renderAsLine = type === 'line';
  const renderAsArea = type === 'area';

  if (renderAsBars) {
    // Grouped bars: each X-label gets `data.series.length` bars side-by-side.
    const groupCount = data.labels.length;
    if (groupCount > 0) {
      const groupWidth = plotW / groupCount;
      const barPadding = Math.max(4, groupWidth * 0.15);
      const innerGroupWidth = groupWidth - barPadding * 2;
      const barWidth = innerGroupWidth / data.series.length;

      for (let g = 0; g < groupCount; g++) {
        for (let s = 0; s < data.series.length; s++) {
          const value = data.series[s]!.values[g] ?? 0;
          const barH = ((value - yMin) / yRange) * plotH;
          const barX = plotX + g * groupWidth + barPadding + s * barWidth;
          const barY = plotY + plotH - barH;
          const color = colors[s % colors.length]!;
          out.push({
            kind: 'fill-rect',
            nodeId: box.nodeId,
            x: px(barX + 1),
            y: px(barY),
            width: px(Math.max(1, barWidth - 2)),
            height: px(Math.max(1, barH)),
            color,
            borderRadius: px(2),
          });
        }
      }
    }
  }

  if (renderAsLine || renderAsArea) {
    // One polyline per series. We approximate a polyline by emitting
    // adjacent line segments, which keeps us inside the existing
    // RenderCommand union (no polyline primitive).
    const groupCount = data.labels.length;
    if (groupCount > 1) {
      const stepX = plotW / (groupCount - 1);
      for (let s = 0; s < data.series.length; s++) {
        const series = data.series[s]!;
        const color = colors[s % colors.length]!;
        // Area: emit vertical shaded bars underneath first so lines sit on top.
        if (renderAsArea) {
          const shade = `${color}33`;
          for (let g = 0; g < groupCount - 1; g++) {
            const v1 = series.values[g] ?? 0;
            const v2 = series.values[g + 1] ?? 0;
            const x1 = plotX + g * stepX;
            const x2 = plotX + (g + 1) * stepX;
            const y1 = plotY + plotH - ((v1 - yMin) / yRange) * plotH;
            const y2 = plotY + plotH - ((v2 - yMin) / yRange) * plotH;
            // Approximate trapezoid with a rectangle under the midpoint.
            const midY = (y1 + y2) / 2;
            out.push({
              kind: 'fill-rect',
              nodeId: box.nodeId,
              x: px(x1),
              y: px(midY),
              width: px(x2 - x1),
              height: px(plotY + plotH - midY),
              color: shade,
              borderRadius: px(0),
            });
          }
        }

        for (let g = 0; g < groupCount - 1; g++) {
          const v1 = series.values[g] ?? 0;
          const v2 = series.values[g + 1] ?? 0;
          const x1 = plotX + g * stepX;
          const x2 = plotX + (g + 1) * stepX;
          const y1 = plotY + plotH - ((v1 - yMin) / yRange) * plotH;
          const y2 = plotY + plotH - ((v2 - yMin) / yRange) * plotH;
          out.push({
            kind: 'draw-line',
            nodeId: box.nodeId,
            x1: px(x1),
            y1: px(y1),
            x2: px(x2),
            y2: px(y2),
            color,
            lineWidth: px(2),
          });
        }
      }
    }
  }

  // 7. X-axis baseline
  out.push({
    kind: 'draw-line',
    nodeId: box.nodeId,
    x1: px(plotX),
    y1: px(plotY + plotH),
    x2: px(plotX + plotW),
    y2: px(plotY + plotH),
    color: borderColor,
    lineWidth: px(1),
  });

  // 8. X labels
  const labelY = px(plotY + plotH + 4);
  const segmentW = plotW / data.labels.length;
  for (let i = 0; i < data.labels.length; i++) {
    out.push({
      kind: 'fill-text',
      nodeId: box.nodeId,
      text: data.labels[i] ?? '',
      x: px(plotX + i * segmentW + segmentW / 2 - 20),
      y: labelY,
      font: CHART_LABEL_FONT,
      color: theme.colors.textSecondary,
      maxWidth: px(segmentW),
      lineHeight: CHART_LABEL_LINE_HEIGHT,
    });
  }

  // 9. Legend (multi-series only)
  if (props.showLegend && data.series.length > 1) {
    const legendY = px(box.y + box.height - props.padding - CHART_LEGEND_HEIGHT / 2 - 6);
    let legendX = box.x + props.padding;
    for (let s = 0; s < data.series.length; s++) {
      const color = colors[s % colors.length]!;
      out.push({
        kind: 'fill-rect',
        nodeId: box.nodeId,
        x: px(legendX),
        y: legendY,
        width: px(10),
        height: px(10),
        color,
        borderRadius: px(2),
      });
      out.push({
        kind: 'fill-text',
        nodeId: box.nodeId,
        text: data.series[s]!.name,
        x: px(legendX + 16),
        y: px(legendY - 2),
        font: CHART_LABEL_FONT,
        color: theme.colors.textSecondary,
        maxWidth: px(120),
        lineHeight: CHART_LABEL_LINE_HEIGHT,
      });
      legendX += 16 + (data.series[s]!.name.length * 7) + 16;
    }
  }

  // 10. Outer border
  out.push({
    kind: 'stroke-rect',
    nodeId: box.nodeId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: borderColor,
    lineWidth: px(1),
    borderRadius,
  });

  // 11. Restore clip
  out.push(emitRestoreClip(box));
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Converts a tree of LayoutBox nodes into a flat array of renderer-agnostic
 * draw commands. The commands are emitted in painter's order (back-to-front)
 * via depth-first traversal.
 *
 * @param boxes     - Top-level LayoutBox array (typically one per slide).
 * @param theme     - Theme configuration for colors, fonts, and spacing.
 * @param nodeIndex - Map from NodeId → SpatialNode for accessing AST props
 *                    (needed for structured components like MetricCard, Callout).
 * @returns Flat array of RenderCommands in draw order.
 */
export function buildRenderCommands(
  boxes: ReadonlyArray<LayoutBox>,
  theme: ThemeConfig,
  nodeIndex?: ReadonlyMap<NodeId, SpatialNode>,
): RenderCommand[] {
  const commands: RenderCommand[] = [];
  const index = nodeIndex ?? new Map<NodeId, SpatialNode>();
  for (const box of boxes) {
    walkBox(box, theme, index, commands);
  }
  return commands;
}
