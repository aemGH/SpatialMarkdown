# Spatial Markdown Engine — Architecture Specification

> **Status:** Accepted (pipeline & module architecture authoritative)  
> **Author:** @software-architect (Layer A — Layout & Geometry)  
> **Version:** 1.0.0  
> **Date:** 2026-04-14  
> **Core Dependency:** `@chenglou/pretext` v0.0.5

> ⚠️ **Canonical AST reference:** `specs/spatial-spec.md` §7 is the authoritative
> definition of the `SpatialNode` discriminated union, all node kinds, and all
> tag names. The TypeScript examples embedded in *this* document's §3
> (Type Architecture) illustrate the *shape* of the type system (branded
> types, discriminated unions, layout/render types) and predate the final
> tag taxonomy. Where the two documents differ on node naming
> (`'Grid'` vs `'auto-grid'`, `'Paragraph'` vs body text, etc.), **the
> implementation and `spatial-spec.md` win**. This document remains
> authoritative for the pipeline architecture, module boundaries,
> incremental update strategy, measurement integration, bridge
> architecture, performance budgets, and ADRs.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Pipeline Design](#2-pipeline-design)
3. [Type Architecture](#3-type-architecture)
4. [Incremental Update Strategy](#4-incremental-update-strategy)
5. [Module Map](#5-module-map)
6. [Pretext Integration Layer](#6-pretext-integration-layer)
7. [Bridge Architecture](#7-bridge-architecture)
8. [Performance Budget](#8-performance-budget)
9. [Package Configuration](#9-package-configuration)
10. [Architectural Decision Records](#10-architectural-decision-records)

---

## 1. Design Philosophy

### Core Invariants

1. **Pretext is the single source of truth for text geometry.** No DOM reads. No `getBoundingClientRect`. No `offsetHeight`. Every pixel of text height comes from `prepare()` → `layout()`.
2. **Separation of measurement and layout.** `prepare()` is expensive (1–5ms). `layout()` is free (~0.0002ms). The architecture must reflect this asymmetry: prepare once, layout many times.
3. **Streaming is the default mode, not a special case.** Every data structure assumes partial data. Every algorithm handles incomplete ASTs. "Batch mode" is just streaming with one chunk.
4. **The type system prevents bugs.** Discriminated unions for AST nodes. Branded types for coordinates. `ReadonlyArray` for immutable collections. Zero `any`. Zero `as` casts outside of the Pretext FFI boundary.
5. **Dependency flows one direction: down.** `types/` ← `parser/` ← `engine/` ← `renderer/`. `bridge/` sits beside the pipeline, not inside it. No circular imports. No layer violations.

### What This Engine Is NOT

- Not a full CSS engine. We implement a constrained subset: block flow, flex rows/columns, grid, and text inline flow.
- Not a browser. We don't handle events, focus, accessibility trees, or DOM APIs.
- Not a Markdown renderer. Spatial Markdown is a DSL that _happens to look like_ Markdown with layout extensions. It produces a render tree, not HTML.

---

## 2. Pipeline Design

### Overview

```
┌─────────┐    ┌────────┐    ┌───────────┐    ┌─────────────┐    ┌──────────────┐
│ LLM     │───▶│ Stream │───▶│ Tokenizer │───▶│ AST Builder │───▶│ Constraint   │
│ Stream  │    │ Buffer │    │           │    │             │    │ Solver       │
└─────────┘    └────────┘    └───────────┘    └─────────────┘    └──────┬───────┘
                                                                        │
┌─────────┐    ┌─────────────┐    ┌───────────────┐    ┌───────────────┐│
│ Renderer│◀───│ Render Tree │◀───│ Geometry      │◀───│ Pretext       │◀┘
│         │    │ Builder     │    │ Calculator    │    │ Measurement   │
└─────────┘    └─────────────┘    └───────────────┘    └───────────────┘
```

### Stage-by-Stage Specification

#### Stage 1: Stream Buffer

| Property | Value |
|----------|-------|
| **Input** | `ReadableStream<string>` (raw UTF-8 chunks from LLM) |
| **Output** | `StreamToken` (buffered, boundary-aligned text chunks) |
| **Budget** | < 0.1ms per chunk |
| **Pretext API** | None |
| **Owner** | `src/bridge/buffer/` |

The buffer accumulates raw text and emits complete tokens at safe boundaries (after whitespace, after closing tags, after newlines). It never splits a UTF-8 codepoint or a DSL tag mid-stream.

**Backpressure:** If the downstream pipeline is slower than the LLM, the buffer accumulates. It signals backpressure to the bridge when buffer size exceeds 64KB (configurable). The bridge then pauses reads from the WebSocket/SSE connection.

```
Chunk: "# Hello\n<Grid cols"  →  emits: StreamToken("# Hello\n")
Chunk: "=2>\nLeft"            →  emits: StreamToken("<Grid cols=2>\n"), StreamToken("Left")
```

#### Stage 2: Tokenizer

| Property | Value |
|----------|-------|
| **Input** | `StreamToken` |
| **Output** | `SpatialToken[]` |
| **Budget** | < 0.5ms per token batch |
| **Pretext API** | None |
| **Owner** | `src/parser/tokenizer/` |

The tokenizer is a state machine that classifies raw text into typed tokens: tag opens, tag closes, attributes, text content, markdown inline markers (bold, italic, code, link). It maintains a small state stack for nested contexts (e.g., inside a `<Code>` block, markdown markers are literal text).

**Streaming contract:** The tokenizer accepts partial input. If a tag is split across two `StreamToken`s, the tokenizer buffers the partial tag and waits. It emits only complete, valid `SpatialToken`s.

#### Stage 3: AST Builder

| Property | Value |
|----------|-------|
| **Input** | `SpatialToken[]` |
| **Output** | `ASTNode` (root of partial or complete tree) |
| **Budget** | < 0.5ms per token batch |
| **Pretext API** | None |
| **Owner** | `src/parser/ast/` |

Incrementally builds and patches the AST. The builder maintains a cursor pointing to the current insertion point. New tokens are appended at the cursor. The builder emits `ASTDelta` events describing what changed (node added, text appended, node closed).

**Critical invariant:** The AST is always valid. Unclosed tags are implicitly open. The builder never produces a malformed tree—it auto-closes tags when a new sibling or parent-closing tag arrives.

#### Stage 4: Constraint Solver

| Property | Value |
|----------|-------|
| **Input** | `ASTNode` (with dirty flags from `ASTDelta`) |
| **Output** | `ConstrainedNode` (AST nodes annotated with size constraints) |
| **Budget** | < 0.5ms per frame |
| **Pretext API** | None |
| **Owner** | `src/engine/constraints/` |

Resolves layout constraints top-down. The root node gets the viewport width. Container nodes (Grid, Flex, Slide) distribute available width to children based on their layout mode. Text nodes receive their `maxWidth` for measurement.

**Constraint propagation is lazy.** Only dirty nodes (and their ancestors up to the nearest clean constraint boundary) are re-resolved. A `<Grid cols=2>` with one new child only recalculates that child's column, not the entire grid.

#### Stage 5: Pretext Measurement

| Property | Value |
|----------|-------|
| **Input** | `ConstrainedNode` (text leaves with maxWidth + font) |
| **Output** | `MeasuredNode` (text leaves annotated with height, lineCount, optionally lines) |
| **Budget** | < 2ms per frame (amortized; individual `prepare()` is 1–5ms, `layout()` is ~0.0002ms) |
| **Pretext API** | `prepare()`, `layout()`, `prepareWithSegments()`, `layoutWithLines()`, `prepareRichInline()` |
| **Owner** | `src/engine/measurement/` |

This is the critical boundary between our engine and Pretext. The `MeasurementCache` (§6) ensures `prepare()` is called only when text content or font changes. `layout()` is called whenever `maxWidth` changes (e.g., on resize or when a parent constraint changes).

**Measurement modes:**

| Mode | When | Pretext API | Cost |
|------|------|-------------|------|
| **Height-only** | Simple paragraph in block flow | `prepare()` + `layout()` | ~1ms first, ~0.0002ms cached |
| **Line-level** | Text that needs per-line positioning (canvas render) | `prepareWithSegments()` + `layoutWithLines()` | ~1ms first, ~0.01ms cached |
| **Variable-width** | Text flowing around obstacles | `prepareWithSegments()` + `layoutNextLineRange()` loop | ~1ms first, ~0.05ms per layout |
| **Rich inline** | Mixed fonts/chips in a single text run | `prepareRichInline()` + `walkRichInlineLineRanges()` | ~2ms first, ~0.02ms cached |

#### Stage 6: Geometry Calculator

| Property | Value |
|----------|-------|
| **Input** | `MeasuredNode` (tree with all heights resolved) |
| **Output** | `LayoutBox` (absolute x, y, width, height for every node) |
| **Budget** | < 1ms per frame |
| **Pretext API** | None (consumes measurement results) |
| **Owner** | `src/engine/geometry/` |

Bottom-up pass that converts the measured tree into absolute coordinates. Parent nodes sum children heights (block flow), distribute along the cross axis (flex), or place in cells (grid). Every `LayoutBox` has absolute page coordinates—no relative offsets that need resolution at render time.

**Layout modes supported:**

| Mode | Description |
|------|-------------|
| `block` | Vertical stacking. Children fill parent width. |
| `flex-row` | Horizontal distribution with gap. Wraps on overflow. |
| `flex-col` | Vertical distribution with gap. |
| `grid` | CSS Grid-like cell placement. Fixed columns, auto rows. |
| `absolute` | Positioned relative to nearest positioned ancestor. |
| `inline` | Text inline flow (delegated to Pretext). |

#### Stage 7: Render Tree Builder

| Property | Value |
|----------|-------|
| **Input** | `LayoutBox` tree |
| **Output** | `RenderCommand[]` (flat list of draw instructions) |
| **Budget** | < 0.5ms per frame |
| **Pretext API** | None |
| **Owner** | `src/renderer/` (shared across all backends) |

Flattens the `LayoutBox` tree into an ordered list of `RenderCommand`s. Each command is a self-contained draw instruction: fill a rectangle, draw text at (x, y), clip a region, draw an image. The list is sorted by z-order.

**Render commands are renderer-agnostic.** The same command list feeds Canvas 2D, React/DOM, or SVG renderers. The renderer is a thin interpreter.

#### Stage 8: Renderer

| Property | Value |
|----------|-------|
| **Input** | `RenderCommand[]` |
| **Output** | Pixels on screen (Canvas), VDOM (React), or SVG DOM |
| **Budget** | < 8ms per frame (within 16ms frame budget, after pipeline overhead) |
| **Pretext API** | None |
| **Owner** | `src/renderer/canvas/`, `src/renderer/react/`, `src/renderer/svg/` |

Three renderer implementations, all sharing the same `RenderCommand` input:

| Renderer | Target | Use Case |
|----------|--------|----------|
| **Canvas** | `<canvas>` 2D context | Highest performance. Streaming artifacts. |
| **React** | React component tree | Integration with React apps. Interactivity. |
| **SVG** | SVG DOM | Export, print, static artifacts. |

---

## 3. Type Architecture

> **Note on AST types:** The `SpatialToken` and `ASTNode` unions shown in
> §3.3 and §3.4 below illustrate the *approach* (discriminated unions,
> `readonly` fields, branded types). The production tag taxonomy and
> node kind names (`'slide'`, `'auto-grid'`, `'metric-card'`, etc.) are
> defined in `specs/spatial-spec.md` §7. When adding or renaming tags,
> update `spatial-spec.md` — not this section.

### 3.1 Branded Types and Primitives

```typescript
// src/types/primitives.ts

/** Pixel value — prevents mixing px with unitless numbers */
type Pixels = number & { readonly __brand: 'Pixels' };

/** Millisecond timestamp */
type Timestamp = number & { readonly __brand: 'Timestamp' };

/** Monotonically increasing ID for nodes */
type NodeId = number & { readonly __brand: 'NodeId' };

/** Frame sequence number */
type FrameId = number & { readonly __brand: 'FrameId' };

/** CSS font shorthand string (e.g., '16px Inter') */
type FontDescriptor = string & { readonly __brand: 'FontDescriptor' };

/** Helper to create branded values */
function px(n: number): Pixels { return n as Pixels; }
function nodeId(n: number): NodeId { return n as NodeId; }
function font(s: string): FontDescriptor { return s as FontDescriptor; }
```

### 3.2 StreamToken

```typescript
// src/types/stream.ts

/** Raw chunk from the LLM stream, boundary-aligned */
interface StreamToken {
  readonly kind: 'stream-token';
  readonly text: string;
  readonly offset: number;        // byte offset in the total stream
  readonly timestamp: Timestamp;  // when the chunk arrived
  readonly isFinal: boolean;      // true if stream is complete after this token
}
```

### 3.3 SpatialToken (Discriminated Union)

```typescript
// src/types/tokens.ts

type SpatialToken =
  | TagOpenToken
  | TagCloseToken
  | TextToken
  | MarkdownInlineToken
  | AttributeToken
  | NewlineToken
  | EOFToken;

interface TagOpenToken {
  readonly kind: 'tag-open';
  readonly tag: SpatialTagName;
  readonly attributes: ReadonlyMap<string, string>;
  readonly selfClosing: boolean;
  readonly offset: number;
}

interface TagCloseToken {
  readonly kind: 'tag-close';
  readonly tag: SpatialTagName;
  readonly offset: number;
}

interface TextToken {
  readonly kind: 'text';
  readonly content: string;
  readonly offset: number;
}

interface MarkdownInlineToken {
  readonly kind: 'md-inline';
  readonly marker: 'bold' | 'italic' | 'code' | 'link' | 'strikethrough';
  readonly action: 'open' | 'close';
  readonly href?: string; // only for 'link' open
  readonly offset: number;
}

interface AttributeToken {
  readonly kind: 'attribute';
  readonly name: string;
  readonly value: string;
  readonly offset: number;
}

interface NewlineToken {
  readonly kind: 'newline';
  readonly count: number; // 1 = soft break, 2+ = paragraph break
  readonly offset: number;
}

interface EOFToken {
  readonly kind: 'eof';
  readonly offset: number;
}

/** All valid spatial tag names */
type SpatialTagName =
  // Layout containers
  | 'Grid' | 'Flex' | 'Stack' | 'Columns'
  // Presentation
  | 'Slide' | 'Card' | 'Panel' | 'Callout'
  // Content
  | 'Code' | 'Chart' | 'Table' | 'Image' | 'Math'
  // Text-level
  | 'Heading' | 'Paragraph' | 'List' | 'ListItem' | 'BlockQuote'
  // Interactive (renderer-dependent)
  | 'Tab' | 'TabGroup' | 'Accordion' | 'AccordionItem'
  // Root
  | 'Document' | 'Section' | 'Fragment';
```

### 3.4 ASTNode (Discriminated Union)

```typescript
// src/types/ast.ts

import type { NodeId, FontDescriptor, Pixels } from './primitives';

/** Every AST node has these fields */
interface ASTNodeBase {
  readonly id: NodeId;
  readonly parent: NodeId | null;
  dirty: boolean;                   // mutable — set by incremental update
  readonly sourceOffset: number;    // position in original stream
}

/** The full discriminated union */
type ASTNode =
  | DocumentNode
  | SectionNode
  | GridNode
  | FlexNode
  | StackNode
  | ColumnsNode
  | SlideNode
  | CardNode
  | PanelNode
  | CalloutNode
  | CodeNode
  | ChartNode
  | TableNode
  | ImageNode
  | MathNode
  | HeadingNode
  | ParagraphNode
  | ListNode
  | ListItemNode
  | BlockQuoteNode
  | TabGroupNode
  | TabNode
  | AccordionNode
  | AccordionItemNode
  | FragmentNode
  | TextSpanNode
  | InlineCodeNode
  | LinkNode
  | EmphasisNode
  | StrongNode;

// ─── Container Nodes ────────────────────────────────────────────

interface DocumentNode extends ASTNodeBase {
  readonly kind: 'Document';
  readonly children: ASTNode[];
  readonly meta: ReadonlyMap<string, string>;
}

interface SectionNode extends ASTNodeBase {
  readonly kind: 'Section';
  readonly children: ASTNode[];
  readonly level: number; // 1–6
}

interface GridNode extends ASTNodeBase {
  readonly kind: 'Grid';
  readonly children: ASTNode[];
  readonly cols: number;
  readonly gap: Pixels;
  readonly rowGap?: Pixels;
  readonly colGap?: Pixels;
}

interface FlexNode extends ASTNodeBase {
  readonly kind: 'Flex';
  readonly children: ASTNode[];
  readonly direction: 'row' | 'column';
  readonly gap: Pixels;
  readonly wrap: boolean;
  readonly justify: 'start' | 'center' | 'end' | 'between' | 'around';
  readonly align: 'start' | 'center' | 'end' | 'stretch';
}

interface StackNode extends ASTNodeBase {
  readonly kind: 'Stack';
  readonly children: ASTNode[];
  readonly gap: Pixels;
}

interface ColumnsNode extends ASTNodeBase {
  readonly kind: 'Columns';
  readonly children: ASTNode[];
  readonly widths?: ReadonlyArray<string>; // e.g. ['1fr', '2fr'] or ['300px', 'auto']
  readonly gap: Pixels;
}

// ─── Presentation Nodes ─────────────────────────────────────────

interface SlideNode extends ASTNodeBase {
  readonly kind: 'Slide';
  readonly children: ASTNode[];
  readonly background?: string;
  readonly padding: Pixels;
}

interface CardNode extends ASTNodeBase {
  readonly kind: 'Card';
  readonly children: ASTNode[];
  readonly padding: Pixels;
  readonly borderRadius: Pixels;
  readonly elevation: 0 | 1 | 2 | 3;
}

interface PanelNode extends ASTNodeBase {
  readonly kind: 'Panel';
  readonly children: ASTNode[];
  readonly title?: string;
  readonly collapsible: boolean;
  readonly padding: Pixels;
}

interface CalloutNode extends ASTNodeBase {
  readonly kind: 'Callout';
  readonly children: ASTNode[];
  readonly variant: 'info' | 'warning' | 'error' | 'success' | 'note';
  readonly title?: string;
  readonly padding: Pixels;
}

// ─── Content Nodes ──────────────────────────────────────────────

interface CodeNode extends ASTNodeBase {
  readonly kind: 'Code';
  readonly language: string;
  readonly content: string;          // raw code text (mutable during streaming)
  readonly font: FontDescriptor;     // monospace font
  readonly lineNumbers: boolean;
}

interface ChartNode extends ASTNodeBase {
  readonly kind: 'Chart';
  readonly chartType: 'bar' | 'line' | 'pie' | 'scatter' | 'area';
  readonly data: string;             // JSON-serialized data
  readonly title?: string;
}

interface TableNode extends ASTNodeBase {
  readonly kind: 'Table';
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly columnAligns?: ReadonlyArray<'left' | 'center' | 'right'>;
}

interface ImageNode extends ASTNodeBase {
  readonly kind: 'Image';
  readonly src: string;
  readonly alt: string;
  readonly width?: Pixels;
  readonly height?: Pixels;
  readonly aspectRatio?: number;
}

interface MathNode extends ASTNodeBase {
  readonly kind: 'Math';
  readonly expression: string; // LaTeX or AsciiMath
  readonly display: 'inline' | 'block';
}

// ─── Text-Level Block Nodes ─────────────────────────────────────

interface HeadingNode extends ASTNodeBase {
  readonly kind: 'Heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly children: InlineNode[];
  readonly font: FontDescriptor;
}

interface ParagraphNode extends ASTNodeBase {
  readonly kind: 'Paragraph';
  readonly children: InlineNode[];
  readonly font: FontDescriptor;
}

interface ListNode extends ASTNodeBase {
  readonly kind: 'List';
  readonly children: ListItemNode[];
  readonly ordered: boolean;
  readonly start?: number;
}

interface ListItemNode extends ASTNodeBase {
  readonly kind: 'ListItem';
  readonly children: ASTNode[]; // can contain nested blocks
  readonly marker: string;      // '•', '1.', 'a)', etc.
}

interface BlockQuoteNode extends ASTNodeBase {
  readonly kind: 'BlockQuote';
  readonly children: ASTNode[];
  readonly cite?: string;
}

// ─── Interactive Nodes ──────────────────────────────────────────

interface TabGroupNode extends ASTNodeBase {
  readonly kind: 'TabGroup';
  readonly children: TabNode[];
  readonly activeTab: number;
}

interface TabNode extends ASTNodeBase {
  readonly kind: 'Tab';
  readonly children: ASTNode[];
  readonly label: string;
}

interface AccordionNode extends ASTNodeBase {
  readonly kind: 'Accordion';
  readonly children: AccordionItemNode[];
}

interface AccordionItemNode extends ASTNodeBase {
  readonly kind: 'AccordionItem';
  readonly children: ASTNode[];
  readonly title: string;
  readonly expanded: boolean;
}

interface FragmentNode extends ASTNodeBase {
  readonly kind: 'Fragment';
  readonly children: ASTNode[];
}

// ─── Inline Nodes ───────────────────────────────────────────────

type InlineNode = TextSpanNode | InlineCodeNode | LinkNode | EmphasisNode | StrongNode;

interface TextSpanNode extends ASTNodeBase {
  readonly kind: 'TextSpan';
  content: string;  // mutable — text accumulates during streaming
}

interface InlineCodeNode extends ASTNodeBase {
  readonly kind: 'InlineCode';
  readonly content: string;
  readonly font: FontDescriptor;
}

interface LinkNode extends ASTNodeBase {
  readonly kind: 'Link';
  readonly children: InlineNode[];
  readonly href: string;
  readonly title?: string;
}

interface EmphasisNode extends ASTNodeBase {
  readonly kind: 'Emphasis';
  readonly children: InlineNode[];
}

interface StrongNode extends ASTNodeBase {
  readonly kind: 'Strong';
  readonly children: InlineNode[];
}
```

### 3.5 Layout Types

```typescript
// src/types/layout.ts

import type { NodeId, Pixels, FontDescriptor } from './primitives';
import type { ASTNode } from './ast';
import type { PreparedText, PreparedTextWithSegments, LayoutLine } from '@chenglou/pretext';

/** Constraints flow top-down */
interface LayoutConstraints {
  readonly maxWidth: Pixels;
  readonly maxHeight: Pixels | null;  // null = unconstrained
  readonly availableWidth: Pixels;    // remaining width in parent
  readonly availableHeight: Pixels | null;
}

/** Measurement result — attached to text-bearing nodes after Pretext runs */
type MeasurementResult =
  | HeightOnlyMeasurement
  | LineDetailMeasurement
  | RichInlineMeasurement;

interface HeightOnlyMeasurement {
  readonly kind: 'height-only';
  readonly height: Pixels;
  readonly lineCount: number;
  readonly prepared: PreparedText;
}

interface LineDetailMeasurement {
  readonly kind: 'line-detail';
  readonly height: Pixels;
  readonly lineCount: number;
  readonly lines: ReadonlyArray<LayoutLine>;
  readonly prepared: PreparedTextWithSegments;
}

interface RichInlineMeasurement {
  readonly kind: 'rich-inline';
  readonly height: Pixels;
  readonly lineCount: number;
  readonly fragments: ReadonlyArray<ReadonlyArray<RichInlineFragmentInfo>>;
}

interface RichInlineFragmentInfo {
  readonly text: string;
  readonly font: FontDescriptor;
  readonly x: Pixels;
  readonly width: Pixels;
}

/** The final layout box — absolute coordinates, ready for rendering */
interface LayoutBox {
  readonly nodeId: NodeId;
  readonly kind: ASTNode['kind'];
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly contentX: Pixels;      // x + paddingLeft
  readonly contentY: Pixels;      // y + paddingTop
  readonly contentWidth: Pixels;  // width - paddingLeft - paddingRight
  readonly contentHeight: Pixels; // height - paddingTop - paddingBottom
  readonly children: ReadonlyArray<LayoutBox>;
  readonly measurement: MeasurementResult | null; // non-null for text-bearing nodes
  readonly clipChildren: boolean;
  readonly scrollable: boolean;
  readonly zIndex: number;
}

/** Edge insets (padding, margin) */
interface EdgeInsets {
  readonly top: Pixels;
  readonly right: Pixels;
  readonly bottom: Pixels;
  readonly left: Pixels;
}
```

### 3.6 Render Commands

```typescript
// src/types/render.ts

import type { Pixels, FontDescriptor, NodeId } from './primitives';

/** Flat, ordered draw instructions. Renderer-agnostic. */
type RenderCommand =
  | FillRectCommand
  | StrokeRectCommand
  | FillTextCommand
  | FillRichTextCommand
  | DrawImageCommand
  | ClipRectCommand
  | RestoreClipCommand
  | DrawBorderCommand
  | DrawShadowCommand
  | DrawLineCommand
  | DrawCodeBlockCommand
  | CustomRenderCommand;

interface FillRectCommand {
  readonly kind: 'fill-rect';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly color: string;
  readonly borderRadius: Pixels;
}

interface StrokeRectCommand {
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

interface FillTextCommand {
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

interface FillRichTextCommand {
  readonly kind: 'fill-rich-text';
  readonly nodeId: NodeId;
  readonly lines: ReadonlyArray<{
    readonly fragments: ReadonlyArray<{
      readonly text: string;
      readonly x: Pixels;
      readonly y: Pixels;
      readonly font: FontDescriptor;
      readonly color: string;
    }>;
  }>;
}

interface DrawImageCommand {
  readonly kind: 'draw-image';
  readonly nodeId: NodeId;
  readonly src: string;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
}

interface ClipRectCommand {
  readonly kind: 'clip-rect';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly borderRadius: Pixels;
}

interface RestoreClipCommand {
  readonly kind: 'restore-clip';
  readonly nodeId: NodeId;
}

interface DrawBorderCommand {
  readonly kind: 'draw-border';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly color: string;
  readonly widths: { top: Pixels; right: Pixels; bottom: Pixels; left: Pixels };
  readonly borderRadius: Pixels;
}

interface DrawShadowCommand {
  readonly kind: 'draw-shadow';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly color: string;
  readonly blur: Pixels;
  readonly offsetX: Pixels;
  readonly offsetY: Pixels;
  readonly borderRadius: Pixels;
}

interface DrawLineCommand {
  readonly kind: 'draw-line';
  readonly nodeId: NodeId;
  readonly x1: Pixels;
  readonly y1: Pixels;
  readonly x2: Pixels;
  readonly y2: Pixels;
  readonly color: string;
  readonly lineWidth: Pixels;
  readonly dashPattern?: ReadonlyArray<number>;
}

interface DrawCodeBlockCommand {
  readonly kind: 'draw-code-block';
  readonly nodeId: NodeId;
  readonly x: Pixels;
  readonly y: Pixels;
  readonly width: Pixels;
  readonly height: Pixels;
  readonly lines: ReadonlyArray<{
    readonly tokens: ReadonlyArray<{
      readonly text: string;
      readonly color: string;
      readonly x: Pixels;
    }>;
    readonly y: Pixels;
  }>;
  readonly font: FontDescriptor;
  readonly background: string;
  readonly gutterWidth: Pixels;
  readonly lineHeight: Pixels;
}

interface CustomRenderCommand {
  readonly kind: 'custom';
  readonly nodeId: NodeId;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly bounds: { x: Pixels; y: Pixels; width: Pixels; height: Pixels };
}
```

### 3.7 AST Delta Events

```typescript
// src/types/delta.ts

import type { NodeId } from './primitives';
import type { ASTNode } from './ast';

/** Describes a single incremental change to the AST */
type ASTDelta =
  | NodeAddedDelta
  | NodeRemovedDelta
  | TextAppendedDelta
  | TextReplacedDelta
  | NodeClosedDelta
  | AttributeChangedDelta;

interface NodeAddedDelta {
  readonly kind: 'node-added';
  readonly nodeId: NodeId;
  readonly parentId: NodeId;
  readonly index: number;         // position among siblings
  readonly node: ASTNode;
}

interface NodeRemovedDelta {
  readonly kind: 'node-removed';
  readonly nodeId: NodeId;
  readonly parentId: NodeId;
}

interface TextAppendedDelta {
  readonly kind: 'text-appended';
  readonly nodeId: NodeId;
  readonly appendedText: string;
  readonly newFullText: string;
}

interface TextReplacedDelta {
  readonly kind: 'text-replaced';
  readonly nodeId: NodeId;
  readonly oldText: string;
  readonly newText: string;
}

interface NodeClosedDelta {
  readonly kind: 'node-closed';
  readonly nodeId: NodeId;
}

interface AttributeChangedDelta {
  readonly kind: 'attribute-changed';
  readonly nodeId: NodeId;
  readonly attribute: string;
  readonly oldValue: string | undefined;
  readonly newValue: string;
}
```

---

## 4. Incremental Update Strategy

### 4.1 The Problem

LLM tokens arrive at 50–200 tokens/second. Each token is ~4 characters. Naively remeasuring and relaying out the entire tree on every token would be catastrophic: 200 `prepare()` calls/second × 1–5ms each = 200–1000ms/second just in measurement. We need an incremental strategy that does the minimum work per frame.

### 4.2 Three-Phase Dirty Propagation

```
Token arrives → AST patch → dirty flags set → frame boundary →
  Phase 1: Collect dirty text leaves (need re-prepare)
  Phase 2: Collect dirty constraint nodes (need re-layout)
  Phase 3: Collect dirty geometry ancestors (need re-position)
```

#### Phase 1: Text Dirty (Remeasurement Required)

A text node is "text-dirty" when its `content` string changes. This is the only condition that triggers a `prepare()` call.

```typescript
// Dirty flag structure on each node
interface DirtyFlags {
  textDirty: boolean;        // content changed → need re-prepare()
  constraintDirty: boolean;  // available width changed → need re-layout()
  geometryDirty: boolean;    // child sizes changed → need re-position
  renderDirty: boolean;      // position/size changed → need re-render
}
```

**Optimization: Text batching.** During streaming, text tokens for the same paragraph node accumulate. We batch them: the `TextSpanNode.content` is mutated with each token, but the `textDirty` flag is only checked once per frame. This means if 10 tokens arrive in one frame (16ms), we call `prepare()` once with the full accumulated text, not 10 times.

#### Phase 2: Constraint Dirty (Re-layout Required)

A node is "constraint-dirty" when:
- Its parent's available width changes (e.g., viewport resize)
- A sibling was added/removed (e.g., new grid child)
- Its own layout-affecting attributes change (e.g., `cols` on a Grid)

Constraint dirtiness does NOT require `prepare()` — only `layout()` on already-prepared text. Since `layout()` is ~0.0002ms, this phase is effectively free.

#### Phase 3: Geometry Dirty (Re-position Required)

A node is "geometry-dirty" when:
- Any child's height changed (after measurement or constraint resolution)
- Its own position needs recalculation due to sibling height changes

This propagates upward: if a paragraph's height changes, its parent Stack, then the parent Grid cell, then the Grid itself, all need re-positioning.

### 4.3 Frame Batching

```
                    Time →
 LLM tokens:     t1  t2  t3  t4  t5  t6  t7  t8  t9  ...
 Frame boundary:  ─────────|────────────|─────────────|──
 Frame 1:                  ▼                          
   AST has: t1+t2+t3      Process dirty set {A, B}
 Frame 2:                               ▼
   AST has: t1..t6                       Process dirty set {A}
 Frame 3:                                             ▼
   AST has: t1..t9                                    Process dirty set {A, C}
```

The pipeline runs on `requestAnimationFrame`. Between frames, tokens accumulate and dirty flags collect. At frame start, the pipeline:

1. **Freezes** the dirty set (no more mutations until render)
2. **Collects** all text-dirty leaves → batch `prepare()` calls
3. **Re-layouts** all constraint-dirty text nodes → batch `layout()` calls
4. **Re-positions** all geometry-dirty ancestors → single tree walk
5. **Diffs** the new `LayoutBox` tree against the previous one → `RenderCommand` delta
6. **Renders** only changed commands

### 4.4 PreparedText Cache Lifecycle

```typescript
// Cache key is (text_content, font_descriptor, white_space_mode)
type MeasurementCacheKey = `${string}|${FontDescriptor}|${'normal' | 'pre-wrap'}`;
```

**Cache entries have three states:**

```
EMPTY → PREPARING → READY → STALE → PREPARING → READY → ...
                                ↑
                          text changed
```

| State | PreparedText | layout() callable | Action needed |
|-------|-------------|-------------------|---------------|
| EMPTY | null | no | Call `prepare()` |
| PREPARING | null | no | Waiting (async in rare cases) |
| READY | valid handle | yes | None — use `layout()` freely |
| STALE | old handle | yes (old result) | Recycle entry, call `prepare()` with new text |

**When STALE:** We keep the old PreparedText handle alive until the new `prepare()` completes. This means the renderer can still use the old measurement for one frame, preventing layout shift during streaming.

### 4.5 Intelligent Dirty Minimization

**Key insight for streaming:** During LLM streaming, only one text node is actively receiving tokens at a time (the "cursor" node). This means:

- Only **1 `prepare()` call per frame** in the common case
- Only **1 upward geometry propagation** per frame
- Siblings of the cursor node are never dirty

**When this breaks:** LLM emits a new block-level tag (e.g., closing a paragraph and opening a new one). Now we have a new node, which triggers `node-added` → parent geometry dirty. But the old paragraph is now closed and clean. Still only ~1 measurement per frame.

**Worst case:** Viewport resize. Every text node needs `layout()` (but not `prepare()`). For 100 text nodes, that's 100 × 0.0002ms = 0.02ms. Well within budget.

---

## 5. Module Map

### 5.1 `src/types/` — Shared Type Definitions

No runtime code. Only type declarations. Every other module imports from here.

```
src/types/
├── primitives.ts      — Branded types (Pixels, NodeId, FontDescriptor, etc.)
│                        Exports: Pixels, NodeId, FrameId, Timestamp, FontDescriptor
│                        Exports: px(), nodeId(), font() constructor helpers
│                        Dependencies: none
│
├── tokens.ts          — SpatialToken discriminated union, SpatialTagName
│                        Exports: SpatialToken, SpatialTagName, all token interfaces
│                        Dependencies: primitives.ts
│
├── ast.ts             — ASTNode discriminated union, all node interfaces
│                        Exports: ASTNode, InlineNode, all node interfaces
│                        Exports: ASTNodeBase, DirtyFlags
│                        Dependencies: primitives.ts
│
├── delta.ts           — ASTDelta events for incremental updates
│                        Exports: ASTDelta, all delta interfaces
│                        Dependencies: primitives.ts, ast.ts
│
├── layout.ts          — LayoutConstraints, MeasurementResult, LayoutBox, EdgeInsets
│                        Exports: LayoutConstraints, MeasurementResult, LayoutBox, EdgeInsets
│                        Dependencies: primitives.ts, ast.ts, @chenglou/pretext (types only)
│
├── render.ts          — RenderCommand discriminated union
│                        Exports: RenderCommand, all command interfaces
│                        Dependencies: primitives.ts
│
├── stream.ts          — StreamToken, bridge message types
│                        Exports: StreamToken, BridgeMessage, BackpressureSignal
│                        Dependencies: primitives.ts
│
├── theme.ts           — ThemeConfig, ColorPalette, TypographyScale
│                        Exports: ThemeConfig, ColorPalette, TypographyScale, defaultTheme
│                        Dependencies: primitives.ts
│
└── index.ts           — Barrel re-export of all types
                         Dependencies: all of the above
```

### 5.2 `src/parser/tokenizer/` — Stream → SpatialTokens

```
src/parser/tokenizer/
├── state-machine.ts   — Core tokenizer state machine
│                        Exports: TokenizerState, createTokenizer(), feedTokenizer()
│                        Dependencies: types/tokens, types/stream
│                        Details: Implements a 12-state FSM:
│                          INITIAL → TAG_OPEN → TAG_NAME → ATTR_NAME → ATTR_VALUE →
│                          TAG_CLOSE → TEXT → MD_MARKER → CODE_FENCE → CODE_BODY →
│                          COMMENT → ERROR
│                        Each state transition emits zero or more SpatialTokens.
│
├── patterns.ts        — Regex patterns and matchers for DSL syntax
│                        Exports: TAG_OPEN_RE, TAG_CLOSE_RE, MD_BOLD_RE, MD_ITALIC_RE,
│                                 MD_CODE_RE, MD_LINK_RE, MD_HEADING_RE, isTagName()
│                        Dependencies: types/tokens (SpatialTagName)
│
├── buffer.ts          — Partial-input buffer for incomplete tokens
│                        Exports: TokenBuffer, createTokenBuffer(), drainBuffer()
│                        Dependencies: none
│                        Details: Accumulates bytes until a complete token boundary.
│                          Handles split UTF-8 sequences and split DSL tags.
│
└── index.ts           — Public API
                         Exports: Tokenizer (class wrapping state machine + buffer)
                         API: tokenizer.feed(streamToken) → SpatialToken[]
                              tokenizer.flush() → SpatialToken[] (emit buffered + EOF)
                         Dependencies: state-machine.ts, buffer.ts
```

### 5.3 `src/parser/ast/` — SpatialTokens → AST

```
src/parser/ast/
├── builder.ts         — Incremental AST builder
│                        Exports: ASTBuilder, createASTBuilder()
│                        Dependencies: types/ast, types/tokens, types/delta, id-generator.ts
│                        API: builder.push(tokens: SpatialToken[]) → ASTDelta[]
│                             builder.getRoot() → DocumentNode
│                             builder.getNode(id: NodeId) → ASTNode | undefined
│                        Details: Maintains an open-element stack. Tokens are processed
│                          sequentially. Tag-open pushes to stack, tag-close pops.
│                          Text tokens append to the current open text span (or create one).
│                          Returns deltas describing every mutation.
│
├── id-generator.ts    — Monotonic NodeId allocator
│                        Exports: IdGenerator, createIdGenerator()
│                        Dependencies: types/primitives
│                        Details: Simple incrementing counter. IDs are never reused.
│                          Enables O(1) lookups in the node map.
│
├── node-factory.ts    — Factory functions for creating typed AST nodes
│                        Exports: createDocumentNode(), createGridNode(), createParagraphNode(),
│                                 createTextSpanNode(), ... (one per ASTNode variant)
│                        Dependencies: types/ast, types/primitives, id-generator.ts
│                        Details: Each factory applies defaults (e.g., Grid gap=16px,
│                          Card padding=16px). Parses attribute strings into typed fields.
│
├── node-map.ts        — O(1) NodeId → ASTNode lookup table
│                        Exports: NodeMap, createNodeMap()
│                        Dependencies: types/ast, types/primitives
│                        API: map.set(id, node), map.get(id), map.delete(id), map.size
│                        Details: Flat Map<NodeId, ASTNode>. Avoids tree traversal for
│                          random access. Updated by the builder on every mutation.
│
├── validators.ts      — AST structural validation rules
│                        Exports: validateNode(), validateTree(), ValidationError
│                        Dependencies: types/ast
│                        Details: Checks nesting rules (e.g., ListItem must be child of List,
│                          Tab must be child of TabGroup). Runs on debug builds only.
│
└── index.ts           — Public API
                         Exports: ASTBuilder, NodeMap (re-exports)
                         Dependencies: builder.ts, node-map.ts
```

### 5.4 `src/parser/transforms/` — AST → AST Passes

```
src/parser/transforms/
├── auto-paragraph.ts  — Wraps bare text runs in ParagraphNode
│                        Exports: autoParagraph(root: DocumentNode) → ASTDelta[]
│                        Dependencies: types/ast, types/delta
│
├── heading-levels.ts  — Normalizes heading levels (e.g., # inside a Section)
│                        Exports: normalizeHeadings(root: DocumentNode) → ASTDelta[]
│                        Dependencies: types/ast, types/delta
│
├── font-resolver.ts   — Resolves font descriptors for text nodes from theme
│                        Exports: resolveFonts(root: DocumentNode, theme: ThemeConfig) → ASTDelta[]
│                        Dependencies: types/ast, types/delta, types/theme
│                        Details: Walks the tree, applying font descriptors based on node kind
│                          and theme configuration. Heading levels get display fonts, paragraphs
│                          get body fonts, code nodes get mono fonts.
│
├── list-numbering.ts  — Resolves ordered list numbering (1. 2. 3. ...)
│                        Exports: resolveListNumbers(root: DocumentNode) → ASTDelta[]
│                        Dependencies: types/ast, types/delta
│
└── index.ts           — Ordered transform pipeline
                         Exports: runTransforms(root: DocumentNode, theme: ThemeConfig) → ASTDelta[]
                         Dependencies: all transform files
                         Details: Runs transforms in order: autoParagraph → headingLevels →
                           fontResolver → listNumbering. Returns aggregated deltas.
```

### 5.5 `src/engine/constraints/` — Top-Down Constraint Resolution

```
src/engine/constraints/
├── solver.ts          — Main constraint solver
│                        Exports: ConstraintSolver, createConstraintSolver()
│                        Dependencies: types/ast, types/layout, layout-modes/*.ts
│                        API: solver.solve(root: ASTNode, viewport: { width: Pixels, height: Pixels })
│                             → Map<NodeId, LayoutConstraints>
│                             solver.solveDirty(dirtyNodes: Set<NodeId>, constraints: Map<...>)
│                             → Map<NodeId, LayoutConstraints>  // incremental
│                        Details: Top-down tree walk. Parent computes child constraints based
│                          on its own constraints and its layout mode.
│
├── layout-modes/
│   ├── block.ts       — Block flow: children get parent's full width
│   ├── flex.ts        — Flex: distributes width based on direction, gap, and children count
│   ├── grid.ts        — Grid: divides width into columns, accounting for gaps
│   └── absolute.ts    — Absolute: children get explicit or parent's full width
│                        Each exports: resolveConstraints(node, parentConstraints) → LayoutConstraints[]
│                        Dependencies: types/ast, types/layout
│
└── index.ts           — Public API
                         Exports: ConstraintSolver (re-export)
                         Dependencies: solver.ts
```

### 5.6 `src/engine/measurement/` — Pretext Integration

```
src/engine/measurement/
├── cache.ts           — MeasurementCache: (text + font + options) → PreparedText
│                        Exports: MeasurementCache, createMeasurementCache()
│                        Dependencies: types/primitives, @chenglou/pretext
│                        API: cache.prepare(text, font, options?) → PreparedText
│                             cache.prepareWithSegments(text, font, options?) → PreparedTextWithSegments
│                             cache.prepareRichInline(items) → PreparedRichInline
│                             cache.invalidate(text, font) → void
│                             cache.invalidateAll() → void
│                             cache.stats() → { size, hits, misses, hitRatio }
│                        Details: LRU cache with max 2048 entries. Key is
│                          `${text}|${font}|${whiteSpace}`. Eviction is LRU.
│                          See §6 for full design.
│
├── measurer.ts        — Orchestrates measurement for a dirty set of nodes
│                        Exports: Measurer, createMeasurer()
│                        Dependencies: cache.ts, types/ast, types/layout, @chenglou/pretext
│                        API: measurer.measureDirtyNodes(
│                               nodes: ReadonlyArray<ASTNode>,
│                               constraints: Map<NodeId, LayoutConstraints>
│                             ) → Map<NodeId, MeasurementResult>
│                        Details: Batches text nodes by measurement mode (§2 Stage 5).
│                          Calls cache.prepare() for text-dirty nodes, then layout() for all.
│
├── font-loader.ts     — Ensures fonts are loaded before prepare() is called
│                        Exports: FontLoader, createFontLoader()
│                        Dependencies: types/primitives
│                        API: loader.ensureLoaded(font: FontDescriptor) → Promise<void>
│                             loader.isLoaded(font: FontDescriptor) → boolean
│                             loader.preload(fonts: FontDescriptor[]) → Promise<void>
│                        Details: Uses document.fonts.load() with a fallback polling mechanism.
│                          Caches loaded state. The pipeline blocks on font loading before
│                          first measurement (but never blocks the streaming buffer).
│
├── text-collector.ts  — Extracts measurable text content from AST nodes
│                        Exports: collectText(node: ASTNode) → TextMeasurementRequest[]
│                        Dependencies: types/ast, types/primitives
│                        Details: For a ParagraphNode with mixed inline children (bold, italic,
│                          links), produces RichInlineItem[] for prepareRichInline(). For plain
│                          text, produces a single string. For code blocks, produces pre-wrap text.
│
└── index.ts           — Public API
                         Exports: MeasurementCache, Measurer, FontLoader (re-exports)
                         Dependencies: cache.ts, measurer.ts, font-loader.ts
```

### 5.7 `src/engine/geometry/` — Bottom-Up Position Calculation

```
src/engine/geometry/
├── calculator.ts      — Main geometry calculator
│                        Exports: GeometryCalculator, createGeometryCalculator()
│                        Dependencies: types/ast, types/layout, layout-algorithms/*.ts
│                        API: calc.calculate(
│                               root: ASTNode,
│                               constraints: Map<NodeId, LayoutConstraints>,
│                               measurements: Map<NodeId, MeasurementResult>
│                             ) → LayoutBox
│                             calc.recalculateDirty(
│                               prevTree: LayoutBox,
│                               dirtyNodes: Set<NodeId>,
│                               constraints: Map<...>,
│                               measurements: Map<...>
│                             ) → LayoutBox  // structural sharing with prevTree
│                        Details: Bottom-up pass. Leaf nodes have known sizes (from measurement
│                          or explicit dimensions). Parents compute their size from children.
│                          Positions are assigned top-down after sizes are known.
│
├── layout-algorithms/
│   ├── block-flow.ts  — Vertical stacking with margins and spacing
│   │                    Exports: layoutBlockFlow(children, constraints) → ChildPosition[]
│   │
│   ├── flex-layout.ts — Single-axis flex distribution (row or column)
│   │                    Exports: layoutFlex(children, direction, gap, justify, align, constraints)
│   │                             → ChildPosition[]
│   │
│   ├── grid-layout.ts — Grid cell placement and track sizing
│   │                    Exports: layoutGrid(children, cols, gap, constraints) → ChildPosition[]
│   │
│   └── types.ts       — Shared types for layout algorithms
│                        Exports: ChildPosition { x, y, width, height }
│                        Dependencies: types/primitives
│
├── box-model.ts       — Padding, margin, and border calculations
│                        Exports: computeEdgeInsets(node: ASTNode, theme: ThemeConfig) → EdgeInsets
│                                 applyInsets(box: LayoutBox, insets: EdgeInsets) → LayoutBox
│                        Dependencies: types/ast, types/layout, types/theme
│
├── tree-differ.ts     — Structural diff between old and new LayoutBox trees
│                        Exports: diffLayoutTrees(oldTree: LayoutBox, newTree: LayoutBox)
│                                 → LayoutDiff[]
│                        Dependencies: types/layout
│                        Details: Returns a minimal set of changed boxes. Used by the
│                          render tree builder to emit only changed RenderCommands.
│                          Compares by nodeId, position, and size — not deep equality.
│
└── index.ts           — Public API
                         Exports: GeometryCalculator, diffLayoutTrees (re-exports)
                         Dependencies: calculator.ts, tree-differ.ts
```

### 5.8 `src/renderer/` — Render Command Generation + Backends

```
src/renderer/
├── command-builder.ts — Converts LayoutBox tree → RenderCommand[]
│                        Exports: buildRenderCommands(tree: LayoutBox, theme: ThemeConfig)
│                                 → RenderCommand[]
│                                 buildDeltaCommands(diff: LayoutDiff[], theme: ThemeConfig)
│                                 → { added: RenderCommand[], removed: NodeId[], updated: RenderCommand[] }
│                        Dependencies: types/layout, types/render, types/theme
│                        Details: Walks the LayoutBox tree in z-order. For each box, emits
│                          the appropriate RenderCommands (background, border, shadow, text, etc.)
│
├── canvas/
│   ├── canvas-renderer.ts  — Canvas 2D rendering backend
│   │                         Exports: CanvasRenderer, createCanvasRenderer()
│   │                         Dependencies: types/render
│   │                         API: renderer.render(commands: RenderCommand[]) → void
│   │                              renderer.renderDelta(delta) → void  // incremental
│   │                              renderer.resize(width, height) → void
│   │                              renderer.setDPR(dpr: number) → void
│   │                         Details: Maintains a canvas context. Maps each RenderCommand kind
│   │                           to canvas API calls. Uses save/restore for clipping.
│   │                           Supports HiDPI via device pixel ratio scaling.
│   │
│   └── index.ts
│
├── react/
│   ├── react-renderer.tsx  — React component renderer
│   │                         Exports: SpatialMarkdownView (React component)
│   │                         Dependencies: types/render, types/layout
│   │                         Props: { commands: RenderCommand[], width: Pixels, height: Pixels }
│   │                         Details: Maps RenderCommands to absolutely-positioned divs/spans.
│   │                           Uses React.memo aggressively — each command maps to a keyed
│   │                           component (keyed by nodeId). React's reconciler handles diffing.
│   │
│   ├── hooks.ts            — React hooks for the pipeline
│   │                         Exports: useSpatialMarkdown(source: ReadableStream | string)
│   │                                  → { commands: RenderCommand[], width, height, isStreaming }
│   │                         Dependencies: full pipeline (parser, engine, renderer)
│   │                         Details: The primary React integration point. Manages the entire
│   │                           pipeline lifecycle. Uses useEffect for stream subscription,
│   │                           requestAnimationFrame for batching.
│   │
│   └── index.ts
│
├── svg/
│   ├── svg-renderer.ts     — SVG rendering backend
│   │                         Exports: SVGRenderer, createSVGRenderer()
│   │                         Dependencies: types/render
│   │                         API: renderer.render(commands: RenderCommand[]) → SVGElement
│   │                              renderer.renderToString(commands: RenderCommand[]) → string
│   │                         Details: Produces SVG DOM or SVG string. Useful for export,
│   │                           server-side rendering, and print.
│   │
│   └── index.ts
│
└── index.ts               — Public renderer API
                             Exports: buildRenderCommands, CanvasRenderer, SVGRenderer,
                                      SpatialMarkdownView, useSpatialMarkdown
```

### 5.9 `src/bridge/` — Python ↔ TypeScript Integration

```
src/bridge/
├── buffer/
│   ├── ring-buffer.ts      — Fixed-size ring buffer for incoming stream data
│   │                         Exports: RingBuffer<T>, createRingBuffer()
│   │                         Dependencies: none
│   │                         API: buffer.write(item) → boolean (false = full)
│   │                              buffer.read() → T | undefined
│   │                              buffer.size → number
│   │                              buffer.capacity → number
│   │
│   ├── backpressure.ts     — Backpressure controller
│   │                         Exports: BackpressureController, createBackpressureController()
│   │                         Dependencies: ring-buffer.ts, types/stream
│   │                         API: controller.shouldPause() → boolean
│   │                              controller.onDrain(callback) → void
│   │                         Details: Monitors buffer fill ratio. Pauses upstream when
│   │                           buffer is >75% full. Resumes when <25% full (hysteresis).
│   │
│   └── index.ts
│
├── streaming/
│   ├── sse-adapter.ts      — Server-Sent Events adapter
│   │                         Exports: SSEAdapter, createSSEAdapter()
│   │                         Dependencies: types/stream, buffer/
│   │                         API: adapter.connect(url: string) → ReadableStream<StreamToken>
│   │                              adapter.disconnect() → void
│   │
│   ├── ws-adapter.ts       — WebSocket adapter
│   │                         Exports: WSAdapter, createWSAdapter()
│   │                         Dependencies: types/stream, buffer/
│   │                         API: adapter.connect(url: string) → ReadableStream<StreamToken>
│   │                              adapter.disconnect() → void
│   │                              adapter.send(message: BridgeMessage) → void
│   │
│   ├── stream-protocol.ts  — Message format and serialization
│   │                         Exports: BridgeMessage (type), serializeMessage, deserializeMessage,
│   │                                  PROTOCOL_VERSION
│   │                         Dependencies: types/stream
│   │                         Details: See §7 for the full protocol specification.
│   │
│   └── index.ts
│
├── python-adapter/
│   ├── python-sdk-types.ts — TypeScript types mirroring the Python SDK API
│   │                         Exports: PythonSDKConfig, PythonRenderRequest, PythonRenderResponse
│   │                         Dependencies: types/stream
│   │
│   └── index.ts
│
└── index.ts                — Public bridge API
                              Exports: SSEAdapter, WSAdapter, RingBuffer, BackpressureController
```

### 5.10 `src/` Root Files

```
src/
├── pipeline.ts         — Assembles the full pipeline from components
│                         Exports: SpatialPipeline, createPipeline()
│                         Dependencies: all modules
│                         API: pipeline.feed(text: string) → void  // push mode
│                              pipeline.connect(stream: ReadableStream<string>) → void  // stream mode
│                              pipeline.render(target: 'canvas' | 'react' | 'svg') → RenderOutput
│                              pipeline.onUpdate(callback: (commands: RenderCommand[]) => void) → void
│                              pipeline.resize(width: Pixels, height: Pixels) → void
│                              pipeline.destroy() → void
│                         Details: The top-level orchestrator. Wires together tokenizer, builder,
│                           solver, measurer, calculator, and command builder. Manages the
│                           requestAnimationFrame loop for streaming mode.
│
├── scheduler.ts        — Frame scheduler for batching updates
│                         Exports: FrameScheduler, createFrameScheduler()
│                         Dependencies: types/primitives
│                         API: scheduler.scheduleUpdate(callback: () => void) → void
│                              scheduler.flush() → void  // force immediate execution
│                              scheduler.destroy() → void
│                         Details: Coalesces multiple update requests into a single
│                           requestAnimationFrame callback. Tracks frame timing for
│                           performance monitoring.
│
├── config.ts           — Engine configuration and defaults
│                         Exports: EngineConfig, defaultConfig, mergeConfig()
│                         Dependencies: types/theme, types/primitives
│
└── index.ts            — Library entry point (barrel export)
                          Exports: everything the consumer needs
                          Re-exports: SpatialPipeline, useSpatialMarkdown, SpatialMarkdownView,
                                      CanvasRenderer, SVGRenderer, all types
```

---

## 6. Pretext Integration Layer

### 6.1 MeasurementCache Design

```typescript
interface MeasurementCache {
  // Core prepare APIs — cached wrappers around Pretext
  prepare(text: string, font: FontDescriptor, options?: PrepareOptions): PreparedText;
  prepareWithSegments(text: string, font: FontDescriptor, options?: PrepareOptions): PreparedTextWithSegments;
  prepareRichInline(items: ReadonlyArray<RichInlineItem>): PreparedRichInline;
  
  // Invalidation
  invalidate(text: string, font: FontDescriptor): void;
  invalidateByFont(font: FontDescriptor): void;
  invalidateAll(): void;
  
  // Stats
  stats(): CacheStats;
  
  // Lifecycle
  resize(maxEntries: number): void;
  destroy(): void;
}

interface CacheStats {
  readonly size: number;
  readonly maxSize: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly hitRatio: number;       // hits / (hits + misses)
  readonly totalPrepareTimeMs: number;
  readonly avgPrepareTimeMs: number;
}

interface PrepareOptions {
  readonly whiteSpace?: 'normal' | 'pre-wrap';
  readonly wordBreak?: 'normal' | 'keep-all';
}
```

### 6.2 Cache Key Design

```typescript
// The cache key must capture everything that affects prepare()'s output.
// Pretext's prepare() is pure: same inputs → same outputs. So the key is:
//   text content + font descriptor + options

function makeCacheKey(
  text: string,
  font: FontDescriptor,
  options?: PrepareOptions
): string {
  // Use a separator that cannot appear in text or font strings
  const ws = options?.whiteSpace ?? 'normal';
  const wb = options?.wordBreak ?? 'normal';
  return `${text}\x00${font}\x00${ws}\x00${wb}`;
}

// For rich inline, the key is a hash of all items:
function makeRichInlineCacheKey(items: ReadonlyArray<RichInlineItem>): string {
  let key = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    key += `${item.text}\x01${item.font}\x01${item.break ?? 'normal'}\x01${item.extraWidth ?? 0}\x00`;
  }
  return key;
}
```

### 6.3 Cache Eviction: LRU with Size Awareness

```
┌────────────────────────────────────────────────────────┐
│ MeasurementCache (LRU, max 2048 entries)               │
│                                                        │
│  Key: "Hello world\x0016px Inter\x00normal\x00normal" │
│  Value: {                                              │
│    prepared: PreparedText (opaque handle),              │
│    accessCount: 47,                                    │
│    lastAccessed: 1713100000000,                        │
│    prepareTimeMs: 1.2,                                 │
│    textLength: 11                                      │
│  }                                                     │
│                                                        │
│  Eviction order: LRU (least recently accessed first)   │
│  Eviction trigger: size > maxEntries                   │
│  Protected entries: none (all entries are equal)        │
└────────────────────────────────────────────────────────┘
```

**Why LRU and not LFU?** During streaming, the "active" paragraph's cache entry is accessed on every frame. After streaming moves to a new paragraph, the old one is rarely accessed. LRU naturally evicts stale paragraphs. LFU would keep the old high-frequency paragraph and evict newer, more relevant entries.

### 6.4 Cache Invalidation Strategy

| Event | Action | Cost |
|-------|--------|------|
| Text content changes (streaming) | Invalidate that specific key, re-prepare with new text | 1–5ms |
| Font changes (theme switch) | `invalidateByFont(oldFont)` — clear all entries for that font | N × 1–5ms |
| Viewport resize | No invalidation needed — `layout()` is called with new maxWidth, not `prepare()` | ~0.0002ms each |
| Font loading completes | `invalidateAll()` — all measurements from before the font loaded are wrong | Full re-prepare |
| Memory pressure | `resize(smallerMax)` — reduce max entries, evict LRU overflow | Immediate |

### 6.5 Batch Measurement Optimization

During a full layout pass (e.g., initial render or font change), many text nodes need `prepare()`. Rather than calling `prepare()` one at a time (each blocking the main thread for 1–5ms), we batch them:

```typescript
interface BatchMeasurementRequest {
  readonly nodeId: NodeId;
  readonly text: string;
  readonly font: FontDescriptor;
  readonly options?: PrepareOptions;
  readonly mode: 'height-only' | 'line-detail' | 'rich-inline';
}

// Strategy: Sort by font descriptor. Pretext's internal canvas context
// setup is per-font, so measuring all "16px Inter" text together is
// faster than alternating between fonts.
function batchPrepare(
  requests: ReadonlyArray<BatchMeasurementRequest>,
  cache: MeasurementCache
): Map<NodeId, PreparedText | PreparedTextWithSegments> {
  // 1. Group by font
  const byFont = groupBy(requests, r => r.font);
  
  // 2. For each font group, prepare all texts (cache deduplicates)
  const results = new Map();
  for (const [font, group] of byFont) {
    for (const req of group) {
      const prepared = req.mode === 'height-only'
        ? cache.prepare(req.text, font, req.options)
        : cache.prepareWithSegments(req.text, font, req.options);
      results.set(req.nodeId, prepared);
    }
  }
  
  return results;
}
```

### 6.6 Font Loading Strategy

Pretext's `prepare()` requires that the font is already loaded in the browser. If `prepare()` runs before the font loads, it falls back to a system font and produces wrong measurements. Our strategy:

```
┌─────────────────────────────────────────────────────────────┐
│ Font Loading Lifecycle                                      │
│                                                             │
│  1. Pipeline starts → FontLoader.preload(theme.allFonts)    │
│  2. While fonts load → render with system fallback metrics   │
│     (Accept wrong measurements for 1–3 frames)              │
│  3. Font loaded event → invalidateAll() on MeasurementCache │
│  4. Next frame → full re-prepare with correct font          │
│  5. Layout shift happens ONCE, on font load                 │
│                                                             │
│  This is the ONE acceptable layout shift in the system.     │
│  After fonts are loaded, zero shift guarantee applies.      │
└─────────────────────────────────────────────────────────────┘
```

```typescript
class FontLoader {
  private loaded = new Set<FontDescriptor>();
  private loading = new Map<FontDescriptor, Promise<void>>();

  async preload(fonts: ReadonlyArray<FontDescriptor>): Promise<void> {
    const promises = fonts.map(f => this.ensureLoaded(f));
    await Promise.all(promises);
  }

  async ensureLoaded(font: FontDescriptor): Promise<void> {
    if (this.loaded.has(font)) return;
    if (this.loading.has(font)) return this.loading.get(font)!;

    const promise = document.fonts.load(font).then(() => {
      this.loaded.add(font);
      this.loading.delete(font);
    });
    this.loading.set(font, promise);
    return promise;
  }

  isLoaded(font: FontDescriptor): boolean {
    return this.loaded.has(font);
  }
}
```

---

## 7. Bridge Architecture

### 7.1 Protocol: WebSocket with SSE Fallback

```
┌──────────────┐              ┌──────────────────────┐
│ Python Agent │──WebSocket──▶│ TypeScript Engine     │
│ (upstream)   │◀─────────────│ (downstream)          │
│              │              │                       │
│ OR:          │              │                       │
│              │──SSE────────▶│                       │
│              │◀─HTTP POST───│ (backpressure/config) │
└──────────────┘              └──────────────────────┘
```

**WebSocket** is preferred: bidirectional, lower latency, supports backpressure signals.  
**SSE** is the fallback: unidirectional (server → client), works through proxies/CDNs, simpler infra.

### 7.2 Message Format (JSON)

```typescript
// src/bridge/streaming/stream-protocol.ts

const PROTOCOL_VERSION = 1;

/** Messages from Python → TypeScript */
type UpstreamMessage =
  | StreamChunkMessage
  | StreamEndMessage
  | StreamErrorMessage
  | ConfigUpdateMessage
  | PingMessage;

interface StreamChunkMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'chunk';
  readonly seq: number;            // monotonic sequence number
  readonly text: string;           // raw text chunk from LLM
  readonly ts: number;             // sender timestamp (ms)
}

interface StreamEndMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'end';
  readonly seq: number;
  readonly reason: 'complete' | 'cancelled' | 'max-tokens';
}

interface StreamErrorMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'error';
  readonly seq: number;
  readonly code: string;
  readonly message: string;
}

interface ConfigUpdateMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'config';
  readonly seq: number;
  readonly viewport?: { width: number; height: number };
  readonly theme?: string;
}

interface PingMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'ping';
  readonly seq: number;
  readonly ts: number;
}

/** Messages from TypeScript → Python (WebSocket only) */
type DownstreamMessage =
  | BackpressurePauseMessage
  | BackpressureResumeMessage
  | AckMessage
  | PongMessage;

interface BackpressurePauseMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'pause';
  readonly reason: 'buffer-full' | 'render-behind';
  readonly bufferUtilization: number; // 0.0–1.0
}

interface BackpressureResumeMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'resume';
}

interface AckMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'ack';
  readonly seq: number;            // acknowledges up to this seq
  readonly renderLatencyMs: number; // how long the last frame took
}

interface PongMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'pong';
  readonly seq: number;
  readonly ts: number;             // echo back the ping timestamp
}
```

### 7.3 Buffer Management

```
                    ┌─────────────────────────────┐
                    │ RingBuffer (capacity: 1024)  │
                    │                              │
 WebSocket ──write──▶ [ chunk chunk chunk ... ]   │
                    │         ▲                    │
                    │         │ 75% full → PAUSE   │
                    │         │ 25% full → RESUME  │
                    │                              │
 Tokenizer ◀──read──  oldest first (FIFO)         │
                    │                              │
                    └─────────────────────────────┘
```

**Backpressure hysteresis prevents oscillation:** Pause at 75%, resume at 25%. Without hysteresis, a buffer hovering around 50% would rapidly alternate between pause and resume signals.

**Overflow policy:** If the buffer is 100% full and a new chunk arrives, the oldest unprocessed chunk is dropped and a warning is logged. This should never happen in practice — the backpressure signal should slow the upstream before overflow.

### 7.4 Python SDK API Surface

The Python SDK is a thin wrapper that the `@backend-architect` (Layer D) will implement. The TypeScript side defines the contract:

```python
# spatial_markdown/sdk.py — Python side (contract defined by TS bridge)

from spatial_markdown import SpatialRenderer

# Option 1: WebSocket streaming
async with SpatialRenderer.connect("ws://localhost:3000/spatial") as renderer:
    async for chunk in llm.stream("Explain quantum computing"):
        await renderer.send(chunk)
    result = await renderer.finalize()
    # result.screenshot_url, result.svg, result.metrics

# Option 2: SSE streaming  
renderer = SpatialRenderer.sse("http://localhost:3000/spatial/sse")
async for chunk in llm.stream("Explain quantum computing"):
    await renderer.push(chunk)

# Option 3: Batch (non-streaming)
result = SpatialRenderer.render_sync(
    text="# Hello\n<Grid cols=2>\nLeft\nRight\n</Grid>",
    width=800,
    height=600,
    theme="dark"
)
```

### 7.5 SSE Event Format

```
event: chunk
data: {"v":1,"type":"chunk","seq":1,"text":"# Hello","ts":1713100000000}

event: chunk  
data: {"v":1,"type":"chunk","seq":2,"text":"\n<Grid cols=2>","ts":1713100000016}

event: end
data: {"v":1,"type":"end","seq":3,"reason":"complete"}
```

---

## 8. Performance Budget

### 8.1 Frame Budget Breakdown (16ms target)

```
┌─────────────────────────────────────────────────────┐
│ 16ms frame budget (60fps)                           │
│                                                     │
│ ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐ │
│ │Buffer│Token │ AST  │Constr│Meas. │Geom. │Render│ │
│ │ 0.1  │ 0.5  │ 0.5  │ 0.5  │ 2.0  │ 1.0  │ 8.0  │ │
│ │ ms   │ ms   │ ms   │ ms   │ ms   │ ms   │ ms   │ │
│ └──────┴──────┴──────┴──────┴──────┴──────┴──────┘ │
│                                                     │
│ Pipeline overhead: ~4.6ms                           │
│ Render time:       ~8.0ms                           │
│ Headroom:          ~3.4ms                           │
│                                                     │
│ Total:             < 16ms ✓                         │
└─────────────────────────────────────────────────────┘
```

### 8.2 Per-Stage Budgets (Streaming Steady-State)

| Stage | Budget | Typical | Worst Case | Notes |
|-------|--------|---------|------------|-------|
| Buffer read | 0.1ms | 0.01ms | 0.1ms | Ring buffer dequeue |
| Tokenizer | 0.5ms | 0.1ms | 0.5ms | One partial tag = worst case |
| AST Builder | 0.5ms | 0.05ms | 0.5ms | Node creation + delta emission |
| Constraint Solver | 0.5ms | 0.01ms | 0.5ms | Only dirty subtree (usually 1 path) |
| Pretext Measurement | 2.0ms | 0.0002ms | 5.0ms | Cache hit = 0.0002ms; cache miss (new text) = 1–5ms |
| Geometry Calculator | 1.0ms | 0.1ms | 1.0ms | Bottom-up position pass |
| Render Command Build | 0.5ms | 0.1ms | 0.5ms | Delta only — usually <10 changed commands |
| Canvas Render | 8.0ms | 2.0ms | 8.0ms | Full repaint worst case; delta repaint typical |

### 8.3 Critical Performance Targets

| Metric | Target | How We Achieve It |
|--------|--------|-------------------|
| Token-to-pixel latency (streaming) | < 16ms (1 frame) | rAF batching, dirty flags, incremental pipeline |
| Token-to-pixel latency (initial) | < 50ms | Font preloading, batch prepare, parallel constraint solving |
| Layout calculation per frame | < 2ms | Only re-layout dirty subtree; `layout()` is 0.0002ms |
| Full re-layout (resize) | < 5ms for 1000 nodes | No re-prepare; only `layout()` + geometry |
| `prepare()` cache hit ratio | > 95% in streaming | Text changes only at cursor; rest is cached |
| Memory per 1000 LayoutBox nodes | < 2MB | No string duplication; PreparedText handles are shared |
| Memory per MeasurementCache entry | ~1–5KB | Opaque PreparedText handle + key string |
| Max MeasurementCache size | 2048 entries (~5–10MB) | LRU eviction |
| Frame drops during streaming | 0 (at 60fps) | rAF batching, idle-time measurement for non-critical nodes |

### 8.4 Measurement Budget Amortization

The expensive operation is `prepare()` (1–5ms). In streaming mode, `prepare()` is called once per new/changed text node per frame. With frame batching:

- **Tokens/second from LLM:** ~100–200
- **Characters/token:** ~4
- **Frames/second:** 60
- **Tokens/frame:** ~2–3
- **Unique text-dirty nodes/frame:** 1 (the cursor paragraph)
- **`prepare()` calls/frame:** 1
- **`prepare()` cost/frame:** 1–5ms (within 2ms budget most of the time)

**When budget is exceeded:** If `prepare()` takes >2ms (long paragraph, complex Unicode), the scheduler allows it to run to completion but skips non-critical work (e.g., shadow rendering, animation) in that frame. The frame may take 18ms instead of 16ms (dropping to 55fps for one frame). This is acceptable.

### 8.5 Benchmark Targets (Vitest Bench)

```typescript
// tests/benchmarks/pipeline.bench.ts — target numbers

// Microbenchmarks
bench('prepare() with 100-char English text',   () => { /* ... */ }, { target: '< 2ms' });
bench('prepare() with 1000-char mixed Unicode',  () => { /* ... */ }, { target: '< 5ms' });
bench('layout() with cached PreparedText',       () => { /* ... */ }, { target: '< 0.001ms' });
bench('constraint solve for 100-node tree',      () => { /* ... */ }, { target: '< 0.5ms' });
bench('geometry calc for 100-node tree',         () => { /* ... */ }, { target: '< 1ms' });
bench('render commands for 100-node tree',       () => { /* ... */ }, { target: '< 0.5ms' });

// Integration benchmarks
bench('full pipeline: 50-word paragraph',         () => { /* ... */ }, { target: '< 10ms' });
bench('streaming: 100 tokens into live pipeline',  () => { /* ... */ }, { target: '< 16ms/frame avg' });
bench('resize: 500-node tree relayout',            () => { /* ... */ }, { target: '< 5ms' });

// Memory benchmarks
bench('memory: 1000 LayoutBox nodes',              () => { /* ... */ }, { target: '< 2MB' });
bench('memory: MeasurementCache at capacity',       () => { /* ... */ }, { target: '< 10MB' });
```

---

## 9. Package Configuration

### 9.1 `package.json`

```jsonc
{
  "name": "@spatial-markdown/engine",
  "version": "0.1.0",
  "description": "High-performance Spatial Markdown layout engine powered by @chenglou/pretext",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./react": {
      "import": "./dist/react/index.js",
      "require": "./dist/react/index.cjs",
      "types": "./dist/react/index.d.ts"
    },
    "./canvas": {
      "import": "./dist/canvas/index.js",
      "require": "./dist/canvas/index.cjs",
      "types": "./dist/canvas/index.d.ts"
    },
    "./svg": {
      "import": "./dist/svg/index.js",
      "require": "./dist/svg/index.cjs",
      "types": "./dist/svg/index.d.ts"
    },
    "./bridge": {
      "import": "./dist/bridge/index.js",
      "require": "./dist/bridge/index.cjs",
      "types": "./dist/bridge/index.d.ts"
    },
    "./types": {
      "types": "./dist/types/index.d.ts"
    }
  },
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc --emitDeclarationOnly",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:bench": "vitest bench",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint src/ tests/",
    "format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
    "prepublishOnly": "npm run typecheck && npm run test && npm run build"
  },
  "dependencies": {
    "@chenglou/pretext": "^0.0.5"
  },
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "react-dom": { "optional": true }
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "oxlint": "^1.51.0",
    "prettier": "^3.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.8.0",
    "vite": "^6.0.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### 9.2 `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    // Strict mode — no escape hatches
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,

    // Module resolution
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,

    // Output
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",

    // JSX (for React renderer)
    "jsx": "react-jsx",

    // Path aliases
    "paths": {
      "@spatial/types": ["./src/types/index.ts"],
      "@spatial/types/*": ["./src/types/*"],
      "@spatial/parser": ["./src/parser/index.ts"],
      "@spatial/parser/*": ["./src/parser/*"],
      "@spatial/engine": ["./src/engine/index.ts"],
      "@spatial/engine/*": ["./src/engine/*"],
      "@spatial/renderer": ["./src/renderer/index.ts"],
      "@spatial/renderer/*": ["./src/renderer/*"],
      "@spatial/bridge": ["./src/bridge/index.ts"],
      "@spatial/bridge/*": ["./src/bridge/*"]
    },

    // Lib
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 9.3 `tsconfig.test.json`

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"]
}
```

### 9.4 `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],

  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'react/index': resolve(__dirname, 'src/renderer/react/index.ts'),
        'canvas/index': resolve(__dirname, 'src/renderer/canvas/index.ts'),
        'svg/index': resolve(__dirname, 'src/renderer/svg/index.ts'),
        'bridge/index': resolve(__dirname, 'src/bridge/index.ts'),
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@chenglou/pretext',
        '@chenglou/pretext/rich-inline',
      ],
      output: {
        preserveModules: false,
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
    target: 'es2022',
    minify: 'terser',
    sourcemap: true,
  },

  resolve: {
    alias: {
      '@spatial/types': resolve(__dirname, 'src/types'),
      '@spatial/parser': resolve(__dirname, 'src/parser'),
      '@spatial/engine': resolve(__dirname, 'src/engine'),
      '@spatial/renderer': resolve(__dirname, 'src/renderer'),
      '@spatial/bridge': resolve(__dirname, 'src/bridge'),
    },
  },
});
```

### 9.5 `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Unit tests
    include: ['tests/unit/**/*.test.ts'],
    
    // Benchmark tests  
    benchmark: {
      include: ['tests/benchmarks/**/*.bench.ts'],
      reporters: ['verbose'],
      outputFile: 'tests/benchmarks/results.json',
    },

    // Coverage
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/**/index.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },

    // Environment
    environment: 'jsdom', // needed for canvas and font APIs
    globals: true,
    
    // TypeScript
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },

  resolve: {
    alias: {
      '@spatial/types': resolve(__dirname, 'src/types'),
      '@spatial/parser': resolve(__dirname, 'src/parser'),
      '@spatial/engine': resolve(__dirname, 'src/engine'),
      '@spatial/renderer': resolve(__dirname, 'src/renderer'),
      '@spatial/bridge': resolve(__dirname, 'src/bridge'),
    },
  },
});
```

---

## 10. Architectural Decision Records

### ADR-001: Pretext as Sole Text Measurement Provider

**Status:** Accepted

**Context:** We need DOM-less text measurement for zero-reflow streaming layouts. Options considered:
1. Browser DOM measurement (`getBoundingClientRect`) — triggers reflow, 300–600× slower
2. Canvas `measureText` directly — we'd need to implement line breaking, Unicode segmentation, bidi ourselves
3. `@chenglou/pretext` — does all of the above, well-tested, 15KB, MIT

**Decision:** Use `@chenglou/pretext` as the exclusive text measurement layer. No DOM reads for geometry anywhere in the engine.

**Consequences:**
- ✅ Zero reflow guarantee
- ✅ `layout()` is pure arithmetic (~0.0002ms) — enables 60fps re-layout
- ✅ Full Unicode/bidi/emoji support without custom code
- ⚠️ Fonts must be loaded before `prepare()` — requires font loading orchestration
- ⚠️ We depend on an opaque `PreparedText` handle — can't inspect or serialize it
- ⚠️ Pretext is single-font per `prepare()` call — mixed-font paragraphs need `prepareRichInline()`

---

### ADR-002: Discriminated Unions Over Class Hierarchies for AST

**Status:** Accepted

**Context:** AST nodes need to be typed. Options:
1. Class hierarchy (`class GridNode extends ContainerNode extends ASTNodeBase`)
2. Discriminated unions (`type ASTNode = GridNode | FlexNode | ...`)
3. Generic node with `type` string + `props: Record<string, unknown>`

**Decision:** Discriminated unions with the `kind` field as discriminant.

**Consequences:**
- ✅ Exhaustive `switch` checking — compiler errors when a new node type is added but not handled
- ✅ No `instanceof` checks (unreliable across module boundaries)
- ✅ Serializable (plain objects, not class instances)
- ⚠️ Verbose — every node variant is a separate interface
- ⚠️ No shared methods — use standalone functions with `switch` instead

---

### ADR-003: Frame Batching Over Per-Token Updates

**Status:** Accepted

**Context:** LLM tokens arrive at 100–200/sec. Options:
1. Process each token immediately through the full pipeline
2. Batch tokens per `requestAnimationFrame` (60fps)
3. Batch tokens on a fixed interval (e.g., every 50ms)

**Decision:** Batch on `requestAnimationFrame`. All tokens that arrive between frames are processed together.

**Consequences:**
- ✅ Maximum 60 pipeline runs/second, regardless of token rate
- ✅ Only 1 `prepare()` call per dirty text node per frame
- ✅ Leverages browser's native frame timing
- ⚠️ Adds up to 16ms latency between token arrival and pixel update
- ⚠️ If pipeline takes >16ms, frames are dropped (but the scheduler adapts)

---

### ADR-004: LRU Cache for PreparedText Handles

**Status:** Accepted

**Context:** `prepare()` is 1–5ms. Must cache. Options:
1. Unbounded cache (never evict)
2. LRU cache with max entries
3. TTL-based cache (evict after N seconds)
4. Weak references (let GC decide)

**Decision:** LRU cache with 2048 max entries.

**Consequences:**
- ✅ Bounded memory (~5–10MB at capacity)
- ✅ Naturally evicts stale entries (old paragraphs during streaming)
- ✅ Simple implementation and reasoning
- ⚠️ Cache miss after eviction triggers re-`prepare()` (1–5ms penalty)
- ⚠️ 2048 is a heuristic — may need tuning per application

---

### ADR-005: Render Commands as Renderer-Agnostic Intermediate Representation

**Status:** Accepted

**Context:** We support three render targets (Canvas, React, SVG). Options:
1. Each renderer reads the LayoutBox tree directly
2. An intermediate `RenderCommand` list that all renderers consume
3. A virtual DOM that each renderer interprets

**Decision:** Flat, ordered `RenderCommand[]` as the IR between layout and rendering.

**Consequences:**
- ✅ Renderers are thin interpreters (~200 LOC each)
- ✅ Easy to add new renderers (WebGL, PDF, etc.)
- ✅ Diffable — delta rendering compares command lists, not trees
- ✅ Serializable — can be sent to a worker or across the bridge
- ⚠️ Flat list loses tree structure — clipping requires explicit push/pop commands
- ⚠️ Z-ordering must be computed during command generation, not at render time

---

### ADR-006: WebSocket with SSE Fallback for Bridge Protocol

**Status:** Accepted

**Context:** Python agents need to stream text to the TS engine. Options:
1. WebSocket only
2. SSE only
3. WebSocket primary with SSE fallback
4. gRPC-Web

**Decision:** WebSocket primary, SSE fallback. JSON messages.

**Consequences:**
- ✅ WebSocket gives bidirectional communication (backpressure signals)
- ✅ SSE works through corporate proxies and CDNs that block WebSocket
- ✅ JSON is debuggable and language-agnostic
- ⚠️ Two transport implementations to maintain
- ⚠️ JSON parsing overhead (~0.01ms/message — negligible)
- ⚠️ SSE cannot send backpressure signals upstream (needs separate HTTP POST endpoint)

---

### ADR-007: Dirty Flag Propagation Over Full-Tree Diffing

**Status:** Accepted

**Context:** On each frame, we need to know what changed. Options:
1. Diff the entire AST tree against the previous version (immutable + structural sharing)
2. Dirty flags on mutable nodes, propagated upward on mutation
3. Event sourcing — replay all deltas from the last clean state

**Decision:** Dirty flags on nodes (`textDirty`, `constraintDirty`, `geometryDirty`, `renderDirty`), propagated upward when set.

**Consequences:**
- ✅ O(dirty set size) per frame, not O(tree size)
- ✅ Fine-grained — can skip measurement if only geometry changed
- ✅ Simple implementation — set flag + walk to root
- ⚠️ Mutable flags on otherwise-immutable-ish nodes (philosophical compromise)
- ⚠️ Must be careful to always propagate — a missed flag means a stale render
- ⚠️ Debugging dirty flag bugs is harder than diffing (no "before/after" snapshot)

---

## Appendix A: Dependency Graph

```
                    ┌─────────────┐
                    │  types/     │  ← No dependencies. Pure type declarations.
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
        │  parser/   │ │engine/│ │  bridge/   │
        │            │ │       │ │            │
        │ tokenizer/ │ │constr/│ │ buffer/    │
        │ ast/       │ │meas./ │ │ streaming/ │
        │ transforms/│ │geom./ │ │ python-ad/ │
        └─────┬──────┘ └───┬───┘ └─────┬──────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │  renderer/  │
                    │             │
                    │ canvas/     │
                    │ react/      │
                    │ svg/        │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ pipeline.ts │  ← Top-level orchestrator
                    │ scheduler.ts│
                    │ config.ts   │
                    │ index.ts    │
                    └─────────────┘
