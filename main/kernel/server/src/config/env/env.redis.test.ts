// main/kernel/server/src/config/env/env.redis.test.ts
import { describe, expect, it } from 'vitest';

import { RedisEnvSchema } from './env.redis';

describe('RedisEnvSchema', () => {
  it('applies localhost:6379 defaults and strips unknown keys', () => {
    expect(RedisEnvSchema.parse({ EXTRA: '1' })).toEqual({
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
    });
  });

  it('rejects non-numeric REDIS_PORT and REDIS_DB values', () => {
    expect(RedisEnvSchema.safeParse({ REDIS_PORT: 'bad' }).success).toBe(false);
    expect(RedisEnvSchema.safeParse({ REDIS_DB: 'bad' }).success).toBe(false);
  });
});
