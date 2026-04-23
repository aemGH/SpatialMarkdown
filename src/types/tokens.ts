/**
 * Tokenizer output types for the Spatial Markdown parser.
 *
 * @module @spatial/types/tokens
 */

// ─── Spatial Tag Names ───────────────────────────────────────────────

/** All valid spatial tag names — closed taxonomy, no runtime extensibility */
export type SpatialTagName =
  // Layout Containers (Tier 1)
  | 'Slide'
  | 'AutoGrid'
  | 'Stack'
  | 'Columns'
  | 'Canvas'
  // Content Components (Tier 2)
  | 'MetricCard'
  | 'CodeBlock'
  | 'DataTable'
  | 'Chart'
  | 'Quote'
  | 'Callout'
  // Primitives (Tier 3)
  | 'Text'
  | 'Heading'
  | 'Spacer'
  | 'Divider'
  | 'Image';

// ─── Token Discriminated Union ───────────────────────────────────────

/** Discriminated union of all tokens emitted by the Spatial Markdown tokenizer. */
export type SpatialToken =
  | TagOpenToken
  | TagCloseToken
  | TextToken
  | NewlineToken
  | EOFToken;

/** Opening tag token, e.g. `<Slide width="800">`, with parsed attributes. */
export interface TagOpenToken {
  readonly kind: 'tag-open';
  readonly tag: SpatialTagName;
  readonly attributes: ReadonlyMap<string, string>;
  readonly selfClosing: boolean;
  readonly offset: number;
}

/** Closing tag token, e.g. `</Slide>`. */
export interface TagCloseToken {
  readonly kind: 'tag-close';
  readonly tag: SpatialTagName;
  readonly offset: number;
}

/** Raw text content between or inside spatial tags. */
export interface TextToken {
  readonly kind: 'text';
  readonly content: string;
  readonly offset: number;
}

/** One or more consecutive newlines, collapsed into a single token. */
export interface NewlineToken {
  readonly kind: 'newline';
  readonly count: number;
  readonly offset: number;
}

/** Sentinel token signalling the end of the input stream. */
export interface EOFToken {
  readonly kind: 'eof';
  readonly offset: number;
}

// ─── Tokenizer State ─────────────────────────────────────────────────

/** Internal state machine for the incremental tokenizer (streaming-safe). */
export type TokenizerState =
  | { readonly mode: 'text' }
  | { readonly mode: 'tag-opening'; buffer: string }
  | { readonly mode: 'tag-attributes'; tag: string; buffer: string }
  | { readonly mode: 'tag-closing'; buffer: string }
  | { readonly mode: 'self-closing'; tag: string };