```

**Import rules (enforced by lint):**

| Module | Can Import From | Cannot Import From |
|--------|-----------------|--------------------|
| `types/` | nothing | — |
| `parser/` | `types/` | `engine/`, `renderer/`, `bridge/` |
| `engine/` | `types/`, `@chenglou/pretext` | `parser/`, `renderer/`, `bridge/` |
| `renderer/` | `types/` | `parser/`, `engine/` (except through pipeline) |
| `bridge/` | `types/` | `parser/`, `engine/`, `renderer/` |
| `pipeline.ts` | everything | — |

This ensures that each layer is independently testable and replaceable.

---

## Appendix B: Data Flow Trace (Single Streaming Token)

Here is the complete trace for a single LLM token arriving during streaming, showing every data transformation:

```
1. WebSocket receives: '{"v":1,"type":"chunk","seq":42,"text":"quantu","ts":1713100000123}'

2. WSAdapter deserializes → StreamChunkMessage
   Writes to RingBuffer (0.01ms)

3. FrameScheduler fires (requestAnimationFrame)
   Reads all buffered StreamChunkMessages from RingBuffer

4. For each chunk, creates StreamToken:
   { kind: 'stream-token', text: 'quantu', offset: 847, timestamp: 1713100000123, isFinal: false }

5. Tokenizer.feed(streamToken) → SpatialToken[]:
   [{ kind: 'text', content: 'quantu', offset: 847 }]
   (0.1ms)

