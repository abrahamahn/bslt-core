// main/kernel/server/src/cache/index.ts
/**
 * @bslt/server-system
 *
 * Cache layer with LRU and memory provider.
 *
 * Key features:
 * - O(1) LRU cache operations
 * - Tag-based cache invalidation
 * - Optional memory tracking
 *
 * @example
 * ```ts
 * import { createMemoryCache } from '@bslt/server-system';
 *
 * const cache = createMemoryCache({ maxSize: 1000 });
 * ```
 */

// ============================================================================
// Core LRU Cache (backend-specific doubly-linked-list implementation)
// ============================================================================

export { LRUCache } from './lru';

// ============================================================================
// Providers
// ============================================================================

export { createRedisProvider, MemoryCacheProvider, RedisCacheProvider } from './providers';

// ============================================================================
// Factory
// ============================================================================

export { createCache } from './factory';

// ============================================================================
// Configuration
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export type {
  CacheConfig,
  CacheDeleteOptions,
  CacheGetOptions,
  CacheProvider,
  CacheSetOptions,
  CacheStats,
  MemoryCacheConfig,
  RedisCacheConfig,
} from './types';

// Cache-specific types
export type { CacheEvictionReason, CacheLogger, CreateCacheOptions } from './types';
