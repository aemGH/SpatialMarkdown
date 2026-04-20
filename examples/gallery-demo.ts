import { createPipeline } from '../src/pipeline';
import type { SpatialPipeline } from '../src/pipeline';
import { createCanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { CanvasRenderer } from '../src/renderer/canvas/canvas-renderer';
import type { RenderCommand } from '../src/types/render';
import { defaultTheme, darkTheme } from '../src/types/theme';

// ─── Golden Examples ────────────────────────────────────────────────

interface Example {
  id: string;
  title: string;
  description: string;
  content: string;
}

const EXAMPLES: Example[] = [
  {
    id: 'dashboard',
    title: 'Executive Dashboard',
    description: 'Real-time financial metrics and regional growth analysis with multi-column layouts.',
    content: `<Slide>
  <Heading level={1}>Global Market Intelligence</Heading>
  <Stack direction="vertical" gap={8}>
    <Heading level={3}>Q2 Fiscal Performance Overview</Heading>
    <AutoGrid minChildWidth={220} gap={16}>
      <MetricCard label="Total Revenue" value="$42.8M" delta="+14.2%" trend="up" sentiment="positive" />
      <MetricCard label="Active Users" value="1.2M" delta="+8.5%" trend="up" sentiment="positive" />
      <MetricCard label="Op. Margin" value="24%" delta="-1.2%" trend="down" sentiment="neutral" />
      <MetricCard label="Churn Rate" value="1.8%" delta="-0.3%" trend="down" sentiment="positive" />
    </AutoGrid>
    <Spacer height={16} />
    <Columns widths="2fr 1fr" gap={24}>
      <Stack direction="vertical" gap={12}>
        <Heading level={3}>Regional Growth Analysis</Heading>
        Growth in the EMEA region has exceeded expectations, driven primarily by our new enterprise partnership in Germany. North American markets remain stable with steady 4% MoM increases.
        <Callout type="info" title="Strategic Update">
          Expansion into Southeast Asia is scheduled for Q3. Preliminary research suggests a 30% higher TAM than previously estimated.
        </Callout>
      </Stack>
      <Stack direction="vertical" gap={8}>
        <Heading level={3}>Risk Profile</Heading>
        <MetricCard label="Market Volatility" value="Low" sentiment="positive" />
        <MetricCard label="Credit Exposure" value="Medium" sentiment="neutral" />
        <Quote cite="Internal Audit">
          Maintaining conservative liquidity ratios remains the priority for the next two quarters.
        </Quote>
      </Stack>
    </Columns>
  </Stack>
</Slide>`,
  },
  {
    id: 'tech-spec',
    title: 'Technical Specification',
    description: 'System architecture deep-dive featuring live code blocks and performance benchmarks.',
    content: `<Slide>
  <Heading level={1}>Spatial Engine v4.0</Heading>
  <Stack direction="vertical" gap={12}>
    <Heading level={2}>Core Pipeline Architecture</Heading>
    The new V4 engine implements a lock-free geometry solver capable of 120fps updates on mobile hardware.
    <Columns widths="1fr 1fr" gap={16}>
      <CodeBlock language="typescript" title="pipeline.ts">
const engine = createSpatialEngine({
  pretext: true,
  zeroReflow: true,
  threading: 'worker'
});

engine.on('frame', (geometry) => {
  render(geometry);
});
      </CodeBlock>
      <Stack direction="vertical" gap={8}>
        <Heading level={3}>Optimization Specs</Heading>
        <MetricCard label="Parse Latency" value="0.12ms" sentiment="positive" />
        <MetricCard label="Layout Depth" value="Unlimited" sentiment="neutral" />
        <Callout type="tip" title="Pro Tip">
          Use the \`AutoGrid\` component for responsive collections to avoid manual media queries.
        </Callout>
      </Stack>
    </Columns>
    <Divider />
    <Heading level={3}>Component Hierarchy</Heading>
    All nodes are measured in isolation using the Pretext measurement bridge before being committed to the layout tree.
  </Stack>
</Slide>`,
  },
  {
    id: 'market-report',
    title: 'Market Opportunity',
    description: 'Editorial-style report on consumer technology trends with rich typography.',
    content: `<Slide>
  <Heading level={1}>Consumer Tech Trends 2026</Heading>
  <Spacer height={12} />
  <Columns widths="1fr 2fr" gap={32}>
    <Stack direction="vertical" gap={16}>
      <Heading level={2}>Key Drivers</Heading>
      <MetricCard label="AI Adoption" value="84%" trend="up" sentiment="positive" />
      <MetricCard label="Remote Work" value="62%" trend="neutral" sentiment="neutral" />
      <MetricCard label="E-commerce" value="$8.4T" trend="up" sentiment="positive" />
    </Stack>
    <Stack direction="vertical" gap={12}>
      <Heading level={2}>The "Spatial" Shift</Heading>
      User interfaces are moving away from rigid grids towards dynamic, context-aware spatial layouts.
      <Quote cite="Trend Report 2026">
        Spatial awareness in UI design is no longer an outlier—it's the new standard for immersive digital experiences.
      </Quote>
      <Callout type="note" title="Market Impact">
        Companies adopting spatial design principles report a 40% increase in user session duration and 25% higher task completion rates.
      </Callout>
    </Stack>
  </Columns>
</Slide>`,
  },
  {
    id: 'hero-reveal',
    title: 'Product Hero Reveal',
    description: 'Centered brand showcase with high-impact headings and feature grids.',
    content: `<Slide>
  <Stack direction="vertical" gap={24} align="center">
    <Heading level={1}>Lumina Pro 2</Heading>
    <Heading level={2}>Reimagining the professional workspace.</Heading>
    <Spacer height={12} />
    <AutoGrid minChildWidth={250} gap={20}>
      <Callout type="info" title="4K Retina Display">
        Unmatched clarity with 10-bit color depth and 1000 nits peak brightness.
      </Callout>
      <Callout type="success" title="M4 Max Performance">
        Up to 40% faster rendering for 3D workflows and neural processing.
      </Callout>
      <Callout type="note" title="24h Battery Life">
        Go further with our most efficient power management system ever.
      </Callout>
    </AutoGrid>
    <Spacer height={24} />
    <Divider />
    <Quote cite="Design Weekly">
      "The Lumina Pro 2 isn't just a laptop; it's a statement about the future of creative work."
    </Quote>
  </Stack>
</Slide>`,
  },
];

// ─── DOM Helpers ────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const exampleList = $('example-list');
const btnStream = $<HTMLButtonElement>('btn-stream');
const btnInstant = $<HTMLButtonElement>('btn-instant');
const btnTheme = $<HTMLButtonElement>('btn-theme');
const btnRaw = $<HTMLButtonElement>('btn-raw');
const speedRange = $<HTMLInputElement>('speed-range');
const speedVal = $('speed-val');
const canvas = $<HTMLCanvasElement>('output-canvas');
const canvasWrapper = $('canvas-wrapper');
const activeExampleName = $('active-example-name');
const canvasDims = $('canvas-dims');
const widthIndicator = $('width-indicator');
const resizeLeft = $('resize-left');
const resizeRight = $('resize-right');
const rawViewer = $('raw-viewer');
const rawContent = $('raw-content');
const streamStatus = $('stream-status');

const statLayout = $('stat-layout');
const statNodes = $('stat-nodes');
const statCommands = $('stat-commands');
const statChars = $('stat-chars');

// ─── State ───────────────────────────────────────────────────────────

let pipeline: SpatialPipeline | null = null;
let renderer: CanvasRenderer | null = null;
let currentExample: Example | null = null;
let isDark = true;
let isStreaming = false;
let abortStreaming = false;
let canvasW = 900;
let currentH = 600;
let showingRaw = false;

// ─── Logic ───────────────────────────────────────────────────────────

function resetPipeline(): void {
  if (pipeline) pipeline.destroy();
  if (renderer) renderer.destroy();

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
      canvasDims.textContent = `${canvasW} × ${currentH}`;
    }

    const t0 = performance.now();
    renderer!.render(commands);
    const dt = performance.now() - t0;
    
    updateStats(commands.length, dt);
  });
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

