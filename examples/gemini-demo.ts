/**
 * Spatial Markdown × Gemini — Live LLM Demo
 *
 * Connects the Gemini API (streaming) to the Spatial Markdown Engine
 * for real-time, structured rendering of LLM output on canvas.
 */

import { createPipeline } from '../src/pipeline';
import type { SpatialPipeline } from '../src/pipeline';
import { createCanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { CanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { RenderCommand } from '../src/types/render';
import type { ThemeConfig } from '../src/types/theme';
import { defaultTheme, darkTheme } from '../src/types/theme';
import { extractThemeFromURL, mapExtractedTheme } from '../src/theme/index';
import type { ExtractedTheme } from '../src/theme/index';

// ─── Content Height Calculator ───────────────────────────────────────

/**
 * Scan render commands to find the maximum bottom edge of all drawn elements.
 * This tells us how tall the content actually is, so we can auto-resize the canvas.
 */
function computeContentHeight(commands: ReadonlyArray<RenderCommand>): number {
  let maxBottom = 0;
  for (const cmd of commands) {
    switch (cmd.kind) {
      case 'fill-rect':
      case 'stroke-rect':
      case 'clip-rect':
      case 'draw-image':
        maxBottom = Math.max(maxBottom, cmd.y + cmd.height);
        break;
      case 'fill-text':
        maxBottom = Math.max(maxBottom, cmd.y + cmd.lineHeight);
        break;
      case 'draw-line':
        maxBottom = Math.max(maxBottom, cmd.y1, cmd.y2);
        break;
    }
  }
  return maxBottom;
}

// ─── Spatial Markdown System Prompt ──────────────────────────────────

function getSystemPrompt(extracted: ExtractedTheme | null): string {
  const basePrompt = `You are the Nexlo Archival Intelligence — a Knowledge Architect that renders research and explanations as structured Spatial Markdown slides. Voice: measured, authoritative, precise. Aesthetic: Executive Archive — architectural whitespace, rule-based hierarchy, quiet confidence.

Your entire response MUST be a single <Slide>...</Slide> tree. Nothing before, nothing after.

═══════════════════════════════════════════════════════
CANVAS FORMAT
═══════════════════════════════════════════════════════
The viewport is narrow (≈900px wide). Think "portrait research note", NOT "16:9 presentation".
- Prefer 2-column layouts over 3.
- Prefer AutoGrid minChildWidth={240}+ so cells don't crush.
- Long prose should breathe; break it up with anchors (metrics, tables, callouts, quotes, dividers).

═══════════════════════════════════════════════════════
FULL TAG VOCABULARY (use all of it — variety is the point)
═══════════════════════════════════════════════════════

LAYOUT CONTAINERS
<Slide padding={48}> ... </Slide>                              // root, always required
<Stack direction="vertical|horizontal" gap={N} align="start|center|end|stretch"> ... </Stack>
<Columns widths="2fr 1fr" gap={24}> ... </Columns>             // direct children = columns, in order
<AutoGrid minChildWidth={240} gap={16}> ... </AutoGrid>        // responsive grid of same-shape items

CONTENT COMPONENTS
<MetricCard label="Revenue" value="$1.2M" delta="+12%" trend="up" sentiment="positive" footer="YoY" />
<DataTable columns="Col|Num:right|Status" striped={true} compact={true}>
Row A|42|Good
Row B|17|Watch
</DataTable>
<Chart type="bar|line|area|pie|scatter" title="Growth" height={260} colors="#58a6ff,#3fb950">
Label,Q1,Q2,Q3,Q4
Series,10,20,40,80
</Chart>
<Quote cite="Author" variant="default|highlight|pull">Insightful quote text.</Quote>
<Callout type="tip|info|warning|error|success|note" title="Title" icon={true}>Body explaining the nuance.</Callout>
<CodeBlock language="typescript" title="file.ts" showLineNumbers={true}>
const x = 42;
</CodeBlock>

PRIMITIVES
<Heading level={1|2|3}>Title</Heading>                          // has built-in margin — no Spacer after
<Text color="#8b949e" font="500 16px Inter" align="left">Secondary text / subtitle.</Text>
<Divider thickness={1|2} color="#30363d" />                     // architectural rule, use intentionally
<Spacer height={16|24|32} />                                    // only where margin isn't enough
Plain prose between tags renders as body paragraphs.

═══════════════════════════════════════════════════════
COMPOSITION PRINCIPLES (Executive Archive)
═══════════════════════════════════════════════════════

1. ZONES, NOT BLOCKS. Every slide has 3 zones: TITLE ZONE → PRIMARY ZONE → SUPPORT ZONE. Each zone has a distinct visual rhythm.

2. RHYTHM THROUGH VARIETY. A good slide alternates text with structured anchors:
   paragraph → anchor (metric row / table / chart / callout / quote) → paragraph → anchor
   A slide of pure prose is a failure. A slide of pure cards is also a failure.

3. TYPOGRAPHY IS ARCHITECTURE. H1 for title, H2 for zone headers, H3 for inline sub-topics. Use <Text color="#8b949e" ...> for dateline / subtitle / caption under H1.

4. DIVIDERS AS PUNCTUATION. Place one <Divider /> after the title zone to separate metadata from content. Use sparingly elsewhere (max 2 per slide).

5. ANCHORS ARE MANDATORY. Every slide MUST contain at least ONE of:
   - an AutoGrid of 3+ MetricCards (for any quantifiable claim)
   - a DataTable (for any comparison, list of facts, or structured data)
   - a Chart (for any trend or distribution)
   - a Quote with variant="pull" or "highlight" (for a key insight)
   - a CodeBlock (for any technical topic)
   If the topic has no numbers, invent a structured DataTable that summarizes the key aspects. Always find a way to structure.

6. CONNECTED PAIRS. A Columns layout (2fr 1fr) pairs explanation + support: Left = prose + H3 heading; Right = Callout + MetricCard + Quote stack.

═══════════════════════════════════════════════════════
COLUMNS DISCIPLINE (critical — most common failure mode)
═══════════════════════════════════════════════════════

RULE 1 — ONE ZONE PER COLUMNS BLOCK.
A <Columns> block holds the content of exactly ONE H2-level zone.
You MUST close </Columns> before starting the next H2 zone.

RULE 2 — SUBSEQUENT ZONES ARE FULL-WIDTH SIBLINGS.
After </Columns>, the next zone's <Heading level={2}> and its content go directly
inside the outer body <Stack>, NOT inside another <Columns>. Full-width prose
reads dramatically better than prose squeezed into a 2fr sub-column.

RULE 3 — BOTH SIDES OF COLUMNS MUST BE BALANCED.
The right column (1fr) MUST contain at least 2 support items (Callout + Quote,
or 2 MetricCards, or Callout + MetricCard). If you only have one small support
item, do NOT use Columns — put the item full-width below the prose instead.

RULE 4 — NEVER NEST COLUMNS INSIDE COLUMNS.
If you need more structure inside a column, use a <Stack>. Never <Columns>.

RULE 5 — MAX ONE <Columns> BLOCK PER SLIDE.
If you find yourself wanting a second one, ask: "Is this actually a full-width
zone with an attached Callout?" Usually yes — emit the prose full-width and
follow with a single Callout below it, not a second Columns.

RULE 6 — LEVERAGE-RISK / SIDE-NOTE CALLOUTS ARE FULL-WIDTH.
When a Callout explains a risk, caveat, or consequence attached to a paragraph,
place it as a FULL-WIDTH sibling directly after that paragraph. Do not wrap it
in a 1fr column — it will become cramped and ugly.

If these rules feel restrictive, remember: this is a narrow portrait canvas.
The architectural move is vertical rhythm with the occasional horizontal pairing,
NOT a magazine two-column layout.

═══════════════════════════════════════════════════════
PLANNING STEP (silent)
═══════════════════════════════════════════════════════
Before writing, plan internally:
(a) What is the single thesis? → H1.
(b) What 2-4 zones develop it? → H2 per zone.
(c) What ANCHOR fits each zone? → pick from the list in principle 5.
(d) What narrow-canvas arrangement wins? → default vertical Stack; add Columns only for explanation+support.

Then output ONLY the <Slide> tree — no commentary, no plan text.

═══════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════
- Wrap EVERYTHING in <Slide padding={48}>.
- NO Markdown (**bold**, #, -, \`code\`) — only Spatial Markdown tags.
- NO HTML (<div>, <p>, <br>).
- NEVER add <Spacer> immediately after a <Heading> — headings already have margin.
- Keep paragraphs short (1-3 sentences).
- Slide width ≈ 900px: prefer "2fr 1fr" over "1fr 1fr 1fr".
- AutoGrid minChildWidth must be ≥ 200 to survive narrow canvas.
- DataTable syntax: header row uses "|", optional ":right" or ":center" alignment, each data row is a newline with "|" separators.

═══════════════════════════════════════════════════════
COMPONENT CONTRACTS (every tag MUST be fully populated)
═══════════════════════════════════════════════════════
NEVER emit empty content components. Each is renders as a card and will
create a confusing empty box if unfilled.
- <Callout> REQUIRES a non-empty title AND body text. icon={true} is recommended.
- <Quote> REQUIRES body text AND a cite="Author or Source" attribute.
- <CodeBlock> REQUIRES a language and non-empty code body.
- <MetricCard> REQUIRES label + value; add delta and footer together when relevant
  (delta for the comparison, footer for the context — "+12.4%" / "vs. last quarter").
- <DataTable> REQUIRES a header row and at least 2 data rows.
- <Chart> REQUIRES a CSV body with a header row and at least one data row.
- <Heading>, <Text>: never render empty. Omit the tag instead.
- Don't use <Callout> as a generic "box" — that's what layout containers are for.

═══════════════════════════════════════════════════════
EXAMPLE 1 — Concept Explainer (no numbers)
═══════════════════════════════════════════════════════
<Slide padding={48}>
  <Stack direction="vertical" gap={24}>
    <Stack direction="vertical" gap={6}>
      <Heading level={1}>Understanding Futures Contracts</Heading>
      <Text color="#8b949e" font="500 14px Inter">Primer — Derivatives Markets</Text>
    </Stack>

    <Divider thickness={1} color="#30363d" />

    A futures contract is a standardized legal agreement to buy or sell an underlying asset at a predetermined price on a specific future date. They trade on regulated exchanges, ensuring transparency and reducing counterparty risk.

    <Columns widths="2fr 1fr" gap={24}>
      <Stack direction="vertical" gap={12}>
        <Heading level={2}>Core Components</Heading>
        Every contract specifies the quantity, quality, expiration date, and method of delivery. Most positions settle in cash based on the asset price at expiry rather than physical delivery.
        <DataTable columns="Component|Role" compact={true}>
Standardization|Uniform terms enable exchange trading
Obligation|Both parties are legally bound
Underlying|Commodities, indices, or financial instruments
Settlement|Cash or physical delivery at expiry
        </DataTable>
      </Stack>
      <Stack direction="vertical" gap={12}>
        <Callout type="info" title="Zero-Sum Game" icon={true}>
          For every long position, there is an equal and opposite short position.
        </Callout>
        <Quote cite="CME Group" variant="highlight">
          Standardization is what turned agricultural hedging into a global capital market.
        </Quote>
      </Stack>
    </Columns>

    <Heading level={2}>Hedgers and Speculators</Heading>
    The futures market functions by bringing together participants with different objectives — those managing risk and those seeking to profit from it. The interaction between them provides the liquidity that makes the market efficient.

    <AutoGrid minChildWidth={240} gap={16}>
      <MetricCard label="Hedger Share" value="~60%" footer="Commercial participants" sentiment="neutral" />
      <MetricCard label="Speculator Share" value="~40%" footer="Provide liquidity" sentiment="neutral" />
      <MetricCard label="Daily Volume" value="$12T+" delta="global" sentiment="positive" />
    </AutoGrid>

    <Callout type="tip" title="Market Impact" icon={true}>
      Speculators absorb volume that hedgers want to offload, allowing positions to be entered and exited without causing massive price swings.
    </Callout>
  </Stack>
</Slide>

═══════════════════════════════════════════════════════
EXAMPLE 2 — Dashboard / Data-Heavy
═══════════════════════════════════════════════════════
<Slide padding={48}>
  <Stack direction="vertical" gap={24}>
    <Stack direction="vertical" gap={6}>
      <Heading level={1}>Q1 2026 — Platform Brief</Heading>
      <Text color="#8b949e" font="500 14px Inter">Confidential · Executive Summary</Text>
    </Stack>

    <Divider thickness={1} color="#30363d" />

    <AutoGrid minChildWidth={220} gap={16}>
      <MetricCard label="Revenue" value="$142.8M" delta="+14.2%" trend="up" sentiment="positive" footer="Exceeded forecast" />
      <MetricCard label="Retention" value="94.2%" delta="+1.8%" trend="up" sentiment="positive" footer="Historical Q1 high" />
      <MetricCard label="Burn" value="$12.4M" delta="-5.1%" trend="down" sentiment="positive" footer="Infra optimized" />
    </AutoGrid>

    <Columns widths="2fr 1fr" gap={24}>
      <Stack direction="vertical" gap={12}>
        <Heading level={2}>Regional Trajectory</Heading>
        EMEA has reached an inflection point: organic growth now outpaces paid acquisition 3:1, suggesting durable network effects. Western Europe alone accounts for 42% of new enterprise signups this quarter.
        <Chart type="bar" title="Regional Growth (%)" height={220} colors="#58a6ff,#3fb950,#d29922">
Region,Growth
EMEA,24
APAC,12
AMER,8
        </Chart>
      </Stack>
      <Stack direction="vertical" gap={12}>
        <Heading level={3}>At a Glance</Heading>
        <DataTable columns="Region|Δ:right|State" compact={true}>
EMEA|+24%|Hot
APAC|+12%|Stable
AMER|+8%|Monitor
        </DataTable>
        <Quote cite="Director of Research" variant="pull">
          A structural shift in how users engage with decentralized archives.
        </Quote>
      </Stack>
    </Columns>

    <Callout type="success" title="Strategic Focus" icon={true}>
      Deepen integration with local financial systems across EMEA to capture the momentum before network effects plateau.
    </Callout>
  </Stack>
</Slide>

═══════════════════════════════════════════════════════
ANTI-EXAMPLE — do NOT do this
═══════════════════════════════════════════════════════
Wrong (causes empty space, cramped callouts, narrow prose):

    <Columns widths="2fr 1fr">
      <Stack>
        Zone 1 heading + prose + anchor
        Zone 2 heading + prose + anchor     ← WRONG, these should be full-width
        Zone 3 heading + prose + anchor     ← WRONG
      </Stack>
      <Stack>
        One small Callout                   ← WRONG, leaves huge gap under it
      </Stack>
    </Columns>

Right (each zone is a full-width sibling, Columns used ONCE for a true pair):

    Zone 1 heading + prose
    <Columns widths="2fr 1fr">
      <Stack> Zone 1 anchor + details </Stack>
      <Stack> Zone 1 support callout + quote </Stack>
    </Columns>
    Zone 2 heading + prose                  ← back to full-width
    <AutoGrid> Zone 2 metric row </AutoGrid>
    Zone 3 heading + prose
    <Callout> full-width callout </Callout>

═══════════════════════════════════════════════════════
CHECKLIST BEFORE YOU STREAM
═══════════════════════════════════════════════════════
□ Wrapped in <Slide padding={48}>?
□ H1 + subtitle <Text> + <Divider> at top?
□ At least ONE structural anchor (MetricCard grid / DataTable / Chart / Quote / CodeBlock)?
□ Zones separated by <Heading level={2}>, not just whitespace?
□ No walls of text longer than 3 sentences before an anchor?
□ At most ONE <Columns> block in the whole slide?
□ All H2 zones after the Columns are DIRECT children of the body Stack, not inside another Columns?
□ Every Callout outside the primary Columns pair is full-width (direct child of body Stack)?
□ Zero Markdown (**, #, -)? Zero HTML?`;

  if (!extracted) return basePrompt;

  const mode = extracted.colors.background === '#ffffff' || extracted.colors.background === '#fff' ? 'light' : 'dark';
  return basePrompt + `

═══════════════════════════════════════════════════════
TARGET THEME — adapt the vibe
═══════════════════════════════════════════════════════
Source: "${extracted.title || extracted.url}"
Mode: ${mode} background · accent ${extracted.colors.accent}
Typography: ~${extracted.typography.bodySize}px body · spacing unit ~${extracted.spacing.unit}px

Match this brand's layout density:
- If the source feels editorial (long-form, generous whitespace): favor fewer, larger zones, prose-forward Columns.
- If the source feels dashboard-y (dense data): favor MetricCard grids and DataTables.
- Use ${extracted.colors.accent} for accent color hints in <Text color="..."> and Divider/Chart colors where appropriate.`;
}

// ─── DOM Elements ────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const apiKeyInput = $<HTMLInputElement>('api-key');
const modelSelect = $<HTMLSelectElement>('model-select');
const userInput = $<HTMLTextAreaElement>('user-input');
const btnSend = $<HTMLButtonElement>('btn-send');
const btnStop = $<HTMLButtonElement>('btn-stop');
const btnClear = $<HTMLButtonElement>('btn-clear');
const btnRaw = $<HTMLButtonElement>('btn-raw');
const messagesDiv = $<HTMLDivElement>('messages');
const canvas = $<HTMLCanvasElement>('output-canvas');
const canvasWrap = $<HTMLDivElement>('canvas-wrap');
const rawOutput = $<HTMLDivElement>('raw-output');
const streamDot = $<HTMLSpanElement>('stream-dot');

// Stats
const statTokens = $<HTMLSpanElement>('stat-tokens');
const statNodes = $<HTMLSpanElement>('stat-nodes');
const statCommands = $<HTMLSpanElement>('stat-commands');
const statLayout = $<HTMLSpanElement>('stat-layout');
const statFrames = $<HTMLSpanElement>('stat-frames');

// ─── State ───────────────────────────────────────────────────────────

let pipeline: SpatialPipeline | null = null;
let canvasRenderer: CanvasRenderer | null = null;
let abortController: AbortController | null = null;
let frameCount = 0;
let totalChars = 0;
let rawSpatialMarkdown = '';
let showingRaw = false;
let customTheme: ThemeConfig | null = null; // Theme extracted from a URL
let extractedThemeState: ExtractedTheme | null = null; // Raw extracted tokens for prompt injection
let isDarkTheme = true; // Gemini demo defaults to dark

let canvasW = 900;
const MIN_CANVAS_H = 600;
let currentCanvasH = MIN_CANVAS_H;

// Conversation history for multi-turn
const conversationHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

// ─── Pipeline Setup ──────────────────────────────────────────────────

function resetPipeline(): void {
  if (pipeline !== null) pipeline.destroy();
  if (canvasRenderer !== null) canvasRenderer.destroy();

  frameCount = 0;
  totalChars = 0;
  rawSpatialMarkdown = '';
  currentCanvasH = MIN_CANVAS_H;

  // Pick theme: custom > dark/light toggle > dark (default for Gemini demo)
  const activeTheme = customTheme ?? (isDarkTheme ? darkTheme : defaultTheme);

  pipeline = createPipeline({ theme: activeTheme });
  canvasRenderer = createCanvasRenderer(canvas);
  canvasRenderer.resize(canvasW, currentCanvasH);

  pipeline.onRender((commands: ReadonlyArray<RenderCommand>) => {
    // Auto-resize canvas to fit content.
    // We only grow the canvas renderer (not the pipeline viewport) so the
    // Slide doesn't expand to fill extra space and cause an infinite loop.
    const contentH = computeContentHeight(commands);
    // Cap height to prevent canvas memory crashes (max ~8000 logical px at 2x DPR)
    const MAX_CANVAS_H = 8000;
    const neededH = Math.min(MAX_CANVAS_H, Math.max(MIN_CANVAS_H, Math.ceil(contentH + 32)));

    if (neededH !== currentCanvasH) {
      currentCanvasH = neededH;
      try {
        canvasRenderer!.resize(canvasW, currentCanvasH);
      } catch (e) {
        // Canvas too large for browser — cap and continue
        console.warn('[Spatial] Canvas resize failed, capping height:', e);
        currentCanvasH = MIN_CANVAS_H;
        canvasRenderer!.resize(canvasW, currentCanvasH);
      }
      const dimsEl = document.getElementById('canvas-dims');
      if (dimsEl) dimsEl.textContent = `${canvasW} × ${currentCanvasH}`;
    }

    try {
      const t0 = performance.now();
      canvasRenderer!.render(commands);
      const dt = performance.now() - t0;
      frameCount++;
      updateStats(commands.length, dt);
    } catch (e) {
      console.warn('[Spatial] Render failed:', e);
    }
  });

  pipeline.resize(canvasW, MIN_CANVAS_H);
}

function updateStats(commandCount: number, renderTimeMs: number): void {
  if (pipeline === null) return;
  const doc = pipeline.getDocument();
  statTokens.textContent = String(totalChars);
  statNodes.textContent = String(doc.nodeIndex.size);
  statCommands.textContent = String(commandCount);
  statFrames.textContent = String(frameCount);
  statLayout.textContent = `${renderTimeMs.toFixed(2)}ms`;
  statLayout.className = renderTimeMs < 2 ? 'stat-value good' : renderTimeMs < 8 ? 'stat-value' : 'stat-value warn';
}

// ─── Chat UI Helpers ─────────────────────────────────────────────────

function addMessage(role: 'user' | 'assistant' | 'system', text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return div;
}

function setStreaming(active: boolean): void {
  streamDot.className = active ? 'streaming-dot active' : 'streaming-dot';
  btnSend.disabled = active;
  btnStop.disabled = !active;
  userInput.disabled = active;
  if (statusText) {
    statusText.textContent = active ? 'Streaming...' : 'Ready';
  }
}

// ─── Gemini API Streaming ────────────────────────────────────────────

async function streamGemini(userMessage: string): Promise<void> {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    addMessage('system', '⚠ Please enter your Gemini API key above.');
    return;
  }

  const model = modelSelect.value;

  // Clear UI for fresh response — canvas resets, so messages should too
  messagesDiv.innerHTML = '';
  conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });
  addMessage('user', userMessage);

  // Reset pipeline for fresh render
  resetPipeline();
  rawSpatialMarkdown = '';
  if (showingRaw) {
    rawOutput.textContent = '';
  }

  // Create assistant message placeholder
  const assistantDiv = addMessage('assistant', '');

  setStreaming(true);

  abortController = new AbortController();

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const body = {
      system_instruction: {
        parts: [{ text: getSystemPrompt(extractedThemeState) }],
      },
      contents: conversationHistory,
      generationConfig: {
        // Lower temperature yields more disciplined structure and
        // better adherence to the DSL/example patterns. Visual variety
        // now comes from the prompt's mandated anchors, not randomness.
        temperature: 0.7,
        maxOutputTokens: 12288,
        // Gemini 3.x models have thinking enabled by default. Give it
        // enough budget to plan the zone structure (title/primary/support)
        // and pick appropriate anchors before streaming.
        thinkingConfig: {
          thinkingBudget: 4096,
        },
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]' || data.length === 0) continue;

        try {
          const parsed = JSON.parse(data);
          const parts = parsed?.candidates?.[0]?.content?.parts;
          if (!Array.isArray(parts)) continue;

          for (const part of parts) {
            // Gemini 3.x models include "thought" parts when thinking is enabled.
            // We skip those — only feed actual text output into the pipeline.
            if (part.thought === true) continue;

            const text = part?.text;
            if (text && text.length > 0) {
              fullResponse += text;
              totalChars += text.length;
              rawSpatialMarkdown += text;

              // Feed into Spatial Markdown pipeline
              pipeline!.feed(text);

              // Update raw output
              if (showingRaw) {
                rawOutput.textContent = rawSpatialMarkdown;
                rawOutput.scrollTop = rawOutput.scrollHeight;
              }

              // Update assistant message preview (truncated)
              assistantDiv.textContent = rawSpatialMarkdown.length > 500
                ? rawSpatialMarkdown.slice(0, 500) + '...'
                : rawSpatialMarkdown;
              messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    // Flush the pipeline to close all open tags
    pipeline!.flush();

    // Add to conversation history
    conversationHistory.push({ role: 'model', parts: [{ text: fullResponse }] });

    // Final update
    assistantDiv.textContent = rawSpatialMarkdown.length > 500
      ? rawSpatialMarkdown.slice(0, 500) + '...'
      : rawSpatialMarkdown;

    if (showingRaw) {
      rawOutput.textContent = rawSpatialMarkdown;
    }

  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      addMessage('system', 'Stream stopped by user.');
      // Flush whatever we have
      pipeline?.flush();
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      addMessage('system', `❌ Error: ${msg}`);
    }
  } finally {
    setStreaming(false);
    abortController = null;
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────

btnSend.addEventListener('click', () => {
  const text = userInput.value.trim();
  if (text.length === 0) return;
  userInput.value = '';
  streamGemini(text);
});

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    btnSend.click();
  }
});

