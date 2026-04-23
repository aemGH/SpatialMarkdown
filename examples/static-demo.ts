/**
 * Static Rendering Demo — Spatial Markdown Engine
 *
 * This is the simplest possible usage: markup in, pixels out.
 * No streaming, no buffers, no LLM — just a general-purpose layout engine
 * that turns declarative markup into precisely-positioned render commands.
 */

import { render } from '../src/pipeline';
import { createCanvasRenderer } from '../src/renderer/canvas/canvas-renderer';

// 1. The markup. Plain declarative layout — no framework, no DOM.
const markup = `
  <Slide>
    <Heading level={1}>Quarterly Report</Heading>
    <Spacer height={16} />

    <AutoGrid minChildWidth={200} gap={16}>
      <MetricCard label="Revenue" value="$4.2M" delta="+12%"  trend="up" sentiment="positive" />
      <MetricCard label="Users"   value="128K"  delta="+8.3%" trend="up" sentiment="positive" />
      <MetricCard label="NPS"     value="72"    delta="+5"    trend="up" sentiment="positive" />
    </AutoGrid>

    <Spacer height={16} />

    <Columns widths="1fr 1fr" gap={24}>
      <Stack direction="vertical" gap={12}>
        Growth held steady across all three business lines, with enterprise expansion outpacing forecasts.
        <Callout type="info" title="Key Insight">
          Expansion revenue from existing accounts now accounts for 64% of new ARR.
        </Callout>
      </Stack>

      <CodeBlock language="typescript" title="Usage">
import { render } from '@spatial-markdown/engine';

const commands = render(markup, { width: 960, height: 720 });
renderer.render(commands);
      </CodeBlock>
    </Columns>
  </Slide>
`;

// 2. Grab the canvas and create a renderer.
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = createCanvasRenderer(canvas);

// 3. One-shot render function — synchronous, pure, no side effects on markup.
function draw(): void {
  const width = Math.min(window.innerWidth - 48, 1200);
  const height = Math.min(window.innerHeight - 160, 800);

  renderer.resize(width, height);
  const commands = render(markup, { width, height });
  renderer.render(commands);
}

// 4. Draw once, then re-draw on resize. That's the whole integration.
draw();
window.addEventListener('resize', draw);
