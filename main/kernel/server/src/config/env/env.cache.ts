// main/kernel/server/src/config/env/env.cache.ts
/**
 * Cache Environment Configuration
 *
 * Cache types, env interface, and validation schema.
 * Merged from config/types/infra.ts (cache section) and config/env.ts.
 *
 * @module config/env.cache
 */

import { defaulted, enumOf, number, object, optional } from '@bslt/schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Application cache configuration.
 * Supports in-memory caching with optional Redis backend for scaling.
 */
export interface CacheConfig {
  ttl: number;
  maxSize: number;
  useExternalProvider: boolean;
  externalConfig?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    tls?: boolean;
  };
}

// ============================================================================
// Env Interface
// ============================================================================

/** Cache environment variables */
export interface CacheEnv {
  CACHE_PROVIDER?: 'local' | 'redis' | undefined;
  CACHE_TTL_MS: number;
  CACHE_MAX_SIZE: number;
  CACHE_USE_REDIS?: 'true' | 'false' | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const CacheEnvSchema: Schema<CacheEnv> = object(
  {
    CACHE_PROVIDER: optional(enumOf(['local', 'redis'] as const, 'CACHE_PROVIDER')),
    CACHE_TTL_MS: defaulted(number({ coerce: true, label: 'CACHE_TTL_MS' }), 300000),
    CACHE_MAX_SIZE: defaulted(number({ coerce: true, label: 'CACHE_MAX_SIZE' }), 1000),
    CACHE_USE_REDIS: optional(trueFalseSchema),
  },
  { unknownKeys: 'strip' },
);
