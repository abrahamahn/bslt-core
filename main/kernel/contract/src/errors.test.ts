// main/kernel/contract/src/errors.test.ts
import { describe, expect, it } from 'vitest';

import {
  defineErrors,
  ERROR_KINDS,
  kindForStatus,
  lookupErrorCode,
  type ErrorKind,
  type ErrorStatusCode,
  type RegisteredError,
} from './errors';

describe('errors registry', () => {
  it('registers module errors with <moduleId>.<CODE> names and derived ErrorKind', () => {
    const errs = defineErrors('tasks', {
      TASK_NOT_FOUND: 404,
      TASK_CONFLICT: 409,
    });
    expect(errs).toEqual({
      TASK_NOT_FOUND: 'tasks.TASK_NOT_FOUND',
      TASK_CONFLICT: 'tasks.TASK_CONFLICT',
    });
    expect(Object.isFrozen(errs)).toBe(true);

    const found: RegisteredError | undefined = lookupErrorCode('tasks.TASK_NOT_FOUND');
    expect(found).toEqual({
      code: 'tasks.TASK_NOT_FOUND',
      moduleId: 'tasks',
      name: 'TASK_NOT_FOUND',
      status: 404,
      kind: 'not_found',
    });
  });

  it('maps every ErrorStatusCode to its canonical ErrorKind and allows idempotent re-registration', () => {
    const pairs: ReadonlyArray<readonly [ErrorStatusCode, ErrorKind]> = [
      [400, 'validation'],
      [401, 'authentication'],
      [403, 'authorization'],
      [404, 'not_found'],
      [409, 'conflict'],
      [422, 'validation'],
      [429, 'rate_limit'],
      [500, 'internal'],
      [502, 'external_dependency'],
      [503, 'unavailable'],
      [504, 'timeout'],
    ];
    for (const [status, expectedKind] of pairs) {
      expect(kindForStatus(status)).toBe(expectedKind);
      expect(ERROR_KINDS).toContain(expectedKind);
    }

    const repeat = defineErrors('tasks', { TASK_NOT_FOUND: 404 });
    expect(repeat.TASK_NOT_FOUND).toBe('tasks.TASK_NOT_FOUND');
  });

  it('returns undefined when looking up unregistered or malformed error codes', () => {
    expect(lookupErrorCode('unknown.DOES_NOT_EXIST')).toBeUndefined();
    expect(lookupErrorCode('')).toBeUndefined();
    expect(lookupErrorCode('__proto__')).toBeUndefined();
    expect(lookupErrorCode('toString')).toBeUndefined();
  });

  it('rejects invalid module ids in defineErrors', () => {
    expect(() => defineErrors('', { BAD: 400 })).toThrow(/module id/i);
    expect(() => defineErrors('Tasks', { BAD: 400 })).toThrow(/module id/i);
    expect(() => defineErrors('task-list', { BAD: 400 })).toThrow(/module id/i);
    expect(() => defineErrors('task_list', { BAD: 400 })).toThrow(/module id/i);
    expect(() => defineErrors('1tasks', { BAD: 400 })).toThrow(/module id/i);
  });

  it('rejects invalid error code names in defineErrors', () => {
    expect(() => defineErrors('tasks', { '': 400 })).toThrow(/error key/i);
    expect(() => defineErrors('tasks', { task_not_found: 404 })).toThrow(/error key/i);
    expect(() => defineErrors('tasks', { 'TASK-NOT-FOUND': 404 })).toThrow(/error key/i);
    expect(() => defineErrors('tasks', { '1_BAD': 400 })).toThrow(/error key/i);
  });

  it('rejects invalid HTTP status codes in defineErrors', () => {
    expect(() => defineErrors('tasks', { BAD_OK: 200 as ErrorStatusCode })).toThrow(/status/i);
    expect(() => defineErrors('tasks', { BAD_TEAPOT: 418 as ErrorStatusCode })).toThrow(/status/i);
    expect(() => defineErrors('tasks', { BAD_NAN: Number.NaN as ErrorStatusCode })).toThrow(
      /status/i,
    );
  });

  it('rejects conflicting status re-registration for an already registered error code', () => {
    defineErrors('billing', { INVOICE_LOCKED: 409 });
    expect(() => defineErrors('billing', { INVOICE_LOCKED: 400 })).toThrow(/already registered/i);
  });
});
