// main/kernel/client/src/transport/errors.test.ts
import {
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  TooManyRequestsError,
  UnprocessableError,
  type AppError,
} from '@bslt/contract';
import { describe, expect, it } from 'vitest';

import {
  ApiError,
  NetworkError,
  TimeoutError,
  createApiError,
  getErrorMessage,
  isApiError,
  isAuthenticationError,
  isNetworkError,
  isTimeoutError,
} from './errors';

describe('Transport Errors', () => {
  it('classifies client, server, and retryable statuses on ApiError', () => {
    const clientErr = new ApiError('Bad request', 400, 'BAD_INPUT', { field: 'email' });
    const rateLimited = new ApiError('Too many requests', 429);
    const serverErr = new ApiError('Server error', 500);

    expect((clientErr as AppError).code).toBe('BAD_INPUT');
    expect((clientErr as AppError).details).toEqual({ field: 'email' });
    expect(clientErr.isClientError()).toBe(true);
    expect(clientErr.isServerError()).toBe(false);
    expect(clientErr.isRetryable()).toBe(false);
    expect(rateLimited.isRetryable()).toBe(true);
    expect(serverErr.isServerError()).toBe(true);
    expect(serverErr.isRetryable()).toBe(true);
  });

  it('constructs NetworkError and TimeoutError with preserved cause/timeoutMs', () => {
    const cause = new Error('fetch failed');
    const net = new NetworkError('Offline', cause);
    expect(net.originalError).toBe(cause);
    expect((net as AppError).code).toBe('NETWORK_ERROR');

    const timeout = new TimeoutError('Timed out', 5000);
    expect(timeout.timeoutMs).toBe(5000);
    expect((timeout as AppError).details).toEqual({ timeoutMs: 5000 });
  });

  it('maps HTTP status codes to canonical AppError subclasses in createApiError', () => {
    expect(createApiError(400, { message: 'Bad' })).toBeInstanceOf(BadRequestError);
    expect(createApiError(401, { message: 'Unauth' })).toBeInstanceOf(AuthenticationError);
    expect(createApiError(403, { message: 'Denied' })).toBeInstanceOf(ForbiddenError);
    expect(createApiError(404)).toBeInstanceOf(NotFoundError);
    expect(createApiError(404).message).toBe('HTTP 404');
    expect(createApiError(409, { message: 'Dup' })).toBeInstanceOf(ConflictError);
    expect(createApiError(422, { message: 'Invalid' })).toBeInstanceOf(UnprocessableError);

    const locked = createApiError(429, {
      message: 'Locked',
      lockReason: 'abuse',
      lockedUntil: '2026-12-01T00:00:00Z',
    }) as TooManyRequestsError & { lockReason?: string; lockedUntil?: string };
    expect(locked).toBeInstanceOf(TooManyRequestsError);
    expect(locked.lockReason).toBe('abuse');
    expect(locked.lockedUntil).toBe('2026-12-01T00:00:00Z');

    expect(createApiError(502, { message: 'Bad gateway' })).toBeInstanceOf(InternalError);
    expect(createApiError(418, { message: 'Teapot' })).toBeInstanceOf(ApiError);
  });

  it('validates type guards and extracts fallback error messages cleanly', () => {
    expect(isApiError(new ApiError('T', 418))).toBe(true);
    expect(isApiError(new Error('T'))).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isNetworkError(new NetworkError())).toBe(true);
    expect(isNetworkError(new Error('T'))).toBe(false);
    expect(isTimeoutError(new TimeoutError())).toBe(true);
    expect(isTimeoutError(new Error('T'))).toBe(false);
    expect(isAuthenticationError(new AuthenticationError())).toBe(true);
    expect(isAuthenticationError(new ApiError('T', 401))).toBe(false);

    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('plain string')).toBe('plain string');
    expect(getErrorMessage(null)).toBe('An unexpected error occurred');
    expect(getErrorMessage({ message: 'obj' })).toBe('An unexpected error occurred');
  });
});
