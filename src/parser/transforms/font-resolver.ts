/**
 * Font Resolution & Validation Transform
 *
 * Walks all text-bearing nodes and ensures their dirty flags are set
 * correctly for font-dependent remeasurement. This is a **validation pass**
 * rather than a mutation pass because:
 *
 *   1. TextProps.font, CodeBlockProps.font, etc. are `readonly` — the type
 *      system prevents in-place mutation.
 *   2. The node factory already applies sensible font defaults from hardcoded
 *      values that match the default theme.
 *   3. When a non-default theme is provided, font descriptors may differ from
 *      what the factory baked in. Since we can't mutate readonly props, the
 *      correct fix is to ensure the factory receives theme-aware defaults.
 *
 * What this pass **does** do:
 *   - Marks `dirty.textDirty = true` on any text-bearing node whose factory
 *     font differs from the theme font. This forces the constraint solver to
 *     remeasure using the theme font (which it receives separately).
 *   - Marks `dirty.constraintDirty = true` as a consequence, since text
 *     metrics affect constraint computation.
 *
 * This ensures that even when node props carry stale font descriptors, the
 * downstream pipeline knows to remeasure. The constraint solver is the
 * source of truth for actual font selection — it reads node.props.font as
 * a hint but defers to ThemeConfig when the two disagree.
 *
 * @module @spatial/parser/transforms/font-resolver
 */

import type { SpatialDocument, SpatialNode } from '../../types/ast';
import type { ThemeConfig } from '../../types/theme';
import type { FontDescriptor } from '../../types/primitives';

// ─── Font expectation per node kind ──────────────────────────────────

type TextBearingKind = 'text' | 'heading' | 'code-block' | 'data-table' | 'chart' | 'quote' | 'callout';

/**
 * Returns the expected theme font for a given text-bearing node kind.
 * Returns undefined for kinds that don't have a single canonical font
 * (data-table has both `font` and `headerFont`; chart has no font prop).
 */
function expectedFont(kind: TextBearingKind, theme: ThemeConfig): FontDescriptor | undefined {
  switch (kind) {
    case 'text':
      return theme.fonts.body;
    case 'heading':
      // Headings don't carry a font prop — they use the heading font
      // via the constraint solver. No font to validate here.
      return undefined;
    case 'code-block':
      return theme.fonts.mono;
    case 'quote':
      return theme.fonts.body;
    case 'callout':
      // Callout doesn't have a font prop on CalloutProps.
      return undefined;
    case 'data-table':
      // DataTable has both font and headerFont — validate font against body.
      return theme.fonts.body;
    case 'chart':
      // Chart has no font prop.
      return undefined;
  }
}

/**
 * Extracts the font descriptor from a text-bearing node's props, if present.
 * Returns undefined if the node kind has no font property.
 */
function extractNodeFont(node: SpatialNode): FontDescriptor | undefined {
  switch (node.kind) {
    case 'text':
      return node.props.font;
    case 'code-block':
      return node.props.font;
    case 'data-table':
      return node.props.font;
    case 'quote':
      return node.props.font;
    default:
      return undefined;
  }
}

// ─── Tree Walker ─────────────────────────────────────────────────────

function walkAndValidate(node: SpatialNode, theme: ThemeConfig, flagged: number): number {
  let count = flagged;

  // Check if this node is text-bearing and has a font mismatch
  const nodeFont = extractNodeFont(node);
  if (nodeFont !== undefined) {
    const expected = expectedFont(node.kind as TextBearingKind, theme);
    if (expected !== undefined && nodeFont !== expected) {
      // Font mismatch: the factory default doesn't match the theme.
      // Mark dirty so the constraint solver knows to remeasure with
      // the theme font.
      node.dirty.textDirty = true;
      node.dirty.constraintDirty = true;
      count++;
    }
  }

  // Recurse into children for container nodes
  switch (node.kind) {
    case 'slide':
    case 'auto-grid':
    case 'stack':
    case 'columns':
    case 'canvas':
    case 'quote':
    case 'callout':
      for (const child of node.children) {
        count = walkAndValidate(child, theme, count);
      }
      break;
    default:
      // Leaf nodes — no children to recurse into
      break;
  }

  return count;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Validates font descriptors on text-bearing nodes against the theme.
 *
 * Does not return deltas (fonts are readonly props — no AST mutation).
 * Instead, sets dirty flags to force remeasurement when fonts don't match
 * the provided theme.
 *
 * @param doc   - The spatial document to validate
 * @param theme - The active theme whose fonts are the source of truth
 */
export function resolveFonts(doc: SpatialDocument, theme: ThemeConfig): void {
  for (const rootChild of doc.children) {
    walkAndValidate(rootChild, theme, 0);
  }
}
