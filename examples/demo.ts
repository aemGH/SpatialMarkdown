/**
 * Spatial Markdown Engine — Interactive Demo
 *
 * Wires the pipeline → canvas renderer, with simulated LLM streaming,
 * preset documents, and a live AST debug inspector.
 */

import { createPipeline } from '../src/pipeline';
import type { SpatialPipeline } from '../src/pipeline';
import { createCanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { CanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { RenderCommand } from '../src/types/render';
import type { SpatialNode } from '../src/types/ast';
import type { ThemeConfig } from '../src/types/theme';
import { defaultTheme, darkTheme } from '../src/types/theme';
import { extractThemeFromURL, mapExtractedTheme } from '../src/theme/index';
import type { ExtractedTheme } from '../src/theme/index';

// ─── Preset Documents ────────────────────────────────────────────────

const PRESETS: Record<string, string> = {
  basic: `<Slide>
  <Heading level={1}>Hello, Spatial Markdown!</Heading>
  This is a simple slide with a heading and body text.
  The engine measures text via pretext — zero layout shift.
  <Spacer height={16} />
  <Divider />
  <Spacer height={16} />
  Built with TypeScript. Rendered on Canvas. 60fps ready.
</Slide>`,

  grid: `<Slide>
  <Heading level={1}>Q4 Performance Dashboard</Heading>
  <Spacer height={16} />
  <AutoGrid minChildWidth={180} gap={16}>
    <MetricCard label="Revenue" value="$4.2M" delta="+12%" trend="up" sentiment="positive" />
    <MetricCard label="Users" value="128K" delta="+8.3%" trend="up" sentiment="positive" />
    <MetricCard label="Churn" value="2.1%" delta="-0.4%" trend="down" sentiment="positive" />
    <MetricCard label="NPS" value="72" delta="+5" trend="up" sentiment="positive" />
    <MetricCard label="ARPU" value="$32.80" delta="+3.1%" trend="up" sentiment="neutral" />
    <MetricCard label="CAC" value="$48" delta="+11%" trend="up" sentiment="negative" />
  </AutoGrid>
</Slide>`,

  columns: `<Slide>
  <Heading level={1}>Two-Column Layout</Heading>
  <Spacer height={16} />
  <Columns widths="1fr 1fr" gap={24}>
    <Stack direction="vertical" gap={8}>
      <Heading level={2}>Left Column</Heading>
      This side explains the concept.
      Spatial Markdown lets LLMs produce structured layouts directly in their response stream.
      <Callout type="info" title="Key Insight">
        No post-processing needed — the layout engine interprets tags in real-time.
      </Callout>
    </Stack>
    <Stack direction="vertical" gap={8}>
      <Heading level={2}>Right Column</Heading>
      This side shows the details.
      Each tag maps to a layout primitive with predictable geometry.
      <Quote cite="The Spec">
        Every node gets measured before rendering. Zero reflow guaranteed.
      </Quote>
    </Stack>
  </Columns>
</Slide>`,

  code: `<Slide>
  <Heading level={1}>Code Block Demo</Heading>
  <Spacer height={12} />
  Here is how you create a pipeline:
  <Spacer height={8} />
  <CodeBlock language="typescript" title="Getting Started" showLineNumbers={true}>
import { createPipeline } from '@spatial-markdown/engine';

const pipeline = createPipeline();

pipeline.onRender((commands) => {
  // Draw commands to canvas
  renderer.render(commands);
});

// Feed Spatial Markdown from an LLM stream
pipeline.feed('<Slide>Hello World</Slide>');
pipeline.flush();
  </CodeBlock>
  <Spacer height={12} />
  The pipeline tokenizes, parses, measures, and renders — all in one frame.
</Slide>`,

  full: `<Slide>
  <Heading level={1}>Spatial Markdown Engine</Heading>
  A high-performance layout engine for LLM streaming output.
  <Spacer height={16} />
  <AutoGrid minChildWidth={200} gap={16}>
    <MetricCard label="Layout Time" value="<1ms" sentiment="positive" />
    <MetricCard label="Reflows" value="Zero" sentiment="positive" />
    <MetricCard label="Tag Types" value="16" sentiment="neutral" />
  </AutoGrid>
  <Spacer height={16} />
  <Columns widths="2fr 1fr" gap={24}>
    <Stack direction="vertical" gap={8}>
      <Heading level={2}>How It Works</Heading>
      The engine uses an 8-stage pipeline:
      Stream Buffer, Tokenizer, AST Builder, Constraint Solver,
      Pretext Measurement, Geometry Calculator, Render Tree, and Renderer.
      <Spacer height={8} />
      <Callout type="tip" title="Streaming-Safe">
        Partial tags split across chunks are buffered automatically.
        The tokenizer FSM handles mid-token boundaries transparently.
      </Callout>
    </Stack>
    <Stack direction="vertical" gap={8}>
      <Heading level={2}>Quick Stats</Heading>
      <MetricCard label="Source Files" value="60" sentiment="neutral" />
      <MetricCard label="Test Suites" value="7" sentiment="positive" />
      <MetricCard label="Tests" value="72" delta="passing" sentiment="positive" />
    </Stack>
  </Columns>
  <Spacer height={16} />
  <Divider />
  <Spacer height={8} />
  <CodeBlock language="typescript" title="Usage">
const pipeline = createPipeline();
pipeline.feed(llmChunk);
pipeline.flush();
  </CodeBlock>
</Slide>`,
};

// ─── DOM Elements ────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const editor = $<HTMLTextAreaElement>('editor');
const canvas = $<HTMLCanvasElement>('output-canvas');
const canvasWrap = canvas.parentElement as HTMLDivElement;
const canvasWidthLabel = $<HTMLDivElement>('canvas-width-label');
const canvasResizeLeft = $<HTMLDivElement>('canvas-resize-left');
const canvasResizeRight = $<HTMLDivElement>('canvas-resize-right');
const panelResizeHandle = $<HTMLDivElement>('panel-resize-handle');
const editorPane = $<HTMLDivElement>('editor-pane');

const presetSelect = $<HTMLSelectElement>('preset-select');
const speedRange = $<HTMLInputElement>('speed-range');
const speedLabel = $<HTMLSpanElement>('speed-label');
const btnStream = $<HTMLButtonElement>('btn-stream');
const btnInstant = $<HTMLButtonElement>('btn-instant');
const btnClear = $<HTMLButtonElement>('btn-clear');
const btnDebug = $<HTMLButtonElement>('btn-debug');
const btnTheme = $<HTMLButtonElement>('btn-theme');
const debugPane = $<HTMLDivElement>('debug-pane');
const debugContent = $<HTMLDivElement>('debug-content');
const streamStatus = $<HTMLDivElement>('stream-status');
const charCount = $<HTMLSpanElement>('char-count');
const renderMode = $<HTMLSpanElement>('render-mode');

// Theme extraction
const themeUrl = $<HTMLInputElement>('theme-url');
const btnExtractTheme = $<HTMLButtonElement>('btn-extract-theme');
const themeStatus = $<HTMLSpanElement>('theme-status');

// Stats
const statTokens = $<HTMLSpanElement>('stat-tokens');
const statNodes = $<HTMLSpanElement>('stat-nodes');
const statCommands = $<HTMLSpanElement>('stat-commands');
const statLayoutTime = $<HTMLSpanElement>('stat-layout-time');
const statFrame = $<HTMLSpanElement>('stat-frame');

// ─── State ───────────────────────────────────────────────────────────

/** Calculate relative luminance of a hex color string. */
function luminanceHex(hex: string): number {
  if (!hex.startsWith('#') || hex.length < 4) return 0.5;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let pipeline: SpatialPipeline | null = null;
let canvasRenderer: CanvasRenderer | null = null;
let streamingAbort: (() => void) | null = null;
let frameCount = 0;
let totalTokens = 0;
let isDarkTheme = false;
let customTheme: ThemeConfig | null = null; // Theme extracted from a URL

let canvasW = 800;
let currentCanvasH = 900;

// ─── Pipeline Setup ──────────────────────────────────────────────────

function resetPipeline(): void {
  // Tear down old pipeline
  if (pipeline !== null) {
    pipeline.destroy();
  }
  if (canvasRenderer !== null) {
    canvasRenderer.destroy();
  }
  cancelStreaming();

  frameCount = 0;
  totalTokens = 0;

  // Pick theme: custom > dark/light toggle > default
  const activeTheme = customTheme ?? (isDarkTheme ? darkTheme : defaultTheme);

  // Create fresh instances
  pipeline = createPipeline({ theme: activeTheme });
  canvasRenderer = createCanvasRenderer(canvas);
  canvasRenderer.resize(canvasW, currentCanvasH);

  // Wire pipeline output → canvas
  pipeline.onRender((commands: ReadonlyArray<RenderCommand>) => {
    try {
      const t0 = performance.now();
      canvasRenderer!.render(commands);
      const dt = performance.now() - t0;

      frameCount++;
      updateStats(commands.length, dt);
      updateDebugPanel();
    } catch (err) {
      console.error('[Demo] Render error:', err);
    }
  });

  pipeline.resize(canvasW, currentCanvasH);
}

// ─── Stats ───────────────────────────────────────────────────────────

function updateStats(commandCount: number, renderTimeMs: number): void {
  if (pipeline === null) return;

  const doc = pipeline.getDocument();
  const nodeCount = doc.nodeIndex.size;

  statTokens.textContent = String(totalTokens);
  statNodes.textContent = String(nodeCount);
  statCommands.textContent = String(commandCount);
  statFrame.textContent = String(frameCount);

  const totalMs = renderTimeMs;
  statLayoutTime.textContent = `${totalMs.toFixed(2)}ms`;
  statLayoutTime.className = totalMs < 2 ? 'stat-value good' : totalMs < 8 ? 'stat-value' : 'stat-value warn';
}

// ─── Debug Panel ─────────────────────────────────────────────────────

function updateDebugPanel(): void {
  if (!debugPane.classList.contains('open')) return;
  if (pipeline === null) return;

  const doc = pipeline.getDocument();
  const lines: string[] = [];

  lines.push(`Document: ${doc.children.length} root(s), ${doc.nodeIndex.size} total nodes\n`);

  for (const child of doc.children) {
    dumpNode(child, 0, lines);
  }

  debugContent.innerHTML = lines.join('\n');
}

function dumpNode(node: SpatialNode, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  const kindHtml = `<span class="node-kind">${node.kind}</span>`;
  const idHtml = `<span class="node-id">#${node.id}</span>`;
  const status = node.status === 'streaming' ? ' (streaming...)' : '';

  let textPreview = '';
  if ('textBuffer' in node && node.textBuffer.raw.length > 0) {
    const preview = node.textBuffer.raw.slice(0, 60).replace(/\n/g, '\\n');
    textPreview = ` <span class="node-text">"${preview}${node.textBuffer.raw.length > 60 ? '...' : ''}"</span>`;
  }

  out.push(`${indent}${kindHtml} ${idHtml}${status}${textPreview}`);

  if ('children' in node) {
    for (const child of node.children) {
      dumpNode(child, depth + 1, out);
    }
  }
}

// ─── Streaming Simulation ────────────────────────────────────────────

function cancelStreaming(): void {
  if (streamingAbort !== null) {
    streamingAbort();
    streamingAbort = null;
  }
  setStreamingStatus(false);
}

function setStreamingStatus(active: boolean): void {
  if (active) {
    streamStatus.classList.remove('idle');
    streamStatus.querySelector('span')!.textContent = 'streaming';
    btnStream.disabled = true;
    btnInstant.disabled = true;
  } else {
    streamStatus.classList.add('idle');
    streamStatus.querySelector('span')!.textContent = 'idle';
    btnStream.disabled = false;
    btnInstant.disabled = false;
  }
}

/**
 * Pre-split text into meaningful chunks that won't break tags.
 *
 * Strategy: split on newlines and complete tags. Each chunk is either
 * a full line of text, a complete tag, or a segment of text within a line.
 * This avoids feeding partial `<Tag attr="val">` across multiple chunks
 * which is legal but causes excessive cache misses in pretext.prepare().
 */
function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '<') {
      // Find the end of this tag
      const closeIdx = text.indexOf('>', i);
      if (closeIdx !== -1) {
        // Emit the complete tag as one chunk
        chunks.push(text.slice(i, closeIdx + 1));
        i = closeIdx + 1;
      } else {
        // Unclosed tag at end — emit rest as one chunk
        chunks.push(text.slice(i));
        i = text.length;
      }
    } else {
      // Text content: find the next tag or newline
      const nextTag = text.indexOf('<', i);
      const nextNewline = text.indexOf('\n', i);

      let endIdx: number;
      if (nextTag === -1 && nextNewline === -1) {
        endIdx = text.length;
      } else if (nextTag === -1) {
        endIdx = nextNewline + 1; // include the newline
      } else if (nextNewline === -1 || nextTag < nextNewline) {
        endIdx = nextTag; // stop before the tag
      } else {
        endIdx = nextNewline + 1; // include the newline
      }

      const chunk = text.slice(i, endIdx);
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      i = endIdx;
    }
  }

  return chunks;
}

