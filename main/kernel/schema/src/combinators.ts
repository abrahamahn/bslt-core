// main/kernel/schema/src/combinators.ts
/**
 * Structural schema combinators with full `describe()` AST introspection,
 * strict unknown-key & prototype-pollution rejection, and Standard Schema v1 support.
 */

import { describe } from './describe';
import { SchemaValidationError, makeSchema } from './factory';
import { EMAIL_REGEX, IP_V4_REGEX, IP_V6_REGEX, UUID_REGEX, isValidAbsoluteUrl } from './regex';

import type {
  BigIntStringOptions,
  BigIntStringSchema,
  DefaultedSchema,
  Infer,
  NumberSchemaOptions,
  ObjectSchemaOptions,
  OptionalSchema,
  Schema,
  SchemaNode,
  SealedSchema,
  StringSchemaOptions,
} from './types';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CANONICAL_BIGINT_REGEX = /^(?:0|-?[1-9]\d*)$/u;
const DEFAULT_MAX_JSON_DEPTH = 64;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(data: unknown): data is Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const proto: unknown = Object.getPrototypeOf(data);
  return proto === Object.prototype || proto === null;
}

function wrapPathError(err: unknown, segment: string | number): SchemaValidationError {
  if (err instanceof SchemaValidationError) {
    return new SchemaValidationError(err.message, [segment, ...err.path]);
  }
  const msg = err instanceof Error ? err.message : String(err);
  const prefix = typeof segment === 'number' ? `[${String(segment)}]` : `Field "${segment}"`;
  return new SchemaValidationError(`${prefix}: ${msg}`, [segment]);
}

function isOptionalSchema(schema: Schema): schema is OptionalSchema<unknown> {
  return (schema as Partial<OptionalSchema<unknown>>).isOptional === true;
}

function isDefaultedSchema(schema: Schema): schema is DefaultedSchema<unknown> {
  return (schema as Partial<DefaultedSchema<unknown>>).isDefaulted === true;
}

// ============================================================================
// Scalars & Literals
// ============================================================================

export function string(opts?: StringSchemaOptions): Schema<string> {
  const label = opts?.label ?? 'Value';
  const node: SchemaNode = {
    kind: 'string',
    ...(opts?.trim !== undefined ? { trim: opts.trim } : {}),
    ...(opts?.min !== undefined ? { min: opts.min } : {}),
    ...(opts?.max !== undefined ? { max: opts.max } : {}),
    ...(opts?.length !== undefined ? { length: opts.length } : {}),
    ...(opts?.pattern !== undefined ? { pattern: opts.pattern.source } : {}),
    ...(opts?.format !== undefined ? { format: opts.format } : {}),
  };

  return makeSchema<string>((data: unknown) => {
    if (typeof data !== 'string') {
      throw new SchemaValidationError(`${label} must be a string`);
    }
    let value = opts?.trim === true ? data.trim() : data;
    if (opts?.format === 'email') {
      value = value.trim().toLowerCase();
      if (!EMAIL_REGEX.test(value) || value.length < 1 || value.length > 255) {
        throw new SchemaValidationError(`${label} must be a valid email`);
      }
    } else if (opts?.format === 'uuid') {
      if (!UUID_REGEX.test(value)) {
        throw new SchemaValidationError(`${label} must be a valid UUID`);
      }
    } else if (opts?.format === 'url') {
      if (!isValidAbsoluteUrl(value)) {
        throw new SchemaValidationError(`${label} must be a valid URL`);
      }
    } else if (opts?.format === 'iso-datetime') {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new SchemaValidationError(`${label} must be a valid ISO datetime`);
      }
    } else if (opts?.format === 'ip') {
      if (!IP_V4_REGEX.test(value) && !IP_V6_REGEX.test(value)) {
        throw new SchemaValidationError(`${label} must be a valid IP address`);
      }
    }

    if (opts?.min !== undefined && value.length < opts.min) {
      throw new SchemaValidationError(`${label} must be at least ${String(opts.min)} characters`);
    }
    if (opts?.max !== undefined && value.length > opts.max) {
      throw new SchemaValidationError(`${label} must be at most ${String(opts.max)} characters`);
    }
    if (opts?.length !== undefined && value.length !== opts.length) {
      throw new SchemaValidationError(`${label} must be exactly ${String(opts.length)} characters`);
    }
    if (opts?.pattern !== undefined && !opts.pattern.test(value)) {
      throw new SchemaValidationError(opts.patternMessage ?? `${label} has invalid format`);
    }
    return value;
  }, node);
}