btnStop.addEventListener('click', () => {
  if (abortController) {
    abortController.abort();
  }
});

btnClear.addEventListener('click', () => {
  conversationHistory.length = 0;
  messagesDiv.innerHTML = '';
  addMessage('system', 'Conversation cleared. Ask a new question.');
  resetPipeline();
  rawOutput.textContent = '';
  rawSpatialMarkdown = '';
});

btnRaw.addEventListener('click', () => {
  showingRaw = !showingRaw;
  if (showingRaw) {
    canvasWrap.classList.add('hidden');
    rawOutput.classList.add('visible');
    rawOutput.textContent = rawSpatialMarkdown;
    btnRaw.textContent = 'Rendered';
  } else {
    canvasWrap.classList.remove('hidden');
    rawOutput.classList.remove('visible');
    btnRaw.textContent = 'Raw Markup';
  }
});

// Auto-resize textarea
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
});

// Persist API key in localStorage
const savedKey = localStorage.getItem('gemini-api-key');
if (savedKey) apiKeyInput.value = savedKey;
apiKeyInput.addEventListener('change', () => {
  localStorage.setItem('gemini-api-key', apiKeyInput.value.trim());
});

// ─── Canvas Width Resize (drag either edge of canvas) ────────────────

const canvasResizeLeft = document.getElementById('canvas-resize-left') as HTMLDivElement;
const canvasResizeRight = document.getElementById('canvas-resize-right') as HTMLDivElement;
const canvasWidthLabel = document.getElementById('canvas-width-label') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;

