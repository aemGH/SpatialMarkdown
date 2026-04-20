/**
 * Heading Level Normalization Transform
 *
 * ADR: HeadingProps.level is `readonly` — we cannot mutate it in place.
 *
 * ## Decision
 * This transform is a **no-op** that returns `[]`.
 *
 * ## Context
 * The original design called for automatic heading level adjustment based on
 * nesting depth (e.g., an `<Heading level="1">` inside a nested `<Stack>`
 * inside a `<Slide>` should render as h2 or h3 visually). However:
 *
 *   1. `HeadingProps.level` is `readonly` — the type system prevents mutation.
 *   2. Creating replacement nodes would require a new ID, breaking the
 *      nodeIndex mapping and any external references to the old node.
 *   3. The ASTDelta union has no `AttributeChangedDelta` variant, so we
 *      cannot express "heading level changed" as a delta.
 *   4. The heading level from the DSL is **authoritative** — the LLM or
 *      author explicitly chose `level="1"`. Silently overriding it would
 *      violate the principle of least surprise.
 *
 * ## Consequence
 * Visual heading sizing based on nesting depth should be handled by the
 * **constraint solver** (Layer A) or the **renderer** (Layer C), not by
 * an AST transform. The constraint solver already receives the full tree
 * context and can compute effective visual sizes from (level + depth).
 *
 * This transform exists as a placeholder so the pipeline signature stays
 * stable. If an `AttributeChangedDelta` is added in the future, this
 * transform can be activated without changing the pipeline API.
 *
 * @module @spatial/parser/transforms/heading-levels
 */

import type { SpatialDocument } from '../../types/ast';
import type { ASTDelta } from '../../types/delta';

/**
 * No-op heading level normalization.
 *
 * Returns `[]` — heading levels from the DSL are authoritative.
 * See module doc for the architectural decision record.
 */
export function normalizeHeadings(_doc: SpatialDocument): ASTDelta[] {
  return [];
}