export function number(opts?: NumberSchemaOptions): Schema<number> {
  const label = opts?.label ?? 'Value';
  const node: SchemaNode = {
    kind: 'number',
    ...(opts?.int !== undefined ? { int: opts.int } : {}),
    ...(opts?.min !== undefined ? { min: opts.min } : {}),
    ...(opts?.max !== undefined ? { max: opts.max } : {}),
    ...(opts?.coerce !== undefined ? { coerce: opts.coerce } : {}),
  };

  return makeSchema<number>((data: unknown) => {
    let num: number;
    if (typeof data === 'number') {
      if (Number.isNaN(data)) {
        throw new SchemaValidationError(`${label} must be a number`);
      }
      if (!Number.isFinite(data)) {
        throw new SchemaValidationError(`${label} must be a finite number`);
      }
      num = data;
    } else if (opts?.coerce === true && typeof data === 'string' && data.trim() !== '') {
      num = Number(data);
      if (!Number.isFinite(num)) {
        throw new SchemaValidationError(`${label} must be a valid number`);
      }
    } else {
      throw new SchemaValidationError(
        opts?.coerce === true ? `${label} must be a valid number` : `${label} must be a number`,
      );
    }

    if (opts?.int === true && !Number.isInteger(num)) {
      throw new SchemaValidationError(`${label} must be an integer`);
    }
    if (opts?.min !== undefined && num < opts.min) {
      throw new SchemaValidationError(`${label} must be at least ${String(opts.min)}`);
    }
    if (opts?.max !== undefined && num > opts.max) {
      throw new SchemaValidationError(`${label} must be at most ${String(opts.max)}`);
    }
    return num;
  }, node);
}

export function boolean(opts?: {
  readonly coerce?: boolean;
  readonly label?: string;
}): Schema<boolean> {
  const label = opts?.label ?? 'Value';
  const node: SchemaNode = {
    kind: 'boolean',
    ...(opts?.coerce !== undefined ? { coerce: opts.coerce } : {}),
  };
  return makeSchema<boolean>((data: unknown) => {
    if (typeof data === 'boolean') return data;
    if (opts?.coerce === true) {
      if (data === 'true') return true;
      if (data === 'false') return false;
    }
    throw new SchemaValidationError(`${label} must be a boolean`);
  }, node);
}

export function literal<const T extends string | number | boolean | null>(expected: T): Schema<T> {
  return makeSchema<T>(
    (data: unknown) => {
      if (!Object.is(data, expected)) {
        throw new SchemaValidationError(
          `Expected literal ${String(expected)}, got ${String(data)}`,
        );
      }
      return expected;
    },
    { kind: 'literal', value: expected },
  );
}

export function enumOf<const T extends readonly [string, ...string[]]>(
  values: T,
  label = 'value',
): Schema<T[number]> {
  const allowed = new Set<string>(values);
  return makeSchema<T[number]>(
    (data: unknown) => {
      if (typeof data !== 'string') {
        throw new SchemaValidationError(`${label} must be a string`);
      }
      if (!allowed.has(data)) {
        throw new SchemaValidationError(
          `Invalid ${label}: "${data}". Expected one of: ${values.join(', ')}`,
        );
      }
      return data;
    },
    { kind: 'enum', values: [...values] },
  );
}

// ============================================================================
// Optional & Nullable
// ============================================================================

export function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  const base = makeSchema<T | undefined>(
    (data: unknown) => (data === undefined ? undefined : inner.parse(data)),
    { kind: 'optional', inner: describe(inner) },
  );
  return Object.assign(base, { isOptional: true as const, inner });
}

export function defaulted<T>(inner: Schema<T>, defaultValue: T): DefaultedSchema<T> {
  const base = makeSchema<T>(
    (data: unknown) => (data === undefined ? defaultValue : inner.parse(data)),
    { kind: 'optional', inner: describe(inner) },
  );
  return Object.assign(base, { isDefaulted: true as const, inner, defaultValue });
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return makeSchema<T | null>((data: unknown) => (data === null ? null : inner.parse(data)), {
    kind: 'nullable',
    inner: describe(inner),
  });
}

// ============================================================================
// Object, Array, Record
// ============================================================================

type RequiredKeys<Shape extends Readonly<Record<string, Schema>>> = {
  [K in keyof Shape]: Shape[K] extends OptionalSchema<unknown> ? never : K;
}[keyof Shape];

type OptionalKeys<Shape extends Readonly<Record<string, Schema>>> = {
  [K in keyof Shape]: Shape[K] extends OptionalSchema<unknown> ? K : never;
}[keyof Shape];

type Simplify<T> = { readonly [K in keyof T]: T[K] } & {};