6. ASTBuilder.push(tokens) → ASTDelta[]:
   Current cursor is a TextSpanNode (id: 73) inside a ParagraphNode (id: 72)
   TextSpanNode.content: "quantum compu" → "quantum compuquantu"
   Wait, that doesn't look right — the tokenizer handles boundary alignment.
   Actually: TextSpanNode.content: "quantum comp" → "quantum compquantu"
   
   Emits: [{ kind: 'text-appended', nodeId: 73, appendedText: 'quantu', newFullText: 'quantum compquantu' }]
   Sets: node73.dirty.textDirty = true
   Propagates: node72.dirty.geometryDirty = true (parent paragraph)
               node71.dirty.geometryDirty = true (grandparent section)
               ... up to root
   (0.05ms)

7. ConstraintSolver.solveDirty({72, 71, ...}):
   ParagraphNode 72 still has maxWidth=760px (unchanged since last frame)
   No constraint changes needed.
   (0.01ms)

8. Measurer.measureDirtyNodes([node73], constraints):
   TextCollector extracts: text="quantum compquantu", font="16px Inter"
   MeasurementCache.prepare("quantum compquantu", "16px Inter"):
     Cache MISS (text changed from "quantum comp")
     Calls Pretext prepare("quantum compquantu", "16px Inter") → PreparedText
     Stores in cache.
   Calls Pretext layout(prepared, 760, 24) → { height: 24, lineCount: 1 }
   Returns: Map { 73 → { kind: 'height-only', height: 24, lineCount: 1, prepared } }
   (1.2ms — dominated by prepare())

