/**
 * Core streaming tokenizer state machine.
 *
 * Converts raw text into typed `SpatialToken[]`. Designed for streaming:
 * partial tags split across multiple `feed()` calls are buffered until
 * they can be resolved into complete tokens.
 *
 * State machine states:
 *   text           — accumulating plain text content
 *   tag-start      — saw `<`, deciding if tag-open or tag-close
 *   tag-name       — accumulating tag name after `<`
 *   tag-attrs      — parsing attributes inside an open tag
 *   tag-close-name — accumulating tag name after `</`
 *   self-closing   — saw `/` inside tag, expecting `>`
 *
 * @module @spatial/parser/tokenizer/state-machine
 */

import type {
  SpatialToken,
  TagOpenToken,
  TagCloseToken,
  TextToken,
  NewlineToken,
  EOFToken,
  SpatialTagName,
} from '../../types/tokens';

import { isValidTagName, isValidTagPrefix, parseAttributes } from './patterns';
import { createTokenBuffer } from './buffer';
import type { TokenBuffer } from './buffer';

// ─── Internal State Types ────────────────────────────────────────────

/**
 * Discriminated union of tokenizer states.
 * Separate from the exported `TokenizerState` in types/tokens.ts —
 * this is the internal representation with all the fields the state
 * machine needs. The exported type is a simplified view for consumers.
 */
type MachineState =
  | { readonly mode: 'text' }
  | { readonly mode: 'tag-start'; readonly startOffset: number }
  | { readonly mode: 'tag-name'; readonly startOffset: number; nameBuf: string }
  | {
      readonly mode: 'tag-attrs';
      readonly startOffset: number;
      readonly tagName: SpatialTagName;
      attrBuf: string;
    }
  | { readonly mode: 'tag-close-name'; readonly startOffset: number; nameBuf: string }
  | {
      readonly mode: 'self-closing';
      readonly startOffset: number;
      readonly tagName: SpatialTagName;
      readonly attrBuf: string;
    }
  | { readonly mode: 'raw-text'; readonly untilTag: string };

// ─── Tokenizer Interface ─────────────────────────────────────────────

export interface Tokenizer {
  /**
   * Feed a chunk of streaming text into the tokenizer.
   * Returns all complete tokens that can be extracted from the
   * accumulated input. Partial tags are buffered internally.
   */
  feed(text: string): SpatialToken[];

  /**
   * Flush any remaining buffered content and emit an EOF token.
   * Call this when the stream ends. Any partial tag in progress
   * is emitted as literal text.
   */
  flush(): SpatialToken[];

