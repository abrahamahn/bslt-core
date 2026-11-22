// main/kernel/contract/src/http-errors.test.ts
import { describe, expect, it } from 'vitest';

import {
  AppError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ERROR_CODES,
  ERROR_MESSAGES,
  ForbiddenError,
  HTTP_STATUS,
  InternalError,
  NotFoundError,
  RequestSchemaError,
  TooManyRequestsError,
  UnavailableError,
  UnprocessableError,
  getKindForStatusCode,
  getStatusCodeForKind,
  isAppError,
  normalizeUnknownError,
  toErrorWire,
} from './http-errors';

describe('AppError and HTTP status errors', () => {
  it('constructs BadRequestError (400) with validation kind and non-retryable state', () => {
    const err = new BadRequestError('Invalid email', 'INVALID_EMAIL', { field: 'email' });
    expect(err.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(err.kind).toBe('validation');
    expect(err.code).toBe('INVALID_EMAIL');
    expect(err.retryable).toBe(false);
    expect(err.details).toEqual({ field: 'email' });
    expect(isAppError(err)).toBe(true);
  });

  it('constructs AuthenticationError (401), ForbiddenError (403), NotFoundError (404), and ConflictError (409)', () => {
    expect(new AuthenticationError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new ConflictError().statusCode).toBe(409);
  });

  it('constructs UnprocessableError (422) and RequestSchemaError with normalized issue paths', () => {
    const schemaErr = new RequestSchemaError([
      { message: 'Too short', path: ['password'] },
      null,
      { invalid: true },
    ]);
    expect(schemaErr).toBeInstanceOf(UnprocessableError);
    expect(schemaErr.statusCode).toBe(422);
    expect(schemaErr.issues).toEqual([
      { message: 'Too short', path: ['password'] },
      { message: 'Validation failed' },
      { message: 'Validation failed' },
    ]);
  });

  it('normalizes negative or non-finite retryAfterMs to undefined on TooManyRequestsError and UnavailableError', () => {
    const negative = new TooManyRequestsError('Slow down', ERROR_CODES.RATE_LIMITED, {
      retryAfterMs: -500,
    });
    expect(negative.retryAfterMs).toBeUndefined();
    expect(negative.retryAfter).toBeUndefined();

    const nanRetry = new UnavailableError('Down', 'DOWN', { retryAfterMs: Number.NaN });
    expect(nanRetry.retryAfterMs).toBeUndefined();

    const valid = new TooManyRequestsError('Slow down', ERROR_CODES.RATE_LIMITED, {
      retryAfterMs: 1500,
    });
    expect(valid.retryAfter).toBe(2);
  });

  it('masks raw InternalError messages in production wire format unless publicMessage is explicit', () => {
    const err = new InternalError('Postgres connection reset on 10.0.0.4').attachCorrelationId(
      'corr-123',
    );
    expect(toErrorWire(err, true)).toEqual({
      code: 'system.internal',
      kind: 'internal',
      message: ERROR_MESSAGES.INTERNAL_ERROR,
      correlationId: 'corr-123',
    });
    expect(toErrorWire(err, false).message).toBe('Postgres connection reset on 10.0.0.4');
  });

  it('rejects non-branded plain objects and primitives in isAppError and instanceof checks', () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError('boom')).toBe(false);
    expect(isAppError({ code: 'X', kind: 'internal', message: 'no brand' })).toBe(false);
    expect(
      ({
        __isAppError: true,
        code: 'X',
        kind: 'authentication',
        message: 'm',
        name: 'ForbiddenError',
      } as unknown) instanceof AuthenticationError,
    ).toBe(false);
  });

  it('normalizes arbitrary thrown values and plain Errors into InternalError', () => {
    const fromPlain = normalizeUnknownError(new Error('unexpected failure'));
    expect(fromPlain).toBeInstanceOf(InternalError);
    expect(fromPlain.statusCode).toBe(500);

    const fromPrimitive = normalizeUnknownError(42);
    expect(fromPrimitive).toBeInstanceOf(InternalError);
    expect(fromPrimitive.message).toBe('Unknown error');

    const existing = new NotFoundError('missing');
    expect(normalizeUnknownError(existing)).toBe(existing);
  });

  it('maps kinds and status codes bidirectionally', () => {
    expect(getStatusCodeForKind('rate_limit')).toBe(429);
    expect(getKindForStatusCode(422)).toBe('validation');
    expect(getKindForStatusCode(504)).toBe('timeout');
    expect(new AppError('custom', { statusCode: 503 }).kind).toBe('unavailable');
  });
});