function applyCanvasWidth(newW: number): void {
  newW = Math.max(380, Math.min(newW, 1600));
  if (newW === canvasW) return;
  canvasW = newW;

  if (pipeline && canvasRenderer) {
    canvasRenderer.resize(canvasW, currentCanvasH);
    pipeline.resize(canvasW, MIN_CANVAS_H);
  }

  const dimsEl = document.getElementById('canvas-dims');
  if (dimsEl) dimsEl.textContent = `${canvasW} × ${currentCanvasH}`;
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

// ─── Theme Extraction ─────────────────────────────────────────────────

const themeUrl = $<HTMLInputElement>('theme-url');
const btnExtractTheme = $<HTMLButtonElement>('btn-extract-theme');
const themeStatus = $<HTMLSpanElement>('theme-status');
const btnThemeToggle = $<HTMLButtonElement>('btn-theme-toggle');

/** Calculate relative luminance of a hex color. */
function luminanceHex(hex: string): number {
  if (!hex.startsWith('#') || hex.length < 4) return 0.5;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

btnExtractTheme.addEventListener('click', async () => {
  const url = themeUrl.value.trim();
  if (url.length === 0) {
    themeStatus.textContent = 'Enter a URL';
    themeStatus.style.color = '#f85149';
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!parsedUrl.protocol.startsWith('http')) throw new Error('Only HTTP(S) URLs');
  } catch {
    themeStatus.textContent = 'Invalid URL';
    themeStatus.style.color = '#f85149';
    return;
  }

  btnExtractTheme.disabled = true;
  themeStatus.textContent = 'Extracting...';
  themeStatus.style.color = 'var(--muted)';

  try {
    const extracted = await extractThemeFromURL(url);
    extractedThemeState = extracted;
    customTheme = mapExtractedTheme(extracted);
    isDarkTheme = luminanceHex(extracted.colors.background) < 0.5;

    // Log extracted theme for debugging
    console.log('[Theme Extraction]', {
      url,
      title: extracted.title,
      colors: extracted.colors,
      typography: extracted.typography,
      cssVarCount: Object.keys(extracted.cssVariables).length,
    });

    const hostname = new URL(url).hostname;
    const modeLabel = isDarkTheme ? 'dark' : 'light';
    themeStatus.textContent = `✓ ${extracted.title || hostname} (${modeLabel})`;
    themeStatus.style.color = 'var(--green)';
    btnThemeToggle.textContent = isDarkTheme ? '☀ Light' : '☾ Dark';

    // Re-render current content if we have a pipeline running
    if (pipeline) {
      pipeline.destroy();
    }
    resetPipeline();
    // Re-feed current content
    if (rawSpatialMarkdown.length > 0) {
      pipeline!.feed(rawSpatialMarkdown);
      pipeline!.flush();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    themeStatus.textContent = `✗ ${message}`;
    themeStatus.style.color = '#f85149';
  } finally {
    btnExtractTheme.disabled = false;
  }
});

themeUrl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnExtractTheme.click();
  }
});