9. GeometryCalculator.recalculateDirty(prevTree, {72, 71, ...}, constraints, measurements):
   ParagraphNode 72: height was 24px, still 24px. No change.
   Short-circuit: reuse previous LayoutBox subtree.
   (0.01ms)

10. No LayoutDiff → no RenderCommand changes → skip render.
    Total frame time: ~1.4ms ✓
```

**Key insight from this trace:** Most streaming frames produce zero visual change (the text just got slightly longer but still fits on the same line). The geometry short-circuit at step 9 is the critical optimization.

When the text DOES wrap to a new line (height changes from 24px to 48px), step 9 propagates the height change upward, and step 10 produces a small delta of render commands (reposition siblings below the grown paragraph).

---

## Appendix C: Testing Strategy

### Unit Tests (`tests/unit/`)

```
tests/unit/
├── parser/
│   ├── tokenizer.test.ts      — Token FSM state transitions, edge cases
│   ├── ast-builder.test.ts    — Incremental build, auto-close, delta emission
│   ├── node-factory.test.ts   — Default values, attribute parsing
│   └── transforms.test.ts     — Each transform in isolation
│
├── engine/
│   ├── constraint-solver.test.ts  — Block, flex, grid constraint resolution
│   ├── measurement-cache.test.ts  — Hit/miss, eviction, invalidation
│   ├── measurer.test.ts          — Batch measurement, mode selection
│   ├── geometry-calc.test.ts     — Position calculation per layout mode
│   └── tree-differ.test.ts       — Diff detection, structural sharing
│
├── renderer/
│   ├── command-builder.test.ts   — LayoutBox → RenderCommand mapping
│   ├── canvas-renderer.test.ts   — Canvas API call verification
│   └── svg-renderer.test.ts      — SVG output verification
│
├── bridge/
│   ├── ring-buffer.test.ts       — FIFO, overflow, empty reads
│   ├── backpressure.test.ts      — Hysteresis thresholds
│   └── protocol.test.ts          — Serialization roundtrip
│
└── integration/
    ├── pipeline.test.ts          — End-to-end: text → RenderCommands
    └── streaming.test.ts         — Multi-frame streaming scenario
```

### Benchmarks (`tests/benchmarks/`)

```
tests/benchmarks/
├── prepare.bench.ts        — Pretext prepare() across text sizes and languages
├── layout.bench.ts         — Pretext layout() across container widths
├── pipeline.bench.ts       — Full pipeline throughput
├── constraint-solver.bench.ts — Solver across tree depths and widths
├── geometry.bench.ts       — Position calculation across tree sizes
└── streaming.bench.ts      — Simulated streaming with frame timing
```

### Visual Regression (`tests/visual-regression/`)

```
tests/visual-regression/
├── fixtures/               — Spatial Markdown input files
│   ├── basic-paragraph.smd
│   ├── grid-layout.smd
│   ├── nested-flex.smd
│   ├── mixed-content.smd
│   ├── unicode-bidi.smd
│   └── stress-1000-nodes.smd
│
├── snapshots/              — Expected Canvas/SVG output (generated, committed)
│   └── *.png / *.svg
│
└── runner.ts               — Renders fixtures, compares against snapshots
```

---

*This document is the canonical architecture reference for the Spatial Markdown Engine. All implementation must conform to the types, boundaries, and performance budgets defined here. Changes to this document require an ADR and review by @software-architect.*
