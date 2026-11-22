// main/kernel/schema/src/describe.ts
/**
 * Canonical AST introspection (`describe()`) and secret-field redaction (`redactSealed()`).
 */

import type { Schema, SchemaNode } from './types';

const REDACTED = '[REDACTED]';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Return the deterministic `SchemaNode` AST for any `Schema`.
 * Hand-written `createSchema(fn)` parsers return `{ kind: 'opaque' }`.
 */
export function describe(schema: Schema): SchemaNode {
  return schema._node ?? { kind: 'opaque' };
}

function redactWithNode(node: SchemaNode, value: unknown): unknown {
  if (value === undefined) return undefined;

  switch (node.kind) {
    case 'sealed':
      return REDACTED;
    case 'optional':
      return redactWithNode(node.inner, value);
    case 'nullable':
      return value === null ? null : redactWithNode(node.inner, value);
    case 'brand':
    case 'refine':
      return redactWithNode(node.inner, value);
    case 'array':
      if (!Array.isArray(value)) return value;
      return value.map((item: unknown) => redactWithNode(node.items, item));
    case 'record': {
      if (!isPlainRecord(value)) return value;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        Object.defineProperty(out, key, {
          value: redactWithNode(node.values, value[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    case 'object': {
      if (!isPlainRecord(value)) return value;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        const propNode = node.properties[key];
        const redactedVal =
          propNode !== undefined ? redactWithNode(propNode, value[key]) : value[key];
        Object.defineProperty(out, key, {
          value: redactedVal,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    case 'discriminated': {
      if (!isPlainRecord(value)) return value;
      const tag = value[node.discriminator];
      if (typeof tag === 'string') {
        const variant = node.mapping[tag];
        if (variant !== undefined) return redactWithNode(variant, value);
      }
      return value;
    }
    case 'union': {
      for (const branch of node.anyOf) {
        if (branch.kind === 'sealed') return REDACTED;
      }
      return value;
    }
    case 'opaque':
    case 'json':
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'enum':
    case 'bigintString':
      return value;
  }
}

/**
 * Produce a log-safe clone of `value` where every `sealed(...)` field in `schema`
 * is replaced with `"[REDACTED]"`, without mutating `value`.
 */
export function redactSealed<T>(schema: Schema<T>, value: unknown): unknown {
  return redactWithNode(describe(schema), value);
}
