# Spatial Markdown DSL — Authoritative Specification

**Status**: Approved  
**Author**: Alex (Product Manager, Layer B)  
**Version**: 1.0.0  
**Last Updated**: 2026-04-14  
**Stakeholders**: @software-architect (Layer A), @frontend-developer (Layer C), @backend-architect (Layer D), @qa-engineer (Layer E)

---

## 0. Purpose & Scope

This document is the **single source of truth** for the Spatial Markdown DSL — a custom markup language designed for LLM-generated spatial layouts. Every layer of the Pretext Spatial Engine (parser, geometry engine, renderer, bridge) MUST implement against this spec.

**What Spatial Markdown is:**
A strict superset of Markdown that adds layout-aware container tags, content components, and rendering primitives. An LLM streams Spatial Markdown tokens; the engine parses them into an AST, calculates geometry using `@chenglou/pretext`, and renders the result at 60fps with zero layout shift.

**What Spatial Markdown is NOT:**
- Not HTML. Tags share angle-bracket syntax but follow a closed, non-extensible taxonomy.
- Not CSS. Layout is constraint-based and declarative, not cascading.
- Not a general-purpose markup language. It is purpose-built for LLM output rendering.

**Design Principles:**
1. **Streaming-first.** Every design decision assumes tokens arrive one at a time from an LLM.
2. **Geometry before pixels.** All spatial math happens via `@chenglou/pretext` before any renderer touches a canvas/DOM/SVG.
3. **Zero layout shift.** Content that has been rendered MUST NOT move when subsequent tokens arrive. Achieved through reservation-based layout.
4. **Strict typing.** The AST uses discriminated unions with no `any`. If the types can't express it, the DSL doesn't support it.

---

## 1. Tag Taxonomy

### 1.1 Overview

Tags are organized into three tiers based on their role in the layout tree:

| Tier | Role | Tags |
|------|------|------|
| **Layout Containers** | Define spatial regions and coordinate systems | `<Slide>`, `<AutoGrid>`, `<Stack>`, `<Columns>`, `<Canvas>` |
| **Content Components** | Structured, semantic content blocks | `<MetricCard>`, `<CodeBlock>`, `<DataTable>`, `<Chart>`, `<Quote>`, `<Callout>` |
| **Primitives** | Atomic visual elements | `<Text>`, `<Heading>`, `<Spacer>`, `<Divider>`, `<Image>` |

**Nesting rules (universal):**
- Layout Containers can contain: Layout Containers, Content Components, Primitives, raw Markdown text.
- Content Components can contain: Primitives, raw Markdown text (NO Layout Containers, NO other Content Components unless explicitly noted).
- Primitives are leaf nodes. They MUST NOT contain other tags. They may contain raw text.

**Self-closing syntax:** Primitives without text content MAY use self-closing syntax: `<Spacer height={24} />`.

**Attribute syntax:** Attributes use JSX-style syntax with curly braces for non-string values:
```
<Tag stringAttr="value" numberAttr={42} boolAttr={true} enumAttr="option-a" />
```
String attributes MAY omit curly braces: `font="16px Inter"` is equivalent to `font={"16px Inter"}`.

---

## 2. Layout Containers (Tier 1)

### 2.1 `<Slide>`

**Purpose:** A fixed-dimension presentation surface. The fundamental unit for slide decks. Acts as a viewport root — all children are laid out within its bounds.

**Allowed attributes:**
```typescript
type SlideProps = {
  width: number          // Slide width in px. Default: 1280
  height: number         // Slide height in px. Default: 720
  padding: number        // Uniform inner padding in px. Default: 48
  paddingX: number       // Horizontal padding override. Default: undefined (falls back to `padding`)
  paddingY: number       // Vertical padding override. Default: undefined (falls back to `padding`)
  background: string     // CSS color string. Default: '#FFFFFF'
  id: string             // Unique identifier. Default: auto-generated `slide-{n}`
}
```

**Allowed children:** Layout Containers, Content Components, Primitives, raw Markdown.

**Layout behavior:**
1. Slide creates a fixed-size coordinate system: `contentWidth = width - 2 * (paddingX ?? padding)`, `contentHeight = height - 2 * (paddingY ?? padding)`.
2. Children are laid out in **block flow** (vertical stack) within the content area, top to bottom.
3. If children's total computed height exceeds `contentHeight`, the Slide enters **overflow state** (see §6.3). It does NOT expand.
4. The Slide reserves its full `width × height` in the parent layout immediately, before any children are measured.
5. Text within a Slide is measured via `prepareWithSegments(text, font)` → `layoutWithLines(prepared, contentWidth, lineHeight)`.

**Streaming behavior:**
- **Reservation:** The Slide's full `width × height` rectangle is reserved in the layout the moment the `<Slide>` open tag is parsed. This guarantees zero layout shift.
- **Incremental fill:** Children render incrementally as tokens arrive. Text nodes call `prepare()` on each token append, then `layout()` with the Slide's `contentWidth`.
- **Completion:** On `</Slide>`, final layout pass runs. No geometry changes after close.

---

### 2.2 `<AutoGrid>`

**Purpose:** Automatically arranges children into a responsive grid. Cell count and dimensions are computed from the available width and the `minChildWidth` constraint.

**Allowed attributes:**
```typescript
type AutoGridProps = {
  minChildWidth: number  // Minimum width per cell in px. Default: 200
  gap: number            // Gap between cells in px. Default: 16
  gapX: number           // Horizontal gap override. Default: undefined (falls back to `gap`)
  gapY: number           // Vertical gap override. Default: undefined (falls back to `gap`)
  columns: number | 'auto' // Force column count or auto-calculate. Default: 'auto'
  align: 'start' | 'center' | 'stretch' // Cross-axis alignment of cells. Default: 'stretch'
  padding: number        // Uniform inner padding in px. Default: 0
}
```

