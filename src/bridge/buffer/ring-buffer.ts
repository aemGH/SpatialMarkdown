/**
 * Generic fixed-size ring buffer.
 *
 * Array-backed circular buffer with head/tail pointers.
 * O(1) read, write, peek, and utilization queries.
 *
 * Used by the bridge layer to buffer incoming StreamTokens
 * between the network transport and the layout engine.
 *
 * @module @spatial/bridge/buffer/ring-buffer
 */

// ─── Public Interface ────────────────────────────────────────────────

export interface RingBuffer<T> {
  /**
   * Write an item to the tail of the buffer.
   * Returns `true` if the item was written, `false` if the buffer is full.
   */
  readonly write: (item: T) => boolean;

  /**
   * Read and remove the item at the head of the buffer.
   * Returns `undefined` if the buffer is empty.
   */
  readonly read: () => T | undefined;

  /**
   * Peek at the item at the head without removing it.
   * Returns `undefined` if the buffer is empty.
   */
  readonly peek: () => T | undefined;

  /** Number of items currently in the buffer. */
  readonly size: number;

  /** Maximum number of items the buffer can hold. */
  readonly capacity: number;

  /** True when the buffer has reached its capacity. */
  readonly isFull: () => boolean;

  /** True when the buffer contains zero items. */
  readonly isEmpty: () => boolean;

  /** Remove all items from the buffer. */
  readonly clear: () => void;

  /**
   * Buffer utilization as a ratio from 0.0 (empty) to 1.0 (full).
   * Used by the backpressure controller to decide when to pause/resume.
   */
  readonly utilization: () => number;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createRingBuffer<T>(capacity: number): RingBuffer<T> {
  if (capacity < 1 || !Number.isInteger(capacity)) {
    throw new RangeError(
      `RingBuffer capacity must be a positive integer, got ${String(capacity)}`,
    );
  }

  // Pre-allocate a fixed-length array. Slots are typed as T | undefined
  // internally but we only expose T through the public API after
  // checking emptiness.
  const slots: Array<T | undefined> = new Array<T | undefined>(capacity).fill(undefined);

  let head = 0;   // Index of the next item to read
  let tail = 0;   // Index of the next slot to write
  let count = 0;  // Current number of items

  function write(item: T): boolean {
    if (count === capacity) {
      return false;
    }
    slots[tail] = item;
    tail = (tail + 1) % capacity;
    count++;
    return true;
  }

  function read(): T | undefined {
    if (count === 0) {
      return undefined;
    }
    const item = slots[head];
    slots[head] = undefined; // Release reference for GC
    head = (head + 1) % capacity;
    count--;
    return item;
  }

  function peek(): T | undefined {
    if (count === 0) {
      return undefined;
    }
    return slots[head];
  }

  function isFull(): boolean {
    return count === capacity;
  }

  function isEmpty(): boolean {
    return count === 0;
  }

  function clear(): void {
    // Release all references for GC
    for (let i = 0; i < capacity; i++) {
      slots[i] = undefined;
    }
    head = 0;
    tail = 0;
    count = 0;
  }

  function utilization(): number {
    return count / capacity;
  }

  const buffer: RingBuffer<T> = {
    write,
    read,
    peek,
    get size(): number {
      return count;
    },
    get capacity(): number {
      return capacity;
    },
    isFull,
    isEmpty,
    clear,
    utilization,
  };

  return buffer;
}
