// main/kernel/schema/src/combinators.test.ts
import { describe, expect, it } from 'vitest';

import {
  array,
  bigintString,
  boolean,
  brand,
  defaulted,
  discriminated,
  enumOf,
  json,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  refine,
  sealed,
  string,
  transform,
  union,
  unknown,
  type InferObject,
  type JsonValue,
} from './combinators';
import { describe as describeSchema, redactSealed } from './describe';

import type { Infer, StandardSchemaV1, StringFormat } from './types';

describe('@bslt/schema combinators', () => {
  describe('string, number, boolean, literal, enumOf', () => {
    it('parses valid scalars and applies trim/format normalization', () => {
      const fmt: StringFormat = 'email';
      const emailCombinator: StandardSchemaV1<unknown, string> = string({ format: fmt });
      expect(string({ trim: true, min: 1, max: 10 }).parse('  hello  ')).toBe('hello');
      expect(emailCombinator['~standard'].validate('  Alice@Example.COM ')).toEqual({
        value: 'alice@example.com',
      });
      expect(number({ int: true, min: 0, max: 100 }).parse(42)).toBe(42);
      expect(number({ coerce: true, int: true }).parse('15')).toBe(15);
      expect(boolean().parse(false)).toBe(false);
      expect(boolean({ coerce: true }).parse('true')).toBe(true);
      expect(literal('active').parse('active')).toBe('active');
      expect(enumOf(['todo', 'done'] as const).parse('done')).toBe('done');
    });

    it('rejects wrong types, bounds violations, NaN, Infinity, and empty coercions', () => {
      expect(() => string().parse(123)).toThrow(/must be a string/u);
      expect(() => string({ trim: true, min: 1 }).parse('   ')).toThrow(/at least 1/u);
      expect(() => string({ max: 3 }).parse('abcd')).toThrow(/at most 3/u);
      expect(() => string({ length: 4 }).parse('abc')).toThrow(/exactly 4/u);
      expect(() => string({ pattern: /^[a-z]+$/u }).parse('A1')).toThrow(/invalid format/u);
      expect(() => string({ format: 'uuid' }).parse('not-uuid')).toThrow(/UUID/u);
      expect(() => string({ format: 'url' }).parse('/relative')).toThrow(/URL/u);
      expect(() => string({ format: 'iso-datetime' }).parse('not-a-date')).toThrow(/ISO/u);
      expect(() => string({ format: 'ip' }).parse('999.999.999.999.1')).toThrow(/IP/u);

      expect(() => number().parse('42')).toThrow(/must be a number/u);
      expect(() => number().parse(Number.NaN)).toThrow(/must be a number/u);
      expect(() => number().parse(Number.POSITIVE_INFINITY)).toThrow(/must be a finite number/u);
      expect(() => number({ coerce: true }).parse('')).toThrow(/must be a valid number/u);
      expect(() => number({ coerce: true }).parse('   ')).toThrow(/must be a valid number/u);
      expect(() => number({ coerce: true }).parse(true)).toThrow(/must be a valid number/u);
      expect(() => number({ int: true }).parse(1.25)).toThrow(/integer/u);
      expect(() => number({ min: 5 }).parse(4)).toThrow(/at least 5/u);
      expect(() => number({ max: 5 }).parse(6)).toThrow(/at most 5/u);

      expect(() => boolean().parse('true')).toThrow(/must be a boolean/u);
      expect(() => boolean({ coerce: true }).parse('yes')).toThrow(/must be a boolean/u);
      expect(() => literal(0).parse(-0)).toThrow(/Expected literal/u);
      expect(() => enumOf(['a', 'b'] as const).parse('c')).toThrow(/Expected one of/u);
    });
  });

  describe('object, optional, nullable (strict + prototype-pollution safe)', () => {
    const userPatchSchema = object({
      name: string({ trim: true, min: 1 }),
      bio: optional(nullable(string({ max: 50 }))),
      active: optional(boolean()),
    });
    type UserPatch = Infer<typeof userPatchSchema>;
    type UserPatchShape = InferObject<{
      readonly name: ReturnType<typeof string>;
    }>;

    it('parses valid plain and null-prototype objects and omits undefined optional keys', () => {
      const shapeCheck: UserPatchShape = { name: '  Ada  ' };
      const parsed: UserPatch = userPatchSchema.parse(shapeCheck);
      expect(parsed).toEqual({ name: 'Ada' });
      expect('bio' in parsed).toBe(false);
      expect('active' in parsed).toBe(false);

      const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, {
        name: 'Grace',
        bio: null,
        active: true,
      });
      expect(userPatchSchema.parse(nullProto)).toEqual({
        name: 'Grace',
        bio: null,
        active: true,
      });
    });

    it('rejects non-plain objects (null, arrays, Date, Map, primitives)', () => {
      for (const bad of [null, undefined, [], ['a'], new Date(), new Map(), 'str', 42]) {
        expect(() => userPatchSchema.parse(bad)).toThrow(/must be a plain object/u);
      }
    });

    it('rejects unknown keys strictly', () => {
      expect(() => userPatchSchema.parse({ name: 'Ada', role: 'admin' })).toThrow(
        /Unknown key "role"/u,
      );
    });

    it('rejects own __proto__, constructor, and prototype keys (JSON prototype pollution)', () => {
      const protoPayload: unknown = JSON.parse('{"name":"Ada","__proto__":{"isAdmin":true}}');
      expect(() => userPatchSchema.parse(protoPayload)).toThrow(/Forbidden key "__proto__"/u);
      expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();

      const ctorPayload: unknown = JSON.parse(
        '{"name":"Ada","constructor":{"prototype":{"pwn":1}}}',
      );
      expect(() => userPatchSchema.parse(ctorPayload)).toThrow(/Forbidden key "constructor"/u);

      const prototypePayload: unknown = JSON.parse('{"name":"Ada","prototype":{"pwn":1}}');
      expect(() => userPatchSchema.parse(prototypePayload)).toThrow(/Forbidden key "prototype"/u);
    });

    it('reports structured nested field paths in Standard Schema issues', () => {
      const nested = object({
        profile: object({
          age: number({ int: true, min: 18 }),
        }),
      });
      const res = nested['~standard'].validate({ profile: { age: 12 } });
      expect(res.issues).toBeDefined();
      expect(res.issues?.[0]?.path).toEqual(['profile', 'age']);
    });
  });

  describe('array, record, union, discriminated', () => {
    const eventSchema = discriminated('type', [
      object({ type: literal('created'), id: string({ min: 1 }) }),
      object({ type: literal('deleted'), reason: optional(string()) }),
    ]);

    it('parses valid arrays, records, unions, and discriminated unions', () => {
      expect(array(number({ int: true }), { min: 1, max: 3 }).parse([1, 2])).toEqual([1, 2]);
      expect(record(number()).parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
      expect(union([literal('auto'), number({ int: true, min: 1 })]).parse(10)).toBe(10);
      expect(eventSchema.parse({ type: 'created', id: 'tsk_1' })).toEqual({
        type: 'created',
        id: 'tsk_1',
      });
    });

    it('rejects invalid array bounds and reports element index paths', () => {
      const tags = array(string({ min: 2 }), { min: 1, max: 2 });
      expect(() => tags.parse('not-array')).toThrow(/Expected an array/u);
      expect(() => tags.parse([])).toThrow(/at least 1/u);
      expect(() => tags.parse(['aa', 'bb', 'cc'])).toThrow(/at most 2/u);

      const res = tags['~standard'].validate(['ok', 'x']);
      expect(res.issues?.[0]?.path).toEqual([1]);
    });

    it('rejects __proto__ / constructor / prototype keys in record()', () => {
      const rec = record(number());
      const polluted: unknown = JSON.parse('{"__proto__": 1}');
      expect(() => rec.parse(polluted)).toThrow(/Forbidden key "__proto__"/u);
      expect(() => rec.parse([])).toThrow(/must be a plain object/u);
    });

    it('rejects unknown or missing discriminator values and non-objects in discriminated()', () => {
      expect(() => eventSchema.parse(null)).toThrow(/must be a plain object/u);
      expect(() => eventSchema.parse({})).toThrow(/discriminator "type"/u);
      expect(() => eventSchema.parse({ type: 'updated' })).toThrow(/Invalid "type"/u);
      expect(() => eventSchema.parse({ type: 'created', id: '1', extra: true })).toThrow(
        /Unknown key "extra"/u,
      );
    });

    it('throws at schema construction time when discriminated variants lack unique string literals', () => {
      const dupA = object({ type: literal('same') });
      const dupB = object({ type: literal('same') });
      expect(() => discriminated('type', [dupA, dupB])).toThrow(/Duplicate discriminator/u);
    });
  });

  describe('brand, refine, bigintString, sealed', () => {
    const slugSchema = brand(string({ pattern: /^[a-z0-9-]+$/u }), 'Slug');
    const nonEmptyPatch = refine(
      object({ a: optional(string()), b: optional(number()) }),
      (v) => v.a !== undefined || v.b !== undefined,
      'at least one field is required',
    );

    it('parses valid branded, refined, bigintString, and sealed values', () => {
      const slug = slugSchema.parse('my-post');
      expect(slug).toBe('my-post');
      expect(nonEmptyPatch.parse({ b: 1 })).toEqual({ b: 1 });
      expect(bigintString.parse('0')).toBe('0');
      expect(bigintString.parse('-9007199254740993')).toBe('-9007199254740993');
      expect(bigintString({ min: 0n, max: 1000n }).parse('1000')).toBe('1000');

      const secretSchema = sealed(string({ min: 8 }));
      expect(secretSchema.parse('super-secret')).toBe('super-secret');
    });

    it('rejects non-canonical bigintString inputs and range violations', () => {
      for (const bad of ['', '   ', '+10', '00', '01', '-0', '1.5', '1e5', '10n', 10, 10n, null]) {
        expect(() => bigintString.parse(bad)).toThrow();
      }
      expect(() => bigintString({ nonNegative: true }).parse('-1')).toThrow(/non-negative/u);
      expect(() => bigintString({ min: 10n }).parse('9')).toThrow(/at least 10/u);
      expect(() => bigintString({ max: 10n }).parse('11')).toThrow(/at most 10/u);
    });

    it('rejects values failing refine() or sealed() inner schema', () => {
      expect(() => nonEmptyPatch.parse({})).toThrow('at least one field is required');
      expect(() => slugSchema.parse('Bad Slug')).toThrow();
      expect(() => sealed(string({ min: 8 })).parse('short')).toThrow(/at least 8/u);
    });
  });

  describe('json (recursive JSON values, prototype-pollution safe)', () => {
    const jsonSchema = json();

    it('parses JSON scalars, nested arrays, and plain objects', () => {
      const sample: JsonValue = {
        flag: true,
        count: 0,
        label: 'v1',
        nothing: null,
        items: [1, 'two', false, null, { nested: ['ok'] }],
      };
      expect(jsonSchema.parse(sample)).toEqual(sample);
      expect(jsonSchema.parse(-0)).toBe(0);
    });

    it('rejects non-JSON values, non-finite numbers, prototype-pollution keys, and excessive depth', () => {
      expect(() => jsonSchema.parse(undefined)).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(Number.NaN)).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(Number.POSITIVE_INFINITY)).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(Number.NEGATIVE_INFINITY)).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(10n)).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(() => null)).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(Symbol('x'))).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(new Date())).toThrow(/JSON/u);
      expect(() => jsonSchema.parse(new Map())).toThrow(/JSON/u);
      expect(() => jsonSchema.parse([1, undefined])).toThrow(/JSON/u);

      const poisoned: unknown = JSON.parse('{"nested":[{"__proto__":{"polluted":true}}]}');
      expect(() => jsonSchema.parse(poisoned)).toThrow(/Forbidden key "__proto__"/u);

      const ctorPoisoned: unknown = JSON.parse('{"constructor":{"prototype":{"x":1}}}');
      expect(() => jsonSchema.parse(ctorPoisoned)).toThrow(/Forbidden key "constructor"/u);

      let deep: unknown = 'leaf';
      for (let i = 0; i < 70; i++) {
        deep = { next: deep };
      }
      expect(() => jsonSchema.parse(deep)).toThrow(/depth/iu);
    });
  });

  describe('defaulted, unknown, transform, and object unknownKeys modes', () => {
    it('applies defaulted fallback on undefined while omitting field from required AST and rejecting invalid values', () => {
      const pageQuery = object({
        page: defaulted(number({ coerce: true, int: true, min: 1 }), 1),
        limit: defaulted(number({ coerce: true, int: true, min: 1, max: 100 }), 20),
        q: string({ min: 1 }),
      });

      const parsed: { readonly page: number; readonly limit: number; readonly q: string } =
        pageQuery.parse({ q: 'hello' });
      expect(parsed).toEqual({ page: 1, limit: 20, q: 'hello' });
      expect(describeSchema(pageQuery)).toEqual({
        kind: 'object',
        properties: {
          limit: {
            kind: 'optional',
            inner: { kind: 'number', coerce: true, int: true, min: 1, max: 100 },
          },
          page: {
            kind: 'optional',
            inner: { kind: 'number', coerce: true, int: true, min: 1 },
          },
          q: { kind: 'string', min: 1 },
        },
        required: ['q'],
        additionalProperties: false,
      });

      // Failure assertions (>= 60%): null, zero, negative, non-numeric string, missing required q, unknown key
      expect(() => pageQuery.parse({ q: 'hello', page: null })).toThrow(/number/iu);
      expect(() => pageQuery.parse({ q: 'hello', page: 0 })).toThrow(/at least 1/iu);
      expect(() => pageQuery.parse({ q: 'hello', limit: 101 })).toThrow(/at most 100/iu);
      expect(() => pageQuery.parse({ q: 'hello', limit: 'abc' })).toThrow(/number/iu);
      expect(() => pageQuery.parse({})).toThrow(/must be a string/u);
      expect(pageQuery['~standard'].validate({})).toEqual({
        issues: [{ message: 'Value must be a string', path: ['q'] }],
      });
      expect(() => pageQuery.parse({ q: 'hello', extra: true })).toThrow(/Unknown key "extra"/u);
    });

    it('strips or passes through unknown keys while rejecting prototype-pollution keys and invalid inputs', () => {
      const stripped = object(
        {
          PORT: defaulted(number({ coerce: true, int: true, min: 1 }), 8080),
        },
        { unknownKeys: 'strip' },
      );
      const passthrough = object(
        {
          id: string({ format: 'uuid' }),
          version: number({ int: true, min: 1 }),
        },
        { unknownKeys: 'passthrough' },
      );

      expect(stripped.parse({ PORT: '3000', DATABASE_URL: 'postgres://localhost/db' })).toEqual({
        PORT: 3000,
      });
      expect(
        passthrough.parse({
          id: '550e8400-e29b-41d4-a716-446655440000',
          version: 2,
          title: 'Draft',
        }),
      ).toEqual({
        id: '550e8400-e29b-41d4-a716-446655440000',
        version: 2,
        title: 'Draft',
      });
      expect(describeSchema(stripped)).toMatchObject({
        kind: 'object',
        additionalProperties: true,
      });

      const protoPoison: unknown = JSON.parse('{"PORT":8080,"__proto__":{"x":1}}');
      const ctorPoison: unknown = JSON.parse(
        '{"id":"550e8400-e29b-41d4-a716-446655440000","version":1,"constructor":1}',
      );
      expect(() => stripped.parse(protoPoison)).toThrow(/Forbidden key "__proto__"/u);
      expect(() => passthrough.parse(ctorPoison)).toThrow(/Forbidden key "constructor"/u);
      expect(() => stripped.parse(null)).toThrow(/plain object/iu);
      expect(() => passthrough.parse([])).toThrow(/plain object/iu);
      expect(() => passthrough.parse({ id: 'not-uuid', version: 1, extra: 'ok' })).toThrow(
        /UUID/iu,
      );
    });

    it('supports unknown() and transform() while preserving inner AST and sealed redaction', () => {
      const anyVal = unknown();
      expect(anyVal.parse(undefined)).toBeUndefined();
      expect(anyVal.parse({ nested: [1, 'two'] })).toEqual({ nested: [1, 'two'] });
      expect(describeSchema(anyVal)).toEqual({ kind: 'json' });

      const envTransformed = transform(
        object(
          {
            SECRET: sealed(string({ min: 8 })),
            PUBLIC_URL: optional(string({ format: 'url' })),
            FALLBACK_URL: optional(string({ format: 'url' })),
          },
          { unknownKeys: 'strip' },
        ),
        (raw) => {
          const resolvedUrl = raw.PUBLIC_URL ?? raw.FALLBACK_URL;
          if (resolvedUrl === undefined) {
            throw new Error('Either PUBLIC_URL or FALLBACK_URL is required');
          }
          return { secret: raw.SECRET, url: resolvedUrl };
        },
        'require url',
      );

      expect(
        envTransformed.parse({
          SECRET: 'super-secret-value',
          FALLBACK_URL: 'https://app.example.com',
          IGNORED: 'yes',
        }),
      ).toEqual({
        secret: 'super-secret-value',
        url: 'https://app.example.com',
      });
      expect(
        redactSealed(envTransformed, {
          SECRET: 'super-secret-value',
          PUBLIC_URL: 'https://app.example.com',
        }),
      ).toEqual({
        SECRET: '[REDACTED]',
        PUBLIC_URL: 'https://app.example.com',
      });

      // Failure assertions: inner validation fails before transform, and transform errors surface cleanly
      expect(() =>
        envTransformed.parse({ SECRET: 'short', PUBLIC_URL: 'https://app.example.com' }),
      ).toThrow(/at least 8/iu);
      expect(() =>
        envTransformed.parse({ SECRET: 'super-secret-value', PUBLIC_URL: 'not a url' }),
      ).toThrow(/valid URL/iu);
      expect(() => envTransformed.parse({ SECRET: 'super-secret-value' })).toThrow(
        /Either PUBLIC_URL or FALLBACK_URL is required/u,
      );
      expect(() => envTransformed.parse('not-an-object')).toThrow(/plain object/iu);
    });
  });
});
