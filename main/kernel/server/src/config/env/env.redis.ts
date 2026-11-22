// main/kernel/server/src/config/env/env.redis.ts
/**
 * Redis Environment Configuration
 *
 * Shared Redis connection vars used by both cache and queue providers.
 *
 * @module config/env.redis
 */

import { defaulted, number, object, optional, string } from '@bslt/schema';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Env Interface
// ============================================================================

/** Redis connection environment variables. Shared by cache and queue. */
export interface RedisEnv {
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string | undefined;
  REDIS_DB?: number | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const RedisEnvSchema: Schema<RedisEnv> = object(
  {
    REDIS_HOST: defaulted(string({ label: 'REDIS_HOST' }), 'localhost'),
    REDIS_PORT: defaulted(number({ coerce: true, label: 'REDIS_PORT' }), 6379),
    REDIS_PASSWORD: optional(string({ label: 'REDIS_PASSWORD' })),
    REDIS_DB: optional(number({ coerce: true, label: 'REDIS_DB' })),
  },
  { unknownKeys: 'strip' },
);
