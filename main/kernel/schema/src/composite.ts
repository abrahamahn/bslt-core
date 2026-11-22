// main/kernel/schema/src/composite.ts

import { describe } from './describe';
import { makeSchema } from './factory';
import { parseString, type ParseStringOptions } from './parsers';
import { UUID_REGEX } from './regex';

import type { Schema } from './types';

// ============================================================================
// Composite Schema Factories
// ============================================================================

/**
 * Create a schema that validates a string against a set of allowed values (Enum).
 */
export function createEnumSchema<T extends string>(values: readonly T[], label: string): Schema<T> {
  return makeSchema<T>(
    (data: unknown) => {
      if (typeof data !== 'string') {
        throw new Error(`${label} must be a string`);
      }
      if (!values.includes(data as T)) {
        throw new Error(`Invalid ${label}: "${data}". Expected one of: ${values.join(', ')}`);
      }
      return data as T;
    },
    { kind: 'enum', values: [...values] },
  );
}

/**
 * Create a valid UUID schema with a branded type.
 */
export function createBrandedUuidSchema<T extends string & { __brand: string }>(
  brand: string,
): Schema<T> {
  return makeSchema<T>(
    (data: unknown) => {
      if (typeof data !== 'string') {
        throw new Error(`${brand} must be a string`);
      }
      if (!UUID_REGEX.test(data)) {
        throw new Error(`${brand} must be a valid UUID`);
      }
      return data as T;
    },
    { kind: 'brand', brand, inner: { kind: 'string', format: 'uuid' } },
  );
}

/**
 * Create a branded string schema with options (min/max length, etc).
 */
export function createBrandedStringSchema<T extends string & { __brand: string }>(
  brand: string,
  opts?: ParseStringOptions,
): Schema<T> {
  const effectiveMin = opts?.min ?? 1;
  return makeSchema<T>(
    (data: unknown) => {
      const validated = parseString(data, brand, { min: 1, ...opts });
      return validated as T;
    },
    {
      kind: 'brand',
      brand,
      inner: {
        kind: 'string',
        min: effectiveMin,
        ...(opts?.max !== undefined ? { max: opts.max } : {}),
        ...(opts?.length !== undefined ? { length: opts.length } : {}),
        ...(opts?.trim !== undefined ? { trim: opts.trim } : {}),
        ...(opts?.regex !== undefined ? { pattern: opts.regex.source } : {}),
      },
    },
  );
}

/**
 * Create a schema that validates an array of items.
 */
export function createArraySchema<T>(
  itemParse: (data: unknown) => T,
  opts?: { readonly min?: number; readonly max?: number },
): Schema<T[]> {
  return makeSchema<T[]>(
    (data: unknown) => {
      if (!Array.isArray(data)) {
        throw new Error('Expected an array');
      }
      if (opts?.min !== undefined && data.length < opts.min) {
        throw new Error(`Array must have at least ${String(opts.min)} items`);
      }
      if (opts?.max !== undefined && data.length > opts.max) {
        throw new Error(`Array must have at most ${String(opts.max)} items`);
      }
      return data.map((item: unknown) => itemParse(item));
    },
    {
      kind: 'array',
      items: { kind: 'opaque' },
      ...(opts?.min !== undefined ? { min: opts.min } : {}),
      ...(opts?.max !== undefined ? { max: opts.max } : {}),
    },
  );
}

/**
 * Create a schema that validates an exact literal value (string, number, boolean).
 */
export function createLiteralSchema<T extends string | number | boolean>(expected: T): Schema<T> {
  return makeSchema<T>(
    (data: unknown) => {
      if (data !== expected) {
        throw new Error(`Expected literal ${String(expected)}, got ${String(data)}`);
      }
      return data as T;
    },
    { kind: 'literal', value: expected },
  );
}

/**
 * Create a union schema that tries multiple schemas in order.
 */
export function createUnionSchema<T>(schemas: ReadonlyArray<Schema<T>>): Schema<T> {
  return makeSchema<T>(
    (data: unknown) => {
      const errors: string[] = [];
      for (const schema of schemas) {
        const result = schema.safeParse(data);
        if (result.success) {
          return result.data;
        }
        errors.push(result.error.message);
      }
      throw new Error(`Value does not match any schema: ${errors.join('; ')}`);
    },
    {
      kind: 'union',
      anyOf: schemas.map((s) => describe(s)),
    },
  );
}
