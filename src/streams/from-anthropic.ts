/**
 * fromAnthropic — Extract text deltas from an Anthropic Messages API SSE stream.
 *
 * Works with the Anthropic Messages API (stream: true).
 * Handles the content_block_delta event type.
 *
 * @module @spatial-markdown/engine/streams
 */

import { fromSSE } from './from-sse';

/**
 * Convert an Anthropic streaming response body into text chunks.
 *
 * @param body - The response.body ReadableStream from fetch().
 * @returns AsyncIterable<string> of text delta tokens.
 *
 * @example
 * ```ts
 * const response = await fetch('https://api.anthropic.com/v1/messages', {
 *   method: 'POST',
 *   headers: {
 *     'x-api-key': key,
 *     'anthropic-version': '2023-06-01',
 *     'Content-Type': 'application/json',
 *   },
 *   body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages, stream: true }),
 * });
 * await app.feedStream(fromAnthropic(response.body!));
 * ```
 */
export function fromAnthropic(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  return fromSSE(body, (data) => {
    // Anthropic format: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
    const type = data['type'];

    if (type === 'content_block_delta') {
      const delta = data['delta'] as Record<string, unknown> | undefined;
      if (delta && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
        return delta['text'] as string;
      }
    }

    return null;
  });
}
