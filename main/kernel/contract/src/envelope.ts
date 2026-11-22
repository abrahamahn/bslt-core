// main/kernel/contract/src/envelope.ts
import {
  enumOf,
  makeSchema,
  object,
  optional,
  record,
  SchemaValidationError,
  string,
  type Infer,
  type Schema,
} from '@bslt/schema';

import { ERROR_KINDS } from './errors';

const unknownValueSchema: Schema = makeSchema((input: unknown) => input, {
  kind: 'opaque',
});

export const emptyBodySchema: Schema<Record<string, never>> = makeSchema<Record<string, never>>(
  (input: unknown) => {
    if (input === undefined || input === null) {
      return {};
    }
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new SchemaValidationError('Expected an empty request body');
    }
    const proto: unknown = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) {
      throw new SchemaValidationError('Expected a plain empty object body');
    }
    const keys = Object.keys(input);
    if (keys.length > 0) {
      const firstKey = keys[0] ?? '';
      throw new SchemaValidationError(
        `Expected an empty request body (unexpected key "${firstKey}")`,
        [firstKey],
      );
    }
    return {};
  },
  { kind: 'object', properties: {}, required: [], additionalProperties: false },
);

export const errorResponseSchema = object({
  code: string({ min: 1 }),
  kind: enumOf(ERROR_KINDS),
  message: string({ min: 1 }),
  details: optional(record(unknownValueSchema)),
  correlationId: optional(string({ min: 1 })),
});

export type ErrorWire = Infer<typeof errorResponseSchema>;
