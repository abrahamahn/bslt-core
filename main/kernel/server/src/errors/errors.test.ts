// main/kernel/server/src/errors/errors.test.ts
import { AppError, BadRequestError, RequestSchemaError, UnprocessableError } from '@bslt/contract';
import { describe, expect, test, vi } from 'vitest';

import { mapErrorToHttpResponse, toHttpErrorResponse } from './index';

describe('server error mapping', () => {
  test('maps unknown errors to internal responses', () => {
    const response = toHttpErrorResponse(new Error('boom'), {
      isProduction: true,
      correlationId: 'cid-1',
    });
    const wire = response.wire!;

    expect(response.status).toBe(500);
    expect(response.retryAfter).toBeUndefined();
    expect(wire).toEqual({
      code: 'system.internal',
      kind: 'internal',
      message: 'Internal server error',
      correlationId: 'cid-1',
    });
  });

  test('logs and preserves rate limit errors', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const error = new AppError({
      code: 'system.rate_limit',
      kind: 'rate_limit',
      message: 'slow down',
      publicMessage: 'slow down',
      retryAfterMs: 2100,
    });

    const response = mapErrorToHttpResponse(error, logger);
    const wire = response.wire!;

    expect(response.status).toBe(429);
    expect(response.retryAfter).toBe(3);
    expect(wire.message).toBe('slow down');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('treats timeout errors as warnings instead of hard errors', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const error = new AppError({
      code: 'system.timeout',
      kind: 'timeout',
      message: 'upstream timed out',
      publicMessage: 'upstream timed out',
      retryAfterMs: 5000,
    });

    const response = mapErrorToHttpResponse(error, logger);

    expect(response.status).toBe(504);
    expect(response.retryAfter).toBe(5);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  // Two validation errors share a kind and differ in status: a malformed
  // request is 400, a well-formed request that fails its schema is 422. The
  // mapper used to derive the status from the kind alone, so the error handler
  // answered 400 for every schema failure while the same error under Fastify's
  // default handler (what the integration suites ran on) answered 422.
  test('answers with the status the error carries, not one derived from its kind', () => {
    expect(toHttpErrorResponse(new BadRequestError('malformed')).status).toBe(400);
    expect(toHttpErrorResponse(new UnprocessableError('unprocessable')).status).toBe(422);

    const schema = toHttpErrorResponse(new RequestSchemaError([{ message: 'Email is required' }]));
    expect(schema.status).toBe(422);
    expect(schema.wire).toMatchObject({ code: 'system.validation', kind: 'validation' });
  });

  test('falls back to the status of the kind for an error that carries none', () => {
    const branded = {
      __isAppError: true,
      code: 'system.conflict',
      kind: 'conflict',
      message: 'duplicate',
      toWire: () => ({
        ok: false,
        error: { code: 'system.conflict', kind: 'conflict', message: 'duplicate' },
      }),
      attachCorrelationId() {
        return this;
      },
    };

    expect(toHttpErrorResponse(branded).status).toBe(409);
  });
});
