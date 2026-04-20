/**
 * Unit tests for FrameScheduler — coalesces layout updates per frame.
 *
 * @module tests/unit/scheduler
 */

import { createFrameScheduler } from '../../src/scheduler';

describe('FrameScheduler', () => {
  describe('flush() executes pending callback', () => {
    it('calls the scheduled callback synchronously on flush', () => {
      const scheduler = createFrameScheduler();
      const fn = vi.fn();

      scheduler.scheduleUpdate(fn);
      scheduler.flush();

      expect(fn).toHaveBeenCalledTimes(1);

      scheduler.destroy();
    });
  });

  describe('Latest callback wins', () => {
    it('only executes the most recent callback, discarding earlier ones', () => {
      const scheduler = createFrameScheduler();
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      scheduler.scheduleUpdate(fn1);
      scheduler.scheduleUpdate(fn2);
      scheduler.flush();

      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledTimes(1);

      scheduler.destroy();
    });

    it('replaces callback even with many successive scheduleUpdate calls', () => {
      const scheduler = createFrameScheduler();
      const calls: number[] = [];

      scheduler.scheduleUpdate(() => calls.push(1));
      scheduler.scheduleUpdate(() => calls.push(2));
      scheduler.scheduleUpdate(() => calls.push(3));
      scheduler.scheduleUpdate(() => calls.push(4));
      scheduler.flush();

      expect(calls).toEqual([4]);

      scheduler.destroy();
    });
  });

  describe('Flush no-op when no pending', () => {
    it('does not throw when flushing with nothing pending', () => {
      const scheduler = createFrameScheduler();

      expect(() => scheduler.flush()).not.toThrow();

      scheduler.destroy();
    });
  });

  describe('Destroy prevents future updates', () => {
    it('ignores scheduleUpdate after destroy', () => {
      const scheduler = createFrameScheduler();
      const fn = vi.fn();

      scheduler.destroy();
      scheduler.scheduleUpdate(fn);
      scheduler.flush();

      expect(fn).not.toHaveBeenCalled();
    });

    it('discards a pending callback when destroyed before flush', () => {
      const scheduler = createFrameScheduler();
      const fn = vi.fn();

      scheduler.scheduleUpdate(fn);
      scheduler.destroy();
      scheduler.flush();

      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('Double flush', () => {
    it('second flush is a no-op after the callback has already been executed', () => {
      const scheduler = createFrameScheduler();
      const fn = vi.fn();

      scheduler.scheduleUpdate(fn);
      scheduler.flush();
      scheduler.flush();

      expect(fn).toHaveBeenCalledTimes(1);

      scheduler.destroy();
    });
  });

  describe('Re-scheduling after flush', () => {
    it('allows a new callback to be scheduled and flushed after a prior flush', () => {
      const scheduler = createFrameScheduler();
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      scheduler.scheduleUpdate(fn1);
      scheduler.flush();
      expect(fn1).toHaveBeenCalledTimes(1);

      scheduler.scheduleUpdate(fn2);
      scheduler.flush();
      expect(fn2).toHaveBeenCalledTimes(1);

      // fn1 was not called again
      expect(fn1).toHaveBeenCalledTimes(1);

      scheduler.destroy();
    });
  });
});
