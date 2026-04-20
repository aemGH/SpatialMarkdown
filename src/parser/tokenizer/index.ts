/**
 * Tokenizer — Stream → SpatialToken[]
 *
 * The tokenizer is a streaming state machine that converts raw text
 * from the LLM into typed `SpatialToken[]`. It handles partial input
 * gracefully: tags split across chunks are buffered until complete.
 *
 * @module @spatial/parser/tokenizer
 *
 * @example
 * ```ts
 * import { createTokenizer } from '@spatial/parser/tokenizer';
 *
 * const tokenizer = createTokenizer();
 *
 * // Feed chunks as they arrive from the LLM stream
 * const tokens1 = tokenizer.feed('<Sli');
 * // tokens1 = []  (partial tag, buffered)
 *
 * const tokens2 = tokenizer.feed('de padding={48}>');
 * // tokens2 = [{ kind: 'tag-open', tag: 'Slide', attributes: Map{ padding: '48' }, ... }]
 *
 * const tokens3 = tokenizer.feed('Hello world');
 * // tokens3 = [{ kind: 'text', content: 'Hello world', ... }]
 *
 * const tokens4 = tokenizer.flush();
 * // tokens4 = [{ kind: 'eof', ... }]
 * ```
 */

// ─── Core API ────────────────────────────────────────────────────────

export { createTokenizer } from './state-machine';
export type { Tokenizer } from './state-machine';

// ─── Buffer (for advanced use / testing) ─────────────────────────────

export { createTokenBuffer } from './buffer';
export type { TokenBuffer } from './buffer';

// ─── Patterns & Validation ───────────────────────────────────────────

export {
  VALID_TAG_NAMES,
  isValidTagName,
  isValidTagPrefix,
  parseAttributes,
  TAG_OPEN_RE,
  TAG_CLOSE_RE,
  SELF_CLOSING_RE,
  ATTR_RE,
} from './patterns';
