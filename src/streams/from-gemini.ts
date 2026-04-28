/**
 * fromGemini — Extract text deltas from a Google Gemini SSE stream.
 *
 * Works with the Gemini API (streamGenerateContent with alt=sse).
 * Filters out "thought" parts from Gemini 2.5+ models.
 *
 * @module @spatial-markdown/engine/streams
 */

import { fromSSE } from './from-sse';

/**
 * Convert a Gemini streaming response body into text chunks.
 *
 * @param body - The response.body ReadableStream from fetch().
 * @returns AsyncIterable<string> of text tokens.
 *
 * @example
 * ```ts
 * const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${key}`;
 * const response = await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
 * await app.feedStream(fromGemini(response.body!));
 * ```
 */
export function fromGemini(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  return fromSSE(body, (data) => {
    // Gemini format: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
    const candidates = data['candidates'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const content = candidates[0]!['content'] as Record<string, unknown> | undefined;
    if (!content) return null;

    const parts = content['parts'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts)) return null;

    // Concatenate all non-thought text parts
    let result = '';
    for (const part of parts) {
      // Skip "thought" parts (Gemini 2.5+ thinking)
      if (part['thought'] === true) continue;
      const text = part['text'];
      if (typeof text === 'string' && text.length > 0) {
        result += text;
      }
    }

    return result.length > 0 ? result : null;
  });
}
