/**
 * Unit tests for RingBuffer — fixed-size circular buffer.
 *
 * @module tests/unit/ring-buffer
 */

import { createRingBuffer } from '../../src/bridge/buffer/ring-buffer';

describe('RingBuffer', () => {
  describe('Create', () => {
    it('initialises with correct state for capacity 4', () => {
      const buf = createRingBuffer<number>(4);

      expect(buf.isEmpty()).toBe(true);
      expect(buf.size).toBe(0);
      expect(buf.capacity).toBe(4);
    });
  });

  describe('Write and read', () => {
    it('returns items in FIFO order after writing 3 items', () => {
      const buf = createRingBuffer<string>(4);

      expect(buf.write('a')).toBe(true);
      expect(buf.write('b')).toBe(true);
      expect(buf.write('c')).toBe(true);

      expect(buf.size).toBe(3);

      expect(buf.read()).toBe('a');
      expect(buf.read()).toBe('b');
      expect(buf.read()).toBe('c');

      expect(buf.size).toBe(0);
      expect(buf.isEmpty()).toBe(true);
    });
  });

  describe('Full buffer', () => {
    it('returns isFull=true when written to capacity, and write returns false', () => {
      const buf = createRingBuffer<number>(4);

      expect(buf.write(10)).toBe(true);
      expect(buf.write(20)).toBe(true);
      expect(buf.write(30)).toBe(true);
      expect(buf.write(40)).toBe(true);

      expect(buf.isFull()).toBe(true);
      expect(buf.size).toBe(4);

      // Additional write should fail
      expect(buf.write(50)).toBe(false);
      expect(buf.size).toBe(4);
    });
  });

  describe('Empty read', () => {
    it('returns undefined when reading from an empty buffer', () => {
      const buf = createRingBuffer<number>(4);

      expect(buf.read()).toBeUndefined();
    });
  });

  describe('Peek', () => {
    it('returns the head item without consuming it', () => {
      const buf = createRingBuffer<number>(4);

      buf.write(1);
      buf.write(2);

      expect(buf.peek()).toBe(1);
      expect(buf.size).toBe(2);

      // Peek again — same item, still not consumed
      expect(buf.peek()).toBe(1);
      expect(buf.size).toBe(2);

      // Read actually consumes
      expect(buf.read()).toBe(1);
      expect(buf.peek()).toBe(2);
      expect(buf.size).toBe(1);
    });

    it('returns undefined when peeking an empty buffer', () => {
      const buf = createRingBuffer<number>(4);

      expect(buf.peek()).toBeUndefined();
    });
  });

  describe('Wraparound', () => {
    it('correctly handles circular indexing after fill-read-fill', () => {
      const buf = createRingBuffer<number>(4);

      // Fill to capacity
      buf.write(1);
      buf.write(2);
      buf.write(3);
      buf.write(4);
      expect(buf.isFull()).toBe(true);

      // Drain completely
      expect(buf.read()).toBe(1);
      expect(buf.read()).toBe(2);
      expect(buf.read()).toBe(3);
      expect(buf.read()).toBe(4);
      expect(buf.isEmpty()).toBe(true);

      // Fill again — head and tail have wrapped
      buf.write(5);
      buf.write(6);
      buf.write(7);
      buf.write(8);
      expect(buf.isFull()).toBe(true);

      // Read in FIFO order
      expect(buf.read()).toBe(5);
      expect(buf.read()).toBe(6);
      expect(buf.read()).toBe(7);
      expect(buf.read()).toBe(8);
      expect(buf.isEmpty()).toBe(true);
    });

    it('handles partial read then refill across the wrap boundary', () => {
      const buf = createRingBuffer<string>(3);

      // Write 3 items → full
      buf.write('a');
      buf.write('b');
      buf.write('c');

      // Read 2 → head moves to index 2
      expect(buf.read()).toBe('a');
      expect(buf.read()).toBe('b');

      // Write 2 more → tail wraps around
      buf.write('d');
      buf.write('e');
      expect(buf.isFull()).toBe(true);

      // Read all 3 — should be c, d, e in FIFO order
      expect(buf.read()).toBe('c');
      expect(buf.read()).toBe('d');
      expect(buf.read()).toBe('e');
      expect(buf.isEmpty()).toBe(true);
    });
  });

  describe('Clear', () => {
    it('resets the buffer to empty state', () => {
      const buf = createRingBuffer<number>(4);

      buf.write(1);
      buf.write(2);
      buf.write(3);

      expect(buf.size).toBe(3);
      expect(buf.isEmpty()).toBe(false);

      buf.clear();

      expect(buf.isEmpty()).toBe(true);
      expect(buf.size).toBe(0);
      expect(buf.read()).toBeUndefined();
      expect(buf.peek()).toBeUndefined();
      expect(buf.isFull()).toBe(false);

      // Can write again after clear
      expect(buf.write(10)).toBe(true);
      expect(buf.read()).toBe(10);
    });
  });

  describe('Utilization', () => {
    it('reports 0.5 when half full', () => {
      const buf = createRingBuffer<number>(4);

      buf.write(1);
      buf.write(2);

      expect(buf.utilization()).toBe(0.5);
    });

    it('reports 0 when empty', () => {
      const buf = createRingBuffer<number>(4);

      expect(buf.utilization()).toBe(0);
    });

    it('reports 1 when full', () => {
      const buf = createRingBuffer<number>(4);

      buf.write(1);
      buf.write(2);
      buf.write(3);
      buf.write(4);

      expect(buf.utilization()).toBe(1);
    });

    it('reports 0.25 with 1 of 4 slots used', () => {
      const buf = createRingBuffer<number>(4);

      buf.write(42);

      expect(buf.utilization()).toBe(0.25);
    });
  });

  describe('Capacity 1', () => {
    it('works correctly with a single-element buffer', () => {
      const buf = createRingBuffer<string>(1);

      expect(buf.capacity).toBe(1);
      expect(buf.isEmpty()).toBe(true);
      expect(buf.isFull()).toBe(false);

      // Write one item — immediately full
      expect(buf.write('only')).toBe(true);
      expect(buf.isFull()).toBe(true);
      expect(buf.isEmpty()).toBe(false);
      expect(buf.size).toBe(1);
      expect(buf.utilization()).toBe(1);

      // Cannot write when full
      expect(buf.write('nope')).toBe(false);

      // Peek and read
      expect(buf.peek()).toBe('only');
      expect(buf.read()).toBe('only');
      expect(buf.isEmpty()).toBe(true);
      expect(buf.size).toBe(0);

      // Write again after drain
      expect(buf.write('again')).toBe(true);
      expect(buf.read()).toBe('again');
    });
  });

  describe('Invalid capacity', () => {
    it('throws RangeError for zero capacity', () => {
      expect(() => createRingBuffer(0)).toThrow(RangeError);
    });

    it('throws RangeError for negative capacity', () => {
      expect(() => createRingBuffer(-1)).toThrow(RangeError);
    });

    it('throws RangeError for non-integer capacity', () => {
      expect(() => createRingBuffer(2.5)).toThrow(RangeError);
    });
  });
});
