/**
 * AST node types for the Spatial Markdown engine.
 * Strict discriminated union — no `any`, exhaustive switch checking.
 *
 * @module @spatial/types/ast
 */

import type { Pixels, NodeId, FontDescriptor, Rect } from './primitives';

// ─── Node Status ─────────────────────────────────────────────────────

export type NodeStatus = 'streaming' | 'closed';

// ─── Dirty Flags ─────────────────────────────────────────────────────

export interface DirtyFlags {
  textDirty: boolean;
  constraintDirty: boolean;
  geometryDirty: boolean;
  renderDirty: boolean;
}

// ─── Base Fields ─────────────────────────────────────────────────────

export interface NodeBase {
  readonly id: NodeId;
  status: NodeStatus;
  dirty: DirtyFlags;
  computedRect: Rect | null;
  readonly parentId: NodeId | null;
  readonly sourceOffset: number;
}

// ─── Text Buffer (for streaming nodes) ───────────────────────────────

export interface TextBuffer {
  raw: string;
  lastPrepareLength: number;
}

// ─── Layout Container Props ──────────────────────────────────────────

export interface SlideProps {
  readonly width: Pixels;
  readonly height: Pixels;
  readonly padding: Pixels;
  readonly paddingX: Pixels | undefined;
  readonly paddingY: Pixels | undefined;
  readonly background: string | undefined;
}

export interface AutoGridProps {
  readonly minChildWidth: Pixels;
  readonly gap: Pixels;
  readonly gapX: Pixels | undefined;
  readonly gapY: Pixels | undefined;
  readonly columns: number | 'auto';
  readonly align: 'start' | 'center' | 'stretch';
  readonly padding: Pixels;
}

export interface StackProps {
  readonly direction: 'vertical' | 'horizontal';
  readonly gap: Pixels;
  readonly padding: Pixels;
  readonly paddingX: Pixels | undefined;
  readonly paddingY: Pixels | undefined;
  readonly align: 'start' | 'center' | 'end' | 'stretch';
  readonly justify: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  readonly wrap: boolean;
}

export interface ColumnsProps {
  readonly widths: string;
  readonly gap: Pixels;
  readonly padding: Pixels;
  readonly valign: 'top' | 'center' | 'bottom' | 'stretch';
}

export interface CanvasProps {
  readonly width: Pixels | 'fill';
  readonly height: Pixels | 'auto';
  readonly padding: Pixels;
  readonly background: string | undefined;
  readonly overflow: 'visible' | 'clip';
}

// ─── Content Component Props ─────────────────────────────────────────

export interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly delta: string | undefined;
  readonly trend: 'up' | 'down' | 'flat' | undefined;
  readonly sentiment: 'positive' | 'negative' | 'neutral';
  readonly footer: string | undefined;
  readonly padding: Pixels;
  readonly background: string | undefined;
  readonly borderRadius: Pixels;
}

export interface CodeBlockProps {
  readonly language: string;
  readonly title: string | undefined;
  readonly showLineNumbers: boolean;
  readonly startLine: number;
  readonly highlight: string | undefined;
  readonly maxHeight: Pixels | undefined;
  readonly font: FontDescriptor;
  readonly lineHeight: Pixels;
  readonly padding: Pixels;
  readonly background: string | undefined;
  readonly wrap: boolean;
}

export interface DataTableProps {
  readonly columns: string;
  readonly striped: boolean;
  readonly compact: boolean;
  readonly maxHeight: Pixels | undefined;
  readonly headerBackground: string | undefined;
  readonly font: FontDescriptor;
  readonly headerFont: FontDescriptor;
  readonly lineHeight: Pixels;
  readonly cellPadding: Pixels;
  readonly borderColor: string | undefined;
}

export interface ChartProps {
  readonly type: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  readonly title: string | undefined;
  readonly width: Pixels | 'fill';
  readonly height: Pixels;
  readonly padding: Pixels;
  readonly colors: string;
  readonly showLegend: boolean;
  readonly showGrid: boolean;
  readonly xLabel: string | undefined;
  readonly yLabel: string | undefined;
  readonly animate: boolean;
}

export interface QuoteProps {
  readonly cite: string | undefined;
  readonly variant: 'default' | 'highlight' | 'pull';
  readonly borderColor: string | undefined;
  readonly font: FontDescriptor;
  readonly lineHeight: Pixels;
  readonly padding: Pixels;
  readonly paddingLeft: Pixels;
}

