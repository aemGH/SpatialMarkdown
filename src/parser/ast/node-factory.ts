/**
 * Factory functions to create typed SpatialNode variants from tag names + attributes.
 *
 * Each factory parses attribute strings into strongly-typed props with sensible defaults.
 * No `any`. No `as` except branded type constructors (px, font, nodeId).
 *
 * @module @spatial/parser/ast/node-factory
 */

import { px, font } from '../../types/primitives';
import type { NodeId, Pixels, FontDescriptor } from '../../types/primitives';
import type {
  SpatialNode,
  DirtyFlags,
  TextBuffer,
  SlideProps,
  AutoGridProps,
  StackProps,
  ColumnsProps,
  CanvasProps,
  MetricCardProps,
  CodeBlockProps,
  DataTableProps,
  ChartProps,
  QuoteProps,
  CalloutProps,
  TextProps,
  HeadingProps,
  SpacerProps,
  DividerProps,
  ImageProps,
} from '../../types/ast';
import type { SpatialTagName } from '../../types/tokens';

// ─── Attribute Parsing Helpers ───────────────────────────────────────

function attrPx(attrs: ReadonlyMap<string, string>, key: string, fallback: number): Pixels {
  const raw = attrs.get(key);
  if (raw === undefined) return px(fallback);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? px(parsed) : px(fallback);
}

