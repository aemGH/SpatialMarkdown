/**
 * Golden-snapshot capture script.
 *
 * Runs every fixture in `GOLDEN_FIXTURES` through the engine (Node +
 * jsdom baseline) and writes serialized render commands to
 * `tests/golden/snapshots/<id>.json`.
 *
 * This is Phase 1 of the QuickJS migration: capture the oracle. Phase
 * 2 will add a QuickJS-on-Android harness that reads the same
 * snapshots and asserts byte-identical output.
 *
 * Usage:
 *   npm run golden:capture
 *
 * Re-run whenever the engine output contract intentionally changes
 * (e.g., a new RenderCommand field, a tuned spacing constant). Do NOT
 * run casually — the whole point is for these snapshots to be stable.
 *
 * @module tests/golden/capture-goldens
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOLDEN_FIXTURES } from './fixtures/index';
import { runFixture } from './run-fixture';
import { serializeCommands } from './serialize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_DIR = resolve(__dirname, 'snapshots');

function main(): void {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  let totalCommands = 0;
  let totalMs = 0;

  console.log(`\nCapturing ${GOLDEN_FIXTURES.length} golden snapshots…\n`);

  for (const fixture of GOLDEN_FIXTURES) {
    const result = runFixture(fixture);
    const json = serializeCommands(result.commands);
    const path = resolve(SNAPSHOT_DIR, `${fixture.id}.json`);
    writeFileSync(path, json, { encoding: 'utf8' });

    totalCommands += result.commands.length;
    totalMs += result.elapsedMs;

    const msStr = result.elapsedMs.toFixed(2).padStart(7);
    const cmdStr = String(result.commands.length).padStart(4);
    console.log(`  ${msStr} ms  ${cmdStr} cmds   ${fixture.id}`);
  }

  console.log(
    `\nDone. ${GOLDEN_FIXTURES.length} fixtures, ${totalCommands} commands, ` +
    `${totalMs.toFixed(2)} ms total.\n`,
  );
}

main();
