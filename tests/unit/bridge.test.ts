/**
 * Unit tests for the bridge layer — backpressure controller and stream protocol.
 *
 * WS and SSE adapters depend on browser APIs (WebSocket, EventSource) and
 * are not tested here; they require browser-based E2E tests.
 *
 * @module tests/unit/bridge
 */

import { describe, it, expect } from 'vitest';
import { createBackpressureController } from '../../src/bridge/buffer/backpressure';
import type { BackpressureController } from '../../src/bridge/buffer/backpressure';
import { deserializeUpstream, serializeDownstream, validateProtocolVersion } from '../../src/bridge/streaming/stream-protocol';
import type { DownstreamMessage, UpstreamMessage } from '../../src/types/stream';
import { PROTOCOL_VERSION } from '../../src/types/stream';

// ─── Backpressure Controller ───────────────────────────────────────────

describe('BackpressureController', () => {
  describe('construction', () => {
    it('should create a controller with default watermarks', () => {
      let pauseCalled = false;
      let resumeCalled = false;
      const ctrl = createBackpressureController({
        onPause: () => { pauseCalled = true; },
        onResume: () => { resumeCalled = true; },
      });

      expect(ctrl.isPaused()).toBe(false);

      // Should not fire anything on creation
      expect(pauseCalled).toBe(false);
      expect(resumeCalled).toBe(false);
    });

    it('should create a controller with custom watermarks', () => {
      const ctrl = createBackpressureController({
        highWatermark: 0.9,
        lowWatermark: 0.1,
        onPause: () => {},
        onResume: () => {},
      });

      expect(ctrl.isPaused()).toBe(false);
    });

    it('should throw for invalid highWatermark', () => {
      expect(() =>
        createBackpressureController({
          highWatermark: 1.5,
          lowWatermark: 0.25,
          onPause: () => {},
          onResume: () => {},
        }),
      ).toThrow(RangeError);
    });

    it('should throw for invalid lowWatermark', () => {
      expect(() =>
        createBackpressureController({
          highWatermark: 0.75,
          lowWatermark: -0.1,
          onPause: () => {},
          onResume: () => {},
        }),
      ).toThrow(RangeError);
    });

    it('should throw when lowWatermark >= highWatermark', () => {
      expect(() =>
        createBackpressureController({
          highWatermark: 0.25,
          lowWatermark: 0.5,
          onPause: () => {},
          onResume: () => {},
        }),
      ).toThrow(RangeError);
    });

    it('should throw when lowWatermark equals highWatermark', () => {
      expect(() =>
        createBackpressureController({
          highWatermark: 0.5,
          lowWatermark: 0.5,
          onPause: () => {},
          onResume: () => {},
        }),
      ).toThrow(RangeError);
    });
  });

  describe('pause/resume hysteresis', () => {
    it('should fire onPause when utilization exceeds highWatermark', () => {
      let pauseCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => { pauseCount++; },
        onResume: () => {},
      });

      ctrl.check(0.76);
      expect(pauseCount).toBe(1);
      expect(ctrl.isPaused()).toBe(true);
    });

    it('should NOT fire onPause again when already paused', () => {
      let pauseCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => { pauseCount++; },
        onResume: () => {},
      });

      ctrl.check(0.80);
      ctrl.check(0.90);
      ctrl.check(0.95);

      // Should only fire once despite multiple checks above highWatermark
      expect(pauseCount).toBe(1);
      expect(ctrl.isPaused()).toBe(true);
    });

    it('should NOT fire onPause at exactly highWatermark (must exceed)', () => {
      let pauseCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => { pauseCount++; },
        onResume: () => {},
      });

      ctrl.check(0.75);
      expect(pauseCount).toBe(0);
      expect(ctrl.isPaused()).toBe(false);

      // Just above should trigger
      ctrl.check(0.76);
      expect(pauseCount).toBe(1);
    });

    it('should fire onResume when utilization drops below lowWatermark', () => {
      let resumeCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => {},
        onResume: () => { resumeCount++; },
      });

      // Push past highWatermark to pause
      ctrl.check(0.80);
      expect(ctrl.isPaused()).toBe(true);

      // Drop below lowWatermark to resume
      ctrl.check(0.24);
      expect(resumeCount).toBe(1);
      expect(ctrl.isPaused()).toBe(false);
    });

    it('should NOT fire onResume at exactly lowWatermark (must drop below)', () => {
      let resumeCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => {},
        onResume: () => { resumeCount++; },
      });

      ctrl.check(0.80); // Pause
      expect(ctrl.isPaused()).toBe(true);

      ctrl.check(0.25); // Exactly at lowWatermark — should NOT resume
      expect(resumeCount).toBe(0);
      expect(ctrl.isPaused()).toBe(true);

      ctrl.check(0.24); // Below lowWatermark — should resume
      expect(resumeCount).toBe(1);
      expect(ctrl.isPaused()).toBe(false);
    });

    it('should NOT fire onResume when not paused', () => {
      let resumeCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => {},
        onResume: () => { resumeCount++; },
      });

      // Never paused, but check low utilization
      ctrl.check(0.10);
      ctrl.check(0.01);

      expect(resumeCount).toBe(0);
    });

    it('should demonstrate hysteresis: not oscillate near threshold', () => {
      const events: string[] = [];
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => { events.push('pause'); },
        onResume: () => { events.push('resume'); },
      });

      // Rapid oscillation between 0.4 and 0.6 — both between watermarks
      ctrl.check(0.4);
      ctrl.check(0.6);
      ctrl.check(0.4);
      ctrl.check(0.6);

      expect(events).toEqual([]);
      expect(ctrl.isPaused()).toBe(false);
    });

    it('should oscillate only once per full cycle', () => {
      const events: string[] = [];
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => { events.push('pause'); },
        onResume: () => { events.push('resume'); },
      });

      // Full cycle: low → pause → low → pause → low
      ctrl.check(0.50);   // Middle — no action
      ctrl.check(0.80);   // Pause!
      ctrl.check(0.50);   // Still above lowWatermark — no action
      ctrl.check(0.20);   // Resume!
      ctrl.check(0.80);   // Pause!
      ctrl.check(0.15);   // Resume!

      expect(events).toEqual(['pause', 'resume', 'pause', 'resume']);
    });
  });

  describe('reset', () => {
    it('should reset to unpaused state without firing callbacks', () => {
      let pauseCount = 0;
      let resumeCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => { pauseCount++; },
        onResume: () => { resumeCount++; },
      });

      ctrl.check(0.80);
      expect(ctrl.isPaused()).toBe(true);

      ctrl.reset();
      expect(ctrl.isPaused()).toBe(false);

      // Should not have fired onResume
      expect(resumeCount).toBe(0);
      expect(pauseCount).toBe(1);
    });

    it('should allow re-triggering pause after reset', () => {
      let pauseCount = 0;
      const ctrl = createBackpressureController({
        highWatermark: 0.75,
        lowWatermark: 0.25,
        onPause: () => { pauseCount++; },
        onResume: () => {},
      });

      ctrl.check(0.80);
      ctrl.reset();
      ctrl.check(0.80);

      expect(pauseCount).toBe(2);
    });
  });
});

