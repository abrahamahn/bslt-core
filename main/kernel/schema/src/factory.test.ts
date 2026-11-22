// main/kernel/schema/src/factory.test.ts
import { describe, expect, it } from 'vitest';

import { createSchema } from './factory';

describe('createSchema + Standard Schema v1 (~standard)', () => {
  const positiveIntSchema = createSchema<number>((data: unknown) => {
    if (typeof data !== 'number' || !Number.isInteger(data) || data <= 0) {
      throw new Error('Must be a positive integer');
    }
    return data;
  });

  describe('valid inputs', () => {
    it('parses valid values and returns typed output', () => {
      expect(positiveIntSchema.parse(42)).toBe(42);
    });

    it('safeParse returns { success: true, data } for valid values', () => {
      expect(positiveIntSchema.safeParse(1)).toEqual({ success: true, data: 1 });
    });

    it('exposes Standard Schema v1 metadata and returns { value } on valid input', () => {
      expect(positiveIntSchema['~standard'].version).toBe(1);
      expect(positiveIntSchema['~standard'].vendor).toBe('bslt');
      const result = positiveIntSchema['~standard'].validate(7);
      expect(result).toEqual({ value: 7 });
      expect(result.issues).toBeUndefined();
    });
  });

  describe('failure states (adversarial)', () => {
    it('throws Error from parse on zero', () => {
      expect(() => positiveIntSchema.parse(0)).toThrow('Must be a positive integer');
    });

    it('throws Error from parse on negative integer', () => {
      expect(() => positiveIntSchema.parse(-5)).toThrow('Must be a positive integer');
    });

    it('throws Error from parse on float', () => {
      expect(() => positiveIntSchema.parse(1.5)).toThrow('Must be a positive integer');
    });

    it('throws Error from parse on NaN and Infinity', () => {
      expect(() => positiveIntSchema.parse(Number.NaN)).toThrow('Must be a positive integer');
      expect(() => positiveIntSchema.parse(Number.POSITIVE_INFINITY)).toThrow(
        'Must be a positive integer',
      );
    });

    it('safeParse wraps non-Error throws into Error instances without throwing', () => {
      const nonErrorSchema = createSchema<string>(() => {
        throw 'string-failure';
      });
      const res = nonErrorSchema.safeParse('anything');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBeInstanceOf(Error);
        expect(res.error.message).toBe('string-failure');
      }
    });

    it('~standard.validate returns issues array and never throws on invalid inputs', () => {
      for (const bad of [null, undefined, 0, -1, '42', {}, [], Number.NaN]) {
        const res = positiveIntSchema['~standard'].validate(bad);
        expect('issues' in res && res.issues !== undefined).toBe(true);
        if (res.issues !== undefined) {
          expect(res.issues.length).toBeGreaterThanOrEqual(1);
          expect(res.issues[0]?.message).toBe('Must be a positive integer');
        }
      }
    });

    it('~standard.validate converts non-Error thrown primitives into an issue message', () => {
      const nonErrorSchema = createSchema<string>(() => {
        throw 404;
      });
      const res = nonErrorSchema['~standard'].validate('x');
      expect(res).toEqual({ issues: [{ message: '404' }] });
    });
  });
});
