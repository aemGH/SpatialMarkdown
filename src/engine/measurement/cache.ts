/**
 * LRU cache for Pretext PreparedText handles.
 *
 * Key: `${text}\x00${font}\x00${whiteSpace}` — uses null byte separators
 * that cannot appear in text or font strings.
 *
 * Implementation: Map + intrusive doubly-linked list for O(1) LRU eviction.
 * `prepare()` is 1–5ms; `layout()` is ~0.0002ms. Caching PreparedText
 * handles is the single most impactful optimisation in the engine.
 *
 * @module @spatial/engine/measurement/cache
 */

import type { PreparedTextWithSegments as PreparedText } from '@chenglou/pretext';
import type { FontDescriptor } from '../../types/primitives';

// ─── LRU Linked-List Node ────────────────────────────────────────────

interface LRUNode {
  readonly key: string;
  value: PreparedText;
  prev: LRUNode | null;
  next: LRUNode | null;
}

// ─── Cache Stats ─────────────────────────────────────────────────────

export interface CacheStats {
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRatio: number;
}

// ─── Public Interface ────────────────────────────────────────────────

export interface MeasurementCache {
  /** Retrieve a cached PreparedText handle, promoting it to MRU on hit. */
  readonly get: (
    text: string,
    font: FontDescriptor,
    whiteSpace?: 'normal' | 'pre-wrap',
  ) => PreparedText | undefined;

  /** Store a PreparedText handle, evicting the LRU entry if at capacity. */
  readonly set: (
    text: string,
    font: FontDescriptor,
    prepared: PreparedText,
    whiteSpace?: 'normal' | 'pre-wrap',
  ) => void;

  /** Remove a specific entry by text + font (all whiteSpace variants). */
  readonly invalidate: (text: string, font: FontDescriptor) => void;

  /** Drop every entry (e.g., after font loading completes). */
  readonly invalidateAll: () => void;

  /** Read-only performance counters. */
  readonly stats: () => CacheStats;
}

// ─── Cache Key ───────────────────────────────────────────────────────

function makeCacheKey(
  text: string,
  font: FontDescriptor,
  whiteSpace: 'normal' | 'pre-wrap',
): string {
  return `${text}\x00${font}\x00${whiteSpace}`;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createMeasurementCache(maxSize: number): MeasurementCache {
  if (maxSize < 1) {
    throw new RangeError(`MeasurementCache maxSize must be >= 1, got ${String(maxSize)}`);
  }

  // Map for O(1) key lookup → LRU node
  const map = new Map<string, LRUNode>();

  // Sentinel head/tail simplify edge-case handling in the linked list.
  // Sentinels never enter the map — they exist only to eliminate null
  // checks in the linked-list splice operations.
  //
  // We need to create sentinel nodes without real PreparedText values.
  // These are internal-only and never returned via `get()`.
  const head = createSentinel();
  const tail = createSentinel();
  head.next = tail;
  tail.prev = head;

  let hits = 0;
  let misses = 0;

  // ── Linked-list helpers (all O(1)) ──────────────────────────────

  function removeNode(node: LRUNode): void {
    const prev = node.prev;
    const next = node.next;
    if (prev !== null) prev.next = next;
    if (next !== null) next.prev = prev;
    node.prev = null;
    node.next = null;
  }

  /** Insert immediately before `tail` (= most recently used position). */
  function insertBeforeTail(node: LRUNode): void {
    const prev = tail.prev;
    if (prev !== null) {
      prev.next = node;
    }
    node.prev = prev;
    node.next = tail;
    tail.prev = node;
  }

  /** Promote an existing node to MRU. */
  function moveToMRU(node: LRUNode): void {
    removeNode(node);
    insertBeforeTail(node);
  }

  /** Evict the least recently used entry (node right after `head`). */
  function evictLRU(): void {
    const lru = head.next;
    if (lru === null || lru === tail) return;
    removeNode(lru);
    map.delete(lru.key);
  }

  // ── Public API ──────────────────────────────────────────────────

  function get(
    text: string,
    font: FontDescriptor,
    whiteSpace: 'normal' | 'pre-wrap' = 'normal',
  ): PreparedText | undefined {
    const key = makeCacheKey(text, font, whiteSpace);
    const node = map.get(key);
    if (node === undefined) {
      misses++;
      return undefined;
    }
    hits++;
    moveToMRU(node);
    return node.value;
  }

  function set(
    text: string,
    font: FontDescriptor,
    prepared: PreparedText,
    whiteSpace: 'normal' | 'pre-wrap' = 'normal',
  ): void {
    const key = makeCacheKey(text, font, whiteSpace);

    // Update existing entry in-place (promotes to MRU).
    const existing = map.get(key);
    if (existing !== undefined) {
      existing.value = prepared;
      moveToMRU(existing);
      return;
    }

    // Evict before inserting to stay within capacity.
    if (map.size >= maxSize) {
      evictLRU();
    }

    const node: LRUNode = { key, value: prepared, prev: null, next: null };
    insertBeforeTail(node);
    map.set(key, node);
  }

  function invalidate(text: string, font: FontDescriptor): void {
    // Remove both whiteSpace variants.
    const variants: ReadonlyArray<'normal' | 'pre-wrap'> = ['normal', 'pre-wrap'];
    for (const ws of variants) {
      const key = makeCacheKey(text, font, ws);
      const node = map.get(key);
      if (node !== undefined) {
        removeNode(node);
        map.delete(key);
      }
    }
  }

  function invalidateAll(): void {
    map.clear();
    // Reset the sentinel linked list.
    head.next = tail;
    tail.prev = head;
    // Intentionally preserve hit/miss counters for observability.
  }

  function stats(): CacheStats {
    const total = hits + misses;
    return {
      size: map.size,
      hits,
      misses,
      hitRatio: total === 0 ? 0 : hits / total,
    };
  }

  return { get, set, invalidate, invalidateAll, stats };
}

// ─── Internal Helpers ────────────────────────────────────────────────

/**
 * Create a sentinel node for the doubly-linked list.
 * Sentinels are never exposed via the public API and never enter the Map.
 * The `value` field is a placeholder — we cast through `unknown` here
 * because PreparedText's unique symbol brand cannot be constructed
 * outside of pretext. This is the one allowed cast in the module,
 * isolated to internal bookkeeping.
 */
function createSentinel(): LRUNode {
  // Sentinel nodes are purely structural — their value is never read.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const placeholder = null as unknown as PreparedText;
  return { key: '', value: placeholder, prev: null, next: null };
}
