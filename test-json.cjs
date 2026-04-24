const { createPipeline } = require('./dist/index.cjs');
const pipeline = createPipeline();
pipeline.resize(1080, 1920);
pipeline.onRender(commands => console.log(JSON.stringify(commands, null, 2)));
pipeline.feed('<Slide>\n<Heading level={1}>Hello Android!</Heading>\n<Text>This is rendering natively at 60fps via Jetpack Compose.</Text>\n<AutoGrid minChildWidth={200} gap={16}>\n<MetricCard label="Bridge" value="Active" sentiment="positive" />\n<MetricCard label="Canvas" value="Native" sentiment="positive" />\n</AutoGrid>\n</Slide>');
pipeline.flush();
