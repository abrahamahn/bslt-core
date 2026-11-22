// main/kernel/server/src/config/env/env.base.test.ts
import { describe, expect, it } from 'vitest';

import { BaseEnvSchema } from './env.base';

describe('BaseEnvSchema', () => {
  it('applies default NODE_ENV of development', () => {
    const result = BaseEnvSchema.parse({});
    expect(result.NODE_ENV).toBe('development');
  });

  it('accepts valid NODE_ENV values', () => {
    expect(BaseEnvSchema.parse({ NODE_ENV: 'production' }).NODE_ENV).toBe('production');
    expect(BaseEnvSchema.parse({ NODE_ENV: 'test' }).NODE_ENV).toBe('test');
    expect(BaseEnvSchema.parse({ NODE_ENV: 'development' }).NODE_ENV).toBe('development');
  });

  it('rejects invalid NODE_ENV values', () => {
    expect(() => BaseEnvSchema.parse({ NODE_ENV: 'staging' })).toThrow();
  });

  it('defaults PORT to 8080', () => {
    const result = BaseEnvSchema.parse({});
    expect(result.PORT).toBe(8080);
  });

  it('accepts a custom PORT', () => {
    const result = BaseEnvSchema.parse({ PORT: '3000' });
    expect(result.PORT).toBe(3000);
  });

  it('accepts a configurable application name', () => {
    const result = BaseEnvSchema.parse({ APP_NAME: 'Acme Cloud' });
    expect(result.APP_NAME).toBe('Acme Cloud');
  });

  it('rejects a non-string application name', () => {
    expect(() => BaseEnvSchema.parse({ APP_NAME: 42 })).toThrow();
  });
});
