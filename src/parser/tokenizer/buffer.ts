/**
 * Token buffer for accumulating partial streaming input.
 *
 * The buffer sits between the raw LLM stream and the tokenizer state machine.
 * It provides a sliding-window API: the state machine reads characters from
 * the front (peek/consume) while new text is appended at the back.
 *
 * The buffer tracks its absolute position in the total stream so that
 * every emitted token can carry a precise `offset` field.
 *
 * @module @spatial/parser/tokenizer/buffer
 */

// ─── TokenBuffer Interface ──────────────────────────────────────────

export interface TokenBuffer {
  /**
   * Append new text from the stream to the end of the buffer.
   * Called once per `feed()` invocation on the tokenizer.
   */
  append(text: string): void;

  /**
   * Look ahead at the next `count` characters without consuming them.
   * Returns fewer characters if the buffer is shorter than `count`.
   * With no argument, returns the next single character (or "").
   */
  peek(count?: number): string;

  /**
   * Consume and return the next `count` characters, advancing the
   * internal cursor and incrementing the stream offset.
   *
   * Throws if `count` exceeds the remaining buffer length — callers
   * must check `remaining()` or `isEmpty()` first.
   */
  consume(count: number): string;

  /**
   * Return all unconsumed text remaining in the buffer.
   * Does NOT consume it — this is a read-only view.
   */
  remaining(): string;

  /**
   * True when there are no unconsumed characters.
   */
  isEmpty(): boolean;

  /**
   * The current absolute offset in the total stream.
   * This is the byte position of the NEXT character to be consumed.
   * Starts at 0 and monotonically increases across all `feed()` calls.
   */
  readonly offset: number;

  /**
   * The number of unconsumed characters in the buffer.
   */
  readonly length: number;
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create a new TokenBuffer with the cursor at stream offset 0.
 *
 * Implementation notes:
 * - Uses a simple string + cursor index internally. We considered a
 *   rope or ring buffer but profiling showed that for typical LLM
 *   chunk sizes (4–200 chars), string slicing is faster than the
 *   overhead of a more complex structure.
 * - The buffer periodically compacts (trims consumed prefix) to avoid
 *   holding a growing string in memory for long-running streams.
 */
export function createTokenBuffer(): TokenBuffer {
  let data = '';
  let cursor = 0;
  let streamOffset = 0;

  // Compact threshold: when the consumed prefix exceeds this length,
  // we slice it off to free memory. 4KB is chosen to amortize the
  // cost of string allocation.
  const COMPACT_THRESHOLD = 4096;

  function compact(): void {
    if (cursor > COMPACT_THRESHOLD) {
      data = data.slice(cursor);
      cursor = 0;
    }
  }

  const buffer: TokenBuffer = {
    append(text: string): void {
      data += text;
    },

    peek(count?: number): string {
      const n = count ?? 1;
      return data.slice(cursor, cursor + n);
    },

    consume(count: number): string {
      if (count > data.length - cursor) {
        throw new RangeError(
          `TokenBuffer.consume(${count}) exceeds remaining length ${data.length - cursor}`
        );
      }
      const chunk = data.slice(cursor, cursor + count);
      cursor += count;
      streamOffset += count;
      compact();
      return chunk;
    },

    remaining(): string {
      return data.slice(cursor);
    },

    isEmpty(): boolean {
      return cursor >= data.length;
    },

    get offset(): number {
      return streamOffset;
    },

    get length(): number {
      return data.length - cursor;
    },
  };

  return buffer;
}