function attrPxOrUndefined(attrs: ReadonlyMap<string, string>, key: string): Pixels | undefined {
  const raw = attrs.get(key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? px(parsed) : undefined;
}

function attrPxOrString<S extends string>(
  attrs: ReadonlyMap<string, string>,
  key: string,
  stringValue: S,
  fallback: Pixels | S,
): Pixels | S {
  const raw = attrs.get(key);
  if (raw === undefined) return fallback;
  if (raw === stringValue) return stringValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? px(parsed) : fallback;
}

function attrStr(attrs: ReadonlyMap<string, string>, key: string, fallback: string): string {
  return attrs.get(key) ?? fallback;
}

function attrStrOrUndefined(attrs: ReadonlyMap<string, string>, key: string): string | undefined {
  return attrs.get(key);
}

function attrColorOrUndefined(attrs: ReadonlyMap<string, string>, key: string): string | undefined {
  return attrs.get(key);
}

function attrFont(attrs: ReadonlyMap<string, string>, key: string, fallback: string): FontDescriptor {
  return font(attrs.get(key) ?? fallback);
}

function attrBool(attrs: ReadonlyMap<string, string>, key: string, fallback: boolean): boolean {
  const raw = attrs.get(key);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function attrInt(attrs: ReadonlyMap<string, string>, key: string, fallback: number): number {
  const raw = attrs.get(key);
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function attrFloat(attrs: ReadonlyMap<string, string>, key: string, fallback: number): number {
  const raw = attrs.get(key);
  if (raw === undefined) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function attrEnum<T extends string>(
  attrs: ReadonlyMap<string, string>,
  key: string,
  valid: ReadonlyArray<T>,
  fallback: T,
): T {
  const raw = attrs.get(key);
  if (raw === undefined) return fallback;
  return (valid.includes(raw as T)) ? raw as T : fallback;
}

function attrColumnsOrAuto(attrs: ReadonlyMap<string, string>, key: string, fallback: number | 'auto'): number | 'auto' {
  const raw = attrs.get(key);
  if (raw === undefined) return fallback;
  if (raw === 'auto') return 'auto';
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ─── Shared Defaults ─────────────────────────────────────────────────

function makeDirtyFlags(): DirtyFlags {
  return {
    textDirty: true,
    constraintDirty: true,
    geometryDirty: true,
    renderDirty: true,
  };
}

function makeTextBuffer(): TextBuffer {
  return { raw: '', lastPrepareLength: 0 };
}

// ─── Tag Name → Node Kind Mapping (single source of truth) ──────────

type NodeKindFromTag = SpatialNode['kind'];

export const TAG_TO_KIND: Readonly<Record<SpatialTagName, NodeKindFromTag>> = {
  Slide: 'slide',
  AutoGrid: 'auto-grid',
  Stack: 'stack',
  Columns: 'columns',
  Canvas: 'canvas',
  MetricCard: 'metric-card',
  CodeBlock: 'code-block',
  DataTable: 'data-table',
  Chart: 'chart',
  Quote: 'quote',
  Callout: 'callout',
  Text: 'text',
  Heading: 'heading',
  Spacer: 'spacer',
  Divider: 'divider',
  Image: 'image',
};

// ─── Per-Kind Props Factories ────────────────────────────────────────

function makeSlideProps(attrs: ReadonlyMap<string, string>): SlideProps {
  return {
    width: attrPx(attrs, 'width', 0),
    height: attrPx(attrs, 'height', 0),
    padding: attrPx(attrs, 'padding', 32),
    paddingX: attrPxOrUndefined(attrs, 'paddingX'),
    paddingY: attrPxOrUndefined(attrs, 'paddingY'),
    background: attrColorOrUndefined(attrs, 'background'),
  };
}

function makeAutoGridProps(attrs: ReadonlyMap<string, string>): AutoGridProps {
  return {
    minChildWidth: attrPx(attrs, 'minChildWidth', 200),
    gap: attrPx(attrs, 'gap', 12),
    gapX: attrPxOrUndefined(attrs, 'gapX'),
    gapY: attrPxOrUndefined(attrs, 'gapY'),
    columns: attrColumnsOrAuto(attrs, 'columns', 'auto'),
    align: attrEnum(attrs, 'align', ['start', 'center', 'stretch'] as const, 'stretch'),
    padding: attrPx(attrs, 'padding', 0),
  };
}

function makeStackProps(attrs: ReadonlyMap<string, string>): StackProps {
  return {
    direction: attrEnum(attrs, 'direction', ['vertical', 'horizontal'] as const, 'vertical'),
    gap: attrPx(attrs, 'gap', 8),
    padding: attrPx(attrs, 'padding', 0),
    paddingX: attrPxOrUndefined(attrs, 'paddingX'),
    paddingY: attrPxOrUndefined(attrs, 'paddingY'),
    align: attrEnum(attrs, 'align', ['start', 'center', 'end', 'stretch'] as const, 'stretch'),
    justify: attrEnum(attrs, 'justify', ['start', 'center', 'end', 'space-between', 'space-around'] as const, 'start'),
    wrap: attrBool(attrs, 'wrap', false),
  };
}

function makeColumnsProps(attrs: ReadonlyMap<string, string>): ColumnsProps {
  return {
    widths: attrStr(attrs, 'widths', '1fr'),
    gap: attrPx(attrs, 'gap', 16),
    padding: attrPx(attrs, 'padding', 0),
    valign: attrEnum(attrs, 'valign', ['top', 'center', 'bottom', 'stretch'] as const, 'top'),
  };
}

function makeCanvasProps(attrs: ReadonlyMap<string, string>): CanvasProps {
  return {
    width: attrPxOrString(attrs, 'width', 'fill', 'fill' as const),
    height: attrPxOrString(attrs, 'height', 'auto', 'auto' as const),
    padding: attrPx(attrs, 'padding', 0),
    background: attrColorOrUndefined(attrs, 'background'),
    overflow: attrEnum(attrs, 'overflow', ['visible', 'clip'] as const, 'clip'),
  };
}

function makeMetricCardProps(attrs: ReadonlyMap<string, string>): MetricCardProps {
  return {
    label: attrStr(attrs, 'label', ''),
    value: attrStr(attrs, 'value', ''),
    delta: attrStrOrUndefined(attrs, 'delta'),
    trend: parseTrend(attrs),
    sentiment: attrEnum(attrs, 'sentiment', ['positive', 'negative', 'neutral'] as const, 'neutral'),
    footer: attrStrOrUndefined(attrs, 'footer'),
    padding: attrPx(attrs, 'padding', 20),
    background: attrColorOrUndefined(attrs, 'background'),
    borderRadius: attrPx(attrs, 'borderRadius', 8),
  };
}

function makeCodeBlockProps(attrs: ReadonlyMap<string, string>): CodeBlockProps {
  return {
    language: attrStr(attrs, 'language', 'text'),
    title: attrStrOrUndefined(attrs, 'title'),
    showLineNumbers: attrBool(attrs, 'showLineNumbers', true),
    startLine: attrInt(attrs, 'startLine', 1),
    highlight: attrStrOrUndefined(attrs, 'highlight'),
    maxHeight: attrPxOrUndefined(attrs, 'maxHeight'),
    font: attrFont(attrs, 'font', '14px "JetBrains Mono", monospace'),
    lineHeight: attrPx(attrs, 'lineHeight', 20),
    padding: attrPx(attrs, 'padding', 16),
    background: attrColorOrUndefined(attrs, 'background'),
    wrap: attrBool(attrs, 'wrap', false),
  };
}

function makeDataTableProps(attrs: ReadonlyMap<string, string>): DataTableProps {
  const compact = attrBool(attrs, 'compact', false);
  return {
    columns: attrStr(attrs, 'columns', ''),
    striped: attrBool(attrs, 'striped', true),
    compact,
    maxHeight: attrPxOrUndefined(attrs, 'maxHeight'),
    headerBackground: attrColorOrUndefined(attrs, 'headerBackground'),
    font: attrFont(attrs, 'font', '14px Inter'),
    headerFont: attrFont(attrs, 'headerFont', '600 14px Inter'),
    lineHeight: attrPx(attrs, 'lineHeight', 20),
    cellPadding: attrPx(attrs, 'cellPadding', compact ? 8 : 12),
    borderColor: attrColorOrUndefined(attrs, 'borderColor'),
  };
}

function makeChartProps(attrs: ReadonlyMap<string, string>): ChartProps {
  return {
    type: attrEnum(attrs, 'type', ['bar', 'line', 'pie', 'area', 'scatter'] as const, 'bar'),
    title: attrStrOrUndefined(attrs, 'title'),
    width: attrPxOrString(attrs, 'width', 'fill', 'fill' as const),
    height: attrPx(attrs, 'height', 240),
    padding: attrPx(attrs, 'padding', 16),
    colors: attrStr(attrs, 'colors', '#4C6EF5,#F76707,#37B24D,#F03E3E,#AE3EC9'),
    showLegend: attrBool(attrs, 'showLegend', true),
    showGrid: attrBool(attrs, 'showGrid', true),
    xLabel: attrStrOrUndefined(attrs, 'xLabel'),
    yLabel: attrStrOrUndefined(attrs, 'yLabel'),
    animate: attrBool(attrs, 'animate', false),
  };
}

function makeQuoteProps(attrs: ReadonlyMap<string, string>): QuoteProps {
  return {
    cite: attrStrOrUndefined(attrs, 'cite'),
    variant: attrEnum(attrs, 'variant', ['default', 'highlight', 'pull'] as const, 'default'),
    borderColor: attrColorOrUndefined(attrs, 'borderColor'),
    font: attrFont(attrs, 'font', 'italic 16px Georgia, serif'),
    lineHeight: attrPx(attrs, 'lineHeight', 26),
    padding: attrPx(attrs, 'padding', 16),
    paddingLeft: attrPx(attrs, 'paddingLeft', 20),
  };
}

function makeCalloutProps(attrs: ReadonlyMap<string, string>): CalloutProps {
  const calloutType = attrEnum(attrs, 'type', ['info', 'warning', 'error', 'success', 'tip', 'note'] as const, 'info');
  const defaultTitles: Readonly<Record<CalloutProps['type'], string>> = {
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    success: 'Success',
    tip: 'Tip',
    note: 'Note',
  };
  return {
    type: calloutType,
    title: attrStr(attrs, 'title', defaultTitles[calloutType]),
    icon: attrBool(attrs, 'icon', true),
    collapsible: attrBool(attrs, 'collapsible', false),
    collapsed: attrBool(attrs, 'collapsed', false),
    padding: attrPx(attrs, 'padding', 20),
    borderRadius: attrPx(attrs, 'borderRadius', 8),
  };
}

function makeTextProps(attrs: ReadonlyMap<string, string>): TextProps {
  return {
    font: attrFont(attrs, 'font', '14px Inter'),
    lineHeight: attrPx(attrs, 'lineHeight', 20),
    color: attrColorOrUndefined(attrs, 'color'),
    align: attrEnum(attrs, 'align', ['left', 'center', 'right'] as const, 'left'),
    whiteSpace: attrEnum(attrs, 'whiteSpace', ['normal', 'pre-wrap'] as const, 'normal'),
    wordBreak: attrEnum(attrs, 'wordBreak', ['normal', 'keep-all'] as const, 'normal'),
    maxLines: (() => {
      const raw = attrs.get('maxLines');
      if (raw === undefined) return undefined;
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    })(),
    opacity: attrFloat(attrs, 'opacity', 1),
  };
}

function makeHeadingProps(attrs: ReadonlyMap<string, string>): HeadingProps {
  const level = attrEnum(attrs, 'level', ['1', '2', '3', '4', '5', '6'] as const, '1');
  const numLevel = parseInt(level, 10) as 1 | 2 | 3 | 4 | 5 | 6;
  const defaultMargins: Readonly<Record<number, number>> = {
    1: 16, 2: 12, 3: 8, 4: 8, 5: 6, 6: 6,
  };
  return {
    level: numLevel,
    color: attrColorOrUndefined(attrs, 'color'),
    align: attrEnum(attrs, 'align', ['left', 'center', 'right'] as const, 'left'),
    marginBottom: attrPx(attrs, 'marginBottom', defaultMargins[numLevel] ?? 12),
  };
}

function makeSpacerProps(attrs: ReadonlyMap<string, string>): SpacerProps {
  return {
    height: attrPx(attrs, 'height', 8),
    width: attrPx(attrs, 'width', 0),
  };
}

function makeDividerProps(attrs: ReadonlyMap<string, string>): DividerProps {
  return {
    direction: attrEnum(attrs, 'direction', ['horizontal', 'vertical'] as const, 'horizontal'),
    thickness: attrPx(attrs, 'thickness', 1),
    color: attrColorOrUndefined(attrs, 'color'),
    marginTop: attrPx(attrs, 'marginTop', 12),
    marginBottom: attrPx(attrs, 'marginBottom', 12),
    indent: attrPx(attrs, 'indent', 0),
  };
}

function makeImageProps(attrs: ReadonlyMap<string, string>): ImageProps {
  return {
    src: attrStr(attrs, 'src', ''),
    alt: attrStr(attrs, 'alt', ''),
    width: attrPxOrString(attrs, 'width', 'fill', 'fill' as const),
    height: attrPxOrString(attrs, 'height', 'auto', 'auto' as const),
    aspectRatio: attrStr(attrs, 'aspectRatio', '16:9'),
    fit: attrEnum(attrs, 'fit', ['cover', 'contain', 'fill'] as const, 'cover'),
    borderRadius: attrPx(attrs, 'borderRadius', 0),
    caption: attrStrOrUndefined(attrs, 'caption'),
    captionFont: attrFont(attrs, 'captionFont', 'italic 12px Inter'),
  };
}

// ─── MetricCard Trend Helper ─────────────────────────────────────────

function parseTrend(attrs: ReadonlyMap<string, string>): 'up' | 'down' | 'flat' | undefined {
  const raw = attrs.get('trend');
  if (raw === 'up' || raw === 'down' || raw === 'flat') return raw;
  return undefined;
}

// ─── Text-Bearing Node Detection ─────────────────────────────────────

type TextBearingKind = 'text' | 'heading' | 'code-block' | 'data-table' | 'chart' | 'quote' | 'callout';

const TEXT_BEARING_KINDS: ReadonlySet<string> = new Set<TextBearingKind>([
  'text', 'heading', 'code-block', 'data-table', 'chart', 'quote', 'callout',
]);

export function isTextBearingKind(kind: string): kind is TextBearingKind {
  return TEXT_BEARING_KINDS.has(kind);
}

// ─── Container Node Detection ────────────────────────────────────────

type ContainerKind = 'slide' | 'auto-grid' | 'stack' | 'columns' | 'canvas' | 'quote' | 'callout';

const CONTAINER_KINDS: ReadonlySet<string> = new Set<ContainerKind>([
  'slide', 'auto-grid', 'stack', 'columns', 'canvas', 'quote', 'callout',
]);

export function isContainerKind(kind: string): kind is ContainerKind {
  return CONTAINER_KINDS.has(kind);
}

// ─── Self-Closing Detection ──────────────────────────────────────────

type SelfClosingKind = 'metric-card' | 'spacer' | 'divider' | 'image';

const SELF_CLOSING_KINDS: ReadonlySet<string> = new Set<SelfClosingKind>([
  'metric-card', 'spacer', 'divider', 'image',
]);

export function isSelfClosingKind(kind: string): kind is SelfClosingKind {
  return SELF_CLOSING_KINDS.has(kind);
}

// ─── Main Factory Function ───────────────────────────────────────────

export function createNode(
  tag: SpatialTagName,
  id: NodeId,
  parentId: NodeId | null,
  attributes: ReadonlyMap<string, string>,
  offset: number,
): SpatialNode {
  const kind = TAG_TO_KIND[tag];
  const base = {
    id,
    status: 'streaming' as const,
    dirty: makeDirtyFlags(),
    computedRect: null,
    parentId,
    sourceOffset: offset,
  };

  switch (kind) {
    // Layout Containers
    case 'slide':
      return { ...base, kind, props: makeSlideProps(attributes), children: [] };
    case 'auto-grid':
      return { ...base, kind, props: makeAutoGridProps(attributes), children: [] };
    case 'stack':
      return { ...base, kind, props: makeStackProps(attributes), children: [] };
    case 'columns':
      return { ...base, kind, props: makeColumnsProps(attributes), children: [] };
    case 'canvas':
      return { ...base, kind, props: makeCanvasProps(attributes), children: [] };

    // Content Components
    case 'metric-card': {
      const mcProps = makeMetricCardProps(attributes);
      return {
        ...base,
        kind,
        props: { ...mcProps, trend: parseTrend(attributes) },
        children: [] as [],
      };
    }
    case 'code-block':
      return { ...base, kind, props: makeCodeBlockProps(attributes), children: [] as [], textBuffer: makeTextBuffer() };
    case 'data-table':
      return { ...base, kind, props: makeDataTableProps(attributes), children: [] as [], textBuffer: makeTextBuffer() };
    case 'chart':
      return { ...base, kind, props: makeChartProps(attributes), children: [] as [], textBuffer: makeTextBuffer() };
    case 'quote':
      return { ...base, kind, props: makeQuoteProps(attributes), children: [], textBuffer: makeTextBuffer() };
    case 'callout':
      return { ...base, kind, props: makeCalloutProps(attributes), children: [], textBuffer: makeTextBuffer() };

    // Primitives
    case 'text':
      return { ...base, kind, props: makeTextProps(attributes), children: [] as [], textBuffer: makeTextBuffer() };
    case 'heading':
      return { ...base, kind, props: makeHeadingProps(attributes), children: [] as [], textBuffer: makeTextBuffer() };
    case 'spacer':
      return { ...base, kind, props: makeSpacerProps(attributes), children: [] as [] };
    case 'divider':
      return { ...base, kind, props: makeDividerProps(attributes), children: [] as [] };
    case 'image':
      return { ...base, kind, props: makeImageProps(attributes), children: [] as [] };
  }
}