/**
 * Simulate LLM streaming: feed pre-split chunks one per animation frame.
 *
 * The speed slider controls how many chunks to feed per frame (1 at min
 * speed, up to many at max speed), giving a visible "typing" effect
 * without overwhelming the layout pipeline.
 */
function streamText(text: string): void {
  if (pipeline === null) return;
  cancelStreaming();
  resetPipeline();
  setStreamingStatus(true);

  const chunks = splitIntoChunks(text);
  let chunkIdx = 0;
  let cancelled = false;
  let charsSoFar = 0;

  streamingAbort = () => {
    cancelled = true;
  };

  function tick(): void {
    if (cancelled || pipeline === null) {
      setStreamingStatus(false);
      return;
    }

    if (chunkIdx >= chunks.length) {
      // Done streaming
      setStreamingStatus(false);
      streamingAbort = null;
      return;
    }

    // Speed slider: 1 = 1 chunk/frame (slow), 100 = 10 chunks/frame (fast)
    const speed = parseInt(speedRange.value, 10);
    const chunksPerFrame = Math.max(1, Math.ceil(speed / 10));

    // Feed N chunks this frame
    const batchEnd = Math.min(chunkIdx + chunksPerFrame, chunks.length);
    for (let k = chunkIdx; k < batchEnd; k++) {
      const chunk = chunks[k]!;
      pipeline!.feed(chunk);
      charsSoFar += chunk.length;
      totalTokens += chunk.length;
    }
    chunkIdx = batchEnd;

    // Update editor to show progress
    editor.value = text.slice(0, charsSoFar);
    charCount.textContent = `${charsSoFar} / ${text.length} chars`;

    // Use rAF for smooth frame-aligned delivery
    requestAnimationFrame(tick);
  }

  // Kick off on the next frame
  requestAnimationFrame(tick);
}

