/**
 * Unit tests for the streaming tokenizer state machine.
 *
 * @module tests/unit/tokenizer
 */

import { createTokenizer } from '../../src/parser/tokenizer/state-machine';
import type { SpatialToken, TagOpenToken, TagCloseToken, TextToken, NewlineToken, EOFToken } from '../../src/types/tokens';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Narrow a token array to a specific kind by index. */
function assertKind<K extends SpatialToken['kind']>(
  tokens: SpatialToken[],
  index: number,
  kind: K,
): Extract<SpatialToken, { kind: K }> {
  const token = tokens[index];
  expect(token).toBeDefined();
  expect(token!.kind).toBe(kind);
  return token as Extract<SpatialToken, { kind: K }>;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Tokenizer (state-machine)', () => {
  describe('single-chunk tokenisation', () => {
    it('should tokenize simple text into a single TextToken', () => {
      const tokenizer = createTokenizer();

      // In a streaming tokenizer, plain text stays in the accumulator
      // until a delimiter (<, \n) or flush() forces emission.
      const feedTokens = tokenizer.feed('Hello world');
      expect(feedTokens).toHaveLength(0);

      // flush() drains the accumulator and emits EOF
      const flushed = tokenizer.flush();
      expect(flushed.length).toBeGreaterThanOrEqual(2); // TextToken + EOFToken

      const text = assertKind(flushed, 0, 'text');
      expect(text.content).toBe('Hello world');
      assertKind(flushed, flushed.length - 1, 'eof');
    });

    it('should tokenize an opening tag into a TagOpenToken', () => {
      const tokenizer = createTokenizer();
      const tokens = tokenizer.feed('<Slide>');

      expect(tokens).toHaveLength(1);
      const tag = assertKind(tokens, 0, 'tag-open');
      expect(tag.tag).toBe('Slide');
      expect(tag.selfClosing).toBe(false);
      expect(tag.attributes.size).toBe(0);
    });

    it('should tokenize a closing tag into a TagCloseToken', () => {
      const tokenizer = createTokenizer();
      const tokens = tokenizer.feed('</Slide>');

      expect(tokens).toHaveLength(1);
      const tag = assertKind(tokens, 0, 'tag-close');
      expect(tag.tag).toBe('Slide');
    });

    it('should tokenize a self-closing tag with selfClosing=true', () => {
      const tokenizer = createTokenizer();
      const tokens = tokenizer.feed('<Spacer/>');

      expect(tokens).toHaveLength(1);
      const tag = assertKind(tokens, 0, 'tag-open');
      expect(tag.tag).toBe('Spacer');
      expect(tag.selfClosing).toBe(true);
    });

    it('should parse quoted attributes into the attributes Map', () => {
      const tokenizer = createTokenizer();
      const tokens = tokenizer.feed('<Heading level="2">');

      expect(tokens).toHaveLength(1);
      const tag = assertKind(tokens, 0, 'tag-open');
      expect(tag.tag).toBe('Heading');
      expect(tag.attributes.get('level')).toBe('2');
    });

    it('should tokenize mixed content into [TagOpen, Text, TagClose]', () => {
      const tokenizer = createTokenizer();
      const tokens = tokenizer.feed('<Slide>Hello</Slide>');

      expect(tokens).toHaveLength(3);
      assertKind(tokens, 0, 'tag-open');
      const text = assertKind(tokens, 1, 'text');
      expect(text.content).toBe('Hello');
      assertKind(tokens, 2, 'tag-close');
    });

    it('should emit NewlineTokens for consecutive newlines', () => {
      const tokenizer = createTokenizer();

      // Newlines trigger text flush for content before them,
      // but trailing text ("World") stays buffered.
      const feedTokens = tokenizer.feed('Hello\n\nWorld');

      // feed() emits: Text("Hello"), Newline(2)
      // "World" stays in the accumulator
      expect(feedTokens).toHaveLength(2);
      const t1 = assertKind(feedTokens, 0, 'text');
      expect(t1.content).toBe('Hello');
      const nl = assertKind(feedTokens, 1, 'newline');
      expect(nl.count).toBe(2);

      // flush() drains "World" and emits EOF
      const flushed = tokenizer.flush();
      expect(flushed.length).toBeGreaterThanOrEqual(2);
      const t2 = assertKind(flushed, 0, 'text');
      expect(t2.content).toBe('World');
      assertKind(flushed, flushed.length - 1, 'eof');
    });

    it('should emit invalid (lowercase) tags as text', () => {
      const tokenizer = createTokenizer();

      // <foo> — `<` enters tag-start, `f` is lowercase → bails to text.
      // The bailed text accumulates but stays in the buffer until a
      // delimiter or flush() forces emission.
      const feedTokens = tokenizer.feed('<foo>');
      expect(feedTokens).toHaveLength(0);

      // flush() drains the accumulated text
      const flushed = tokenizer.flush();
      expect(flushed.length).toBeGreaterThanOrEqual(2); // TextToken + EOFToken

      const text = assertKind(flushed, 0, 'text');
      expect(text.content).toBe('<foo>');
      assertKind(flushed, flushed.length - 1, 'eof');
    });

    it('should parse braced attributes like columns={3}', () => {
      const tokenizer = createTokenizer();
      const tokens = tokenizer.feed('<AutoGrid columns={3}>');

      expect(tokens).toHaveLength(1);
      const tag = assertKind(tokens, 0, 'tag-open');
      expect(tag.tag).toBe('AutoGrid');
      expect(tag.attributes.get('columns')).toBe('3');
    });

    it('should tokenize multiple nested tags into 5 tokens', () => {
      const tokenizer = createTokenizer();
      const tokens = tokenizer.feed('<Stack><Text>Hello</Text></Stack>');

      expect(tokens).toHaveLength(5);
      assertKind(tokens, 0, 'tag-open');   // <Stack>
      assertKind(tokens, 1, 'tag-open');   // <Text>
      assertKind(tokens, 2, 'text');       // Hello
      assertKind(tokens, 3, 'tag-close');  // </Text>
      assertKind(tokens, 4, 'tag-close');  // </Stack>

      expect((tokens[0] as TagOpenToken).tag).toBe('Stack');
      expect((tokens[1] as TagOpenToken).tag).toBe('Text');
      expect((tokens[2] as TextToken).content).toBe('Hello');
      expect((tokens[3] as TagCloseToken).tag).toBe('Text');
      expect((tokens[4] as TagCloseToken).tag).toBe('Stack');
    });
  });

  describe('streaming (multi-chunk) tokenisation', () => {
    it('should buffer a partial tag across two feed() calls', () => {
      const tokenizer = createTokenizer();

      const first = tokenizer.feed('<Sli');
      expect(first).toHaveLength(0); // tag name not complete yet

      const second = tokenizer.feed('de>');
      expect(second).toHaveLength(1);
      const tag = assertKind(second, 0, 'tag-open');
      expect(tag.tag).toBe('Slide');
    });

    it('should buffer a partial attribute across two feed() calls', () => {
      const tokenizer = createTokenizer();

      const first = tokenizer.feed('<Heading level=');
      expect(first).toHaveLength(0); // still inside the tag

      const second = tokenizer.feed('"2">');
      expect(second).toHaveLength(1);
      const tag = assertKind(second, 0, 'tag-open');
      expect(tag.tag).toBe('Heading');
      expect(tag.attributes.get('level')).toBe('2');
    });
  });

  describe('flush()', () => {
    it('should emit EOF as the last token on flush', () => {
      const tokenizer = createTokenizer();
      tokenizer.feed('Hello');
      const flushed = tokenizer.flush();

      expect(flushed.length).toBeGreaterThanOrEqual(1);
      const last = flushed[flushed.length - 1];
      expect(last).toBeDefined();
      expect(last!.kind).toBe('eof');
    });

    it('should flush a partial tag as text followed by EOF', () => {
      const tokenizer = createTokenizer();
      const feedResult = tokenizer.feed('<Sli');
      expect(feedResult).toHaveLength(0);

      const flushed = tokenizer.flush();
      // Should have the partial tag as text + EOF
      expect(flushed.length).toBeGreaterThanOrEqual(2);

      const textToken = assertKind(flushed, 0, 'text');
      expect(textToken.content).toBe('<Sli');

      const eofToken = flushed[flushed.length - 1];
      expect(eofToken).toBeDefined();
      expect(eofToken!.kind).toBe('eof');
    });
  });
});
