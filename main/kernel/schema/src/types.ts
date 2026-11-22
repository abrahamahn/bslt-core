// main/kernel/schema/src/types.ts
/**
 * Core isomorphic types for `@bslt/schema`: Schema<T>, Infer<S>, SchemaNode AST,
 * and Standard Schema v1 (`~standard`) without external dependencies.
 */

// ============================================================================
// Standard Schema v1 (in-house type-only spec, zero dependencies)
// ============================================================================

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaV1Issue> };

interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (value: unknown) => StandardSchemaV1Result<Output>;
  readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1Props<Input, Output>;
}

// ============================================================================
// Canonical Introspection AST (`describe()`)
// ============================================================================

export type StringFormat = 'uuid' | 'email' | 'url' | 'iso-datetime' | 'ip';

export type SchemaNode =
  | { readonly kind: 'opaque' }
  | { readonly kind: 'json' }
  | {
      readonly kind: 'string';
      readonly trim?: boolean;
      readonly min?: number;
      readonly max?: number;
      readonly length?: number;
      readonly pattern?: string;
      readonly format?: StringFormat;
    }
  | {
      readonly kind: 'number';
      readonly int?: boolean;
      readonly min?: number;
      readonly max?: number;
      readonly coerce?: boolean;
    }
  | { readonly kind: 'boolean'; readonly coerce?: boolean }
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'bigintString'; readonly min?: string; readonly max?: string }
  | { readonly kind: 'optional'; readonly inner: SchemaNode }
  | { readonly kind: 'nullable'; readonly inner: SchemaNode }
  | {
      readonly kind: 'array';
      readonly items: SchemaNode;
      readonly min?: number;
      readonly max?: number;
    }
  | { readonly kind: 'record'; readonly keys: SchemaNode; readonly values: SchemaNode }
  | {
      readonly kind: 'object';
      readonly properties: Readonly<Record<string, SchemaNode>>;
      readonly required: readonly string[];
      readonly additionalProperties: boolean;
    }
  | { readonly kind: 'union'; readonly anyOf: readonly SchemaNode[] }
  | {
      readonly kind: 'discriminated';
      readonly discriminator: string;
      readonly mapping: Readonly<Record<string, SchemaNode>>;
    }
  | { readonly kind: 'brand'; readonly brand: string; readonly inner: SchemaNode }
  | { readonly kind: 'refine'; readonly inner: SchemaNode; readonly description?: string }
  | { readonly kind: 'sealed'; readonly inner: SchemaNode };

// ============================================================================
// Core Schema Types
// ============================================================================

export type SafeParseResult<T> = { success: true; data: T } | { success: false; error: Error };

export interface Schema<T = unknown> extends StandardSchemaV1<unknown, T> {
  /** Parse unknown data and return the typed value, or throw Error. */
  parse: (data: unknown) => T;
  /** Parse unknown data without throwing. */
  safeParse: (data: unknown) => SafeParseResult<T>;
  /** Phantom type for TypeScript inference. */
  _type: T;
  /** Internal AST node read by `describe()`. */
  readonly _node?: SchemaNode;
}

/** Infer the output type from a Schema instance. */
export type Infer<S> = S extends Schema<infer T> ? T : never;

/** Marker interface for `optional(schema)` so `object(...)` marks the property optional. */
export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly isOptional: true;
  readonly inner: Schema<T>;
}

/** Marker interface for `defaulted(schema, fallback)` so `object(...)` omits the key from wire `required` while returning `T`. */
export interface DefaultedSchema<T> extends Schema<T> {
  readonly isDefaulted: true;
  readonly inner: Schema<T>;
  readonly defaultValue: T;
}

export interface ObjectSchemaOptions {
  readonly unknownKeys?: 'reject' | 'strip' | 'passthrough';
}

/** Marker interface for `sealed(schema)` secret fields. */
export interface SealedSchema<T> extends Schema<T> {
  readonly isSealed: true;
  readonly inner: Schema<T>;
}

export interface StringSchemaOptions {
  readonly trim?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly length?: number;
  readonly pattern?: RegExp;
  readonly patternMessage?: string;
  readonly format?: StringFormat;
  readonly label?: string;
}

export interface NumberSchemaOptions {
  readonly int?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly coerce?: boolean;
  readonly label?: string;
}

export interface BigIntStringOptions {
  readonly min?: bigint;
  readonly max?: bigint;
  readonly nonNegative?: boolean;
}

export interface BigIntStringSchema extends Schema<string> {
  (opts?: BigIntStringOptions): Schema<string>;
}
