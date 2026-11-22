// main/kernel/server/src/config/env/env.helpers.test.ts
import { describe, expect, it } from 'vitest';

import { getRawEnv } from './env.helpers';

describe('getRawEnv', () => {
  it('returns an empty map when override is omitted and preserves explicit overrides', () => {
    expect(getRawEnv()).toEqual({});
    expect(getRawEnv({ PORT: '8080' })).toEqual({ PORT: '8080' });
  });
});
