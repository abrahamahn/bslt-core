// main/shared/src/modules/system/config/env.redis.ts
/**
 * Redis Environment Configuration
 *
 * Shared Redis connection vars used by both cache and queue providers.
 *
 * @module config/env.redis
 */

import {
  coerceNumber,
  createSchema,
  parseObject,
  parseOptional,
  parseString,
  withDefault,
} from '../../../schema';

import type { Schema } from '../../../schema';

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

export const RedisEnvSchema: Schema<RedisEnv> = createSchema<RedisEnv>((data: unknown) => {
  const obj = parseObject(data, 'RedisEnv');
  return {
    REDIS_HOST: parseString(withDefault(obj['REDIS_HOST'], 'localhost'), 'REDIS_HOST'),
    REDIS_PORT: coerceNumber(withDefault(obj['REDIS_PORT'], 6379), 'REDIS_PORT'),
    REDIS_PASSWORD: parseOptional(obj['REDIS_PASSWORD'], (v: unknown) =>
      parseString(v, 'REDIS_PASSWORD'),
    ),
    REDIS_DB: parseOptional(obj['REDIS_DB'], (v: unknown) => coerceNumber(v, 'REDIS_DB')),
  };
});
