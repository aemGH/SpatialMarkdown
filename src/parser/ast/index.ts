/**
 * AST Builder — SpatialToken[] → SpatialNode tree
 *
 * Incremental, streaming-safe AST construction with O(1) node lookup,
 * delta emission, and structural validation.
 *
 * @module @spatial/parser/ast
 */

// ─── ID Generator ────────────────────────────────────────────────────
export { createIdGenerator } from './id-generator';
export type { IdGenerator } from './id-generator';

// ─── Node Factory ────────────────────────────────────────────────────
export { createNode, isTextBearingKind, isContainerKind, isSelfClosingKind, TAG_TO_KIND } from './node-factory';

// ─── Node Map ────────────────────────────────────────────────────────
export { createNodeMap } from './node-map';
export type { NodeMap } from './node-map';

// ─── AST Builder ─────────────────────────────────────────────────────
export { createASTBuilder } from './builder';
export type { ASTBuilder } from './builder';

// ─── Validators ──────────────────────────────────────────────────────
export { validateDocument } from './validators';
export type { ValidationError } from './validators';