/**
 * Feed the entire text instantly (no streaming simulation).
 */
function feedInstant(text: string): void {
  if (pipeline === null) return;
  cancelStreaming();
  resetPipeline();

  totalTokens = text.length;
  pipeline.feed(text);
  pipeline.flush();

  editor.value = text;
  charCount.textContent = `${text.length} chars`;
}

// ─── Event Handlers ──────────────────────────────────────────────────

// Preset selection
presetSelect.addEventListener('change', () => {
  const key = presetSelect.value;
  if (key === 'custom') {
    editor.value = '';
    editor.readOnly = false;
    editor.focus();
    return;
  }
  const preset = PRESETS[key];
  if (preset !== undefined) {
    editor.value = preset;
    editor.readOnly = false;
    charCount.textContent = `${preset.length} chars`;
  }
});

// Stream button
btnStream.addEventListener('click', () => {
  const text = editor.value.trim();
  if (text.length === 0) return;
  streamText(text);
});

// Instant button
btnInstant.addEventListener('click', () => {
  const text = editor.value.trim();
  if (text.length === 0) return;
  feedInstant(text);
});

// Clear button
btnClear.addEventListener('click', () => {
  cancelStreaming();
  resetPipeline();
  editor.value = '';
  charCount.textContent = '0 chars';
  debugContent.innerHTML = 'Feed some Spatial Markdown to see the AST...';
  statTokens.textContent = '0';
  statNodes.textContent = '0';
  statCommands.textContent = '0';
  statLayoutTime.textContent = '—';
  statFrame.textContent = '0';
});

