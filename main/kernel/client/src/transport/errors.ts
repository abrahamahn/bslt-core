// main/kernel/client/src/transport/errors.ts
import {
  AppError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ERROR_MESSAGES,
  ForbiddenError,
  HTTP_STATUS,
  InternalError,
  NotFoundError,
  TooManyRequestsError,
  UnprocessableError,
  type ErrorStatusCode,
} from '@bslt/contract';

export interface TransportErrorBody {
  readonly message?: string | undefined;
  readonly code?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;
  readonly lockReason?: string | undefined;
  readonly lockedUntil?: string | undefined;
}

export class ApiError extends AppError {
  constructor(
    message: string,
    public readonly status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    const options: {
      statusCode: ErrorStatusCode;
      code?: string;
      details?: Record<string, unknown>;
    } = { statusCode: status as ErrorStatusCode };
    if (code !== undefined) options.code = code;
    if (details !== undefined) options.details = details;
    super(message, options);
  }

  isClientError(): boolean {
    return (
      this.status >= HTTP_STATUS.BAD_REQUEST && this.status < HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }

  isServerError(): boolean {
    return this.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR;
  }

  isRetryable(): boolean {
    return (
      this.status === HTTP_STATUS.TOO_MANY_REQUESTS ||
      this.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}

export class NetworkError extends AppError {
  constructor(
    message = 'Network request failed',
    public readonly originalError?: Error,
  ) {
    super(message, { code: 'NETWORK_ERROR', statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}

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

export function createApiError(status: number, body?: TransportErrorBody): AppError {
  const message = body?.message ?? `HTTP ${status.toString()}`;
  const code = body?.code;
  const details = body?.details;

  switch (status) {
    case HTTP_STATUS.BAD_REQUEST:
      return new BadRequestError(message, code, details);
    case HTTP_STATUS.UNAUTHORIZED:
      return new AuthenticationError(message, code);
    case HTTP_STATUS.FORBIDDEN:
      return new ForbiddenError(message, code, details);
    case HTTP_STATUS.NOT_FOUND:
      return new NotFoundError(message, code);
    case HTTP_STATUS.CONFLICT:
      return new ConflictError(message, code);
    case HTTP_STATUS.UNPROCESSABLE_ENTITY:
      return new UnprocessableError(message, code, details);
    case HTTP_STATUS.TOO_MANY_REQUESTS: {
      const err = new TooManyRequestsError(message, code, { details });
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
        return new InternalError(message, code, details);
      }
      return new ApiError(message, status, code, details);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return ERROR_MESSAGES.DEFAULT;
}
