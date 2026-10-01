// main/shared/src/modules/system/cache/cache-aside.ts

import type { CacheProvider } from './types';

/**
 * Cache-aside pattern implementation.
 * Attempts to get value from cache; if missing, calls loader and caches the result.
 *
 * @param cache - The cache provider to use
 * @param key - Cache key
 * @param loader - Async function to fetch the data if not in cache
 * @param options - TTL and tags for the cache entry
 * @returns The data from cache or loader
 */
export async function cacheAside<T>(
  cache: CacheProvider,
  key: string,
  loader: () => Promise<T>,
  options?: { ttl?: number; tags?: string[] },
): Promise<T> {
  const cached = await cache.get<T>(key);
  if (cached !== undefined) return cached;
  const value = await loader();
  const setOpts: { ttl?: number; tags?: string[] } = {};
  if (options?.ttl !== undefined) setOpts.ttl = options.ttl;
  if (options?.tags !== undefined) setOpts.tags = options.tags;
  await cache.set(key, value, setOpts);
  return value;
}