function updateStats(commandCount: number, layoutTime: number): void {
  if (!pipeline) return;
  const doc = pipeline.getDocument();
  statLayout.textContent = `${layoutTime.toFixed(2)}ms`;
  statNodes.textContent = String(doc.nodeIndex.size);
  statCommands.textContent = String(commandCount);
  
  statLayout.style.color = layoutTime < 2 ? 'var(--green)' : layoutTime < 8 ? 'var(--text)' : 'var(--red)';
}

async function streamExample(example: Example): Promise<void> {
  if (isStreaming) return;
  
  currentExample = example;
  activeExampleName.textContent = example.title;
  isStreaming = true;
  abortStreaming = false;
  streamStatus.classList.add('active');
  btnStream.disabled = true;
  btnInstant.disabled = true;
  
  resetPipeline();
  
  const text = example.content;
  let charsProcessed = 0;
  
  // Simple chunking for streaming effect
  const chunks = splitTextIntoChunks(text);
  
  for (const chunk of chunks) {
    if (abortStreaming) break;
    
    pipeline!.feed(chunk);
    charsProcessed += chunk.length;
    statChars.textContent = String(charsProcessed);
    
    // UI feedback for raw view
    if (showingRaw) {
      updateRawView(text.slice(0, charsProcessed));
    }
    
    // Speed: 1 = slow (100ms), 100 = fast (1ms)
    const speed = parseInt(speedRange.value);
    const delay = Math.max(2, Math.floor(200 / (speed / 5)));
    await new Promise(r => setTimeout(r, delay));
  }
  
  pipeline!.flush();
  isStreaming = false;
  streamStatus.classList.remove('active');
  btnStream.disabled = false;
  btnInstant.disabled = false;
  
  if (showingRaw) {
    updateRawView(text);
  }
}

