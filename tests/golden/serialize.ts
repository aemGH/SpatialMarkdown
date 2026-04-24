/**
 * Deterministic serialization for RenderCommand arrays.
 *
 * Used by the golden oracle to produce byte-stable JSON that can be
 * compared across host runtimes (Node baseline vs. QuickJS-on-Android)
 * without false-positive diffs from:
 *   - object-key ordering
 *   - floating-point stringification differences
 *   - trailing-comma / whitespace variance
 *
 * **Numeric precision policy**: `pretext`'s text measurement returns
 * sub-pixel floats. To protect against the tiniest last-bit differences
 * between V8 (Node) and QuickJS's number-to-string routines, we round
 * every numeric field to 4 decimal places before serialization. That
 * is more than enough fidelity for layout validation and guarantees
 * identical bytes out of any conforming IEEE-754 implementation.
 *
 * If a future regression requires sharper precision, lift GOLDEN_PRECISION.
 *
 * @module tests/golden/serialize
 */

import type { RenderCommand } from '../../src/types/render';

/** Decimal places kept in serialized floats. */
export const GOLDEN_PRECISION = 4;

/**
 * Round a number to GOLDEN_PRECISION decimals.
 * Uses the standard `Number((x).toFixed(n))` round-trip which is
 * implementation-portable across V8, JavaScriptCore, and QuickJS.
 */
function roundFixed(value: number): number {
  if (!Number.isFinite(value)) {
    // NaN / Infinity should never appear in valid render commands.
    // Surface them loudly if they do — the harness will fail-stop.
    throw new Error(`Non-finite render value: ${String(value)}`);
  }
  return Number(value.toFixed(GOLDEN_PRECISION));
}

/**
 * Canonical key order per command kind. This is the SORTING KEY for
 * our JSON output — `JSON.stringify(obj, keys)` with a key list emits
 * only those fields, in that order.
 *
 * Adding a new field to a RenderCommand requires adding it here AND
 * regenerating goldens. That's intentional: it's a contract change.
 */
const KEY_ORDER: Record<RenderCommand['kind'], readonly string[]> = {
  'fill-rect': ['kind', 'nodeId', 'x', 'y', 'width', 'height', 'color', 'borderRadius'],
  'stroke-rect': ['kind', 'nodeId', 'x', 'y', 'width', 'height', 'color', 'lineWidth', 'borderRadius'],
  'fill-text': ['kind', 'nodeId', 'text', 'x', 'y', 'font', 'color', 'maxWidth', 'lineHeight', 'align'],
  'draw-image': ['kind', 'nodeId', 'src', 'x', 'y', 'width', 'height'],
  'clip-rect': ['kind', 'nodeId', 'x', 'y', 'width', 'height', 'borderRadius'],
  'restore-clip': ['kind', 'nodeId'],
  'draw-line': ['kind', 'nodeId', 'x1', 'y1', 'x2', 'y2', 'color', 'lineWidth'],
} as const;

/** Fields in any command whose values are numeric and need rounding. */
const NUMERIC_FIELDS = new Set([
  'x', 'y', 'width', 'height', 'borderRadius', 'lineWidth',
  'maxWidth', 'lineHeight', 'x1', 'y1', 'x2', 'y2',
]);

/**
 * Project one RenderCommand onto a plain object with canonical key
 * order and rounded numeric fields. Undefined optional fields are
 * omitted (so `align: undefined` doesn't drift into `"align":null`
 * on one host and get skipped on another).
 */
function canonicalizeCommand(cmd: RenderCommand): Record<string, unknown> {
  const keys = KEY_ORDER[cmd.kind];
  const out: Record<string, unknown> = {};

  for (const key of keys) {
    // Safe cast: the key lists above are derived from the discriminated union.
    const value = (cmd as unknown as Record<string, unknown>)[key];

    if (value === undefined) {
      // Optional field not set — skip entirely.
      continue;
    }

    if (NUMERIC_FIELDS.has(key) && typeof value === 'number') {
      out[key] = roundFixed(value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

/**
 * Serialize a RenderCommand array to stable, pretty-printed JSON
 * that can be diffed across hosts.
 *
 * Format:
 *   - 2-space indent
 *   - Unix line endings
 *   - Trailing newline
 *   - Command order preserved (the engine's command order is part of
 *     the contract — don't sort it)
 */
export function serializeCommands(commands: readonly RenderCommand[]): string {
  const canonical = commands.map(canonicalizeCommand);
  // JSON.stringify with indent 2 is byte-stable across V8 and QuickJS
  // when keys are already in a fixed order (which canonicalizeCommand
  // guarantees).
  return JSON.stringify(canonical, null, 2) + '\n';
}
