/**
 * fromSSE — Converts a Server-Sent Events (SSE) response body into
 * an AsyncIterable<string> of extracted text chunks.
 *
 * Most LLM APIs (OpenAI, Anthropic, Gemini) stream responses as SSE.
 * This adapter handles the SSE framing and lets you extract the text
 * delta from each event's JSON payload.
 *
 * @module @spatial-markdown/engine/streams
 */

/**
 * Convert an SSE response body stream into text chunks.
 *
 * @param body - The response.body ReadableStream (raw bytes from fetch).
 * @param extract - A function that receives parsed JSON from each SSE data line
 *                  and returns the text to feed, or null/undefined to skip.
 *
 * @example
 * ```ts
 * const response = await fetch('/api/stream');
 * const tokens = fromSSE(response.body!, (data) => data?.choices?.[0]?.delta?.content);
 * await app.feedStream(tokens);
 * ```
 */
export async function* fromSSE(
  body: ReadableStream<Uint8Array>,
  extract: (data: Record<string, unknown>) => string | null | undefined,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines and process complete lines
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        // SSE data lines start with "data: "
        if (!line.startsWith('data: ')) continue;

        const payload = line.slice(6).trim();

        // "[DONE]" is the conventional stream-end signal
        if (payload === '[DONE]' || payload.length === 0) continue;

        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>;
          const text = extract(parsed);
          if (text && text.length > 0) {
            yield text;
          }
        } catch {
          // Skip malformed JSON — common in streaming
        }
      }
    }

    // Process any remaining buffer
    if (buffer.length > 0 && buffer.startsWith('data: ')) {
      const payload = buffer.slice(6).trim();
      if (payload !== '[DONE]' && payload.length > 0) {
        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>;
          const text = extract(parsed);
          if (text && text.length > 0) {
            yield text;
          }
        } catch {
          // Skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
