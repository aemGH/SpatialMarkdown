/**
 * Unit tests for the LRU measurement cache.
 *
 * @module tests/unit/measurement-cache
 */

import { createMeasurementCache } from '../../src/engine/measurement/cache';
import { font } from '../../src/types/primitives';
import type { FontDescriptor } from '../../src/types/primitives';
import type { PreparedText } from '@chenglou/pretext';

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Create a mock PreparedText value.
 * PreparedText is an opaque branded type from @chenglou/pretext.
 * We cast through `unknown` to satisfy the type system in tests.
 */
function mockPrepared(id: number): PreparedText {
  return { __mock: id } as unknown as PreparedText;
}

const testFont: FontDescriptor = font('14px Inter');
const altFont: FontDescriptor = font('16px Georgia');

// ─── Tests ───────────────────────────────────────────────────────────

describe('MeasurementCache (LRU)', () => {
  describe('basic get/set', () => {
    it('should return a cached PreparedText after set()', () => {
      const cache = createMeasurementCache(100);
      const prepared = mockPrepared(1);

      cache.set('hello', testFont, prepared);
      const result = cache.get('hello', testFont);

      expect(result).toBe(prepared);
    });

    it('should return undefined on cache miss', () => {
      const cache = createMeasurementCache(100);
      const result = cache.get('nonexistent', testFont);

      expect(result).toBeUndefined();
    });
  });

  describe('stats tracking', () => {
    it('should track hits, misses, and hitRatio accurately', () => {
      const cache = createMeasurementCache(100);
      const prepared = mockPrepared(1);

      cache.set('hello', testFont, prepared);

      // 1 hit
      cache.get('hello', testFont);
      // 1 miss
      cache.get('missing', testFont);

      const stats = cache.stats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRatio).toBeCloseTo(0.5);
    });
  });

  describe('LRU eviction', () => {
    it('should evict the least recently used entry when at capacity', () => {
      const cache = createMeasurementCache(2);

      const p1 = mockPrepared(1);
      const p2 = mockPrepared(2);
      const p3 = mockPrepared(3);

      cache.set('A', testFont, p1); // [A]
      cache.set('B', testFont, p2); // [A, B]
      cache.set('C', testFont, p3); // [B, C] — A should be evicted

      expect(cache.get('A', testFont)).toBeUndefined(); // evicted
      expect(cache.get('B', testFont)).toBe(p2);
      expect(cache.get('C', testFont)).toBe(p3);
    });

    it('should promote accessed items to MRU, evicting the true LRU', () => {
      const cache = createMeasurementCache(2);

      const p1 = mockPrepared(1);
      const p2 = mockPrepared(2);
      const p3 = mockPrepared(3);

      cache.set('A', testFont, p1); // [A]
      cache.set('B', testFont, p2); // [A, B]

      // Access A — promotes it to MRU. B is now LRU.
      cache.get('A', testFont);     // [B, A]

      // Insert C — should evict B (the LRU), not A
      cache.set('C', testFont, p3); // [A, C]

      expect(cache.get('A', testFont)).toBe(p1); // survived
      expect(cache.get('B', testFont)).toBeUndefined(); // evicted
      expect(cache.get('C', testFont)).toBe(p3);
    });
  });

  describe('invalidation', () => {
    it('should remove a specific entry via invalidate()', () => {
      const cache = createMeasurementCache(100);
      const prepared = mockPrepared(1);

      cache.set('hello', testFont, prepared);
      expect(cache.get('hello', testFont)).toBe(prepared);

      cache.invalidate('hello', testFont);
      expect(cache.get('hello', testFont)).toBeUndefined();
    });

    it('should clear the entire cache via invalidateAll()', () => {
      const cache = createMeasurementCache(100);

      cache.set('A', testFont, mockPrepared(1));
      cache.set('B', testFont, mockPrepared(2));
      cache.set('C', testFont, mockPrepared(3));

      expect(cache.stats().size).toBe(3);

      cache.invalidateAll();

      expect(cache.stats().size).toBe(0);
      expect(cache.get('A', testFont)).toBeUndefined();
      expect(cache.get('B', testFont)).toBeUndefined();
      expect(cache.get('C', testFont)).toBeUndefined();
    });
  });

  describe('whiteSpace variants', () => {
    it('should treat the same text+font with different whiteSpace as separate entries', () => {
      const cache = createMeasurementCache(100);

      const pNormal = mockPrepared(1);
      const pPreWrap = mockPrepared(2);

      cache.set('hello', testFont, pNormal, 'normal');
      cache.set('hello', testFont, pPreWrap, 'pre-wrap');

      expect(cache.get('hello', testFont, 'normal')).toBe(pNormal);
      expect(cache.get('hello', testFont, 'pre-wrap')).toBe(pPreWrap);
      expect(cache.stats().size).toBe(2);
    });
  });

  describe('update existing entry', () => {
    it('should overwrite the value when set() is called with the same key', () => {
      const cache = createMeasurementCache(100);

      const p1 = mockPrepared(1);
      const p2 = mockPrepared(2);

      cache.set('hello', testFont, p1);
      expect(cache.get('hello', testFont)).toBe(p1);

      // Overwrite
      cache.set('hello', testFont, p2);
      expect(cache.get('hello', testFont)).toBe(p2);

      // Size should NOT have increased
      expect(cache.stats().size).toBe(1);
    });
  });
});
