// main/kernel/schema/src/factory.ts
/**
 * Schema construction primitives and structured path-carrying validation errors.
 */

import type { SafeParseResult, Schema, SchemaNode, StandardSchemaV1Issue } from './types';

/**
 * Validation error carrying the nested property/index path for Standard Schema issues.
 */
export class SchemaValidationError extends Error {
  readonly path: readonly (string | number)[];

  constructor(message: string, path: readonly (string | number)[] = []) {
    super(message);
    this.name = 'SchemaValidationError';
    this.path = path;
  }
}

function toIssue(err: unknown): StandardSchemaV1Issue {
  if (err instanceof SchemaValidationError) {
    return err.path.length > 0
      ? { message: err.message, path: err.path }
      : { message: err.message };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: String(err) };
}

/**
 * Internal builder used by `@bslt/schema` combinators and scalars so every schema
 * carries both a `describe()` AST node and the Standard Schema v1 `~standard` property.
 */
export function makeSchema<T>(validate: (data: unknown) => T, node: SchemaNode): Schema<T> {
  return {
    parse: validate,
    safeParse: (data: unknown): SafeParseResult<T> => {
      try {
        const result = validate(data);
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },
    '~standard': {
      version: 1,
      vendor: 'bslt',
      validate: (value: unknown) => {
        try {
          return { value: validate(value) };
        } catch (e) {
          return { issues: [toIssue(e)] };
        }
      },
    },
    _node: node,
    _type: undefined as unknown as T,
  };
}

/**
 * Create an opaque schema from an arbitrary validation function.
 * Prefer structural combinators (`object`, `string`, `enumOf`, ...) in new code so
 * `describe()` can introspect the schema for OpenAPI and documentation.
 */
export function createSchema<T>(validate: (data: unknown) => T): Schema<T> {
  return makeSchema(validate, { kind: 'opaque' });
}
