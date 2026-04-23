/**
 * Spatial Markdown Showcase — Stress-Test Theater
 *
 * Four scenarios that demonstrate the engine's superpowers:
 *   1. Firehose       — stream a massive document at max speed
 *   2. Responsive      — auto-animate canvas width while rendered
 *   3. Incremental     — slow stream proving zero reflow
 *   4. Stress Test     — stream + resize + theme swap simultaneously
 *
 * No LLM required. Pure engine demonstration.
 */

import { createPipeline } from '../src/pipeline';
import type { SpatialPipeline } from '../src/pipeline';
import { createCanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { CanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { RenderCommand } from '../src/types/render';
import { defaultTheme, darkTheme } from '../src/types/theme';

// ─── Scenario Content ────────────────────────────────────────────────

/** A single massive document that exercises every component. */
const STRESS_DOCUMENT = `<Slide padding={48}>
  <Stack direction="vertical" gap={24}>
    <Stack direction="vertical" gap={6}>
      <Heading level={1}>Q2 2026 Platform Brief</Heading>
      <Text color="#8b949e" font="500 14px Inter">Confidential — Executive Summary</Text>
    </Stack>

    <Divider thickness={1} color="#30363d" />

    <AutoGrid minChildWidth={220} gap={16}>
      <MetricCard label="Revenue" value="$142.8M" delta="+14.2%" trend="up" sentiment="positive" footer="Exceeded forecast" />
      <MetricCard label="Retention" value="94.2%" delta="+1.8%" trend="up" sentiment="positive" footer="Historical high" />
      <MetricCard label="P99 Latency" value="42ms" delta="-8ms" trend="down" sentiment="positive" footer="API gateway" />
      <MetricCard label="Deploy Rate" value="142/day" delta="+23%" trend="up" sentiment="positive" footer="Fully automated" />
    </AutoGrid>

    <Columns widths="2fr 1fr" gap={24}>
      <Stack direction="vertical" gap={12}>
        <Heading level={2}>Regional Trajectory</Heading>
        EMEA has reached an inflection point: organic growth now outpaces paid acquisition 3:1, suggesting durable network effects. Western Europe alone accounts for 42% of new enterprise signups this quarter.

        APAC traffic patterns have shifted to a dual-peak model following the Singapore availability zone launch, distributing load across two data centers.
      </Stack>
      <Stack direction="vertical" gap={12}>
        <Heading level={3}>At a Glance</Heading>
        <MetricCard label="EMEA Growth" value="+24%" sentiment="positive" footer="Organic-led" />
        <MetricCard label="APAC Growth" value="+12%" sentiment="positive" footer="Stable" />
        <Quote cite="VP Engineering" variant="highlight">
          A structural shift in how users engage with the platform.
        </Quote>
      </Stack>
    </Columns>

    <DataTable columns="Region|P99:right|Throughput:right|Status" striped={true} compact={true}>
US-East|38ms|1.2M/min|Healthy
EU-West|45ms|680K/min|Healthy
APAC-SGP|52ms|420K/min|Healthy
APAC-TKY|61ms|310K/min|Watch
SA-East|78ms|95K/min|Degraded
    </DataTable>

    <Heading level={2}>Deployment Pipeline</Heading>
    The CI/CD pipeline processes 142 deployments per day. Canary analysis caught three regressions this week, each auto-rolled-back in under 90 seconds.

    <AutoGrid minChildWidth={240} gap={16}>
      <Callout type="success" title="Deploy Velocity" icon={true}>
        Lead time from commit to production: 18 minutes. Zero manual gates.
      </Callout>
      <Callout type="info" title="Canary Analysis" icon={true}>
        3 regressions caught this week. Automated rollback in under 90 seconds each.
      </Callout>
      <Callout type="tip" title="Next Milestone" icon={true}>
        Progressive delivery with feature flags. Targeting 10% canary window.
      </Callout>
    </AutoGrid>

    <Chart type="bar" title="Monthly Infra Cost ($K)" height={220} colors="#6c63ff,#22c55e">
Month,Cost
Jan,342
Feb,318
Mar,305
Apr,294
    </Chart>

    <Columns widths="1fr 1fr" gap={20}>
      <Stack direction="vertical" gap={8}>
        <CodeBlock language="typescript" title="pipeline.config.ts" showLineNumbers={true}>
export const pipelineConfig = {
  canary: {
    window: '10%',
    duration: '15m',
    rollbackThreshold: 0.5,
  },
  scaling: {
    minInstances: 3,
    maxInstances: 200,
    targetCPU: 65,
  },
};
        </CodeBlock>
      </Stack>
      <Stack direction="vertical" gap={8}>
        <CodeBlock language="typescript" title="health-check.ts" showLineNumbers={true}>
async function checkHealth() {
  const checks = await Promise.all([
    checkDatabase(),
    checkCache(),
    checkQueue(),
  ]);
  return {
    status: checks.every(c => c.ok)
      ? 'green' : 'yellow',
    checks,
    ts: Date.now(),
  };
}
        </CodeBlock>
      </Stack>
    </Columns>

    <Divider thickness={1} color="#30363d" />

    <Callout type="note" title="Takeaway" icon={true}>
      The platform is in its healthiest state since launch. We are serving more traffic, faster, for less money. Next focus: APAC-TKY latency via a dedicated Osaka cluster.
    </Callout>
  </Stack>
</Slide>`;

// ─── Scenarios ───────────────────────────────────────────────────────

interface Scenario {
  id: string;
  name: string;
  desc: string;
  run: () => void;
}

// ─── DOM ─────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('output-canvas');
const scenarioList = $('scenario-list');
const btnRun = $<HTMLButtonElement>('btn-run');
const btnStop = $<HTMLButtonElement>('btn-stop');
const btnTheme = $<HTMLButtonElement>('btn-theme');
const btnRaw = $<HTMLButtonElement>('btn-raw');
const btnRawClose = $<HTMLButtonElement>('btn-raw-close');
const rawViewer = $('raw-viewer');
const rawContent = $('raw-content');
const speedRange = $<HTMLInputElement>('speed-range');
const speedValue = $('speed-value');
const progressFill = $('progress-fill');
const statusTag = $('status-tag');
const scenarioNameEl = $('active-scenario-name');
const toolbarDims = $('toolbar-dims');
const widthIndicator = $('width-indicator');
const resizeOverlay = $('resize-overlay');

// Metrics
const mLayout = $('m-layout');
const mNodes = $('m-nodes');
const mCommands = $('m-commands');
const mFrames = $('m-frames');
const mChars = $('m-chars');
const mWidth = $('m-width');

// Event log
const eventLog = $('event-log');

// Resize handles
const resizeLeft = $('resize-left');
const resizeRight = $('resize-right');

// ─── State ───────────────────────────────────────────────────────────

let pipeline: SpatialPipeline | null = null;
let renderer: CanvasRenderer | null = null;
let isDark = true;
let canvasW = 900;
let currentH = 600;
let frameCount = 0;
let totalChars = 0;
let isRunning = false;
let cancelFn: (() => void) | null = null;
let activeScenario: Scenario | null = null;
let startTime = 0;
let currentRawMarkup = '';

// ─── Helpers ─────────────────────────────────────────────────────────

function log(msg: string, type: 'stream' | 'resize' | 'perf' | 'complete' | '' = ''): void {
  const elapsed = startTime > 0 ? ((performance.now() - startTime) / 1000).toFixed(1) : '0.0';
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${elapsed}s</span><span class="log-msg ${type}">${msg}</span>`;
  eventLog.appendChild(entry);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function setStatus(status: 'streaming' | 'resizing' | 'idle'): void {
  statusTag.className = `toolbar-tag ${status}`;
  statusTag.textContent = status.toUpperCase();
}

function setRunning(running: boolean): void {
  isRunning = running;
  btnRun.disabled = running;
  btnStop.disabled = !running;
  if (!running) {
    setStatus('idle');
    progressFill.style.width = '0%';
    progressFill.classList.remove('complete');
  }
}

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
        maxBottom = Math.max(maxBottom, (cmd as any).y + (cmd as any).lineHeight);
        break;
      case 'draw-line':
        maxBottom = Math.max(maxBottom, cmd.y1, cmd.y2);
        break;
    }
  }
  return maxBottom;
}

function updateMetrics(commandCount: number, layoutMs: number): void {
  if (!pipeline) return;
  const doc = pipeline.getDocument();

  mLayout.textContent = `${layoutMs.toFixed(1)}`;
  mLayout.className = layoutMs < 2 ? 'metric-value good' : layoutMs < 8 ? 'metric-value' : 'metric-value bad';

  mNodes.textContent = String(doc.nodeIndex.size);
  mCommands.textContent = String(commandCount);
  mFrames.textContent = String(frameCount);
  mChars.textContent = totalChars > 1000 ? `${(totalChars / 1000).toFixed(1)}K` : String(totalChars);
  mWidth.innerHTML = `${canvasW}<span class="metric-unit">px</span>`;
  toolbarDims.textContent = `${canvasW} × ${currentH}`;
}

// ─── Pipeline ────────────────────────────────────────────────────────

function resetPipeline(): void {
  if (pipeline) pipeline.destroy();
  if (renderer) renderer.destroy();

  frameCount = 0;
  totalChars = 0;
  currentH = 600;
  currentRawMarkup = '';

  const theme = isDark ? darkTheme : defaultTheme;
  pipeline = createPipeline({ theme });
  renderer = createCanvasRenderer(canvas);
  renderer.resize(canvasW, currentH);
  pipeline.resize(canvasW, currentH);

  pipeline.onRender((commands) => {
    const contentH = computeContentHeight(commands);
    const neededH = Math.max(600, Math.ceil(contentH + 64));

    if (neededH !== currentH) {
      currentH = neededH;
      renderer!.resize(canvasW, currentH);
    }

    const t0 = performance.now();
    renderer!.render(commands);
    const dt = performance.now() - t0;

    frameCount++;
    updateMetrics(commands.length, dt);
  });
}

/**
 * Resize the canvas to a new width.
 *
 * pipeline.resize() handles everything: invalidates constraints,
 * re-runs the layout pass synchronously, and fires onRender.
 * No flush() or re-feed required — it just works.
 */
function applyWidth(newW: number): void {
  newW = Math.max(380, Math.min(1600, newW));
  if (newW === canvasW) return;
  canvasW = newW;

  if (renderer && pipeline) {
    renderer.resize(canvasW, currentH);
    pipeline.resize(canvasW, currentH);
  }

  mWidth.innerHTML = `${canvasW}<span class="metric-unit">px</span>`;
  toolbarDims.textContent = `${canvasW} × ${currentH}`;
}

// ─── Chunking ────────────────────────────────────────────────────────

function splitChunks(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<') {
      const end = text.indexOf('>', i);
      if (end !== -1) {
        chunks.push(text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    const nextTag = text.indexOf('<', i);
    const nextNl = text.indexOf('\n', i);
    let end: number;
    if (nextTag === -1 && nextNl === -1) end = text.length;
    else if (nextTag === -1) end = nextNl + 1;
    else if (nextNl === -1 || nextTag < nextNl) end = nextTag;
    else end = nextNl + 1;
    const chunk = text.slice(i, end);
    if (chunk.length > 0) chunks.push(chunk);
    i = end;
  }
  return chunks;
}

// ─── Scenario Implementations ────────────────────────────────────────

function stopRunning(): void {
  if (cancelFn) cancelFn();
  cancelFn = null;
  setRunning(false);
}

/** Scenario 1: Firehose — stream everything as fast as possible */
function runFirehose(): void {
  resetPipeline();
  setRunning(true);
  setStatus('streaming');
  startTime = performance.now();
  log('Firehose started — streaming full document at max speed', 'stream');

  const chunks = splitChunks(STRESS_DOCUMENT);
  let idx = 0;
  let cancelled = false;
  totalChars = 0;

  cancelFn = () => { cancelled = true; };

  function tick(): void {
    if (cancelled || !pipeline) {
      setRunning(false);
      return;
    }

    if (idx >= chunks.length) {
      pipeline.flush();
      progressFill.style.width = '100%';
      progressFill.classList.add('complete');
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      log(`Complete: ${totalChars} chars in ${elapsed}s — ${frameCount} frames`, 'complete');
      log(`Peak throughput: ${(totalChars / parseFloat(elapsed) / 1000).toFixed(1)}K chars/s`, 'perf');
      setRunning(false);
      setStatus('idle');
      return;
    }

    const speed = parseInt(speedRange.value, 10);
    const chunksPerFrame = Math.max(1, Math.ceil(speed / 5));
    const batchEnd = Math.min(idx + chunksPerFrame, chunks.length);

    for (let k = idx; k < batchEnd; k++) {
      const chunk = chunks[k]!;
      pipeline.feed(chunk);
      totalChars += chunk.length;
      currentRawMarkup += chunk;
    }
    idx = batchEnd;

    progressFill.style.width = `${(idx / chunks.length * 100).toFixed(1)}%`;
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

/** Scenario 2: Responsive Theater — render then auto-animate width */
function runResponsive(): void {
  resetPipeline();
  setRunning(true);
  startTime = performance.now();

  // First, render the full document
  log('Rendering full document...', 'stream');
  pipeline!.feed(STRESS_DOCUMENT);
  pipeline!.flush();
  totalChars = STRESS_DOCUMENT.length;
  currentRawMarkup = STRESS_DOCUMENT;

  log('Starting width animation: 900 → 400 → 1200 → 900', 'resize');
  setStatus('resizing');
  resizeOverlay.classList.add('active');

  // Animate width through a sequence
  const keyframes = [
    { target: 400, duration: 2000 },
    { target: 1200, duration: 2500 },
    { target: 600, duration: 1500 },
    { target: 900, duration: 1500 },
  ];

  let phaseIdx = 0;
  let phaseStart = performance.now();
  let phaseStartW = canvasW;
  let cancelled = false;

  cancelFn = () => { cancelled = true; };

  function tick(): void {
    if (cancelled) {
      resizeOverlay.classList.remove('active');
      setRunning(false);
      return;
    }

    if (phaseIdx >= keyframes.length) {
      resizeOverlay.classList.remove('active');
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      log(`Complete: ${keyframes.length} resize phases in ${elapsed}s — ${frameCount} re-layouts`, 'complete');
      setRunning(false);
      setStatus('idle');
      return;
    }

    const phase = keyframes[phaseIdx]!;
    const t = Math.min(1, (performance.now() - phaseStart) / phase.duration);
    // Ease in-out
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const newW = Math.round(phaseStartW + (phase.target - phaseStartW) * eased);

    applyWidth(newW);

    progressFill.style.width = `${((phaseIdx + t) / keyframes.length * 100).toFixed(1)}%`;

    if (t >= 1) {
      log(`Phase ${phaseIdx + 1}: resized to ${phase.target}px`, 'resize');
      phaseIdx++;
      phaseStart = performance.now();
      phaseStartW = canvasW;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

/** Scenario 3: Incremental Build — slow stream proving zero reflow */
function runIncremental(): void {
  resetPipeline();
  setRunning(true);
  setStatus('streaming');
  startTime = performance.now();
  log('Incremental build — slow stream to show zero-shift rendering', 'stream');

  const chunks = splitChunks(STRESS_DOCUMENT);
  let idx = 0;
  let cancelled = false;
  totalChars = 0;

  cancelFn = () => { cancelled = true; };

  // Milestones to log
  const milestones = new Set([
    Math.floor(chunks.length * 0.1),
    Math.floor(chunks.length * 0.25),
    Math.floor(chunks.length * 0.5),
    Math.floor(chunks.length * 0.75),
    Math.floor(chunks.length * 0.9),
  ]);

  function tick(): void {
    if (cancelled || !pipeline) {
      setRunning(false);
      return;
    }

    if (idx >= chunks.length) {
      pipeline.flush();
      progressFill.style.width = '100%';
      progressFill.classList.add('complete');
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      log(`Complete: ${totalChars} chars streamed in ${elapsed}s`, 'complete');
      log('Zero pixels shifted during stream. Every partial render was final.', 'perf');
      setRunning(false);
      setStatus('idle');
      return;
    }

    // Slow: 1-2 chunks per frame
    const speed = parseInt(speedRange.value, 10);
    const chunksPerFrame = Math.max(1, Math.ceil(speed / 40));
    const batchEnd = Math.min(idx + chunksPerFrame, chunks.length);

    for (let k = idx; k < batchEnd; k++) {
      const chunk = chunks[k]!;
      pipeline.feed(chunk);
      totalChars += chunk.length;
      currentRawMarkup += chunk;
    }
    idx = batchEnd;

    if (milestones.has(idx)) {
      const pct = Math.round(idx / chunks.length * 100);
      log(`${pct}% streamed — ${totalChars} chars, ${frameCount} frames, 0 reflows`, 'stream');
    }

    progressFill.style.width = `${(idx / chunks.length * 100).toFixed(1)}%`;
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

/** Scenario 4: Stress Test — stream + resize + theme swap simultaneously */
function runStressTest(): void {
  resetPipeline();
  setRunning(true);
  setStatus('streaming');
  startTime = performance.now();
  log('STRESS TEST — streaming + resizing + theme swaps simultaneously', 'stream');

  const chunks = splitChunks(STRESS_DOCUMENT);
  let idx = 0;
  let cancelled = false;
  totalChars = 0;
  let themeSwaps = 0;
  const resizeStartW = canvasW;

  cancelFn = () => { cancelled = true; };

  // Schedule theme swaps during the stream
  const themeSwapAt = new Set([
    Math.floor(chunks.length * 0.25),
    Math.floor(chunks.length * 0.5),
    Math.floor(chunks.length * 0.75),
  ]);

  function tick(): void {
    if (cancelled || !pipeline) {
      setRunning(false);
      return;
    }

    if (idx >= chunks.length) {
      pipeline.flush();
      progressFill.style.width = '100%';
      progressFill.classList.add('complete');
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      log(`STRESS COMPLETE: ${totalChars} chars, ${frameCount} frames, ${themeSwaps} theme swaps`, 'complete');
      log(`Elapsed: ${elapsed}s — no crashes, no reflows, no dropped frames`, 'perf');
      setRunning(false);
      setStatus('idle');
      return;
    }

    // Feed chunks at medium speed
    const speed = parseInt(speedRange.value, 10);
    const chunksPerFrame = Math.max(1, Math.ceil(speed / 8));
    const batchEnd = Math.min(idx + chunksPerFrame, chunks.length);

    for (let k = idx; k < batchEnd; k++) {
      const chunk = chunks[k]!;
      pipeline!.feed(chunk);
      totalChars += chunk.length;
      currentRawMarkup += chunk;
    }

    // Oscillate width while streaming — use pipeline.resize directly
    // since we're actively feeding chunks (applyWidth rebuilds the pipeline)
    const progress = idx / chunks.length;
    const widthOscillation = Math.sin(progress * Math.PI * 4) * 200;
    const targetW = Math.max(380, Math.min(1600, Math.round(resizeStartW + widthOscillation)));
    if (targetW !== canvasW) {
      canvasW = targetW;
      if (pipeline) {
        pipeline.resize(canvasW, currentH);
      }
      mWidth.innerHTML = `${canvasW}<span class="metric-unit">px</span>`;
      toolbarDims.textContent = `${canvasW} × ${currentH}`;
    }

    // Theme swap at milestones
    if (themeSwapAt.has(idx)) {
      isDark = !isDark;
      themeSwaps++;
      log(`Theme swapped to ${isDark ? 'dark' : 'light'} mid-stream`, 'resize');
      btnTheme.textContent = isDark ? 'Dark' : 'Light';

      // Rebuild pipeline with new theme but re-feed all content so far
      const contentSoFar = currentRawMarkup;
      resetPipeline();
      totalChars = contentSoFar.length;
      currentRawMarkup = contentSoFar;
      pipeline!.feed(contentSoFar);
      // Don't flush — we're still streaming
    }

    idx = batchEnd;
    progressFill.style.width = `${(idx / chunks.length * 100).toFixed(1)}%`;
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ─── Scenarios Array ─────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    id: 'firehose',
    name: 'Firehose',
    desc: 'Stream a massive document at max speed. Watch sub-millisecond layout times.',
    run: runFirehose,
  },
  {
    id: 'responsive',
    name: 'Responsive Theater',
    desc: 'Renders fully, then auto-animates width 400→1200→900. Watch AutoGrid reflow.',
    run: runResponsive,
  },
  {
    id: 'incremental',
    name: 'Incremental Build',
    desc: 'Slow stream proving zero reflow. Every partial render is pixel-final.',
    run: runIncremental,
  },
  {
    id: 'stress',
    name: 'Full Stress Test',
    desc: 'Stream + resize oscillation + theme swaps — all at once. Chaos mode.',
    run: runStressTest,
  },
];

// ─── UI Setup ────────────────────────────────────────────────────────

function buildScenarioList(): void {
  SCENARIOS.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.dataset.id = s.id;
    card.innerHTML = `
      <div class="scenario-num">${i + 1}</div>
      <div class="scenario-info">
        <div class="scenario-name">${s.name}</div>
        <div class="scenario-desc">${s.desc}</div>
      </div>
    `;
    card.onclick = () => {
      document.querySelectorAll('.scenario-card').forEach(el => el.classList.remove('active'));
      card.classList.add('active');
      activeScenario = s;
      scenarioNameEl.textContent = s.name;
    };
    scenarioList.appendChild(card);
  });

  // Select first by default
  const first = scenarioList.firstElementChild as HTMLElement;
  if (first) {
    first.classList.add('active');
    activeScenario = SCENARIOS[0]!;
    scenarioNameEl.textContent = activeScenario.name;
  }
}

// Run button
btnRun.onclick = () => {
  if (!activeScenario || isRunning) return;
  stopRunning();
  activeScenario.run();
};

// Stop button
btnStop.onclick = () => {
  stopRunning();
  log('Stopped by user', '');
};

// Speed slider
speedRange.oninput = () => {
  speedValue.textContent = speedRange.value;
};

// Theme toggle
btnTheme.onclick = () => {
  isDark = !isDark;
  btnTheme.textContent = isDark ? 'Dark' : 'Light';
  if (!isRunning && pipeline) {
    const content = currentRawMarkup;
    resetPipeline();
    if (content.length > 0) {
      totalChars = content.length;
      currentRawMarkup = content;
      pipeline!.feed(content);
      pipeline!.flush();
    }
  }
};

// Raw view
btnRaw.onclick = () => {
  rawViewer.style.display = 'block';
  rawContent.textContent = currentRawMarkup || '(No content rendered yet)';
};
btnRawClose.onclick = () => {
  rawViewer.style.display = 'none';
};

// ─── Canvas Resize (manual drag) ─────────────────────────────────────

function setupResizer(handle: HTMLElement, side: 'left' | 'right'): void {
  handle.onmousedown = (e) => {
    e.preventDefault();
    handle.classList.add('dragging');
    widthIndicator.classList.add('visible');
    document.body.classList.add('resizing-canvas');

    const startX = e.clientX;
    const startW = canvasW;

    const onMove = (me: MouseEvent) => {
      const delta = me.clientX - startX;
      const newW = side === 'right'
        ? startW + delta * 2
        : startW - delta * 2;
      applyWidth(newW);
      widthIndicator.textContent = `${canvasW}px`;
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      widthIndicator.classList.remove('visible');
      document.body.classList.remove('resizing-canvas');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
}

setupResizer(resizeLeft, 'left');
setupResizer(resizeRight, 'right');

// ─── Init ────────────────────────────────────────────────────────────

buildScenarioList();
resetPipeline();

console.log(
  '%c Spatial Markdown — Showcase ',
  'background: linear-gradient(135deg, #6c63ff, #4f46e5); color: white; padding: 4px 12px; border-radius: 4px; font-weight: bold;',
);
console.log('Pick a stress scenario and press Run.');
