// main/kernel/contract/src/envelope.test.ts
import { describe, expect, it } from 'vitest';

import { emptyBodySchema, errorResponseSchema, type ErrorWire } from './envelope';

describe('envelope schemas', () => {
  it('accepts empty objects, undefined, and null in emptyBodySchema', () => {
    expect(emptyBodySchema.parse({})).toEqual({});
    expect(emptyBodySchema.parse(undefined)).toEqual({});
    expect(emptyBodySchema.parse(null)).toEqual({});
  });

  it('rejects non-empty objects, arrays, and primitives in emptyBodySchema', () => {
    expect(() => emptyBodySchema.parse({ unexpected: true })).toThrow(/empty/i);
    expect(() => emptyBodySchema.parse([1, 2])).toThrow(/empty/i);
    expect(() => emptyBodySchema.parse('hello')).toThrow(/empty/i);
    expect(() => emptyBodySchema.parse(42)).toThrow(/empty/i);
    expect(() => emptyBodySchema.parse(true)).toThrow(/empty/i);
  });

  it('parses canonical ErrorWire payloads in errorResponseSchema', () => {
    const wire: ErrorWire = {
      code: 'tasks.TASK_NOT_FOUND',
      kind: 'not_found',
      message: 'Task not found',
      details: { id: 'abc' },
      correlationId: 'corr-1',
    };
    expect(errorResponseSchema.parse(wire)).toEqual(wire);
    expect(
      errorResponseSchema.parse({
        code: 'VALIDATION_ERROR',
        kind: 'validation',
        message: 'Invalid title',
      }),
    ).toEqual({
      code: 'VALIDATION_ERROR',
      kind: 'validation',
      message: 'Invalid title',
    });
  });

  it('rejects malformed error payloads in errorResponseSchema', () => {
    expect(() => errorResponseSchema.parse(null)).toThrow();
    expect(() => errorResponseSchema.parse('bad')).toThrow();
    expect(() => errorResponseSchema.parse({})).toThrow();
    expect(() =>
      errorResponseSchema.parse({
        code: 'tasks.TASK_NOT_FOUND',
        kind: 'not_a_real_kind',
        message: 'Task not found',
      }),
    ).toThrow();
    expect(() =>
      errorResponseSchema.parse({
        code: 'tasks.TASK_NOT_FOUND',
        kind: 'not_found',
        message: '',
      }),
    ).toThrow();
    expect(() =>
      errorResponseSchema.parse({
        code: 'tasks.TASK_NOT_FOUND',
        kind: 'not_found',
        message: 'Task not found',
        extra: true,
      }),
    ).toThrow();
  });
});