function splitTextIntoChunks(text: string): string[] {
  // Better chunking to preserve tag integrity for smoother rendering
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
    const end = nextTag === -1 ? text.length : nextTag;
    const content = text.slice(i, end);
    // Split text content into smaller bits
    const words = content.split(/(\s+)/);
    for (const word of words) {
      if (word.length > 0) chunks.push(word);
    }
    i = end;
  }
  return chunks;
}

function renderInstant(example: Example): void {
  currentExample = example;
  activeExampleName.textContent = example.title;
  resetPipeline();
  pipeline!.feed(example.content);
  pipeline!.flush();
  statChars.textContent = String(example.content.length);
  if (showingRaw) updateRawView(example.content);
}

function updateRawView(text: string): void {
  // Simple syntax highlighting
  const highlighted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(\/?[\w]+)/g, '&lt;<span class="tag">$1</span>')
    .replace(/(\w+)=\{([^}]+)\}/g, '<span class="attr">$1</span>={<span class="val">$2</span>}')
    .replace(/(\w+)="([^"]+)"/g, '<span class="attr">$1</span>="<span class="val">$2</span>"');
  
  rawContent.innerHTML = highlighted;
}

// ─── Event Handlers ──────────────────────────────────────────────────

function setupUI(): void {
  // Build example list
  EXAMPLES.forEach(ex => {
    const div = document.createElement('div');
    div.className = 'example-item';
    div.innerHTML = `
      <div class="title">${ex.title}</div>
      <div class="desc">${ex.description}</div>
    `;
    div.onclick = () => {
      document.querySelectorAll('.example-item').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
      renderInstant(ex);
    };
    exampleList.appendChild(div);
  });

  // Default selection
  const first = exampleList.firstChild as HTMLElement;
  if (first) {
    first.classList.add('active');
    renderInstant(EXAMPLES[0]!);
  }

  btnStream.onclick = () => {
    if (currentExample) streamExample(currentExample);
  };

  btnInstant.onclick = () => {
    if (currentExample) renderInstant(currentExample);
  };

  btnTheme.onclick = () => {
    isDark = !isDark;
    btnTheme.textContent = isDark ? 'Dark' : 'Light';
    document.body.style.background = isDark ? 'var(--bg)' : '#f5f5f5';
    document.body.style.color = isDark ? 'var(--text)' : '#1a1a1a';
    if (currentExample) renderInstant(currentExample);
  };

  btnRaw.onclick = () => {
    showingRaw = !showingRaw;
    rawViewer.classList.toggle('visible', showingRaw);
    btnRaw.textContent = showingRaw ? 'View Canvas' : 'View Markup';
    if (showingRaw && currentExample) updateRawView(currentExample.content);
  };

  speedRange.oninput = () => {
    speedVal.textContent = speedRange.value;
  };

  // Resizing logic
  function setupResizer(handle: HTMLElement, side: 'left' | 'right'): void {
    handle.onmousedown = (e) => {
      e.preventDefault();
      handle.classList.add('dragging');
      widthIndicator.classList.add('visible');
      const startX = e.clientX;
      const startW = canvasW;
      
      const onMove = (me: MouseEvent) => {
        const delta = side === 'right' ? me.clientX - startX : startX - me.clientX;
        const newW = Math.max(380, Math.min(1600, startW + delta * (side === 'right' ? 1 : 1)));
        // Symmetrical resize feels better for a centered gallery
        canvasW = newW;
        renderer!.resize(canvasW, currentH);
        pipeline!.resize(canvasW, currentH);
        
        if (currentExample) {
          pipeline!.feed(currentExample.content);
          pipeline!.flush();
        }
        
        canvasDims.textContent = `${canvasW} × ${currentH}`;
        widthIndicator.textContent = `${canvasW}px`;
      };
      
      const onUp = () => {
        handle.classList.remove('dragging');
        widthIndicator.classList.remove('visible');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }

  setupResizer(resizeLeft, 'left');
  setupResizer(resizeRight, 'right');
}

setupUI();
resetPipeline();
