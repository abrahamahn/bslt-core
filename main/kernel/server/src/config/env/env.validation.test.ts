// main/kernel/server/src/config/env/env.validation.test.ts
import { createSchema, parseString } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import { getRawEnv } from './env.helpers';
import { validateEnv } from './env.validation';

describe('env.validation', () => {
  describe('getRawEnv', () => {
    it('returns empty object when override is omitted', () => {
      const result = getRawEnv();
      expect(typeof result).toBe('object');
      expect(result).toEqual({});
    });

    it('returns provided env override', () => {
      const override = { NODE_ENV: 'test', JWT_SECRET: 'test-secret' };
      const result = getRawEnv(override);
      expect(result).toEqual(override);
    });
  });

  describe('validateEnv', () => {
    it('throws Error for invalid env', () => {
      const schema = createSchema((data: unknown) => {
        const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<
          string,
          unknown
        >;
        return { REQUIRED_VAR: parseString(obj['REQUIRED_VAR'], 'REQUIRED_VAR', { min: 1 }) };
      });

      expect(() => validateEnv(schema, {})).toThrow(Error);
      expect(() => validateEnv(schema, {})).toThrow('Environment validation failed');
    });

    it('returns validated env for valid input', () => {
      const schema = createSchema((data: unknown) => {
        const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<
          string,
          unknown
        >;
        const nodeEnv = obj['NODE_ENV'];
        return { NODE_ENV: typeof nodeEnv === 'string' ? nodeEnv : 'test' };
      });

      const result = validateEnv(schema, { NODE_ENV: 'test' }) as { NODE_ENV: string };
      expect(result.NODE_ENV).toBeDefined();
    });
  });
});
