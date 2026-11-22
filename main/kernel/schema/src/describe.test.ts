// main/kernel/schema/src/describe.test.ts
import { describe as suite, expect, it } from 'vitest';

import {
  array,
  bigintString,
  boolean,
  brand,
  discriminated,
  enumOf,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  refine,
  sealed,
  string,
} from './combinators';
import { describe, redactSealed } from './describe';
import { createSchema } from './factory';

suite('describe() schema introspection and redactSealed()', () => {
  it('describes combinator trees deterministically with sorted keys and opaque fallback', () => {
    const complex = object({
      z: optional(nullable(array(enumOf(['a', 'b'] as const), { min: 1 }))),
      a: brand(string({ min: 1, max: 40, format: 'uuid' }), 'ItemId'),
      amount: bigintString({ min: 0n }),
      secret: sealed(string({ min: 8 })),
      meta: record(boolean()),
      choice: unionOrDisc(),
      checked: refine(number({ int: true }), (n) => n % 2 === 0, 'even'),
      legacy: createSchema((x) => x),
    });

    function unionOrDisc() {
      return discriminated('kind', [
        object({ kind: literal('one'), value: number() }),
        object({ kind: literal('two'), flag: boolean() }),
      ]);
    }

    const ast = describe(complex);
    expect(ast.kind).toBe('object');
    if (ast.kind === 'object') {
      expect(Object.keys(ast.properties)).toEqual([
        'a',
        'amount',
        'checked',
        'choice',
        'legacy',
        'meta',
        'secret',
        'z',
      ]);
      expect(ast.required).toEqual([
        'a',
        'amount',
        'checked',
        'choice',
        'legacy',
        'meta',
        'secret',
      ]);
      expect(ast.properties['legacy']).toEqual({ kind: 'opaque' });
      expect(ast.properties['secret']).toEqual({
        kind: 'sealed',
        inner: { kind: 'string', min: 8 },
      });
      expect(ast.properties['amount']).toEqual({ kind: 'bigintString', min: '0' });
    }
    // Identical structural schemas produce identical JSON representations (for sha256 hashing).
    expect(JSON.stringify(ast)).toBe(JSON.stringify(describe(complex)));
  });

  suite('redactSealed() — secret protection & adversarial edge cases', () => {
    const payloadSchema = object({
      userId: string(),
      apiKey: sealed(string()),
      nested: optional(
        object({
          token: nullable(sealed(string())),
        }),
      ),
      items: array(object({ secret: sealed(string()), label: string() })),
    });

    it('replaces all sealed fields with "[REDACTED]" without mutating the original object', () => {
      const original = {
        userId: 'u_1',
        apiKey: 'sk_live_12345',
        nested: { token: 'tok_abc' },
        items: [{ secret: 's1', label: 'first' }],
      };
      const redacted = redactSealed(payloadSchema, original);
      expect(redacted).toEqual({
        userId: 'u_1',
        apiKey: '[REDACTED]',
        nested: { token: '[REDACTED]' },
        items: [{ secret: '[REDACTED]', label: 'first' }],
      });
      expect(original.apiKey).toBe('sk_live_12345');
      expect(original.nested.token).toBe('tok_abc');
    });

    it('preserves null on nullable(sealed(...)) when value is null, and redacts when non-null', () => {
      const withNull = {
        userId: 'u_1',
        apiKey: 'sk_live',
        nested: { token: null },
        items: [],
      };
      expect(redactSealed(payloadSchema, withNull)).toEqual({
        userId: 'u_1',
        apiKey: '[REDACTED]',
        nested: { token: null },
        items: [],
      });
    });

    it('handles malformed/non-matching runtime inputs defensively without throwing or leaking top-level sealed values', () => {
      expect(redactSealed(sealed(string()), 'raw-secret')).toBe('[REDACTED]');
      expect(redactSealed(sealed(string()), { nested: 'raw-secret' })).toBe('[REDACTED]');
      expect(redactSealed(payloadSchema, null)).toBeNull();
      expect(redactSealed(payloadSchema, undefined)).toBeUndefined();
      expect(redactSealed(record(sealed(string())), { a: 's1', b: 's2' })).toEqual({
        a: '[REDACTED]',
        b: '[REDACTED]',
      });
    });
  });
});
