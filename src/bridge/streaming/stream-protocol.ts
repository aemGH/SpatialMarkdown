/**
 * Bridge protocol serialization / deserialization.
 *
 * Handles the wire format between the TypeScript engine and the Python SDK.
 * All messages are JSON-encoded strings with a protocol version field `v`.
 *
 * - Downstream (TS → Python): serialized via `serializeDownstream`
 * - Upstream (Python → TS): parsed and validated via `deserializeUpstream`
 *
 * @module @spatial/bridge/streaming/stream-protocol
 */

import type {
  DownstreamMessage,
  UpstreamMessage,
} from '../../types/stream';
import { PROTOCOL_VERSION } from '../../types/stream';

// ─── Upstream Message Type Guard ─────────────────────────────────────

const VALID_UPSTREAM_TYPES: ReadonlySet<string> = new Set([
  'chunk',
  'end',
  'error',
  'config',
  'ping',
]);

/**
 * Validate that a parsed object carries the correct protocol version.
 */
export function validateProtocolVersion(msg: { v?: unknown }): boolean {
  return msg.v === PROTOCOL_VERSION;
}

/**
 * Minimal structural validation for upstream messages.
 * Returns `true` if the object looks like a valid UpstreamMessage shape.
 */
function isValidUpstreamShape(parsed: Record<string, unknown>): boolean {
  if (typeof parsed['type'] !== 'string') return false;
  if (!VALID_UPSTREAM_TYPES.has(parsed['type'])) return false;
  if (typeof parsed['seq'] !== 'number') return false;

  switch (parsed['type']) {
    case 'chunk':
      return typeof parsed['text'] === 'string' && typeof parsed['ts'] === 'number';
    case 'end':
      return (
        parsed['reason'] === 'complete' ||
        parsed['reason'] === 'cancelled' ||
        parsed['reason'] === 'max-tokens'
      );
    case 'error':
      return typeof parsed['code'] === 'string' && typeof parsed['message'] === 'string';
    case 'config':
      // viewport and theme are both optional
      return true;
    case 'ping':
      return typeof parsed['ts'] === 'number';
    default:
      return false;
  }
}

// ─── Serialize Downstream ────────────────────────────────────────────

/**
 * Serialize a downstream message (TS → Python) to a JSON string.
 * The message is already fully typed — this is a thin JSON.stringify wrapper
 * that guarantees the output is a well-formed string.
 */
export function serializeDownstream(msg: DownstreamMessage): string {
  return JSON.stringify(msg);
}

// ─── Deserialize Upstream ────────────────────────────────────────────

/**
 * Parse a raw JSON string from the Python SDK into an UpstreamMessage.
 * Returns `null` if the string is malformed, has an invalid protocol
 * version, or fails structural validation.
 *
 * This function never throws — all parse errors are swallowed and
 * reported as `null`, letting the caller decide how to handle them.
 */
export function deserializeUpstream(raw: string): UpstreamMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (!validateProtocolVersion({ v: record['v'] })) {
    return null;
  }

  if (!isValidUpstreamShape(record)) {
    return null;
  }

  // At this point, structural validation has passed.
  // The record conforms to one of the UpstreamMessage discriminated union
  // members. We route through `unknown` because Record<string, unknown>
  // doesn't structurally overlap with the branded readonly union —
  // this is the validated-parse constructor pattern (like branded types).
  return parsed as UpstreamMessage;
}
