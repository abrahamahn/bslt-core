// main/client/api/src/errors.ts
/**
 * SDK Error Classes
 *
 * Maps HTTP response errors to typed error classes that extend @bslt/shared errors.
 * Provides consistent error handling across the SDK.
 */

import { ERROR_MESSAGES, HTTP_STATUS } from '@bslt/shared/constants/system';
import {
  AppError,
  BadRequestError,
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  TooManyRequestsError,
  UnprocessableError,
} from '@bslt/shared/system';

/**
 * API Error response structure from the server
 */
export interface ApiErrorBody {
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
  /** Admin-set reason the account was locked (Sprint 3.15) */
  lockReason?: string;
  /** ISO timestamp when the lock expires (Sprint 3.15) */
  lockedUntil?: string;
}

/**
 * SDK-specific API error that wraps HTTP errors
 * Extends AppError for consistency with core error handling
 */
export class ApiError extends AppError {
  constructor(
    message: string,
    public readonly status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    const options: {
      statusCode: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;
      code?: string;
      details?: Record<string, unknown>;
    } = { statusCode: status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503 };
    if (code !== undefined) options.code = code;
    if (details !== undefined) options.details = details;
    super(message, options);
  }

  /**
   * Check if this is a client error (4xx)
   */
  isClientError(): boolean {
    return (
      this.status >= HTTP_STATUS.BAD_REQUEST && this.status < HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }

  /**
   * Check if this is a server error (5xx)
   */
  isServerError(): boolean {
    return this.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR;
  }

  /**
   * Check if this error indicates the user should retry
   */
  isRetryable(): boolean {
    return (
      this.status === HTTP_STATUS.TOO_MANY_REQUESTS ||
      this.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * Network error when request fails to reach the server
 */
export class NetworkError extends AppError {
  constructor(
    message = 'Network request failed',
    public readonly originalError?: Error,
  ) {
    super(message, { code: 'NETWORK_ERROR', statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Timeout error when request exceeds time limit
 */
export class TimeoutError extends AppError {
  constructor(
    message = 'Request timed out',
    public readonly timeoutMs?: number,
  ) {
    super(message, {
      code: 'TIMEOUT_ERROR',
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      details: timeoutMs !== undefined ? { timeoutMs } : undefined,
    });
  }
}

/**
 * Creates a typed error from an HTTP response
 *
 * Maps HTTP status codes to specific error types from @bslt/shared:
 * - 400 -> BadRequestError
 * - 401 -> AuthenticationError
 * - 403 -> ForbiddenError
 * - 404 -> NotFoundError
 * - 409 -> ConflictError
 * - 422 -> UnprocessableError
 * - 429 -> TooManyRequestsError
 * - 5xx -> InternalError
 * - Other -> ApiError
 *
 * @param status - HTTP status code
 * @param body - Parsed error response body
 * @returns Typed error instance
 *
 * @example
 * ```ts
 * const error = createApiError(401, { message: 'Invalid credentials' });
 * if (error instanceof AuthenticationError) {
 *   // Handle auth error
 * }
 * ```
 */
export function createApiError(status: number, body?: ApiErrorBody): AppError {
  const message = body?.message ?? `HTTP ${status.toString()}`;
  const code = body?.code;
  const details = body?.details;

  switch (status) {
    case HTTP_STATUS.BAD_REQUEST:
      return new BadRequestError(message, code, details);

    case HTTP_STATUS.UNAUTHORIZED:
      return new AuthenticationError(message, code);

    case HTTP_STATUS.FORBIDDEN:
      return new ForbiddenError(message, code);

    case HTTP_STATUS.NOT_FOUND:
      return new NotFoundError(message, code);

    case HTTP_STATUS.CONFLICT:
      return new ConflictError(message, code);

    case HTTP_STATUS.UNPROCESSABLE_ENTITY:
      return new UnprocessableError(message, code, details);

    case HTTP_STATUS.TOO_MANY_REQUESTS: {
      const err = new TooManyRequestsError(message);
      // Preserve lock metadata from the server response (Sprint 3.15)
      if (typeof body?.lockReason === 'string') {
        (err as TooManyRequestsError & { lockReason?: string }).lockReason = body.lockReason;
      }
      if (typeof body?.lockedUntil === 'string') {
        (err as TooManyRequestsError & { lockedUntil?: string }).lockedUntil = body.lockedUntil;
      }
      return err;
    }

    default:
      if (status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        return new InternalError(message, code);
      }
      return new ApiError(message, status, code, details);
  }
}

/**
 * Type guard to check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Type guard to check if an error is a NetworkError
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * Type guard to check if an error is a TimeoutError
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Type guard to check if an error indicates the user is authenticated
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

/**
 * Extract a user-friendly error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return ERROR_MESSAGES.DEFAULT;
}
