/**
 * Golden-snapshot capture runner — executed via Vitest so Vite aliases
 * are active (this redirects @chenglou/pretext to our fork).
 *
 * Usage: npx vitest run tests/golden/capture-goldens.vitest.ts
 *
 * @module tests/golden/capture-goldens.vitest
 */

import { test } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOLDEN_FIXTURES } from './fixtures/index';
import { runFixture } from './run-fixture';
import { serializeCommands } from './serialize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_DIR = resolve(__dirname, 'snapshots', 'node-canvas');

test('capture golden snapshots', () => {
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
});