export type InferObject<Shape extends Readonly<Record<string, Schema>>> = Simplify<
  { readonly [K in RequiredKeys<Shape>]: Infer<Shape[K]> } & {
    readonly [K in OptionalKeys<Shape>]?: Infer<Shape[K]>;
  }
>;

export function object<const Shape extends Readonly<Record<string, Schema>>>(
  shape: Shape,
  opts: { readonly unknownKeys: 'passthrough' },
): Schema<InferObject<Shape> & Record<string, unknown>>;
export function object<const Shape extends Readonly<Record<string, Schema>>>(
  shape: Shape,
  opts?: ObjectSchemaOptions,
): Schema<InferObject<Shape>>;
export function object<const Shape extends Readonly<Record<string, Schema>>>(
  shape: Shape,
  opts?: ObjectSchemaOptions,
): Schema<InferObject<Shape>> {
  const unknownKeysMode = opts?.unknownKeys ?? 'reject';
  const sortedKeys = Object.keys(shape).sort();
  const knownKeys = new Set<string>(sortedKeys);
  const properties: Record<string, SchemaNode> = {};
  const required: string[] = [];

  for (const key of sortedKeys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Schema shape cannot define forbidden key "${key}"`);
    }
    const fieldSchema = shape[key];
    if (fieldSchema === undefined) continue;
    properties[key] = describe(fieldSchema);
    if (!isOptionalSchema(fieldSchema) && !isDefaultedSchema(fieldSchema)) {
      required.push(key);
    }
  }

  return makeSchema<InferObject<Shape>>(
    (data: unknown) => {
      if (!isPlainObject(data)) {
        throw new SchemaValidationError('Value must be a plain object');
      }

      for (const ownKey of Object.getOwnPropertyNames(data)) {
        if (FORBIDDEN_KEYS.has(ownKey)) {
          throw new SchemaValidationError(`Forbidden key "${ownKey}" is not allowed`, [ownKey]);
        }
        if (unknownKeysMode === 'reject' && !knownKeys.has(ownKey)) {
          throw new SchemaValidationError(`Unknown key "${ownKey}" is not allowed`, [ownKey]);
        }
      }

      const out: Record<string, unknown> = {};
      if (unknownKeysMode === 'passthrough') {
        for (const key of Object.keys(data)) {
          if (!knownKeys.has(key)) {
            Object.defineProperty(out, key, {
              value: data[key],
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
        }
      }

      for (const key of sortedKeys) {
        const fieldSchema = shape[key];
        if (fieldSchema === undefined) continue;
        const hasKey = Object.prototype.hasOwnProperty.call(data, key);
        const rawVal = hasKey ? data[key] : undefined;
        try {
          const parsedVal = fieldSchema.parse(rawVal);
          if (parsedVal !== undefined) {
            out[key] = parsedVal;
          } else if (!isOptionalSchema(fieldSchema) && !isDefaultedSchema(fieldSchema)) {
            if (!hasKey) {
              throw new SchemaValidationError(`Field "${key}" is required`);
            }
            out[key] = undefined;
          }
        } catch (err) {
          throw wrapPathError(err, key);
        }
      }

      return out as InferObject<Shape>;
    },
    {
      kind: 'object',
      properties,
      required,
      additionalProperties: unknownKeysMode !== 'reject',
    },
  );
}

export function array<T>(
  itemSchema: Schema<T>,
  opts?: { readonly min?: number; readonly max?: number },
): Schema<T[]> {
  return makeSchema<T[]>(
    (data: unknown) => {
      if (!Array.isArray(data)) {
        throw new SchemaValidationError('Expected an array');
      }
      if (opts?.min !== undefined && data.length < opts.min) {
        throw new SchemaValidationError(`Array must have at least ${String(opts.min)} items`);
      }
      if (opts?.max !== undefined && data.length > opts.max) {
        throw new SchemaValidationError(`Array must have at most ${String(opts.max)} items`);
      }
      return data.map((item: unknown, idx: number) => {
        try {
          return itemSchema.parse(item);
        } catch (err) {
          throw wrapPathError(err, idx);
        }
      });
    },
    {
      kind: 'array',
      items: describe(itemSchema),
      ...(opts?.min !== undefined ? { min: opts.min } : {}),
      ...(opts?.max !== undefined ? { max: opts.max } : {}),
    },
  );
}

export function record<V>(
  valueSchema: Schema<V>,
  keySchema?: Schema<string>,
): Schema<Record<string, V>> {
  return makeSchema<Record<string, V>>(
    (data: unknown) => {
      if (!isPlainObject(data)) {
        throw new SchemaValidationError('Value must be a plain object');
      }
      for (const ownKey of Object.getOwnPropertyNames(data)) {
        if (FORBIDDEN_KEYS.has(ownKey)) {
          throw new SchemaValidationError(`Forbidden key "${ownKey}" is not allowed`, [ownKey]);
        }
      }

      const out: Record<string, V> = {};
      for (const key of Object.keys(data)) {
        const validatedKey = keySchema !== undefined ? keySchema.parse(key) : key;
        try {
          const parsedVal = valueSchema.parse(data[key]);
          Object.defineProperty(out, validatedKey, {
            value: parsedVal,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        } catch (err) {
          throw wrapPathError(err, validatedKey);
        }
      }
      return out;
    },
    {
      kind: 'record',
      keys: keySchema !== undefined ? describe(keySchema) : { kind: 'string' },
      values: describe(valueSchema),
    },
  );
}

// ============================================================================
// Union & Discriminated Union
// ============================================================================

export function union<const Schemas extends readonly [Schema, Schema, ...Schema[]]>(
  schemas: Schemas,
): Schema<Infer<Schemas[number]>> {
  return makeSchema<Infer<Schemas[number]>>(
    (data: unknown) => {
      const errors: string[] = [];
      for (const branch of schemas) {
        const res = branch.safeParse(data);
        if (res.success) {
          return res.data as Infer<Schemas[number]>;
        }
        errors.push(res.error.message);
      }
      throw new SchemaValidationError(
        `Value does not match any union branch: ${errors.join('; ')}`,
      );
    },
    {
      kind: 'union',
      anyOf: schemas.map((s) => describe(s)),
    },
  );
}

export function discriminated<const Variants extends readonly [Schema, ...Schema[]]>(
  discriminator: string,
  variants: Variants,
): Schema<Infer<Variants[number]>> {
  const byTag = new Map<string, Schema>();
  const mapping: Record<string, SchemaNode> = {};

  for (const variant of variants) {
    const node = describe(variant);
    if (node.kind !== 'object') {
      throw new Error(`discriminated("${discriminator}") variants must be object() schemas`);
    }
    const tagNode = node.properties[discriminator];
    if (tagNode?.kind !== 'literal' || typeof tagNode.value !== 'string') {
      throw new Error(
        `discriminated("${discriminator}") requires each variant to have a string literal("${discriminator}") field`,
      );
    }
    if (byTag.has(tagNode.value)) {
      throw new Error(
        `Duplicate discriminator "${tagNode.value}" in discriminated("${discriminator}")`,
      );
    }
    byTag.set(tagNode.value, variant);
    mapping[tagNode.value] = node;
  }

  const sortedMapping: Record<string, SchemaNode> = {};
  for (const tag of [...byTag.keys()].sort()) {
    const entry = mapping[tag];
    if (entry !== undefined) sortedMapping[tag] = entry;
  }

  return makeSchema<Infer<Variants[number]>>(
    (data: unknown) => {
      if (!isPlainObject(data)) {
        throw new SchemaValidationError('Value must be a plain object');
      }
      const rawTag = Object.prototype.hasOwnProperty.call(data, discriminator)
        ? data[discriminator]
        : undefined;
      if (typeof rawTag !== 'string') {
        throw new SchemaValidationError(`Missing or non-string discriminator "${discriminator}"`, [
          discriminator,
        ]);
      }
      const matched = byTag.get(rawTag);
      if (matched === undefined) {
        throw new SchemaValidationError(
          `Invalid "${discriminator}": "${rawTag}". Expected one of: ${[...byTag.keys()].join(', ')}`,
          [discriminator],
        );
      }
      return matched.parse(data) as Infer<Variants[number]>;
    },
    {
      kind: 'discriminated',
      discriminator,
      mapping: sortedMapping,
    },
  );
}

// ============================================================================
// Brand, Refine, BigIntString, Sealed
// ============================================================================

export function brand<T, const B extends string>(
  inner: Schema<T>,
  brandName: B,
): Schema<T & { readonly __brand: B }> {
  return makeSchema<T & { readonly __brand: B }>(
    (data: unknown) => inner.parse(data) as T & { readonly __brand: B },
    { kind: 'brand', brand: brandName, inner: describe(inner) },
  );
}

export function refine<T>(
  inner: Schema<T>,
  predicate: (value: T) => boolean,
  message: string | ((value: T) => string),
): Schema<T> {
  return makeSchema<T>(
    (data: unknown) => {
      const parsed = inner.parse(data);
      if (!predicate(parsed)) {
        const msg = typeof message === 'function' ? message(parsed) : message;
        throw new SchemaValidationError(msg);
      }
      return parsed;
    },
    {
      kind: 'refine',
      inner: describe(inner),
      ...(typeof message === 'string' ? { description: message } : {}),
    },
  );
}

export function transform<TIn, TOut>(
  inner: Schema<TIn>,
  fn: (value: TIn) => TOut,
  description?: string,
): Schema<TOut> {
  return makeSchema<TOut>(
    (data: unknown) => {
      const parsed = inner.parse(data);
      try {
        return fn(parsed);
      } catch (err) {
        if (err instanceof SchemaValidationError) throw err;
        throw new SchemaValidationError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      kind: 'refine',
      inner: describe(inner),
      ...(description !== undefined ? { description } : {}),
    },
  );
}

export function unknown(): Schema {
  return makeSchema((data: unknown) => data, { kind: 'json' });
}

function buildBigIntStringSchema(opts?: BigIntStringOptions): Schema<string> {
  const effectiveMin =
    opts?.nonNegative === true
      ? opts.min !== undefined && opts.min > 0n
        ? opts.min
        : 0n
      : opts?.min;

  return makeSchema<string>(
    (data: unknown) => {
      if (typeof data !== 'string') {
        throw new SchemaValidationError('BigInt string must be a string');
      }
      if (!CANONICAL_BIGINT_REGEX.test(data)) {
        throw new SchemaValidationError(`Invalid canonical integer string: "${data}"`);
      }
      const value = BigInt(data);
      if (opts?.nonNegative === true && value < 0n) {
        throw new SchemaValidationError('BigInt string must be non-negative');
      }
      if (effectiveMin !== undefined && value < effectiveMin) {
        throw new SchemaValidationError(
          `BigInt string must be at least ${effectiveMin.toString()}`,
        );
      }
      if (opts?.max !== undefined && value > opts.max) {
        throw new SchemaValidationError(`BigInt string must be at most ${opts.max.toString()}`);
      }
      return data;
    },
    {
      kind: 'bigintString',
      ...(effectiveMin !== undefined ? { min: effectiveMin.toString() } : {}),
      ...(opts?.max !== undefined ? { max: opts.max.toString() } : {}),
    },
  );
}

const defaultBigIntStringSchema = buildBigIntStringSchema();

export const bigintString: BigIntStringSchema = Object.assign(
  (opts?: BigIntStringOptions): Schema<string> => buildBigIntStringSchema(opts),
  defaultBigIntStringSchema,
);

export function sealed<T>(inner: Schema<T>): SealedSchema<T> {
  const base = makeSchema<T>((data: unknown) => inner.parse(data), {
    kind: 'sealed',
    inner: describe(inner),
  });
  return Object.assign(base, { isSealed: true as const, inner });
}

function parseJsonAtDepth(
  data: unknown,
  label: string,
  depth: number,
  maxDepth: number,
): JsonValue {
  if (depth > maxDepth) {
    throw new SchemaValidationError(
      `${label} exceeds maximum JSON nesting depth (${String(maxDepth)})`,
    );
  }
  if (data === null || typeof data === 'string' || typeof data === 'boolean') {
    return data;
  }
  if (typeof data === 'number') {
    if (!Number.isFinite(data)) {
      throw new SchemaValidationError(`${label} must be a finite JSON number`);
    }
    return Object.is(data, -0) ? 0 : data;
  }
  if (Array.isArray(data)) {
    return data.map((item: unknown, idx: number) => {
      try {
        return parseJsonAtDepth(item, label, depth + 1, maxDepth);
      } catch (err) {
        throw wrapPathError(err, idx);
      }
    });
  }
  if (isPlainObject(data)) {
    for (const ownKey of Object.getOwnPropertyNames(data)) {
      if (FORBIDDEN_KEYS.has(ownKey)) {
        throw new SchemaValidationError(`Forbidden key "${ownKey}" is not allowed`, [ownKey]);
      }
    }
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(data)) {
      try {
        const parsedVal = parseJsonAtDepth(data[key], label, depth + 1, maxDepth);
        Object.defineProperty(out, key, {
          value: parsedVal,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } catch (err) {
        throw wrapPathError(err, key);
      }
    }
    return out;
  }
  throw new SchemaValidationError(`${label} must be a valid JSON value`);
}

export function json(opts?: {
  readonly label?: string;
  readonly maxDepth?: number;
}): Schema<JsonValue> {
  const label = opts?.label ?? 'Value';
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  return makeSchema<JsonValue>((data: unknown) => parseJsonAtDepth(data, label, 0, maxDepth), {
    kind: 'json',
  });
}