export interface CalloutProps {
  readonly type: 'info' | 'warning' | 'error' | 'success' | 'tip' | 'note';
  readonly title: string;
  readonly icon: boolean;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  readonly padding: Pixels;
  readonly borderRadius: Pixels;
}

// ─── Primitive Props ─────────────────────────────────────────────────

export interface TextProps {
  readonly font: FontDescriptor;
  readonly lineHeight: Pixels;
  readonly color: string | undefined;
  readonly align: 'left' | 'center' | 'right';
  readonly whiteSpace: 'normal' | 'pre-wrap';
  readonly wordBreak: 'normal' | 'keep-all';
  readonly maxLines: number | undefined;
  readonly opacity: number;
}

export interface HeadingProps {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly color: string | undefined;
  readonly align: 'left' | 'center' | 'right';
  readonly marginBottom: Pixels;
}

export interface SpacerProps {
  readonly height: Pixels;
  readonly width: Pixels;
}

export interface DividerProps {
  readonly direction: 'horizontal' | 'vertical';
  readonly thickness: Pixels;
  readonly color: string | undefined;
  readonly marginTop: Pixels;
  readonly marginBottom: Pixels;
  readonly indent: Pixels;
}

export interface ImageProps {
  readonly src: string;
  readonly alt: string;
  readonly width: Pixels | 'fill';
  readonly height: Pixels | 'auto';
  readonly aspectRatio: string;
  readonly fit: 'cover' | 'contain' | 'fill';
  readonly borderRadius: Pixels;
  readonly caption: string | undefined;
  readonly captionFont: FontDescriptor;
}

// ─── AST Node: Discriminated Union ───────────────────────────────────

export type SpatialNode =
  // Layout Containers
  | (NodeBase & { readonly kind: 'slide'; readonly props: SlideProps; children: SpatialNode[] })
  | (NodeBase & { readonly kind: 'auto-grid'; readonly props: AutoGridProps; children: SpatialNode[] })
  | (NodeBase & { readonly kind: 'stack'; readonly props: StackProps; children: SpatialNode[] })
  | (NodeBase & { readonly kind: 'columns'; readonly props: ColumnsProps; children: SpatialNode[] })
  | (NodeBase & { readonly kind: 'canvas'; readonly props: CanvasProps; children: SpatialNode[] })
  // Content Components
  | (NodeBase & { readonly kind: 'metric-card'; readonly props: MetricCardProps; children: [] })
  | (NodeBase & { readonly kind: 'code-block'; readonly props: CodeBlockProps; children: []; textBuffer: TextBuffer })
  | (NodeBase & { readonly kind: 'data-table'; readonly props: DataTableProps; children: []; textBuffer: TextBuffer })
  | (NodeBase & { readonly kind: 'chart'; readonly props: ChartProps; children: []; textBuffer: TextBuffer })
  | (NodeBase & { readonly kind: 'quote'; readonly props: QuoteProps; children: SpatialNode[]; textBuffer: TextBuffer })
  | (NodeBase & { readonly kind: 'callout'; readonly props: CalloutProps; children: SpatialNode[]; textBuffer: TextBuffer })
  // Primitives
  | (NodeBase & { readonly kind: 'text'; readonly props: TextProps; children: []; textBuffer: TextBuffer })
  | (NodeBase & { readonly kind: 'heading'; readonly props: HeadingProps; children: []; textBuffer: TextBuffer })
  | (NodeBase & { readonly kind: 'spacer'; readonly props: SpacerProps; children: [] })
  | (NodeBase & { readonly kind: 'divider'; readonly props: DividerProps; children: [] })
  | (NodeBase & { readonly kind: 'image'; readonly props: ImageProps; children: [] });

// ─── Node Kind Helpers ───────────────────────────────────────────────

export type LayoutContainerKind = 'slide' | 'auto-grid' | 'stack' | 'columns' | 'canvas';
export type ContentComponentKind = 'metric-card' | 'code-block' | 'data-table' | 'chart' | 'quote' | 'callout';
export type PrimitiveKind = 'text' | 'heading' | 'spacer' | 'divider' | 'image';
export type NodeKind = LayoutContainerKind | ContentComponentKind | PrimitiveKind;

// ─── Root Document ───────────────────────────────────────────────────

export interface SpatialDocument {
  readonly version: '1.0';
  children: SpatialNode[];
  readonly nodeIndex: Map<NodeId, SpatialNode>;
  openStack: SpatialNode[];
}