**Allowed children:** Content Components, Primitives. NOT other Layout Containers (grids don't nest).

**Layout behavior:**
1. If `columns` is `'auto'`: `columnCount = Math.max(1, Math.floor((availableWidth + gapX) / (minChildWidth + gapX)))`.
2. If `columns` is a number: `columnCount = columns`.
3. `cellWidth = (availableWidth - (columnCount - 1) * (gapX ?? gap)) / columnCount`.
4. Children fill cells left-to-right, top-to-bottom. Each child receives `cellWidth` as its `maxWidth` constraint.
5. Row height is determined by the tallest cell in that row (when `align` is `'start'` or `'center'`) or all cells stretch to the tallest (when `align` is `'stretch'`).
6. Total grid height = sum of all row heights + `(rowCount - 1) * (gapY ?? gap)`.

**Streaming behavior:**
- **Deferred column calculation:** On `<AutoGrid>` open tag, column count is calculated from available width and `minChildWidth`. This is deterministic and does not depend on children.
- **Cell reservation:** Each child, as its open tag arrives, reserves a cell slot. The cell's height is initially `0` and grows as content streams in.
- **Row finalization:** A row's height is finalized when all cells in it have closed OR when the next row begins (whichever comes first).
- **Constraint: row height growth does NOT shift subsequent rows' y-positions until the row is finalized.** During streaming, subsequent rows are positioned based on the *current* tallest cell height in the row above. If a cell grows taller after its row was "soft-finalized," subsequent rows shift — this is the ONE allowed layout shift, bounded to within the AutoGrid.

---

### 2.3 `<Stack>`

**Purpose:** Vertical or horizontal sequential layout. The workhorse container.

**Allowed attributes:**
```typescript
type StackProps = {
  direction: 'vertical' | 'horizontal'  // Layout axis. Default: 'vertical'
  gap: number            // Spacing between children in px. Default: 12
  padding: number        // Uniform inner padding in px. Default: 0
  paddingX: number       // Horizontal padding override. Default: undefined
  paddingY: number       // Vertical padding override. Default: undefined
  align: 'start' | 'center' | 'end' | 'stretch' // Cross-axis alignment. Default: 'stretch'
  justify: 'start' | 'center' | 'end' | 'space-between' | 'space-around' // Main-axis distribution. Default: 'start'
  wrap: boolean          // Allow wrapping to next line/column. Default: false
}
```

**Allowed children:** Layout Containers, Content Components, Primitives, raw Markdown.

**Layout behavior:**
1. `direction: 'vertical'`: Children stacked top-to-bottom. Each child receives `contentWidth` as maxWidth. Total height = sum of children heights + `(n-1) * gap`.
2. `direction: 'horizontal'`: Children placed left-to-right. Width is split according to children's intrinsic or constrained widths. Cross-axis height = tallest child (or all stretch).
3. `wrap: true` with `direction: 'horizontal'`: Acts like a flex-wrap row. Children that exceed `contentWidth` wrap to the next line.
4. `justify` only takes effect after ALL children are measured (post-streaming). During streaming, children are placed at `justify: 'start'` positions.

**Streaming behavior:**
- **Incremental append:** Each child is appended to the layout as its open tag arrives. For vertical stacks, this is natural (top-to-bottom streaming matches reading order).
- **Horizontal stacks during streaming:** Children are placed left-to-right as they arrive. If a child hasn't closed yet, its width is based on current content. Once closed, its width is finalized. Subsequent children MAY shift right if the preceding child grew — this shift is bounded to the current Stack.
- **`justify` is a post-streaming concern.** The engine applies `justify` distribution only after `</Stack>`.

---

### 2.4 `<Columns>`

**Purpose:** Explicit multi-column layout with precise width control. Unlike AutoGrid, columns are defined by the author, not computed.

**Allowed attributes:**
```typescript
type ColumnsProps = {
  widths: string         // Space-separated width declarations. Supports px, fr, %, 'auto'.
                         // Example: "1fr 2fr", "300 1fr", "25% 50% 25%", "auto 1fr auto"
                         // Default: "1fr" (single column, full width)
  gap: number            // Gap between columns in px. Default: 24
  padding: number        // Uniform inner padding in px. Default: 0
  valign: 'top' | 'center' | 'bottom' | 'stretch' // Vertical alignment of column content. Default: 'top'
}
```

**Width resolution algorithm:**
1. Parse `widths` string into an array of `ColumnWidth` values.
2. Subtract total gap: `distributableWidth = availableWidth - (columnCount - 1) * gap`.
3. Resolve fixed widths first (px values).
4. Resolve percentage widths against `distributableWidth`.
5. Resolve `auto` widths by measuring content with `measureLineStats()` to find the shrink-to-fit width.
6. Distribute remaining space proportionally among `fr` units.

**Allowed children:** Each direct child becomes a column, in order. Children can be: Layout Containers, Content Components, Primitives, or raw Markdown. The number of direct children MUST match the number of `widths` declarations. Excess children are dropped with a parser warning.

**Layout behavior:**
1. Each column is a vertical stack. Column height = content height.
2. Container height = max(column heights) when `valign` is `'top'`, `'center'`, or `'bottom'`.
3. Container height = max(column heights) with all columns stretched when `valign` is `'stretch'`.

**Streaming behavior:**
- **Column allocation is immediate.** On `<Columns>` open, the column widths are computed and locked. Each column's x-offset is fixed from that point.
- **Children fill columns sequentially.** The 1st child fills column 1, the 2nd fills column 2, etc.
- **Column heights grow independently.** No layout shift across columns — each column only affects its own vertical space.

---

### 2.5 `<Canvas>`

**Purpose:** Absolute-positioning surface. Children are placed at explicit `(x, y)` coordinates. Used for freeform layouts, diagrams, and data visualizations that don't fit flow-based models.

**Allowed attributes:**
```typescript
type CanvasProps = {
  width: number | 'fill'   // Canvas width. 'fill' = parent's available width. Default: 'fill'
  height: number | 'auto'  // Canvas height. 'auto' = bounding box of children. Default: 'auto'
  padding: number           // Uniform inner padding in px. Default: 0
  background: string        // CSS color string. Default: 'transparent'
  overflow: 'visible' | 'clip' // Overflow behavior for children outside bounds. Default: 'clip'
}
```

**Allowed children:** Content Components, Primitives. Each child MUST have `x` and `y` attributes specifying its position within the Canvas coordinate system.

**Additional child attributes (injected by Canvas context):**
```typescript
type CanvasChildPosition = {
  x: number       // X offset from Canvas left edge, in px. Required.
  y: number       // Y offset from Canvas top edge, in px. Required.
  width: number   // Explicit width override. Default: 'auto' (shrink-to-fit)
  height: number  // Explicit height override. Default: 'auto' (shrink-to-fit)
}
```

**Layout behavior:**
1. Canvas does NOT perform flow layout. Children are placed at their `(x, y)` coordinates independently.
2. If `height` is `'auto'`: Canvas height = `max(child.y + child.computedHeight)` for all children, plus padding.
3. Each child's available width defaults to `canvasWidth - x - padding`, unless an explicit `width` is set.
4. Children MAY overlap. Render order = document order (later children paint over earlier ones).

**Streaming behavior:**
- **Canvas width is resolved immediately** on `<Canvas>` open (either explicit or `'fill'` from parent constraint).
- **Each child is independently placed** as its open tag (with `x`, `y`) arrives. No child depends on another for position.
- **Canvas height grows** if `height='auto'` as new children extend the bounding box. This is the ONLY dimension that may change during streaming. The Canvas MUST reserve a minimum `height` based on currently-known children to minimize downstream shift.

---

## 3. Content Components (Tier 2)

### 3.1 `<MetricCard>`

**Purpose:** A structured data display card showing a labeled value with optional trend, delta, and descriptive context. Commonly used in dashboards and executive summaries.

**Allowed attributes:**
```typescript
type MetricCardProps = {
  label: string           // Metric name (e.g., "Monthly Revenue"). Required.
  value: string           // Metric value (e.g., "$1.2M"). Required.
  delta: string           // Change from previous period (e.g., "+12.5%"). Default: undefined
  trend: 'up' | 'down' | 'flat' // Trend direction for visual indicator. Default: undefined
  sentiment: 'positive' | 'negative' | 'neutral' // Semantic color coding. Default: 'neutral'
  footer: string          // Small descriptive text below the value. Default: undefined
  padding: number         // Inner padding in px. Default: 16
  background: string      // Background color. Default: '#F8F9FA'
  borderRadius: number    // Corner radius in px. Default: 8
}
```

**Allowed children:** None. This is a self-contained component. All content comes from attributes.

**Layout behavior:**
1. MetricCard is a vertical stack internally: `[label, value, delta?, footer?]`.
2. `label` is measured via `prepare(label, labelFont)` → `layout(prepared, maxWidth, labelLineHeight)`.
3. `value` is measured via `prepare(value, valueFont)` → `layout(prepared, maxWidth, valueLineHeight)`.
4. Font specifications:
   - `label`: `"500 12px Inter"`, lineHeight `16px`.
   - `value`: `"700 28px Inter"`, lineHeight `34px`.
   - `delta`: `"600 14px Inter"`, lineHeight `18px`.
   - `footer`: `"400 11px Inter"`, lineHeight `14px`.
5. Total height = padding + sum of measured text heights + inter-element gaps (8px between label→value, 4px between value→delta, 8px between delta→footer) + padding.
6. Width: fills available parent width (constrained by parent's maxWidth).

**Streaming behavior:**
- **Atomic render.** MetricCard requires all attributes on its open tag. It renders completely on tag parse (since content is in attributes, not children). No incremental streaming needed.
- **Height reservation:** Height is computable immediately from attribute values.

---

### 3.2 `<CodeBlock>`

**Purpose:** Syntax-highlighted code display with line numbers. Uses monospaced font measurement for precise character-grid alignment.

**Allowed attributes:**
```typescript
type CodeBlockProps = {
  language: string        // Language identifier for syntax highlighting. Default: 'text'
  title: string           // Optional title bar text. Default: undefined
  showLineNumbers: boolean // Show line number gutter. Default: true
  startLine: number       // Starting line number. Default: 1
  highlight: string       // Comma-separated line numbers or ranges to highlight. Default: undefined
                          // Example: "1,3,5-8"
  maxHeight: number       // Max height before scroll. Default: undefined (no limit)
  font: string            // CSS font shorthand. Default: '"14px \"JetBrains Mono\", monospace"'
  lineHeight: number      // Line height in px. Default: 20
  padding: number         // Inner padding in px. Default: 16
  background: string      // Background color. Default: '#1E1E2E'
  wrap: boolean           // Soft-wrap long lines. Default: false
}
```

**Allowed children:** Raw text only (the code content). No nested tags.

**Layout behavior:**
1. Title bar (if present): measured via `prepare(title, titleFont)` → `layout(prepared, maxWidth, titleLineHeight)`. Title font: `"600 13px Inter"`, lineHeight `18px`. Title bar height = `18 + 12` (text + padding).
2. Line number gutter width (if `showLineNumbers`): `prepare(String(lastLineNumber), gutterFont)` → use `measureLineStats()` to get `maxLineWidth`. Gutter width = `maxLineWidth + 24` (padding).
3. Code content width = `maxWidth - gutterWidth - 2 * padding`.
4. If `wrap: false`: Each line is measured with `prepare(line, font)` → `measureLineStats(prepared, Infinity)` for actual width. The CodeBlock's natural width is `max(lineWidths) + gutterWidth + 2 * padding`. If this exceeds `maxWidth`, horizontal overflow is clipped.
5. If `wrap: true`: Each line is measured with `prepare(line, font)` → `layout(prepared, codeContentWidth, lineHeight)` → gets wrapped height.
6. Total code height = sum of all line heights.
7. If `maxHeight` is set and total height exceeds it: CodeBlock clips at `maxHeight` and enters scroll overflow (see §6.3).

**Streaming behavior:**
- **Line-by-line incremental.** As text tokens arrive, the parser splits on newlines. Each complete line is immediately measured and appended to the layout.
- **Partial line buffering.** The current (incomplete) line is measured and displayed but marked as `uncommitted`. When the next token arrives, the current line is re-measured. This causes at most 1 line of re-layout — NOT a full reflow.
- **Line number gutter width may change** when the line count crosses a digit boundary (e.g., 9→10, 99→100). The gutter width is reserved for the **maximum expected line count** (estimated as `currentLineCount * 2`, minimum `4` digits) to prevent gutter-width-triggered reflows.

---

### 3.3 `<DataTable>`

**Purpose:** Structured tabular data display with headers, rows, and optional column alignment.

**Allowed attributes:**
```typescript
type DataTableProps = {
  columns: string         // Pipe-separated column definitions: "Name|Revenue|Growth"
                          // Each column can include alignment: "Name:left|Revenue:right|Growth:center"
                          // Default alignment: 'left'
  striped: boolean        // Alternate row background colors. Default: true
  compact: boolean        // Reduced cell padding. Default: false
  maxHeight: number       // Max height before scroll. Default: undefined
  headerBackground: string // Header row background. Default: '#F1F3F5'
  font: string            // Body font. Default: '"14px Inter"'
  headerFont: string      // Header font. Default: '"600 14px Inter"'
  lineHeight: number      // Row line height. Default: 20
  cellPadding: number     // Cell padding in px. Default: 12 (8 if compact)
  borderColor: string     // Border/divider color. Default: '#E9ECEF'
}
```

**Allowed children:** Raw text rows, pipe-separated, one row per line. Example:
```
<DataTable columns="Company|Revenue:right|YoY Growth:right">
Acme Corp|$4.2M|+23%
Globex|$2.8M|+15%
Initech|$1.1M|-3%
</DataTable>
```

**Layout behavior:**
1. Parse `columns` attribute into column definitions with name, alignment.
2. **Column width algorithm:**
   a. Measure each header text: `prepare(headerText, headerFont)` → `measureLineStats(prepared, Infinity)` → `maxLineWidth`.
   b. Measure each cell text in each column: same process with body font.
   c. Column intrinsic width = `max(headerWidth, maxCellWidth) + 2 * cellPadding`.
   d. If sum of intrinsic widths ≤ `availableWidth`: columns use intrinsic widths. Remaining space distributed proportionally.
   e. If sum exceeds `availableWidth`: columns are proportionally compressed. Text that overflows a compressed cell wraps (measured via `layout(prepared, cellWidth, lineHeight)`).
3. Row height = max cell height in that row + `2 * cellPadding`.
4. Total height = header row height + sum of data row heights + border widths.

**Streaming behavior:**
- **Header renders immediately** from the `columns` attribute on open tag.
- **Rows append incrementally.** Each newline in the text content produces a new row.
- **Column width re-computation:** Column widths are initially computed from headers only. As rows stream in, if a cell's intrinsic width exceeds the current column width, the column MAY widen — but ONLY during the first `N` rows (configurable, default `N=5`). After `N` rows, column widths are locked to prevent late-stage reflows.
- **Late rows that exceed locked column widths:** Text wraps within the cell.

---

### 3.4 `<Chart>`

**Purpose:** Declarative chart specification. The engine generates chart geometry from structured data. Supports common chart types for dashboard layouts.

**Allowed attributes:**
```typescript
type ChartProps = {
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter' // Chart type. Required.
  title: string           // Chart title. Default: undefined
  width: number | 'fill'  // Chart width. Default: 'fill'
  height: number           // Chart height in px. Default: 240
  padding: number          // Inner padding in px. Default: 16
  colors: string           // Comma-separated CSS color values for data series. Default: '#4C6EF5,#F76707,#37B24D,#F03E3E,#AE3EC9'
  showLegend: boolean      // Show legend. Default: true
  showGrid: boolean        // Show background grid lines. Default: true
  xLabel: string           // X-axis label. Default: undefined
  yLabel: string           // Y-axis label. Default: undefined
  animate: boolean         // Animate on render. Default: false
}
```

**Allowed children:** Raw text in CSV-like format. First row = labels. Subsequent rows = data series.
```
<Chart type="bar" title="Q4 Revenue by Region" height={300}>
Region,North,South,East,West
Revenue,4200,3100,5800,2900
Target,4000,3500,5000,3000
</Chart>
```

**Layout behavior:**
1. Chart reserves a fixed `width × height` area. Width is resolved from parent constraint if `'fill'`.
2. Title (if present): measured via `prepare(title, titleFont)` → `layout()`. Title font: `"600 14px Inter"`, lineHeight `20px`. Occupies top of chart area.
3. Legend (if shown): measured via `prepare()` for each series label. Positioned below the chart plot area.
4. Axis labels: measured via `prepare()`. Positioned along respective axes.
5. Plot area = `chartArea - titleHeight - legendHeight - axisLabelHeights - padding`.
6. Data geometry is calculated as pure coordinate math within the plot area bounds.
7. Y-axis tick labels: measured via `prepare(tickLabel, tickFont)` to determine axis width.

**Streaming behavior:**
- **Deferred render.** Chart requires complete data before geometry can be calculated. The `width × height` rectangle is reserved immediately, but the chart content renders only on `</Chart>`.
- **Placeholder:** During streaming, the reserved area displays a loading placeholder (empty frame with title if available).
- **Rationale:** Partial chart data would produce misleading visualizations and require full re-layout on each new data row.

---

### 3.5 `<Quote>`

**Purpose:** A styled blockquote with optional attribution. Used for call-outs, testimonials, and cited text.

**Allowed attributes:**
```typescript
type QuoteProps = {
  cite: string            // Attribution source (author, publication). Default: undefined
  variant: 'default' | 'highlight' | 'pull' // Visual style variant. Default: 'default'
  borderColor: string     // Left border accent color. Default: '#CED4DA'
  font: string            // Quote text font. Default: '"italic 16px Georgia, serif"'
  lineHeight: number      // Line height in px. Default: 26
  padding: number         // Inner padding in px. Default: 16
  paddingLeft: number     // Left padding (inside border). Default: 20
}
```

**Allowed children:** Primitives (`<Text>`) and raw Markdown text.

**Layout behavior:**
1. Left border occupies `4px` width.
2. Text content area = `availableWidth - 4 (border) - paddingLeft - paddingRight`.
3. Quote text measured via `prepareWithSegments(text, font)` → `layoutWithLines(prepared, contentWidth, lineHeight)`.
4. Citation (if present): measured separately. Font: `"500 13px Inter"`, lineHeight `18px`. Positioned below quote text with 8px gap.
5. `variant: 'pull'`: Larger font (`"italic 20px Georgia, serif"`, lineHeight `32px`), centered, no left border.
6. `variant: 'highlight'`: Full background fill (`borderColor` at 10% opacity), border on left.

**Streaming behavior:**
- **Incremental text flow.** Quote text renders line-by-line as tokens arrive, identical to `<Text>` streaming behavior.
- **Citation renders on close** (it's an attribute, displayed after content).

---

### 3.6 `<Callout>`

**Purpose:** An attention-drawing content block with an icon, title, and body text. Used for warnings, tips, notes, and important information.

**Allowed attributes:**
```typescript
type CalloutProps = {
  type: 'info' | 'warning' | 'error' | 'success' | 'tip' | 'note' // Semantic type. Default: 'info'
  title: string           // Callout title. Default: auto-derived from `type` (e.g., "Info", "Warning")
  icon: boolean           // Show type-appropriate icon. Default: true
  collapsible: boolean    // Allow collapse/expand interaction. Default: false
  collapsed: boolean      // Initial collapsed state (only if collapsible). Default: false
  padding: number         // Inner padding in px. Default: 16
  borderRadius: number    // Corner radius in px. Default: 8
}
```

**Type → color mapping:**
| Type | Background | Border | Icon |
|------|-----------|--------|------|
| `info` | `#EBF5FF` | `#4C6EF5` | ℹ️ |
| `warning` | `#FFF9DB` | `#F59F00` | ⚠️ |
| `error` | `#FFE3E3` | `#F03E3E` | ❌ |
| `success` | `#EBFBEE` | `#37B24D` | ✅ |
| `tip` | `#E6FCF5` | `#12B886` | 💡 |
| `note` | `#F3F0FF` | `#7950F2` | 📝 |

**Allowed children:** Primitives and raw Markdown text.

**Layout behavior:**
1. Icon (if shown): fixed 20×20px area, positioned top-left.
2. Title: measured via `prepare(title, titleFont)`. Font: `"600 14px Inter"`, lineHeight `20px`. Positioned right of icon with 8px gap.
3. Body content: positioned below title with 8px gap. Full width minus padding.
4. Total height = padding + max(iconHeight, titleHeight) + bodyGap + bodyHeight + padding.
5. If `collapsible: true` and `collapsed: true`: height = padding + max(iconHeight, titleHeight) + padding (body hidden).

**Streaming behavior:**
- **Title renders immediately** from attribute.
- **Body renders incrementally** as tokens arrive.
- **Collapsible state** is interactive post-render and does not affect streaming layout (always laid out in expanded state for geometry, then visually collapsed by renderer if needed).

---

## 4. Primitives (Tier 3)

### 4.1 `<Text>`

**Purpose:** The fundamental text rendering primitive. All visible text ultimately flows through `<Text>` measurement.

**Allowed attributes:**
```typescript
type TextProps = {
  font: string            // CSS font shorthand. Default: '"14px Inter"'
  lineHeight: number      // Line height in px. Default: 20
  color: string           // Text color. Default: '#212529'
  align: 'left' | 'center' | 'right' // Text alignment. Default: 'left'
  whiteSpace: 'normal' | 'pre-wrap' // Whitespace handling (passed to pretext). Default: 'normal'
  wordBreak: 'normal' | 'keep-all' // Word break behavior (passed to pretext). Default: 'normal'
  maxLines: number        // Truncate after N lines with ellipsis. Default: undefined (no limit)
  opacity: number         // Text opacity 0-1. Default: 1
}
```

**Allowed children:** Raw text only. No nested tags.

**Layout behavior:**
1. Text content is measured via `prepareWithSegments(text, font, { whiteSpace, wordBreak })` → `layoutWithLines(prepared, maxWidth, lineHeight)`.
2. The result provides `height`, `lineCount`, and `lines[]` (each with `text`, `width`, `start`, `end`).
3. If `maxLines` is set and `lineCount > maxLines`: height = `maxLines * lineHeight`. Last visible line is truncated with `"…"` (ellipsis measured and subtracted from available width for last line).
4. For `align: 'center'` or `'right'`: each line's x-offset = `(maxWidth - line.width) / 2` or `(maxWidth - line.width)`.

**Streaming behavior:**
- **Token-by-token measurement.** On each token append:
  1. Concatenate token to current text buffer.
  2. Call `prepare(buffer, font)` → `layout(prepared, maxWidth, lineHeight)` to get updated `height` and `lineCount`.
  3. If `lineCount` changed (new line wrapped): update layout.
  4. If `lineCount` unchanged: only the last line's width changed — renderer updates last line only.
- **Optimization:** Use `walkLineRanges()` with the previous `LayoutCursor` end position to incrementally measure only the affected tail, avoiding re-measuring the entire text on each token.
- **Re-prepare frequency:** Full `prepare()` is called only when the text buffer has grown by ≥64 characters since last prepare OR when a newline character is encountered. Between re-prepares, the last line is approximated by accumulating segment widths. This caps re-prepare cost.

---

### 4.2 `<Heading>`

**Purpose:** Title/heading text with semantic level. Syntactic sugar over `<Text>` with preset font scales.

**Allowed attributes:**
```typescript
type HeadingProps = {
  level: 1 | 2 | 3 | 4 | 5 | 6  // Heading level. Default: 1
  color: string           // Text color. Default: '#212529'
  align: 'left' | 'center' | 'right' // Text alignment. Default: 'left'
  marginBottom: number    // Space below heading in px. Default: derived from level
}
```

**Font scale (non-overridable):**
| Level | Font | Line Height | Margin Bottom |
|-------|------|-------------|---------------|
| 1 | `"700 32px Inter"` | 40px | 24px |
| 2 | `"700 24px Inter"` | 32px | 20px |
| 3 | `"600 20px Inter"` | 28px | 16px |
| 4 | `"600 16px Inter"` | 24px | 12px |
| 5 | `"500 14px Inter"` | 20px | 8px |
| 6 | `"500 12px Inter"` | 16px | 8px |

**Allowed children:** Raw text only.

**Layout behavior:** Identical to `<Text>` with the font, lineHeight, and marginBottom derived from `level`.

**Streaming behavior:** Identical to `<Text>`.

---

### 4.3 `<Spacer>`

**Purpose:** Explicit empty space. Used to insert precise vertical or horizontal gaps.

**Allowed attributes:**
```typescript
type SpacerProps = {
  height: number          // Vertical space in px. Default: 16
  width: number           // Horizontal space in px (only meaningful in horizontal Stacks). Default: 0
}
```

**Allowed children:** None. Self-closing tag.

**Layout behavior:**
1. In a vertical flow: contributes `height` px to the parent's layout height. Width = 0 (invisible).
2. In a horizontal flow: contributes `width` px to the parent's layout width. Height = 0.
3. If both are set: acts as a fixed-size invisible rectangle.

**Streaming behavior:**
- **Immediate.** Spacer is fully defined by its attributes. Renders instantly on tag parse.

---

### 4.4 `<Divider>`

**Purpose:** A visual horizontal (or vertical) rule/separator.

**Allowed attributes:**
```typescript
type DividerProps = {
  direction: 'horizontal' | 'vertical' // Divider orientation. Default: 'horizontal'
  thickness: number       // Line thickness in px. Default: 1
  color: string           // Line color. Default: '#DEE2E6'
  marginTop: number       // Space above (or left, if vertical) in px. Default: 12
  marginBottom: number    // Space below (or right, if vertical) in px. Default: 12
  indent: number          // Inset from both edges in px. Default: 0
}
```

**Allowed children:** None. Self-closing tag.

**Layout behavior:**
1. `direction: 'horizontal'`: Total occupied height = `marginTop + thickness + marginBottom`. Width = `availableWidth - 2 * indent`.
2. `direction: 'vertical'`: Total occupied width = `marginLeft(marginTop) + thickness + marginRight(marginBottom)`. Height = `availableHeight - 2 * indent` (or parent's current content height).

**Streaming behavior:**
- **Immediate.** Fully defined by attributes. Renders on tag parse.

---

### 4.5 `<Image>`

**Purpose:** An image element with explicit dimensions. Pretext cannot measure images — dimensions MUST be specified or a fallback aspect ratio is used.

**Allowed attributes:**
```typescript
type ImageProps = {
  src: string             // Image URL or data URI. Required.
  alt: string             // Alt text for accessibility. Default: ''
  width: number | 'fill'  // Image width. 'fill' = parent width. Default: 'fill'
  height: number | 'auto' // Image height. 'auto' = calculated from aspect ratio. Default: 'auto'
  aspectRatio: string     // Aspect ratio (e.g., "16:9", "4:3", "1:1"). Default: '16:9'
  fit: 'cover' | 'contain' | 'fill' // Image fit within bounds. Default: 'cover'
  borderRadius: number    // Corner radius in px. Default: 0
  caption: string         // Image caption text. Default: undefined
  captionFont: string     // Caption font. Default: '"italic 12px Inter"'
}
```

**Allowed children:** None. Self-closing tag.

**Layout behavior:**
1. If `width` is `'fill'`: resolvedWidth = parent's available width.
2. If `height` is `'auto'`: resolvedHeight = `resolvedWidth / aspectRatioValue`. (e.g., `16:9` → `resolvedWidth * 9/16`).
3. If both `width` and `height` are explicit: image scales per `fit` mode.
4. Caption (if present): measured via `prepare(caption, captionFont)` → `layout(prepared, resolvedWidth, captionLineHeight)`. Positioned below image with 4px gap.
5. Total block height = resolvedHeight + captionGap + captionHeight.

**Streaming behavior:**
- **Immediate reservation.** The image's space is reserved on tag parse using `width` and `aspectRatio`. The image itself loads asynchronously — the renderer shows a placeholder (background color from parent, aspect-ratio box) until the image loads.
- **No layout shift.** Since dimensions are declared or calculated from aspect ratio, the space is always pre-reserved.

---

## 5. Streaming Protocol

### 5.1 Token Ingestion Pipeline

```
LLM Token Stream → Tokenizer → Parser (AST Builder) → Layout Engine → Renderer
```

The streaming pipeline processes one token at a time. A "token" is a chunk of text emitted by the LLM — typically 1-4 characters or a complete word, depending on the tokenizer.

### 5.2 Tokenizer: Partial Tag Handling

The tokenizer maintains a state machine with the following states:

```typescript
type TokenizerState =
  | { mode: 'text' }                                    // Accumulating plain text
  | { mode: 'tag-opening'; buffer: string }              // Seen '<', accumulating tag name
  | { mode: 'tag-attributes'; tag: string; buffer: string } // Past tag name, accumulating attributes
  | { mode: 'tag-closing'; buffer: string }              // Seen '</', accumulating close tag name
  | { mode: 'self-closing'; tag: string }                // Seen '/>' — about to emit
```

**Rules for partial tag handling:**

1. **`<` encountered in `text` mode:** Transition to `tag-opening`. Buffer the `<`. Do NOT emit any partial tag to the AST.
2. **More characters arrive in `tag-opening`:** Accumulate into buffer. If the buffer matches a known tag prefix (e.g., `Sli` is a prefix of `Slide`), remain in `tag-opening`. If the buffer is NOT a prefix of any known tag (e.g., `<foo`), treat the entire buffer as literal text — transition back to `text` and emit `<foo` as a text token.
3. **Tag name completes (whitespace or `>` follows):** If the name matches a known tag, transition to `tag-attributes` (if whitespace) or emit a tag-open event (if `>`).
4. **Attributes accumulate** until `>` or `/>` is encountered.
5. **`/>` encountered:** Emit a self-closing tag event with parsed attributes.
6. **`</` encountered in `text` mode:** Transition to `tag-closing`.
7. **Close tag completes with `>`:** Emit a tag-close event. If the close tag doesn't match any open tag, emit as literal text with a parser warning.

**Critical rule:** The parser NEVER emits a partial tag to the AST or renderer. Tags are buffered entirely in the tokenizer until they're syntactically complete. This ensures the AST is always structurally valid.

**Timeout rule:** If a `tag-opening` or `tag-closing` state persists for more than 500ms without resolution (no new tokens), the buffer is flushed as literal text and state returns to `text`. This handles cases where the LLM abandons a tag mid-stream.

### 5.3 AST Incremental Updates

The AST is a mutable tree that is updated in-place during streaming. It is NOT rebuilt from scratch on each token.

**AST update operations:**

| Token Event | AST Operation |
|------------|---------------|
| Text token | Append to current open node's text buffer |
| Tag open | Create new child node, push onto open-node stack |
| Tag close | Pop from open-node stack, mark node as `closed` |
| Self-closing tag | Create child node, immediately mark as `closed` |

**Node lifecycle states:**
```typescript
type NodeStatus = 'streaming' | 'closed'
```
- `streaming`: The node's open tag has been parsed but `</Tag>` has not arrived. Content may still be appended.
- `closed`: The close tag has been parsed. The node is complete and immutable.

### 5.4 Layout Recalculation Triggers

Layout recalculation is NOT triggered on every token. The engine uses a tiered strategy:

| Event | Layout Action | Scope |
|-------|--------------|-------|
| Tag open (Layout Container) | Full subtree layout from new node's parent | Parent and below |
| Tag open (Content Component) | Reserve space in parent, measure if possible | New node only |
| Tag open (Primitive — atomic) | Measure and place | New node only |
| Tag close (any) | Finalize node geometry, propagate height to parent | Node and ancestors |
| Text token (causes new line wrap) | Update current text node height, propagate | Text node and ancestors |
| Text token (same line) | Update current line width only | Renderer-only (no layout) |
| Window/container resize | Full re-layout from root | Entire tree |

**Debouncing:** Text tokens that arrive within 8ms of each other are batched into a single layout update. This ensures that a burst of tokens (common at LLM stream start) doesn't trigger N separate layout passes.

**Propagation:** When a node's height changes, its parent's layout is re-evaluated. This propagation walks UP the tree, recalculating each ancestor's height. It stops when an ancestor's height doesn't change (e.g., a `<Slide>` with fixed height).

---

## 6. Constraint System

### 6.1 Constraint Propagation (Parent → Child)

Every node receives a **LayoutConstraint** from its parent:

```typescript
type LayoutConstraint = {
  maxWidth: number         // Maximum width this node can occupy
  maxHeight: number        // Maximum height (Infinity if unconstrained)
  availableWidth: number   // Actual available width after siblings (for horizontal layouts)
  availableHeight: number  // Actual available height after preceding siblings
}
```

**Propagation rules:**

| Parent Type | Child Constraint |
|------------|-----------------|
| `<Slide>` | `maxWidth = contentWidth`, `maxHeight = contentHeight` |
| `<AutoGrid>` | `maxWidth = cellWidth`, `maxHeight = Infinity` |
| `<Stack direction="vertical">` | `maxWidth = contentWidth`, `maxHeight = remainingHeight` |
| `<Stack direction="horizontal">` | `maxWidth = remainingWidth`, `maxHeight = parentContentHeight` |
| `<Columns>` | `maxWidth = resolvedColumnWidth`, `maxHeight = Infinity` |
| `<Canvas>` | `maxWidth = canvasWidth - x`, `maxHeight = canvasHeight - y` (or Infinity if auto) |

**The constraint flows downward exactly once per layout pass.** A child NEVER requests a size larger than its constraint. If content overflows, the overflow mode (§6.3) governs behavior.

### 6.2 Content-Based Sizing

Nodes compute their size based on their content and their constraint:

```typescript
type SizingMode = 'fill' | 'hug' | 'fixed'
```

| Mode | Behavior |
|------|----------|
| `fill` | Node expands to fill `maxWidth` / `availableWidth`. Default for most containers and text. |
| `hug` | Node shrinks to the minimum size that fits its content. Used by `<MetricCard>` in auto-width grids, `<Image>` with explicit dimensions. |
| `fixed` | Node has an explicit `width`/`height` attribute. Constraint is ignored for that axis. Used by `<Slide>`, `<Chart>`, explicit `<Canvas>`. |

**Width resolution order:**
1. If node has explicit `width` attribute (px value): use it. Mode = `fixed`.
2. If node has `width="fill"`: use `constraint.maxWidth`. Mode = `fill`.
3. If no width specified: default to `fill` for containers, `hug` for atomics with intrinsic size.

**Height resolution:**
1. All nodes compute height from content (text measurement, children heights) unless an explicit `height` is set.
2. Explicit `height` creates a `fixed` constraint that clips or enables scroll (see §6.3).

### 6.3 Overflow Behavior

```typescript
type OverflowMode = 'clip' | 'scroll' | 'wrap' | 'visible'
```

| Mode | Behavior | Applied When |
|------|----------|-------------|
| `clip` | Content beyond bounds is hidden | `<Canvas overflow="clip">`, `<CodeBlock>` without maxHeight |
| `scroll` | Content beyond bounds is scrollable | `<CodeBlock maxHeight={N}>`, `<DataTable maxHeight={N}>` |
| `wrap` | Text wraps to next line, containers wrap children | Default for text, `<Stack wrap={true}>` |
| `visible` | Content renders beyond bounds (may overlap siblings) | `<Canvas overflow="visible">` |

**Default overflow per tag:**

| Tag | Default Overflow |
|-----|-----------------|
| `<Slide>` | `clip` (fixed viewport) |
| `<AutoGrid>` | `visible` (grid expands vertically) |
| `<Stack>` | `visible` (stack grows along main axis) |
| `<Columns>` | `visible` (columns grow vertically) |
| `<Canvas>` | `clip` |
| `<CodeBlock>` | `clip` (horizontal), `scroll` if maxHeight set (vertical) |
| `<DataTable>` | `scroll` if maxHeight set, otherwise `visible` |
| `<Text>` | `wrap` |
| All others | `visible` |

---

## 7. AST Type Definitions (Discriminated Unions)

```typescript
// ─── Core Position & Measurement Types ───────────────────────────────

type Pixels = number

interface Rect {
  x: Pixels
  y: Pixels
  width: Pixels
  height: Pixels
}

interface Insets {
  top: Pixels
  right: Pixels
  bottom: Pixels
  left: Pixels
}

// ─── Node Status ─────────────────────────────────────────────────────

type NodeStatus = 'streaming' | 'closed'

// ─── Base Node Fields ────────────────────────────────────────────────

interface NodeBase {
  id: string
  status: NodeStatus
  computedRect: Rect | null   // null until first layout pass
  parentId: string | null
}

// ─── Layout Container Props ──────────────────────────────────────────

interface SlideProps {
  width: Pixels
  height: Pixels
  padding: Pixels
  paddingX: Pixels | undefined
  paddingY: Pixels | undefined
  background: string
  id: string
}

interface AutoGridProps {
  minChildWidth: Pixels
  gap: Pixels
  gapX: Pixels | undefined
  gapY: Pixels | undefined
  columns: number | 'auto'
  align: 'start' | 'center' | 'stretch'
  padding: Pixels
}

interface StackProps {
  direction: 'vertical' | 'horizontal'
  gap: Pixels
  padding: Pixels
  paddingX: Pixels | undefined
  paddingY: Pixels | undefined
  align: 'start' | 'center' | 'end' | 'stretch'
  justify: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  wrap: boolean
}

interface ColumnsProps {
  widths: string
  gap: Pixels
  padding: Pixels
  valign: 'top' | 'center' | 'bottom' | 'stretch'
}

interface CanvasProps {
  width: Pixels | 'fill'
  height: Pixels | 'auto'
  padding: Pixels
  background: string
  overflow: 'visible' | 'clip'
}

// ─── Content Component Props ─────────────────────────────────────────

interface MetricCardProps {
  label: string
  value: string
  delta: string | undefined
  trend: 'up' | 'down' | 'flat' | undefined
  sentiment: 'positive' | 'negative' | 'neutral'
  footer: string | undefined
  padding: Pixels
  background: string
  borderRadius: Pixels
}

interface CodeBlockProps {
  language: string
  title: string | undefined
  showLineNumbers: boolean
  startLine: number
  highlight: string | undefined
  maxHeight: Pixels | undefined
  font: string
  lineHeight: Pixels
  padding: Pixels
  background: string
  wrap: boolean
}

interface DataTableProps {
  columns: string
  striped: boolean
  compact: boolean
  maxHeight: Pixels | undefined
  headerBackground: string
  font: string
  headerFont: string
  lineHeight: Pixels
  cellPadding: Pixels
  borderColor: string
}

interface ChartProps {
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter'
  title: string | undefined
  width: Pixels | 'fill'
  height: Pixels
  padding: Pixels
  colors: string
  showLegend: boolean
  showGrid: boolean
  xLabel: string | undefined
  yLabel: string | undefined
  animate: boolean
}

interface QuoteProps {
  cite: string | undefined
  variant: 'default' | 'highlight' | 'pull'
  borderColor: string
  font: string
  lineHeight: Pixels
  padding: Pixels
  paddingLeft: Pixels
}

interface CalloutProps {
  type: 'info' | 'warning' | 'error' | 'success' | 'tip' | 'note'
  title: string
  icon: boolean
  collapsible: boolean
  collapsed: boolean
  padding: Pixels
  borderRadius: Pixels
}

// ─── Primitive Props ─────────────────────────────────────────────────

interface TextProps {
  font: string
  lineHeight: Pixels
  color: string
  align: 'left' | 'center' | 'right'
  whiteSpace: 'normal' | 'pre-wrap'
  wordBreak: 'normal' | 'keep-all'
  maxLines: number | undefined
  opacity: number
}

interface HeadingProps {
  level: 1 | 2 | 3 | 4 | 5 | 6
  color: string
  align: 'left' | 'center' | 'right'
  marginBottom: Pixels
}

interface SpacerProps {
  height: Pixels
  width: Pixels
}

interface DividerProps {
  direction: 'horizontal' | 'vertical'
  thickness: Pixels
  color: string
  marginTop: Pixels
  marginBottom: Pixels
  indent: Pixels
}

interface ImageProps {
  src: string
  alt: string
  width: Pixels | 'fill'
  height: Pixels | 'auto'
  aspectRatio: string
  fit: 'cover' | 'contain' | 'fill'
  borderRadius: Pixels
  caption: string | undefined
  captionFont: string
}

// ─── Text Buffer (for streaming) ─────────────────────────────────────

interface TextBuffer {
  raw: string                           // Accumulated raw text
  prepared: PreparedTextWithSegments | null  // Cached pretext handle (invalidated on change)
  lastPrepareLength: number             // Text length at last prepare() call
}

// ─── AST Node: Discriminated Union ───────────────────────────────────

type SpatialNode =
  // Layout Containers
  | (NodeBase & { kind: 'slide';      props: SlideProps;      children: SpatialNode[] })
  | (NodeBase & { kind: 'auto-grid';  props: AutoGridProps;   children: SpatialNode[] })
  | (NodeBase & { kind: 'stack';      props: StackProps;      children: SpatialNode[] })
  | (NodeBase & { kind: 'columns';    props: ColumnsProps;    children: SpatialNode[] })
  | (NodeBase & { kind: 'canvas';     props: CanvasProps;     children: SpatialNode[] })
  // Content Components
  | (NodeBase & { kind: 'metric-card'; props: MetricCardProps; children: [] })
  | (NodeBase & { kind: 'code-block';  props: CodeBlockProps;  children: []; textBuffer: TextBuffer })
  | (NodeBase & { kind: 'data-table';  props: DataTableProps;  children: []; textBuffer: TextBuffer })
  | (NodeBase & { kind: 'chart';       props: ChartProps;      children: []; textBuffer: TextBuffer })
  | (NodeBase & { kind: 'quote';       props: QuoteProps;      children: SpatialNode[]; textBuffer: TextBuffer })
  | (NodeBase & { kind: 'callout';     props: CalloutProps;    children: SpatialNode[]; textBuffer: TextBuffer })
  // Primitives
  | (NodeBase & { kind: 'text';     props: TextProps;     children: []; textBuffer: TextBuffer })
  | (NodeBase & { kind: 'heading';  props: HeadingProps;  children: []; textBuffer: TextBuffer })
  | (NodeBase & { kind: 'spacer';   props: SpacerProps;   children: [] })
  | (NodeBase & { kind: 'divider';  props: DividerProps;  children: [] })
  | (NodeBase & { kind: 'image';    props: ImageProps;    children: [] })

// ─── Root Document ───────────────────────────────────────────────────

interface SpatialDocument {
  version: '1.0'
  children: SpatialNode[]
  nodeIndex: Map<string, SpatialNode>   // Fast lookup by id
  openStack: SpatialNode[]               // Stack of currently-streaming nodes
}

// ─── Layout Constraint (passed parent → child) ──────────────────────

interface LayoutConstraint {
  maxWidth: Pixels
  maxHeight: Pixels         // Infinity if unconstrained
  availableWidth: Pixels    // Width remaining after preceding siblings
  availableHeight: Pixels   // Height remaining after preceding siblings
}

// ─── Computed Layout Result (attached to each node) ──────────────────

interface ComputedLayout {
  rect: Rect                // Final position and size
  insets: Insets             // Resolved padding
  contentRect: Rect          // Inner content area (rect minus insets)
  overflow: 'clip' | 'scroll' | 'wrap' | 'visible'
  childLayouts: ComputedLayout[] // Parallel array to children
}

// ─── Kind Helpers ────────────────────────────────────────────────────

type LayoutContainerKind = 'slide' | 'auto-grid' | 'stack' | 'columns' | 'canvas'
type ContentComponentKind = 'metric-card' | 'code-block' | 'data-table' | 'chart' | 'quote' | 'callout'
type PrimitiveKind = 'text' | 'heading' | 'spacer' | 'divider' | 'image'

type NodeKind = LayoutContainerKind | ContentComponentKind | PrimitiveKind

// ─── Type Guards ─────────────────────────────────────────────────────

function isLayoutContainer(node: SpatialNode): node is Extract<SpatialNode, { kind: LayoutContainerKind }> {
  return ['slide', 'auto-grid', 'stack', 'columns', 'canvas'].includes(node.kind)
}

function isContentComponent(node: SpatialNode): node is Extract<SpatialNode, { kind: ContentComponentKind }> {
  return ['metric-card', 'code-block', 'data-table', 'chart', 'quote', 'callout'].includes(node.kind)
}

function isPrimitive(node: SpatialNode): node is Extract<SpatialNode, { kind: PrimitiveKind }> {
  return ['text', 'heading', 'spacer', 'divider', 'image'].includes(node.kind)
}

function hasTextBuffer(node: SpatialNode): node is Extract<SpatialNode, { textBuffer: TextBuffer }> {
  return 'textBuffer' in node
}
```

---

## 8. Default Values Reference

All defaults in one place for implementors:

### Layout Containers

| Tag | Attribute | Default |
|-----|-----------|---------|
| `<Slide>` | `width` | `1280` |
| `<Slide>` | `height` | `720` |
| `<Slide>` | `padding` | `48` |
| `<Slide>` | `background` | `'#FFFFFF'` |
| `<AutoGrid>` | `minChildWidth` | `200` |
| `<AutoGrid>` | `gap` | `16` |
| `<AutoGrid>` | `columns` | `'auto'` |
| `<AutoGrid>` | `align` | `'stretch'` |
| `<AutoGrid>` | `padding` | `0` |
| `<Stack>` | `direction` | `'vertical'` |
| `<Stack>` | `gap` | `12` |
| `<Stack>` | `padding` | `0` |
| `<Stack>` | `align` | `'stretch'` |
| `<Stack>` | `justify` | `'start'` |
| `<Stack>` | `wrap` | `false` |
| `<Columns>` | `widths` | `'1fr'` |
| `<Columns>` | `gap` | `24` |
| `<Columns>` | `padding` | `0` |
| `<Columns>` | `valign` | `'top'` |
| `<Canvas>` | `width` | `'fill'` |
| `<Canvas>` | `height` | `'auto'` |
| `<Canvas>` | `padding` | `0` |
| `<Canvas>` | `background` | `'transparent'` |
| `<Canvas>` | `overflow` | `'clip'` |

### Content Components

| Tag | Attribute | Default |
|-----|-----------|---------|
| `<MetricCard>` | `sentiment` | `'neutral'` |
| `<MetricCard>` | `padding` | `16` |
| `<MetricCard>` | `background` | `'#F8F9FA'` |
| `<MetricCard>` | `borderRadius` | `8` |
| `<CodeBlock>` | `language` | `'text'` |
| `<CodeBlock>` | `showLineNumbers` | `true` |
| `<CodeBlock>` | `startLine` | `1` |
| `<CodeBlock>` | `font` | `'"14px \"JetBrains Mono\", monospace"'` |
| `<CodeBlock>` | `lineHeight` | `20` |
| `<CodeBlock>` | `padding` | `16` |
| `<CodeBlock>` | `background` | `'#1E1E2E'` |
| `<CodeBlock>` | `wrap` | `false` |
| `<DataTable>` | `striped` | `true` |
| `<DataTable>` | `compact` | `false` |
| `<DataTable>` | `headerBackground` | `'#F1F3F5'` |
| `<DataTable>` | `font` | `'"14px Inter"'` |
| `<DataTable>` | `headerFont` | `'"600 14px Inter"'` |
| `<DataTable>` | `lineHeight` | `20` |
| `<DataTable>` | `cellPadding` | `12` |
| `<DataTable>` | `borderColor` | `'#E9ECEF'` |
| `<Chart>` | `height` | `240` |
| `<Chart>` | `width` | `'fill'` |
| `<Chart>` | `padding` | `16` |
| `<Chart>` | `colors` | `'#4C6EF5,#F76707,#37B24D,#F03E3E,#AE3EC9'` |
| `<Chart>` | `showLegend` | `true` |
| `<Chart>` | `showGrid` | `true` |
| `<Chart>` | `animate` | `false` |
| `<Quote>` | `variant` | `'default'` |
| `<Quote>` | `borderColor` | `'#CED4DA'` |
| `<Quote>` | `font` | `'"italic 16px Georgia, serif"'` |
| `<Quote>` | `lineHeight` | `26` |
| `<Quote>` | `padding` | `16` |
| `<Quote>` | `paddingLeft` | `20` |
| `<Callout>` | `type` | `'info'` |
| `<Callout>` | `icon` | `true` |
| `<Callout>` | `collapsible` | `false` |
| `<Callout>` | `collapsed` | `false` |
| `<Callout>` | `padding` | `16` |
| `<Callout>` | `borderRadius` | `8` |

### Primitives

| Tag | Attribute | Default |
|-----|-----------|---------|
| `<Text>` | `font` | `'"14px Inter"'` |
| `<Text>` | `lineHeight` | `20` |
| `<Text>` | `color` | `'#212529'` |
| `<Text>` | `align` | `'left'` |
| `<Text>` | `whiteSpace` | `'normal'` |
| `<Text>` | `wordBreak` | `'normal'` |
| `<Text>` | `opacity` | `1` |
| `<Heading>` | `level` | `1` |
| `<Heading>` | `color` | `'#212529'` |
| `<Heading>` | `align` | `'left'` |
| `<Spacer>` | `height` | `16` |
| `<Spacer>` | `width` | `0` |
| `<Divider>` | `direction` | `'horizontal'` |
| `<Divider>` | `thickness` | `1` |
| `<Divider>` | `color` | `'#DEE2E6'` |
| `<Divider>` | `marginTop` | `12` |
| `<Divider>` | `marginBottom` | `12` |
| `<Divider>` | `indent` | `0` |
| `<Image>` | `alt` | `''` |
| `<Image>` | `width` | `'fill'` |
| `<Image>` | `height` | `'auto'` |
| `<Image>` | `aspectRatio` | `'16:9'` |
| `<Image>` | `fit` | `'cover'` |
| `<Image>` | `borderRadius` | `0` |
| `<Image>` | `captionFont` | `'"italic 12px Inter"'` |

---

## 9. Markdown Interop

Raw Markdown text (outside any tag) is parsed using standard CommonMark rules and converted into Spatial Markdown primitives:

| Markdown Syntax | Converted To |
|----------------|--------------|
| `# Heading` through `###### Heading` | `<Heading level={1..6}>Heading</Heading>` |
| Paragraph text | `<Text>paragraph text</Text>` |
| `> blockquote` | `<Quote>blockquote</Quote>` |
| `` `inline code` `` | `<Text font='"14px \"JetBrains Mono\", monospace"'>code</Text>` |
| ```` ```lang ... ``` ```` | `<CodeBlock language="lang">...</CodeBlock>` |
| `---` | `<Divider />` |
| `![alt](src)` | `<Image src="src" alt="alt" />` |
| `**bold**` | Treated as a font-weight segment within the containing `<Text>` (see §9.1) |
| `*italic*` | Treated as a font-style segment within the containing `<Text>` (see §9.1) |

### 9.1 Inline Formatting

Inline formatting (`**bold**`, `*italic*`, `` `code` ``, `~~strikethrough~~`) does NOT create new AST nodes. Instead, it creates **text segments** within a `<Text>` node's buffer. Each segment carries its own font declaration, and the text is measured by concatenating segments and using `prepareWithSegments()` for the combined string, with font changes handled at render time.

```typescript
interface TextSegment {
  text: string
  font: string          // Override font for this segment
  color: string         // Override color (for inline code background, etc.)
  decoration: 'none' | 'line-through' | 'underline'
}
```

The `<Text>` node's `textBuffer` holds the full concatenated string for measurement purposes. The segment boundaries are tracked separately for rendering.

---

## 10. Pretext Integration Map

How each layout operation maps to specific `@chenglou/pretext` API calls:

| Operation | Pretext API | When Used |
|-----------|------------|-----------|
| Measure text block height | `prepare()` → `layout()` | Fast height-only measurement (MetricCard, Heading, footer text) |
| Measure + get line contents | `prepareWithSegments()` → `layoutWithLines()` | Text, Quote, CodeBlock — when renderer needs per-line strings |
| Shrink-to-fit width | `prepareWithSegments()` → `measureLineStats()` | Auto-width Columns, intrinsic sizing |
| Streaming line measurement | `prepareWithSegments()` → `walkLineRanges()` | Incremental text streaming — avoids allocating line strings |
| Variable-width lines | `prepareWithSegments()` → `layoutNextLine()` | Text wrapping around floated images in Canvas |
| Cheap line-range iteration | `prepareWithSegments()` → `layoutNextLineRange()` | Binary-search for optimal container width |
| Materialize a line range | `materializeLineRange()` | After `walkLineRanges()` finds the needed range, get the text |

**Performance rules:**
1. Use `prepare()` + `layout()` (the cheap path) whenever you only need height/lineCount.
2. Use `prepareWithSegments()` only when line content is needed for rendering.
3. Cache `PreparedText` / `PreparedTextWithSegments` handles on the node. Re-prepare only when text content changes.
4. During streaming, prefer `walkLineRanges()` over `layoutWithLines()` — it avoids string allocation for lines that haven't changed.

---

## 11. Example DSL Snippets

### 11.1 Presentation Slide Deck (3 Slides)

```xml
<Slide background="#0F172A" padding={64}>
  <Heading level={1} color="#F8FAFC" align="center">
    Q4 2026 Product Strategy
  </Heading>
  <Spacer height={16} />
  <Text font='"18px Inter"' lineHeight={28} color="#94A3B8" align="center">
    From feature factory to outcome engine — our path to $10M ARR
  </Text>
  <Spacer height={48} />
  <Columns widths="1fr 1fr 1fr" gap={32}>
    <MetricCard label="ARR" value="$7.2M" delta="+34% YoY" trend="up" sentiment="positive" background="#1E293B" />
    <MetricCard label="NPS" value="62" delta="+8 pts" trend="up" sentiment="positive" background="#1E293B" />
    <MetricCard label="Churn" value="2.1%" delta="-0.4%" trend="down" sentiment="positive" background="#1E293B" />
  </Columns>
</Slide>

<Slide padding={48}>
  <Heading level={2}>The Problem We're Solving</Heading>
  <Spacer height={24} />
  <Columns widths="1fr 1fr" gap={40}>
    <Stack gap={16}>
      <Callout type="error" title="Current State">
        67% of users drop off before completing setup.
        Average time-to-value is 14 days — 3x industry benchmark.
      </Callout>
      <Quote cite="Customer Interview #42, Enterprise Segment">
        I signed up excited, then spent two weeks figuring out how to
        connect my first data source. By then I'd already found a workaround.
      </Quote>
    </Stack>
    <Stack gap={16}>
      <Callout type="success" title="Target State">
        First value delivered within 30 minutes.
        Guided setup with smart defaults reduces decisions from 23 to 5.
      </Callout>
      <Chart type="bar" title="Setup Completion by Step" height={200}>
        Step,Account,Connect Data,First Query,Dashboard,Share
        Current,95%,58%,42%,31%,22%
        Target,98%,85%,78%,72%,65%
      </Chart>
    </Stack>
  </Columns>
</Slide>

<Slide padding={48}>
  <Heading level={2}>Roadmap: Now / Next / Later</Heading>
  <Spacer height={24} />
  <Stack gap={20}>
    <Stack direction="horizontal" gap={12} align="center">
      <Text font='"700 14px Inter"' color="#37B24D">NOW</Text>
      <Divider direction="vertical" thickness={2} color="#37B24D" marginTop={0} marginBottom={0} />
      <Text>Guided onboarding wizard (ships Week 3)</Text>
    </Stack>
    <Stack direction="horizontal" gap={12} align="center">
      <Text font='"700 14px Inter"' color="#F59F00">NEXT</Text>
      <Divider direction="vertical" thickness={2} color="#F59F00" marginTop={0} marginBottom={0} />
      <Text>Smart defaults engine — auto-configures based on data source type</Text>
    </Stack>
    <Stack direction="horizontal" gap={12} align="center">
      <Text font='"700 14px Inter"' color="#4C6EF5">LATER</Text>
      <Divider direction="vertical" thickness={2} color="#4C6EF5" marginTop={0} marginBottom={0} />
      <Text>Template marketplace — pre-built dashboards for common use cases</Text>
    </Stack>
  </Stack>
  <Spacer height={32} />
  <DataTable columns="Initiative|Owner|Confidence:center|ETA:center" compact={true}>
    Onboarding Wizard|@sarah|High|Week 3
    Smart Defaults|@marcus|Medium|Q1 '27
    Template Marketplace|TBD|Low|Q2 '27
  </DataTable>
</Slide>
```

### 11.2 Market Analysis Dashboard

```xml
<Stack gap={24} padding={24}>
  <Heading level={2}>SaaS Market Intelligence — April 2026</Heading>
  <Divider />

  <AutoGrid minChildWidth={220} gap={16}>
    <MetricCard label="Total Addressable Market" value="$284B" delta="+18% YoY" trend="up" sentiment="positive" />
    <MetricCard label="Our Market Share" value="0.34%" delta="+0.08%" trend="up" sentiment="positive" />
    <MetricCard label="Top Competitor Share" value="4.2%" delta="+0.3%" trend="up" sentiment="negative" />
    <MetricCard label="Category Growth Rate" value="23%" delta="-2% vs Q3" trend="down" sentiment="neutral" />
    <MetricCard label="Win Rate (Enterprise)" value="38%" delta="+5%" trend="up" sentiment="positive" />
    <MetricCard label="Avg Deal Cycle" value="47 days" delta="-8 days" trend="down" sentiment="positive" />
  </AutoGrid>

  <Columns widths="2fr 1fr" gap={24}>
    <Chart type="line" title="Revenue Trajectory vs. Competitors" height={320}>
      Quarter,Q1 '25,Q2 '25,Q3 '25,Q4 '25,Q1 '26
      Us,1200,1800,2400,3600,4800
      Competitor A,8500,9200,9800,10500,11200
      Competitor B,3200,3100,3400,3800,4100
      Competitor C,2100,2400,2200,2500,2800
    </Chart>
    <Stack gap={16}>
      <Heading level={3}>Key Insights</Heading>
      <Callout type="tip" title="Growth Inflection">
        We are the fastest-growing vendor in the category at +34% QoQ.
        At current trajectory, we overtake Competitor B by Q3 '26.
      </Callout>
      <Callout type="warning" title="Enterprise Gap">
        Competitor A's enterprise penetration (62%) dwarfs ours (14%).
        Their SOC2 + HIPAA certifications are table stakes we lack.
      </Callout>
    </Stack>
  </Columns>

  <Heading level={3}>Competitive Feature Matrix</Heading>
  <DataTable columns="Feature:left|Us:center|Comp A:center|Comp B:center|Comp C:center">
    Real-time Streaming|✅|❌|✅|❌
    Zero Layout Shift|✅|❌|❌|❌
    Self-hosted Option|✅|✅|❌|✅
    SOC2 Certified|🔄 In Progress|✅|✅|❌
    HIPAA Compliant|❌|✅|✅|❌
    Sub-100ms TTFB|✅|❌|✅|✅
    Custom Theming|✅|✅|❌|✅
  </DataTable>
</Stack>
```

### 11.3 Code Comparison View (Side-by-Side)

```xml
<Stack gap={16} padding={16}>
  <Heading level={2}>Migration Guide: v1 → v2 API</Heading>
  <Text color="#868E96">
    The v2 API replaces imperative DOM measurement with declarative pretext calls.
    All layout calculations now happen before any rendering.
  </Text>

  <Columns widths="1fr 1fr" gap={16}>
    <Stack gap={8}>
      <Text font='"600 13px Inter"' color="#F03E3E">BEFORE (v1 — DOM-based)</Text>
      <CodeBlock language="typescript" title="layout-v1.ts" highlight="4,5,6,12">
function measureCard(el: HTMLElement): Size {
  // ❌ Triggers browser reflow on every call
  document.body.appendChild(el);
  const width = el.offsetWidth;
  const height = el.getBoundingClientRect().height;
  document.body.removeChild(el);

  return { width, height };
}

function layoutGrid(cards: HTMLElement[], containerWidth: number) {
  // ❌ N reflows for N cards — O(n) forced layouts
  const sizes = cards.map(c => measureCard(c));
  const columns = Math.floor(containerWidth / 300);
  // ... imperative position calculation
}
      </CodeBlock>
    </Stack>
    <Stack gap={8}>
      <Text font='"600 13px Inter"' color="#37B24D">AFTER (v2 — Pretext)</Text>
      <CodeBlock language="typescript" title="layout-v2.ts" highlight="3,4,5,12,13">
import { prepare, layout } from '@chenglou/pretext';

function measureCard(text: string, font: string, maxWidth: number): Size {
  const prepared = prepare(text, font);
  const { height } = layout(prepared, maxWidth, 20);
  // ✅ Pure arithmetic — zero DOM access
  return { width: maxWidth, height: height + CARD_PADDING };
}

function layoutGrid(cards: CardData[], containerWidth: number) {
  const columns = Math.floor(containerWidth / 300);
  // ✅ All measurements are pure functions — O(n) but no reflows
  const sizes = cards.map(c => measureCard(c.text, c.font, cellWidth));
  // ... pure coordinate calculation
}
      </CodeBlock>
    </Stack>
  </Columns>

  <Callout type="info" title="Performance Impact">
    Benchmarks on a 50-card grid: v1 takes 340ms (DOM reflow per card).
    v2 takes 0.8ms (pure arithmetic). That's a 425x improvement.
  </Callout>
</Stack>
```

---

## 12. Parser Error Handling

### 12.1 Error Categories

```typescript
type ParseError =
  | { code: 'UNKNOWN_TAG';       tag: string; position: number; severity: 'warning' }
  | { code: 'INVALID_NESTING';   parent: NodeKind; child: NodeKind; position: number; severity: 'warning' }
  | { code: 'MISSING_ATTRIBUTE'; tag: NodeKind; attribute: string; position: number; severity: 'error' }
  | { code: 'INVALID_ATTRIBUTE'; tag: NodeKind; attribute: string; value: string; expected: string; position: number; severity: 'warning' }
  | { code: 'UNCLOSED_TAG';      tag: NodeKind; openPosition: number; severity: 'warning' }
  | { code: 'ORPHAN_CLOSE_TAG';  tag: string; position: number; severity: 'warning' }
  | { code: 'COLUMN_MISMATCH';   expected: number; received: number; position: number; severity: 'warning' }
```

### 12.2 Recovery Strategies

The parser MUST be resilient. LLMs make mistakes. The parser never crashes — it degrades gracefully.

| Error | Recovery |
|-------|----------|
| Unknown tag `<Foo>` | Treat as literal text: `"<Foo>"` |
| Invalid nesting (e.g., `<AutoGrid>` inside `<AutoGrid>`) | Close the parent grid, start a new one. Emit `INVALID_NESTING` warning. |
| Missing required attribute (e.g., `<MetricCard>` without `label`) | Use placeholder: `label="—"`, `value="—"`. Emit `MISSING_ATTRIBUTE` error. |
| Invalid attribute value (e.g., `direction="diagonal"`) | Fall back to default value. Emit `INVALID_ATTRIBUTE` warning. |
| Unclosed tag at stream end | Auto-close all open tags in reverse order. Emit `UNCLOSED_TAG` for each. |
| Orphan close tag `</Foo>` with no matching open | Ignore. Emit `ORPHAN_CLOSE_TAG` warning. |
| `<Columns widths="1fr 1fr">` with 3 children | Extra children are dropped. Emit `COLUMN_MISMATCH` warning. |
| `<Columns widths="1fr 1fr 1fr">` with 2 children | Missing column is treated as empty (0 height). Emit `COLUMN_MISMATCH` warning. |

---

## 13. Performance Budgets

These are hard requirements. The QA layer (Layer E) MUST enforce these in benchmarks.

| Operation | Budget | Measurement Method |
|-----------|--------|-------------------|
| Token → AST update | < 0.1ms | Avg over 1000 tokens |
| Layout pass (single node) | < 0.5ms | 95th percentile |
| Full tree layout (50 nodes) | < 5ms | 95th percentile |
| Full tree layout (200 nodes) | < 16ms | 95th percentile (must fit in 1 frame) |
| Text `prepare()` call | < 2ms | Per call, for strings up to 10KB |
| Text `layout()` call | < 0.1ms | Per call (this is pure arithmetic) |
| Streaming token-to-pixel latency | < 16ms | From token receipt to rendered pixel |
| Memory per node | < 2KB | Avg across node types (excludes text buffer) |
| AST GC pressure | Zero | No per-frame allocations during steady-state streaming |

---

## 14. Versioning & Extension

### 14.1 Spec Version

This spec is version `1.0`. The version is encoded in the `SpatialDocument.version` field and MAY be declared at the top of a Spatial Markdown document:

```xml
<!-- spatial-markdown:1.0 -->
<Slide>
  ...
</Slide>
```

### 14.2 Extension Policy

**Adding new tags:** New tags MUST go through a spec amendment process:
1. Propose the tag with full specification (attributes, layout behavior, streaming behavior).
2. Review by Layer A (architecture), Layer B (spec), Layer C (renderer feasibility).
3. Approved tags are added to the next minor version (e.g., `1.1`).

**Adding new attributes to existing tags:** Backwards-compatible. New attributes MUST have defaults that preserve existing behavior. Minor version bump.

**Removing or changing existing behavior:** Major version bump (e.g., `2.0`). Requires migration guide.

**Custom tags are NOT supported.** The tag taxonomy is closed. This is intentional — it ensures every renderer (Canvas, SVG, React) can handle every tag without runtime registration or dynamic dispatch.

---

## Appendix A: Tag Quick Reference

| Tag | Tier | Self-Closing | Has TextBuffer | Has Children |
|-----|------|-------------|----------------|-------------|
| `<Slide>` | Layout Container | No | No | Yes |
| `<AutoGrid>` | Layout Container | No | No | Yes |
| `<Stack>` | Layout Container | No | No | Yes |
| `<Columns>` | Layout Container | No | No | Yes |
| `<Canvas>` | Layout Container | No | No | Yes |
| `<MetricCard>` | Content Component | Yes | No | No |
| `<CodeBlock>` | Content Component | No | Yes | No* |
| `<DataTable>` | Content Component | No | Yes | No* |
| `<Chart>` | Content Component | No | Yes | No* |
| `<Quote>` | Content Component | No | Yes | Yes |
| `<Callout>` | Content Component | No | Yes | Yes |
| `<Text>` | Primitive | No | Yes | No* |
| `<Heading>` | Primitive | No | Yes | No* |
| `<Spacer>` | Primitive | Yes | No | No |
| `<Divider>` | Primitive | Yes | No | No |
| `<Image>` | Primitive | Yes | No | No |

\* "No" for children means no nested **tags**. These nodes accept raw text content via their `textBuffer`.

---

## Appendix B: Streaming Behavior Summary

| Tag | Streaming Classification | Behavior |
|-----|------------------------|----------|
| `<Slide>` | **Reservation** | Full rect reserved on open. Children stream inside. |
| `<AutoGrid>` | **Incremental grid** | Column count locked on open. Cells fill as children arrive. |
| `<Stack>` | **Incremental append** | Children append to main axis as they arrive. |
| `<Columns>` | **Column-locked** | Widths computed on open. Each child fills its column independently. |
| `<Canvas>` | **Independent placement** | Each child placed independently at `(x,y)` on arrival. |
| `<MetricCard>` | **Atomic** | All content from attributes. Renders completely on tag parse. |
| `<CodeBlock>` | **Line incremental** | Lines append as text streams. Partial line re-measured per token. |
| `<DataTable>` | **Row incremental** | Header immediate. Rows append on each newline. |
| `<Chart>` | **Deferred** | Placeholder on open. Full render on close only. |
| `<Quote>` | **Text incremental** | Text streams line-by-line. Citation on close. |
| `<Callout>` | **Text incremental** | Title immediate. Body streams line-by-line. |
| `<Text>` | **Token incremental** | Re-measured on each token. Last-line-only optimization. |
| `<Heading>` | **Token incremental** | Same as `<Text>`. |
| `<Spacer>` | **Immediate** | Fully defined by attributes. |
| `<Divider>` | **Immediate** | Fully defined by attributes. |
| `<Image>` | **Reservation** | Space reserved from dimensions/aspect ratio. Image loads async. |

---

*End of Spatial Markdown DSL Specification v1.0*