// Debug toggle
btnDebug.addEventListener('click', () => {
  debugPane.classList.toggle('open');
  if (debugPane.classList.contains('open')) {
    updateDebugPanel();
  }
});

// Theme toggle
btnTheme.addEventListener('click', () => {
  isDarkTheme = !isDarkTheme;
  customTheme = null; // Clear custom theme when toggling
  btnTheme.textContent = isDarkTheme ? 'Light Theme' : 'Dark Theme';
  const text = editor.value.trim();
  if (text.length > 0) {
    feedInstant(text);
  } else {
    // Just reset the pipeline to apply theme
    resetPipeline();
  }
});

// Theme extraction from URL
btnExtractTheme.addEventListener('click', async () => {
  const url = themeUrl.value.trim();
  if (url.length === 0) {
    themeStatus.textContent = 'Enter a URL first';
    themeStatus.style.color = '#F97583';
    return;
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!parsedUrl.protocol.startsWith('http')) {
      throw new Error('Only HTTP(S) URLs are supported');
    }
  } catch {
    themeStatus.textContent = 'Invalid URL';
    themeStatus.style.color = '#F97583';
    return;
  }

  btnExtractTheme.disabled = true;
  themeStatus.textContent = 'Extracting...';
  themeStatus.style.color = '#8b949e';

  try {
    const extracted = await extractThemeFromURL(url);
    customTheme = mapExtractedTheme(extracted);
    isDarkTheme = luminanceHex(extracted.colors.background) < 0.5;

    themeStatus.textContent = `✓ ${extracted.title || new URL(url).hostname}`;
    themeStatus.style.color = '#3fb950';
    btnTheme.textContent = isDarkTheme ? 'Light Theme' : 'Dark Theme';

    const text = editor.value.trim();
    if (text.length > 0) {
      feedInstant(text);
    } else {
      resetPipeline();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    themeStatus.textContent = `✗ ${message}`;
    themeStatus.style.color = '#F97583';
  } finally {
    btnExtractTheme.disabled = false;
  }
});

