// main/kernel/server/src/cache/types.ts
/**
 * Cache Package Types
 *
 * Re-exports shared cache types and defines engine-specific types
 * for provider configuration, eviction, memoization, and logging.
 */

export interface CacheGetOptions {
  updateAccessTime?: boolean;
}

export interface CacheSetOptions {
  ttl?: number;
  tags?: string[];
  updateTtlOnExisting?: boolean;
}

export interface CacheDeleteOptions {
  byTag?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  sets: number;
  deletes: number;
  evictions: number;
  memoryUsage?: number;
  maxSize?: number;
}

export interface CacheProvider {
  readonly name: string;
  get<T>(key: string, options?: CacheGetOptions): Promise<T | undefined>;
  set(key: string, value: unknown, options?: CacheSetOptions): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string, options?: CacheDeleteOptions): Promise<boolean>;
  getMultiple<T>(keys: string[], options?: CacheGetOptions): Promise<Map<string, T>>;
  setMultiple<T>(entries: Map<string, T>, options?: CacheSetOptions): Promise<void>;
  deleteMultiple(keys: string[]): Promise<number>;
  clear(): Promise<void>;
  getStats(): CacheStats;
  resetStats(): void;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

interface BaseCacheConfig {
  defaultTtl?: number;
  maxSize?: number;
  trackMemoryUsage?: boolean;
  keyPrefix?: string;
}

export interface MemoryCacheConfig extends BaseCacheConfig {
  provider: 'memory';
  cleanupInterval?: number;
  maxMemoryBytes?: number;
}

export interface RedisCacheConfig extends BaseCacheConfig {
  provider: 'redis';
  host: string;
  port: number;
  password?: string;
  db?: number;
  tls?: boolean;
  connectTimeout?: number;
  commandTimeout?: number;
}

export type CacheConfig = MemoryCacheConfig | RedisCacheConfig;

// ============================================================================
// Backend-Core-Specific Types
// ============================================================================

/**
 * Minimal logger interface for cache operations.
 * Compatible with most logging libraries.
 */
export interface CacheLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for creating a cache provider.
 */
export interface CreateCacheOptions {
  /** Logger instance for cache operations */
  logger?: CacheLogger;
  /** Callback when cache entries are evicted */
  onEviction?: (key: string, reason: CacheEvictionReason) => void;
}

/**
 * Eviction reason for cache provider (includes memory_limit).
 */
export type CacheEvictionReason = 'expired' | 'lru' | 'manual' | 'memory_limit' | 'clear';