btnThemeToggle.addEventListener('click', () => {
  isDarkTheme = !isDarkTheme;
  customTheme = null; // Clear custom on manual toggle
  extractedThemeState = null;
  btnThemeToggle.textContent = isDarkTheme ? '☀ Light' : '☾ Dark';
  themeStatus.textContent = '';
  if (pipeline) {
    pipeline.destroy();
  }
  resetPipeline();
  if (rawSpatialMarkdown.length > 0) {
    pipeline!.feed(rawSpatialMarkdown);
    pipeline!.flush();
  }
});

// ─── Panel Resize (drag divider between left panel and canvas) ───────

const panelResizeHandle = document.getElementById('panel-resize-handle') as HTMLDivElement;
const leftPanel = document.getElementById('left-panel') as HTMLDivElement;

panelResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
  e.preventDefault();
  panelResizeHandle.classList.add('dragging');
  document.body.classList.add('resizing-panel');

  const onMouseMove = (ev: MouseEvent) => {
    const newWidth = Math.max(240, Math.min(ev.clientX, window.innerWidth * 0.5));
    leftPanel.style.width = `${newWidth}px`;
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

// Set initial width — sensible default
canvasW = Math.min(900, Math.max(400, Math.floor(canvasWrap.getBoundingClientRect().width - 48)));
resetPipeline();

console.log(
  '%c Spatial Markdown × Gemini — Live Demo ',
  'background: linear-gradient(135deg, #4c6ef5, #4285F4); color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;',
);
console.log('Enter your Gemini API key and start chatting!');