  /**
   * Reset the tokenizer to its initial state.
   * Clears all buffers and resets the stream offset to 0.
   */
  reset(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createTokenizer(): Tokenizer {
  let buffer: TokenBuffer = createTokenBuffer();
  let state: MachineState = { mode: 'text' };
  let textAccum = '';       // accumulated plain text not yet emitted
  let textStartOffset = 0;  // stream offset where textAccum started

  /**
   * Emit the accumulated text buffer as a TextToken (if non-empty).
   * Resets the accumulator.
   */
  function emitText(tokens: SpatialToken[]): void {
    if (textAccum.length === 0) return;
    tokens.push(makeTextToken(textAccum, textStartOffset));
    textAccum = '';
    // textStartOffset will be set on next text accumulation
  }

  /**
   * Emit consecutive newlines as a single NewlineToken.
   */
  function emitNewlines(count: number, offset: number, tokens: SpatialToken[]): void {
    const token: NewlineToken = {
      kind: 'newline',
      count,
      offset,
    };
    tokens.push(token);
  }

  /**
   * The main processing loop. Called by both `feed()` and `flush()`.
   * Processes characters from the buffer according to the current state,
   * emitting tokens as they complete.
   */
  function process(tokens: SpatialToken[]): void {
    while (!buffer.isEmpty()) {
      switch (state.mode) {
        case 'text':
          processText(tokens);
          break;
        case 'tag-start':
          processTagStart();
          break;
        case 'tag-name':
          processTagName(tokens);
          break;
        case 'tag-attrs':
          processTagAttrs(tokens);
          break;
        case 'tag-close-name':
          processTagCloseName(tokens);
          break;
        case 'self-closing':
          processSelfClosing(tokens);
          break;
        case 'raw-text':
          processRawText(tokens);
          break;
      }
    }
  }

  // ─── State Processors ──────────────────────────────────────────

  /**
   * TEXT state: scan for `<` or newlines.
   * Everything else accumulates as plain text.
   */
  function processText(tokens: SpatialToken[]): void {
    while (!buffer.isEmpty()) {
      const ch = buffer.peek();

      if (ch === '\n') {
        // Flush any accumulated text before the newline
        emitText(tokens);

        // Count consecutive newlines
        let count = 0;
        const nlOffset = buffer.offset;
        while (!buffer.isEmpty() && buffer.peek() === '\n') {
          buffer.consume(1);
          count++;
        }
        emitNewlines(count, nlOffset, tokens);
        continue;
      }

      if (ch === '<') {
        // Flush accumulated text before entering tag parsing
        emitText(tokens);

        // Transition to tag-start; consume the `<`
        const startOffset = buffer.offset;
        buffer.consume(1);
        state = { mode: 'tag-start', startOffset };
        return; // exit to main loop to dispatch new state
      }

      // Plain text character — accumulate
      if (textAccum.length === 0) {
        textStartOffset = buffer.offset;
      }
      textAccum += buffer.consume(1);
    }
  }

  /**
   * TAG-START state: we've consumed `<`. Next character decides:
   *   `/`  → tag-close-name
   *   A-Z  → tag-name (potential spatial tag)
   *   else → not a tag, emit `<` as text, return to text mode
   */
  function processTagStart(): void {
    if (buffer.isEmpty()) return; // wait for more input

    const ch = buffer.peek();

    if (ch === '/') {
      // Closing tag: consume `/`, transition to tag-close-name
      buffer.consume(1);
      state = {
        mode: 'tag-close-name',
        startOffset: state.mode === 'tag-start' ? state.startOffset : buffer.offset,
        nameBuf: '',
      };
      return;
    }

    if (isUpperAlpha(ch)) {
      // Potential opening tag name
      state = {
        mode: 'tag-name',
        startOffset: state.mode === 'tag-start' ? state.startOffset : buffer.offset,
        nameBuf: '',
      };
      return;
    }

    // Not a valid tag start — emit `<` as literal text
    if (textAccum.length === 0) {
      textStartOffset = state.mode === 'tag-start' ? state.startOffset : buffer.offset;
    }
    textAccum += '<';
    state = { mode: 'text' };
  }

  /**
   * TAG-NAME state: accumulate uppercase/lowercase letters.
   * When we hit whitespace → tag-attrs
   * When we hit `>` → emit tag-open
   * When we hit `/` → potential self-closing
   * When the accumulated name is not a valid prefix → bail to text
   */
  function processTagName(tokens: SpatialToken[]): void {
    if (state.mode !== 'tag-name') return;

    while (!buffer.isEmpty()) {
      const ch = buffer.peek();

      if (isAlpha(ch)) {
        const candidate = state.nameBuf + ch;

        // Check if this is still a valid prefix of any tag name
        if (!isValidTagPrefix(candidate)) {
          // Not a valid tag — emit everything as text
          bailToText('<' + state.nameBuf + ch, state.startOffset);
          buffer.consume(1);
          return;
        }

        state.nameBuf += ch;
        buffer.consume(1);
        continue;
      }

      // We've reached a non-alpha character — tag name is complete
      const name = state.nameBuf;

      if (!isValidTagName(name)) {
        // Accumulated name doesn't match any valid tag — bail to text
        bailToText('<' + name, state.startOffset);
        return;
      }

      // Valid tag name. What comes next?
      if (ch === '>') {
        // Simple open tag with no attributes: <Tag>
        buffer.consume(1);
        tokens.push(makeTagOpen(name, new Map(), false, state.startOffset));
        if (name === 'CodeBlock') {
          state = { mode: 'raw-text', untilTag: '</CodeBlock>' };
        } else {
          state = { mode: 'text' };
        }
        return;
      }

      if (ch === '/') {
        // Might be self-closing: <Tag/>
        buffer.consume(1);
        state = {
          mode: 'self-closing',
          startOffset: state.startOffset,
          tagName: name,
          attrBuf: '',
        };
        return;
      }

      if (isWhitespace(ch)) {
        // Attributes follow: <Tag attr="val">
        buffer.consume(1);
        state = {
          mode: 'tag-attrs',
          startOffset: state.startOffset,
          tagName: name,
          attrBuf: '',
        };
        return;
      }

      // Unexpected character after tag name — bail to text
      bailToText('<' + name, state.startOffset);
      return;
    }

    // Buffer exhausted mid-tag-name — stay in this state and wait
  }

  /**
   * TAG-ATTRS state: accumulate attribute text until `>` or `/>`.
   *
   * We need to be careful about `>` inside attribute values:
   *   <Tag attr="val > ue">  — the `>` is inside quotes
   *   <Tag attr={val > ue}>  — the `>` is inside braces
   *
   * We track quoting/bracing state to avoid premature tag closure.
   */
  function processTagAttrs(tokens: SpatialToken[]): void {
    if (state.mode !== 'tag-attrs') return;

    while (!buffer.isEmpty()) {
      const ch = buffer.peek();

      // Check for self-closing: />
      if (ch === '/') {
        if (buffer.length >= 2) {
          const next = buffer.peek(2);
          if (next === '/>') {
            buffer.consume(2);
            const attrs = parseAttributes(state.attrBuf);
            tokens.push(makeTagOpen(state.tagName, attrs, true, state.startOffset));
            state = { mode: 'text' };
            return;
          }
        } else {
          // Only `/` left in buffer — need more input to decide
          return;
        }
      }

      // Check for tag close: >
      // But only if we're not inside a quoted string or braced expression
      if (ch === '>' && !isInsideValue(state.attrBuf)) {
        buffer.consume(1);
        const attrs = parseAttributes(state.attrBuf);
        tokens.push(makeTagOpen(state.tagName, attrs, false, state.startOffset));
        if (state.tagName === 'CodeBlock') {
          state = { mode: 'raw-text', untilTag: '</CodeBlock>' };
        } else {
          state = { mode: 'text' };
        }
        return;
      }

      // Accumulate attribute character
      state.attrBuf += buffer.consume(1);
    }

    // Buffer exhausted mid-attributes — stay in this state
  }

  /**
   * TAG-CLOSE-NAME state: accumulate tag name after `</`.
   * When `>` is found, emit tag-close if valid, otherwise bail to text.
   */
  function processTagCloseName(tokens: SpatialToken[]): void {
    if (state.mode !== 'tag-close-name') return;

    while (!buffer.isEmpty()) {
      const ch = buffer.peek();

      if (ch === '>') {
        buffer.consume(1);
        const name = state.nameBuf;

        if (isValidTagName(name)) {
          const token: TagCloseToken = {
            kind: 'tag-close',
            tag: name,
            offset: state.startOffset,
          };
          tokens.push(token);
        } else {
          // Invalid close tag — emit as literal text
          bailToText('</' + name + '>', state.startOffset);
        }

        state = { mode: 'text' };
        return;
      }

      if (isAlpha(ch)) {
        const candidate = state.nameBuf + ch;

        // Early bail if this can't possibly be a valid tag
        if (state.nameBuf.length === 0 && !isUpperAlpha(ch)) {
          bailToText('</' + ch, state.startOffset);
          buffer.consume(1);
          return;
        }

        if (candidate.length > 0 && !isValidTagPrefix(candidate) && !isValidTagName(candidate)) {
          // Can't become a valid tag — bail
          bailToText('</' + candidate, state.startOffset);
          buffer.consume(1);
          return;
        }

        state.nameBuf += ch;
        buffer.consume(1);
        continue;
      }

      // Non-alpha, non-`>` character — not a valid close tag
      bailToText('</' + state.nameBuf, state.startOffset);
      return;
    }

    // Buffer exhausted mid-close-tag — stay in this state
  }

  /**
   * SELF-CLOSING state: we've consumed `<TagName ... /`, expecting `>`.
   */
  function processSelfClosing(tokens: SpatialToken[]): void {
    if (state.mode !== 'self-closing') return;

    if (buffer.isEmpty()) return; // wait for more input

    const ch = buffer.peek();

    if (ch === '>') {
      buffer.consume(1);
      const attrs = parseAttributes(state.attrBuf);
      tokens.push(makeTagOpen(state.tagName, attrs, true, state.startOffset));
      // Self-closing code-blocks shouldn't enter raw-text mode, so text is fine
      state = { mode: 'text' };
      return;
    }

    // The `/` was NOT followed by `>` — this is not self-closing.
    // Treat the `/` as part of the attribute buffer and return to tag-attrs.
    state = {
      mode: 'tag-attrs',
      startOffset: state.startOffset,
      tagName: state.tagName,
      attrBuf: state.attrBuf + '/',
    };
  }

  /**
   * RAW-TEXT state: accumulate everything as text until the `untilTag` is encountered.
   */
  function processRawText(tokens: SpatialToken[]): void {
    if (state.mode !== 'raw-text') return;

    while (!buffer.isEmpty()) {
      // Look ahead for untilTag
      const remaining = buffer.length;
      let matched = false;
      let partialMatch = false;

      // Check if buffer starts with untilTag
      if (remaining >= state.untilTag.length) {
        if (buffer.peek(state.untilTag.length) === state.untilTag) {
          matched = true;
        }
      } else {
        // We might have a partial match at the end
        const peekStr = buffer.peek(remaining);
        if (state.untilTag.startsWith(peekStr)) {
          partialMatch = true;
        }
      }

      if (matched) {
        // Emit accumulated text
        emitText(tokens);
        // Consume and emit the close tag
        const startOffset = buffer.offset;
        buffer.consume(state.untilTag.length);
        // Extract tag name from `</TagName>`
        const tagName = state.untilTag.slice(2, -1) as SpatialTagName;
        tokens.push({
          kind: 'tag-close',
          tag: tagName,
          offset: startOffset,
        });
        state = { mode: 'text' };
        return;
      } else if (partialMatch) {
        // Need more input to confirm if it's the end tag
        return;
      } else {
        // Consume one character and continue
        const ch = buffer.peek();
        
        if (ch === '\n') {
          emitText(tokens);
          
          let count = 0;
          const nlOffset = buffer.offset;
          while (!buffer.isEmpty() && buffer.peek() === '\n') {
            buffer.consume(1);
            count++;
          }
          emitNewlines(count, nlOffset, tokens);
          continue;
        }

        if (textAccum.length === 0) {
          textStartOffset = buffer.offset;
        }
        textAccum += buffer.consume(1);
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /**
   * Abandon tag parsing: push the raw text that was being parsed
   * as a tag back into the text accumulator and return to text mode.
   */
  function bailToText(raw: string, offset: number): void {
    if (textAccum.length === 0) {
      textStartOffset = offset;
    }
    textAccum += raw;
    state = { mode: 'text' };
  }

  /**
   * Flush any partial state as text. Used by `flush()` to drain
   * incomplete tags at end-of-stream.
   */
  function flushPartialState(): void {
    switch (state.mode) {
      case 'text':
        // Nothing extra to flush
        break;
      case 'tag-start':
        // We had a bare `<` — emit as text
        if (textAccum.length === 0) {
          textStartOffset = state.startOffset;
        }
        textAccum += '<';
        break;
      case 'tag-name':
        // Partial tag name: emit `<` + name as text
        if (textAccum.length === 0) {
          textStartOffset = state.startOffset;
        }
        textAccum += '<' + state.nameBuf;
        break;
      case 'tag-attrs':
        // Incomplete tag with attributes — emit everything as text
        if (textAccum.length === 0) {
          textStartOffset = state.startOffset;
        }
        textAccum += '<' + state.tagName + (state.attrBuf.length > 0 ? ' ' + state.attrBuf : '');
        break;
      case 'tag-close-name':
        // Partial close tag
        if (textAccum.length === 0) {
          textStartOffset = state.startOffset;
        }
        textAccum += '</' + state.nameBuf;
        break;
      case 'self-closing':
        // Partial self-closing tag
        if (textAccum.length === 0) {
          textStartOffset = state.startOffset;
        }
        textAccum += '<' + state.tagName + (state.attrBuf.length > 0 ? ' ' + state.attrBuf : '') + '/';
        break;
      case 'raw-text':
        // EOF inside a raw-text block. Just leave as text mode to let emitText flush it
        break;
    }
    state = { mode: 'text' };
  }

  // ─── Public API ────────────────────────────────────────────────

  const tokenizer: Tokenizer = {
    feed(text: string): SpatialToken[] {
      const tokens: SpatialToken[] = [];
      buffer.append(text);
      process(tokens);
      return tokens;
    },

    flush(): SpatialToken[] {
      const tokens: SpatialToken[] = [];

      // Process any remaining buffered text
      process(tokens);

      // Flush partial state (incomplete tags become text)
      flushPartialState();

      // Emit any remaining accumulated text
      emitText(tokens);

      // Emit EOF
      const eof: EOFToken = {
        kind: 'eof',
        offset: buffer.offset,
      };
      tokens.push(eof);

      return tokens;
    },

    reset(): void {
      buffer = createTokenBuffer();
      state = { mode: 'text' };
      textAccum = '';
      textStartOffset = 0;
    },
  };

  return tokenizer;
}

// ─── Token Constructors ──────────────────────────────────────────────

function makeTextToken(content: string, offset: number): TextToken {
  return {
    kind: 'text',
    content,
    offset,
  };
}

function makeTagOpen(
  tag: SpatialTagName,
  attributes: ReadonlyMap<string, string>,
  selfClosing: boolean,
  offset: number,
): TagOpenToken {
  return {
    kind: 'tag-open',
    tag,
    attributes,
    selfClosing,
    offset,
  };
}

// ─── Character Classification ────────────────────────────────────────

function isUpperAlpha(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

function isAlpha(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r';
}

/**
 * Determines whether we are currently inside an unclosed quoted string
 * or braced expression within the attribute buffer. This prevents
 * a `>` inside a value from being treated as the end of the tag.
 *
 * Tracks state by scanning the buffer from the start.
 * For typical attribute strings (< 200 chars), this is negligible cost.
 */
function isInsideValue(attrBuf: string): boolean {
  let inDoubleQuote = false;
  let braceDepth = 0;

  for (let i = 0; i < attrBuf.length; i++) {
    const ch = attrBuf[i];

    if (ch === '"' && braceDepth === 0) {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === '{' && !inDoubleQuote) {
      braceDepth++;
    } else if (ch === '}' && !inDoubleQuote && braceDepth > 0) {
      braceDepth--;
    }
  }

  return inDoubleQuote || braceDepth > 0;
}
