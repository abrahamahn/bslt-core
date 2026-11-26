// main/kernel/server/src/cache/providers/memory.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryCacheProvider } from './memory';

describe('MemoryCacheProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports prefixed get/set/delete, tag invalidation, memory limits, bulk ops, and stats', async () => {
    const provider = new MemoryCacheProvider({
      provider: 'memory',
      maxSize: 10,
      defaultTtl: 0,
      cleanupInterval: 0,
      keyPrefix: 'app',
      trackMemoryUsage: true,
      maxMemoryBytes: 120,
    });

    expect(await provider.healthCheck()).toBe(true);
    expect(await provider.get('missing')).toBeUndefined();

    // Oversized entry is safely skipped
    await provider.set('huge', 'x'.repeat(200));
    expect(await provider.has('huge')).toBe(false);

    await provider.set('u1', { ok: true }, { tags: ['users'] });
    await provider.set('u2', { ok: false }, { tags: ['users'] });
    expect(await provider.get<{ ok: boolean }>('u1')).toEqual({ ok: true });

    const multi = await provider.getMultiple<{ ok: boolean }>(['u1', 'missing']);
    expect(multi.size).toBe(1);

    // Delete by tag clears all tagged keys
    expect(await provider.delete('users', { byTag: true })).toBe(true);
    expect(await provider.delete('nonexistent-tag', { byTag: true })).toBe(false);
    expect(await provider.has('u1')).toBe(false);
    expect(await provider.has('u2')).toBe(false);

    await provider.setMultiple(
      new Map([
        ['k1', 1],
        ['k2', 2],
      ]),
    );
    expect(await provider.deleteMultiple(['k1', 'k3'])).toBe(1);
    expect(provider.getStats().hits).toBeGreaterThan(0);

    provider.resetStats();
    expect(provider.getStats().hits).toBe(0);

    await provider.clear();
    await provider.close();
  });
});
