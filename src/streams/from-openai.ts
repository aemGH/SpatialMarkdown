/**
 * fromOpenAI — Extract text deltas from an OpenAI-compatible SSE stream.
 *
 * Works with:
 *  - OpenAI Chat Completions API (stream: true)
 *  - Azure OpenAI
 *  - Any OpenAI-compatible provider (Together, Groq, Fireworks, etc.)
 *
 * @module @spatial-markdown/engine/streams
 */

import { fromSSE } from './from-sse';

/**
 * Convert an OpenAI streaming response body into text chunks.
 *
 * @param body - The response.body ReadableStream from fetch().
 * @returns AsyncIterable<string> of text delta tokens.
 *
 * @example
 * ```ts
 * const response = await fetch('https://api.openai.com/v1/chat/completions', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ model: 'gpt-4', messages, stream: true }),
 * });
 * await app.feedStream(fromOpenAI(response.body!));
 * ```
 */
export function fromOpenAI(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  return fromSSE(body, (data) => {
    // OpenAI format: { choices: [{ delta: { content: "text" } }] }
    const choices = data['choices'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(choices) || choices.length === 0) return null;

    const delta = choices[0]!['delta'] as Record<string, unknown> | undefined;
    if (!delta) return null;

    const content = delta['content'];
    if (typeof content === 'string') return content;

    return null;
  });
}
