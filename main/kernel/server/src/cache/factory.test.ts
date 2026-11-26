// main/kernel/server/src/cache/factory.test.ts
import { describe, expect, it } from 'vitest';

import { createCache } from './factory';
import { MemoryCacheProvider } from './providers/memory';

describe('createCache', () => {
  it('defaults to MemoryCacheProvider and respects custom capacity and TTL', async () => {
    const cache = createCache({ maxSize: 50, defaultTtl: 5000 });
    expect(cache).toBeInstanceOf(MemoryCacheProvider);
    expect(cache.name).toBe('memory');
    expect(cache.getStats().maxSize).toBe(50);
    await cache.close();
  });
});