// ─── Stream Protocol ──────────────────────────────────────────────────

describe('stream-protocol', () => {
  describe('validateProtocolVersion', () => {
    it('should return true for the current protocol version', () => {
      expect(validateProtocolVersion({ v: PROTOCOL_VERSION })).toBe(true);
    });

    it('should return false for a different protocol version', () => {
      expect(validateProtocolVersion({ v: 99 })).toBe(false);
    });

    it('should return false for undefined version', () => {
      expect(validateProtocolVersion({})).toBe(false);
    });
  });

  describe('deserializeUpstream', () => {
    it('should parse a valid StreamChunkMessage', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'chunk',
        seq: 1,
        text: 'Hello World',
        ts: 1700000000000,
      });

      const msg = deserializeUpstream(raw);
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('chunk');
      if (msg!.type === 'chunk') {
        expect(msg.text).toBe('Hello World');
        expect(msg.seq).toBe(1);
      }
    });

    it('should parse a valid StreamEndMessage', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'end',
        seq: 5,
        reason: 'complete',
      });

      const msg = deserializeUpstream(raw);
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('end');
      if (msg!.type === 'end') {
        expect(msg.reason).toBe('complete');
      }
    });

    it('should parse a StreamEndMessage with reason "cancelled"', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'end',
        seq: 3,
        reason: 'cancelled',
      });

      const msg = deserializeUpstream(raw);
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('end');
      if (msg!.type === 'end') {
        expect(msg.reason).toBe('cancelled');
      }
    });

    it('should parse a valid StreamErrorMessage', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'error',
        seq: 2,
        code: 'RATE_LIMIT',
        message: 'Too many requests',
      });

      const msg = deserializeUpstream(raw);
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('error');
      if (msg!.type === 'error') {
        expect(msg.code).toBe('RATE_LIMIT');
        expect(msg.message).toBe('Too many requests');
      }
    });

    it('should parse a valid PingMessage', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'ping',
        seq: 10,
        ts: 1700000000000,
      });

      const msg = deserializeUpstream(raw);
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('ping');
    });

    it('should parse a valid ConfigUpdateMessage', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'config',
        seq: 0,
      });

      const msg = deserializeUpstream(raw);
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('config');
    });

    it('should return null for invalid JSON', () => {
      expect(deserializeUpstream('not json{')).toBeNull();
    });

    it('should return null for wrong protocol version', () => {
      const raw = JSON.stringify({
        v: 99,
        type: 'chunk',
        seq: 1,
        text: 'hi',
        ts: 1000,
      });

      expect(deserializeUpstream(raw)).toBeNull();
    });

    it('should return null for unknown message type', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'unknown',
        seq: 1,
      });

      expect(deserializeUpstream(raw)).toBeNull();
    });

    it('should return null for missing required fields', () => {
      // Missing 'text' on chunk
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'chunk',
        seq: 1,
        ts: 1000,
      });

      expect(deserializeUpstream(raw)).toBeNull();
    });

    it('should return null for non-object input', () => {
      expect(deserializeUpstream('42')).toBeNull();
      expect(deserializeUpstream('"string"')).toBeNull();
      expect(deserializeUpstream('null')).toBeNull();
      expect(deserializeUpstream('[1,2,3]')).toBeNull();
    });

    it('should return null for end message with invalid reason', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'end',
        seq: 1,
        reason: 'invalid-reason',
      });

      expect(deserializeUpstream(raw)).toBeNull();
    });

    it('should return null for error message missing fields', () => {
      const raw = JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'error',
        seq: 1,
        // Missing code and message
      });

      expect(deserializeUpstream(raw)).toBeNull();
    });
  });

  describe('serializeDownstream', () => {
    it('should serialize a BackpressurePauseMessage', () => {
      const msg: DownstreamMessage = {
        v: PROTOCOL_VERSION,
        type: 'pause',
        reason: 'buffer-full',
        bufferUtilization: 0.85,
      };

      const json = serializeDownstream(msg);
      const parsed = JSON.parse(json);

      expect(parsed.v).toBe(PROTOCOL_VERSION);
      expect(parsed.type).toBe('pause');
      expect(parsed.reason).toBe('buffer-full');
      expect(parsed.bufferUtilization).toBe(0.85);
    });

    it('should serialize a BackpressureResumeMessage', () => {
      const msg: DownstreamMessage = {
        v: PROTOCOL_VERSION,
        type: 'resume',
      };

      const json = serializeDownstream(msg);
      const parsed = JSON.parse(json);

      expect(parsed.v).toBe(PROTOCOL_VERSION);
      expect(parsed.type).toBe('resume');
    });

    it('should serialize an AckMessage', () => {
      const msg: DownstreamMessage = {
        v: PROTOCOL_VERSION,
        type: 'ack',
        seq: 42,
        renderLatencyMs: 16,
      };

      const json = serializeDownstream(msg);
      const parsed = JSON.parse(json);

      expect(parsed.seq).toBe(42);
      expect(parsed.renderLatencyMs).toBe(16);
    });

    it('should serialize a PongMessage', () => {
      const msg: DownstreamMessage = {
        v: PROTOCOL_VERSION,
        type: 'pong',
        seq: 10,
        ts: 1700000000000,
      };

      const json = serializeDownstream(msg);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('pong');
      expect(parsed.seq).toBe(10);
    });

    it('should produce valid JSON that can be parsed back', () => {
      const msg: DownstreamMessage = {
        v: PROTOCOL_VERSION,
        type: 'pause',
        reason: 'render-behind',
        bufferUtilization: 0.9,
      };

      const json = serializeDownstream(msg);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });
});