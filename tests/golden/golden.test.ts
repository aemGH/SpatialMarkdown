/**
 * Golden-snapshot regression oracle.
 *
 * Runs every `GOLDEN_FIXTURES` entry through the engine and compares
 * its serialized render-command output to the snapshot file captured
 * by `capture-goldens.ts`. Any drift fails the test with a full diff
 * pointing to the offending fixture.
 *
 * This is the contract test that makes the QuickJS migration
 * *provably lossless*: any future host-runtime swap (Hermes, QuickJS,
 * J2V8, raw V8 embed) must reproduce the byte-identical snapshots.
 *
 * ## When a snapshot legitimately needs to change
 *
 * You tuned a layout constant, added a RenderCommand field, or fixed
 * a spacing bug. The failing diff confirms the behavior change is
 * real. Re-generate the goldens:
 *
 *     npm run golden:capture
 *
 * Review the git diff on `tests/golden/snapshots/*.json`. If the new
 * output is intended, commit it alongside the engine change. If it's
 * a surprise, you just caught a regression — don't capture over it.
 *
 * @module tests/golden/golden.test
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { GOLDEN_FIXTURES } from './fixtures/index';
import { runFixture } from './run-fixture';
import { serializeCommands } from './serialize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_DIR = resolve(__dirname, 'snapshots', 'node-canvas');

describe('Golden render-command contract (Phase 1 regression oracle)', () => {
  for (const fixture of GOLDEN_FIXTURES) {
    it(`${fixture.id} — ${fixture.description}`, () => {
      const result = runFixture(fixture);
      const actualJson = serializeCommands(result.commands);

      const snapshotPath = resolve(SNAPSHOT_DIR, `${fixture.id}.json`);
      let expectedJson: string;
      try {
        expectedJson = readFileSync(snapshotPath, 'utf8');
      } catch (err) {
        // No snapshot yet. Fail with a clear next-step message rather
        // than silently capturing (which would defeat the oracle).
        throw new Error(
          `Missing golden snapshot for "${fixture.id}". ` +
          `Run "npm run golden:capture" to generate it, ` +
          `then review the output before committing.\n` +
          `Underlying error: ${(err as Error).message}`,
        );
      }

      // Direct string compare. Vitest will print a clean diff on
      // failure because both sides are pretty-printed JSON.
      expect(actualJson).toBe(expectedJson);
    });
  }
});
