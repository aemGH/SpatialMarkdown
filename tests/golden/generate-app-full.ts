import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createPipeline } from '../../src/pipeline';
import { createNodeCanvasMeasurementContext } from '../../src/engine/measurement/node-canvas-context';
import { setMeasureContext } from '../../src/engine/measurement/pretext-fork/measurement.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const markdown = `
<Slide>
    <Heading level={1}>Hello Android Native!</Heading>
    <Spacer height={16} />
    <Text>This text is parsed by TypeScript, measured by pretext, and drawn natively by Jetpack Compose at 60fps.</Text>
    <Spacer height={24} />
    <AutoGrid minChildWidth={150} gap={16}>
        <MetricCard label="Performance" value="60 FPS" sentiment="positive" />
        <MetricCard label="Layout Shift" value="Zero" sentiment="positive" />
    </AutoGrid>
    <Spacer height={24} />
    <Callout type="tip" title="Bridged Architecture">
        The Kotlin Adapter is just a dumb renderer. No layout math happens here!
    </Callout>
    <Spacer height={24} />
    <CodeBlock language="kotlin" title="How it works">
SpatialEngineView(
    onControllerReady = { ctrl ->
        ctrl.feed("<Slide>...</Slide>")
    }
)
    </CodeBlock>
</Slide>
`.trim();

const measureCtx = createNodeCanvasMeasurementContext();
setMeasureContext(measureCtx);
const pipeline = createPipeline({ measurementContext: measureCtx });
pipeline.resize(411, 914);

let commands: any[] = [];
pipeline.onRender((c) => { commands = [...c]; });
pipeline.feed(markdown);
pipeline.flush();
pipeline.destroy();

const outDir = path.join(__dirname, 'snapshots', 'node-canvas');
fs.writeFileSync(path.join(outDir, 'app-full.json'), JSON.stringify(commands, null, 2), 'utf-8');
console.log('Saved ' + commands.length + ' commands.');
