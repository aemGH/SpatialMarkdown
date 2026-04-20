/**
 * List Numbering Transform
 *
 * No-op — the Spatial Markdown DSL does not currently define `<List>` or
 * `<ListItem>` tags in the SpatialTagName union (see types/tokens.ts).
 *
 * ## Decision
 * This transform returns `[]` unconditionally.
 *
 * ## Context
 * Ordered list numbering would require:
 *   1. A `List` container kind with an `ordered: boolean` prop
 *   2. A `ListItem` content kind with a computed `index: number`
 *   3. An `AttributeChangedDelta` variant to express index assignment
 *
 * None of these exist in the current type definitions. When list support
 * is added to the DSL, this transform should:
 *   - Walk all `List` containers
 *   - For ordered lists, assign sequential `index` values to ListItem children
 *   - Handle nested lists with independent counters
 *   - Emit deltas for each assigned index
 *
 * ## Consequence
 * The pipeline signature includes list numbering for forward compatibility.
 * No runtime cost — the function returns a static empty array.
 *
 * @module @spatial/parser/transforms/list-numbering
 */

import type { SpatialDocument } from '../../types/ast';
import type { ASTDelta } from '../../types/delta';

/**
 * No-op list numbering transform.
 *
 * Returns `[]` — list tags are not yet part of the DSL.
 * See module doc for the forward-compatibility rationale.
 */
export function resolveListNumbers(_doc: SpatialDocument): ASTDelta[] {
  return [];
}