// Allow Enter key in theme URL input
themeUrl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnExtractTheme.click();
  }
});

// Speed slider — value controls chunks-per-frame, not milliseconds
speedRange.addEventListener('input', () => {
  const chunksPerFrame = Math.max(1, Math.ceil(parseInt(speedRange.value, 10) / 10));
  speedLabel.textContent = `${speedRange.value} (${chunksPerFrame} chunk/frame)`;
});

// Live typing in editor (when in custom mode)
let editorDebounce: ReturnType<typeof setTimeout> | null = null;
editor.addEventListener('input', () => {
  charCount.textContent = `${editor.value.length} chars`;

  // If the user is typing in custom mode, auto-render with debounce
  if (presetSelect.value === 'custom' || editor.readOnly === false) {
    if (editorDebounce !== null) clearTimeout(editorDebounce);
    editorDebounce = setTimeout(() => {
      const text = editor.value.trim();
      if (text.length > 0) {
        feedInstant(text);
      }
    }, 500);
  }
});

// ─── Canvas Width Resize (drag either edge of canvas) ────────────────

function applyCanvasWidth(newW: number): void {
  newW = Math.max(380, Math.min(newW, 1600));
  if (newW === canvasW) return;
  canvasW = newW;

  if (pipeline && canvasRenderer) {
    canvasRenderer.resize(canvasW, currentCanvasH);
    pipeline.resize(canvasW, currentCanvasH);
  }

  renderMode.textContent = `${canvasW} x ${currentCanvasH}`;
  canvasWidthLabel.textContent = `${canvasW}px`;
}

function setupResizeHandle(handle: HTMLDivElement, side: 'left' | 'right'): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    handle.classList.add('dragging');
    canvasWidthLabel.classList.add('visible');
    document.body.classList.add('resizing-canvas');

    const startX = e.clientX;
    const startW = canvasW;

    const onMouseMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      // Since the canvas is centered (justify-content: center), dragging one
      // edge by N pixels requires increasing the width by 2N pixels to keep
      // that edge under the cursor.
      const newW = side === 'right'
        ? startW + deltaX * 2
        : startW - deltaX * 2;
      applyCanvasWidth(newW);
    };

    const onMouseUp = () => {
      handle.classList.remove('dragging');
      canvasWidthLabel.classList.remove('visible');
      document.body.classList.remove('resizing-canvas');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

setupResizeHandle(canvasResizeRight, 'right');
setupResizeHandle(canvasResizeLeft, 'left');

// ─── Panel Resize (drag divider between left panel and canvas) ───────

panelResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
  e.preventDefault();
  panelResizeHandle.classList.add('dragging');
  document.body.classList.add('resizing-panel');

  const onMouseMove = (ev: MouseEvent) => {
    const newWidth = Math.max(320, Math.min(ev.clientX, window.innerWidth * 0.5));
    editorPane.style.width = `${newWidth}px`;
  };

  const onMouseUp = () => {
    panelResizeHandle.classList.remove('dragging');
    document.body.classList.remove('resizing-panel');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

// ─── Init ────────────────────────────────────────────────────────────

// Load the default preset
const defaultPreset = PRESETS[presetSelect.value];
if (defaultPreset !== undefined) {
  editor.value = defaultPreset;
  charCount.textContent = `${defaultPreset.length} chars`;
}

resetPipeline();
renderMode.textContent = `${canvasW} x ${currentCanvasH}`;

console.log(
  '%c Spatial Markdown Engine — Demo ',
  'background: #4c6ef5; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;',
);
console.log('Pipeline created. Pick a preset and click "Stream It" or "Instant".');
