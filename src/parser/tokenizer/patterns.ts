/**
 * Regex patterns and validation for the Spatial Markdown DSL syntax.
 *
 * All patterns are designed for incremental matching inside the tokenizer
 * state machine — they match at the HEAD of the remaining buffer, never
 * globally. None of these regexes use the `g` flag to avoid statefulness.
 *
 * @module @spatial/parser/tokenizer/patterns
 */

import type { SpatialTagName } from '../../types/tokens';

// ─── Valid Tag Name Set ──────────────────────────────────────────────

/**
 * The complete, closed taxonomy of spatial tag names.
 * Kept in sync with the `SpatialTagName` union in types/tokens.ts.
 * This is the runtime equivalent for validation — the type system
 * handles compile-time safety.
 */
export const VALID_TAG_NAMES: ReadonlySet<string> = new Set<SpatialTagName>([
  // Layout Containers (Tier 1)
  'Slide',
  'AutoGrid',
  'Stack',
  'Columns',
  'Canvas',
  // Content Components (Tier 2)
  'MetricCard',
  'CodeBlock',
  'DataTable',
  'Chart',
  'Quote',
  'Callout',
  // Primitives (Tier 3)
  'Text',
  'Heading',
  'Spacer',
  'Divider',
  'Image',
]);

/**
 * Type guard: narrows a string to `SpatialTagName` at runtime.
 *
 * Uses the `VALID_TAG_NAMES` set for O(1) lookup. This is the ONLY
 * place where a raw string becomes a `SpatialTagName` — all downstream
 * code can trust the type.
 */
export function isValidTagName(name: string): name is SpatialTagName {
  return VALID_TAG_NAMES.has(name);
}

// ─── Prefix Validation ──────────────────────────────────────────────

/**
 * Pre-computed set of all valid prefixes of every tag name.
 * Used during streaming to decide whether a partially-received tag name
 * COULD become a valid tag. If not, we bail early and treat it as text.
 *
 * Example: "Au" → true (prefix of "AutoGrid"), "Ax" → false.
 */
const VALID_TAG_PREFIXES: ReadonlySet<string> = buildPrefixSet(VALID_TAG_NAMES);

function buildPrefixSet(names: ReadonlySet<string>): ReadonlySet<string> {
  const prefixes = new Set<string>();
  for (const name of names) {
    for (let i = 1; i <= name.length; i++) {
      prefixes.add(name.slice(0, i));
    }
  }
  return prefixes;
}

/**
 * Returns true if `partial` is a prefix of at least one valid tag name.
 * Used by the state machine to decide whether to keep buffering a tag
 * name or bail out and emit the buffer as literal text.
 */
export function isValidTagPrefix(partial: string): boolean {
  return VALID_TAG_PREFIXES.has(partial);
}

// ─── Regex Patterns ──────────────────────────────────────────────────

/**
 * Matches a complete opening tag with optional attributes and optional
 * self-closing slash. Captures:
 *   [1] tag name
 *   [2] attribute string (may be empty)
 *   [3] optional "/" (self-closing indicator)
 *
 * NOTE: This regex is used for VALIDATION of a fully-buffered tag, NOT
 * for streaming character-by-character parsing. The state machine handles
 * incremental parsing; this validates the result.
 */
export const TAG_OPEN_RE: RegExp =
  /^<([A-Z][A-Za-z]*)((?:\s+[a-zA-Z][a-zA-Z0-9]*(?:=(?:"[^"]*"|{[^}]*}))?)*)\s*(\/?)>$/;

/**
 * Matches a complete closing tag. Captures:
 *   [1] tag name
 */
export const TAG_CLOSE_RE: RegExp = /^<\/([A-Z][A-Za-z]*)>$/;

/**
 * Matches a self-closing marker (/>) at the current position.
 * Used inside the state machine when we've already parsed the tag name
 * and attributes and encounter `/`.
 */
export const SELF_CLOSING_RE: RegExp = /^\/>/;

/**
 * Matches a single attribute in either form:
 *   - key="value"   (string attribute)
 *   - key={value}   (expression attribute — stored as the raw inner string)
 *
 * Captures:
 *   [1] attribute name
 *   [2] quoted string value (without quotes), OR undefined
 *   [3] braced expression value (without braces), OR undefined
 *
 * Applied repeatedly to the attribute portion of a tag to extract
 * all key-value pairs.
 */
export const ATTR_RE: RegExp =
  /([a-zA-Z][a-zA-Z0-9]*)=(?:"([^"]*)"|{([^}]*)})/g;

/**
 * Parses an attribute string (the portion between the tag name and the
 * closing `>` or `/>`) into a Map of key→value pairs.
 *
 * Handles both `key="value"` and `key={value}` forms. For `key={value}`,
 * the value is stored as the raw inner text (no braces).
 *
 * Returns a ReadonlyMap to satisfy the TagOpenToken.attributes type.
 */
export function parseAttributes(attrString: string): ReadonlyMap<string, string> {
  const attrs = new Map<string, string>();
  if (attrString.trim().length === 0) {
    return attrs;
  }

  // Reset lastIndex since ATTR_RE has the `g` flag
  ATTR_RE.lastIndex = 0;

  let match: RegExpExecArray | null = ATTR_RE.exec(attrString);
  while (match !== null) {
    const name = match[1];
    // match[2] is the quoted value, match[3] is the braced value
    const value = match[2] ?? match[3] ?? '';
    if (name !== undefined) {
      attrs.set(name, value);
    }
    match = ATTR_RE.exec(attrString);
  }

  return attrs;
}
