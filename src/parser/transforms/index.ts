/**
 * AST Transform Pipeline
 *
 * Runs a sequence of AST → AST passes that normalize, validate, and enrich
 * the tree after the builder produces it. Transforms mutate in place and
 * report changes as ASTDelta arrays (where applicable).
 *
 * Pipeline order:
 *   1. autoParagraph  — Merge consecutive text siblings
 *   2. normalizeHeadings — (no-op) Heading levels are DSL-authoritative
 *   3. resolveFonts   — Validate font descriptors against theme, set dirty flags
 *   4. resolveListNumbers — (no-op) Lists not yet in the DSL
 *
 * Ordering rationale:
 *   - autoParagraph runs first because merging text nodes reduces the number
 *     of nodes the subsequent passes need to visit.
 *   - resolveFonts runs after structural transforms because it reads
 *     the final node tree shape.
 *   - No-op passes are included for pipeline stability — adding them later
 *     won't change the public API.
 *
 * @module @spatial/parser/transforms
 */

import type { SpatialDocument } from '../../types/ast';
import type { ThemeConfig } from '../../types/theme';
import type { ASTDelta } from '../../types/delta';
import { autoParagraph } from './auto-paragraph';
import { normalizeHeadings } from './heading-levels';
import { resolveFonts } from './font-resolver';
import { resolveListNumbers } from './list-numbering';

// Re-export individual transforms for targeted use
export { autoParagraph } from './auto-paragraph';
export { normalizeHeadings } from './heading-levels';
export { resolveFonts } from './font-resolver';
export { resolveListNumbers } from './list-numbering';

/**
 * Runs the full transform pipeline on a SpatialDocument.
 *
 * Mutates the document in place. Returns an aggregated array of all
 * ASTDelta events emitted by transforms that produce them.
 *
 * @param doc   - The document to transform (mutated in place)
 * @param theme - Active theme config for font resolution
 * @returns     - Aggregated deltas from all delta-producing transforms
 */
export function runTransforms(doc: SpatialDocument, theme: ThemeConfig): ASTDelta[] {
  const deltas: ASTDelta[] = [];

  // 1. Structural: merge consecutive text siblings
  const paragraphDeltas = autoParagraph(doc);
  for (let i = 0; i < paragraphDeltas.length; i++) {
    deltas.push(paragraphDeltas[i]!);
  }

  // 2. Structural: heading level normalization (no-op — see ADR in module)
  const headingDeltas = normalizeHeadings(doc);
  for (let i = 0; i < headingDeltas.length; i++) {
    deltas.push(headingDeltas[i]!);
  }

  // 3. Validation: font descriptor verification against theme
  //    resolveFonts returns void — it only sets dirty flags, no deltas.
  resolveFonts(doc, theme);

  // 4. Structural: list numbering (no-op — lists not in DSL)
  const listDeltas = resolveListNumbers(doc);
  for (let i = 0; i < listDeltas.length; i++) {
    deltas.push(listDeltas[i]!);
  }

  return deltas;
}
