/**
 * @spatial-markdown/engine/streams — LLM stream adapters.
 *
 * Convert provider-specific SSE streams into AsyncIterable<string>
 * that can be fed directly into mount().feedStream() or app.feedStream().
 *
 * Each adapter is tree-shakeable — only the ones you import are bundled.
 *
 * @example
 * ```ts
 * import { mount } from '@spatial-markdown/engine';
 * import { fromOpenAI } from '@spatial-markdown/engine/streams';
 *
 * const sm = mount('#output', { theme: 'dark' });
 * const response = await fetch('/api/chat', { method: 'POST', body });
 * await sm.feedStream(fromOpenAI(response.body!));
 * ```
 */

export { fromSSE } from './from-sse';
export { fromOpenAI } from './from-openai';
export { fromAnthropic } from './from-anthropic';
export { fromGemini } from './from-gemini';
