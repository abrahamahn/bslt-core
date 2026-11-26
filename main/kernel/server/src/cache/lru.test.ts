// main/kernel/server/src/cache/lru.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LRUCache } from './lru';

describe('LRUCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects non-positive or non-integer maxSize values', () => {
    expect(() => new LRUCache({ maxSize: 0 })).toThrow(/positive integer/u);
    expect(() => new LRUCache({ maxSize: -5 })).toThrow(/positive integer/u);
    expect(() => new LRUCache({ maxSize: 1.5 })).toThrow(/positive integer/u);
  });

  it('evicts least recently used items, expires stale TTL entries, and reports eviction reasons', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T00:00:00.000Z'));

    const evictions: Array<{ key: string; reason: string }> = [];
    const cache = new LRUCache<string, number>({
      maxSize: 2,
      onEvict: (key, _value, reason) => {
        evictions.push({ key, reason });
      },
    });

    cache.set('a', 1);
    cache.set('b', 2);
    // Access 'a' so 'b' becomes LRU
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);

    expect(cache.has('b')).toBe(false);
    expect(evictions).toContainEqual({ key: 'b', reason: 'lru' });
    expect([...cache]).toEqual([
      ['c', 3],
      ['a', 1],
    ]);

    // TTL expiration
    cache.set('a', 10, 100);
    vi.advanceTimersByTime(150);
    expect(cache.get('a')).toBeUndefined();
    expect(evictions).toContainEqual({ key: 'a', reason: 'expired' });

    // Manual delete & clear
    expect(cache.delete('missing')).toBe(false);
    expect(cache.delete('c')).toBe(true);
    cache.set('d', 4);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(evictions).toContainEqual({ key: 'd', reason: 'clear' });
  });
});
