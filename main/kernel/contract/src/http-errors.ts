// main/kernel/contract/src/http-errors.ts
import type { ErrorWire } from './envelope';
import type { ErrorKind, ErrorStatusCode } from './errors';

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  PARTIAL_CONTENT: 206,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RANGE_NOT_SATISFIABLE: 416,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

export const ERROR_CODES = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNHANDLED_EXCEPTION: 'UNHANDLED_EXCEPTION',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RESOURCE_NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  REQUEST_SCHEMA_ERROR: 'REQUEST_SCHEMA_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_REUSED: 'TOKEN_REUSED',
  OAUTH_ERROR: 'OAUTH_ERROR',
  OAUTH_STATE_MISMATCH: 'OAUTH_STATE_MISMATCH',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  TOTP_INVALID: 'TOTP_INVALID',
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
} as const;

export const ERROR_MESSAGES = {
  DEFAULT: 'An unexpected error occurred',
  INTERNAL_ERROR: 'Internal server error',
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Conflict',
  VALIDATION_ERROR: 'Validation failed',
  RATE_LIMITED: 'Too many requests',
  EMAIL_SEND_FAILED: 'Failed to send email',
  INVALID_CREDENTIALS: 'Invalid email or password',
  WEAK_PASSWORD: 'Password is too weak',
  ACCOUNT_LOCKED: 'Account temporarily locked',
  EMAIL_ALREADY_REGISTERED: 'Email already registered',
  EMAIL_NOT_VERIFIED: 'Please verify your email address',
  INVALID_TOKEN: 'Invalid or expired token',
  AUTHENTICATION_REQUIRED: 'Authentication required',
  USER_NOT_FOUND: 'User not found',
  NO_REFRESH_TOKEN: 'No refresh token provided',
  INVALID_OR_EXPIRED_TOKEN: 'Invalid or expired token',
} as const;

export const HTTP_ERROR_MESSAGES = {
  AccountLocked:
    'Account temporarily locked due to too many failed attempts. Please try again later.',
  InvalidCredentials: 'Invalid email or password',
  EmailAlreadyRegistered: 'Email already registered',
  InvalidToken: 'Invalid or expired token',
  WeakPassword: 'Password is too weak',
  EmailSendFailed: 'Failed to send email. Please try again or use the resend option.',
  InternalError: 'Internal server error',
} as const;

export const AUTH_SUCCESS_MESSAGES = {
  LOGGED_OUT: 'Logged out successfully',
  ACCOUNT_UNLOCKED: 'Account unlocked successfully',
  PASSWORD_RESET_SENT: 'Password reset email sent',
  VERIFICATION_EMAIL_SENT:
    'Verification email sent. Please check your inbox and click the confirmation link.',
  MAGIC_LINK_SENT: 'Magic link sent to your email',
  EMAIL_OTP_SENT: 'If an account exists for this email, a security code has been sent.',
} as const;

const SYSTEM_ERROR_CODES: Readonly<Record<ErrorKind, string>> = {
  validation: 'system.validation',
  authentication: 'system.authentication',
  authorization: 'system.authorization',
  not_found: 'system.not_found',
  conflict: 'system.conflict',
  rate_limit: 'system.rate_limit',
  external_dependency: 'system.external_dependency',
  timeout: 'system.timeout',
  unavailable: 'system.unavailable',
  internal: 'system.internal',
};

interface AppErrorInit {
  code: string;
  kind: ErrorKind;
  message: string;
  publicMessage?: string | undefined;
  details?: Record<string, unknown> | undefined;
  cause?: unknown;
  retryable?: boolean | undefined;
  retryAfterMs?: number | undefined;
  expose?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
  statusCode?: ErrorStatusCode | undefined;
}

type AppErrorOptions = {
  kind?: ErrorKind | undefined;
  code?: string | undefined;
  publicMessage?: string | undefined;
  details?: Record<string, unknown> | undefined;
  cause?: unknown;
  retryable?: boolean | undefined;
  retryAfterMs?: number | undefined;
  expose?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
  statusCode?: ErrorStatusCode | undefined;
};

interface ResolvedAppErrorInit {
  code: string;
  kind: ErrorKind;
  message: string;
  statusCode: ErrorStatusCode;
  publicMessage?: string | undefined;
  details?: Record<string, unknown> | undefined;
  cause?: unknown;
  retryable: boolean;
  retryAfterMs?: number | undefined;
  expose: boolean;
  metadata?: Record<string, unknown> | undefined;
}

const KIND_TO_STATUS: Record<ErrorKind, ErrorStatusCode> = {
  validation: HTTP_STATUS.BAD_REQUEST,
  authentication: HTTP_STATUS.UNAUTHORIZED,
  authorization: HTTP_STATUS.FORBIDDEN,
  not_found: HTTP_STATUS.NOT_FOUND,
  conflict: HTTP_STATUS.CONFLICT,
  rate_limit: HTTP_STATUS.TOO_MANY_REQUESTS,
  external_dependency: HTTP_STATUS.BAD_GATEWAY,
  timeout: HTTP_STATUS.GATEWAY_TIMEOUT,
  unavailable: HTTP_STATUS.SERVICE_UNAVAILABLE,
  internal: HTTP_STATUS.INTERNAL_SERVER_ERROR,
};

function kindFromStatusCode(statusCode: ErrorStatusCode | undefined): ErrorKind {
  switch (statusCode) {
    case HTTP_STATUS.BAD_REQUEST:
    case HTTP_STATUS.UNPROCESSABLE_ENTITY:
      return 'validation';
    case HTTP_STATUS.UNAUTHORIZED:
      return 'authentication';
    case HTTP_STATUS.FORBIDDEN:
      return 'authorization';
    case HTTP_STATUS.NOT_FOUND:
      return 'not_found';
    case HTTP_STATUS.CONFLICT:
      return 'conflict';
    case HTTP_STATUS.TOO_MANY_REQUESTS:
      return 'rate_limit';
    case HTTP_STATUS.BAD_GATEWAY:
      return 'external_dependency';
    case HTTP_STATUS.GATEWAY_TIMEOUT:
      return 'timeout';
    case HTTP_STATUS.SERVICE_UNAVAILABLE:
      return 'unavailable';
    case HTTP_STATUS.INTERNAL_SERVER_ERROR:
    default:
      return 'internal';
  }
}

function normalizeRetryAfterMs(retryAfterMs?: number): number | undefined {
  if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    return undefined;
  }
  return retryAfterMs;
}

function isAppErrorInit(value: unknown): value is AppErrorInit {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return (
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

function resolveInit(
  messageOrInit: string | AppErrorInit,
  options: AppErrorOptions,
): ResolvedAppErrorInit {
  if (typeof messageOrInit !== 'string' && isAppErrorInit(messageOrInit)) {
    const kind = messageOrInit.kind;
    return {
      code: messageOrInit.code,
      kind,
      message: messageOrInit.message,
      publicMessage: messageOrInit.publicMessage,
      details: messageOrInit.details,
      cause: messageOrInit.cause,
      retryable: messageOrInit.retryable ?? kind !== 'validation',
      retryAfterMs: normalizeRetryAfterMs(messageOrInit.retryAfterMs),
      expose: messageOrInit.expose ?? KIND_TO_STATUS[kind] < 500,
      metadata: messageOrInit.metadata,
      statusCode: messageOrInit.statusCode ?? KIND_TO_STATUS[kind],
    };
  }

  const kind = options.kind ?? kindFromStatusCode(options.statusCode);
  return {
    code: options.code ?? SYSTEM_ERROR_CODES[kind],
    kind,
    message: messageOrInit,
    publicMessage: options.publicMessage,
    details: options.details,
    cause: options.cause,
    retryable: options.retryable ?? kind !== 'validation',
    retryAfterMs: normalizeRetryAfterMs(options.retryAfterMs),
    expose: options.expose ?? KIND_TO_STATUS[kind] < 500,
    metadata: options.metadata,
    statusCode: options.statusCode ?? KIND_TO_STATUS[kind],
  };
}

export function getStatusCodeForKind(kind: ErrorKind): ErrorStatusCode {
  return KIND_TO_STATUS[kind];
}

export function getKindForStatusCode(statusCode: ErrorStatusCode): ErrorKind {
  return kindFromStatusCode(statusCode);
}

function hasAppErrorBrand(
  value: unknown,
): value is { __isAppError: true; code: string; kind: ErrorKind; message: string } {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as {
    __isAppError?: unknown;
    code?: unknown;
    kind?: unknown;
    message?: unknown;
  };
  return (
    candidate.__isAppError === true &&
    typeof candidate.code === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.message === 'string'
  );
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function hasPrototypeInChain(value: unknown, prototype: object): boolean {
  if (!isObjectLike(value)) {
    return false;
  }
  let current = Object.getPrototypeOf(value) as object | null;
  while (current !== null) {
    if (current === prototype) return true;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

const STRUCTURAL_APP_ERROR_INSTANCE_NAMES: Record<string, readonly string[] | undefined> = {
  AppError: undefined,
  AuthenticationError: ['AuthenticationError', 'UnauthorizedError'],
  AuthorizationError: ['AuthorizationError', 'ForbiddenError'],
  BadRequestError: ['BadRequestError'],
  ConflictError: ['ConflictError'],
  ForbiddenError: ['ForbiddenError'],
  InternalError: ['InternalError'],
  NotFoundError: ['NotFoundError'],
  RateLimitError: ['RateLimitError'],
  RequestSchemaError: ['RequestSchemaError'],
  ServiceUnavailableError: ['ServiceUnavailableError'],
  TimeoutError: ['TimeoutError'],
  TooManyRequestsError: ['TooManyRequestsError', 'RateLimitError'],
  UnauthorizedError: ['UnauthorizedError'],
  UnavailableError: ['UnavailableError', 'ServiceUnavailableError'],
  UnprocessableError: ['UnprocessableError', 'RequestSchemaError'],
};

function hasStructuralAppErrorInstance(value: unknown, constructorName: string): boolean {
  if (!hasAppErrorBrand(value)) {
    return false;
  }
  if (constructorName === 'AppError') {
    return true;
  }
  const rawName = (value as { name?: unknown }).name;
  const errorName = typeof rawName === 'string' && rawName.length > 0 ? rawName : undefined;
  const acceptedNames = STRUCTURAL_APP_ERROR_INSTANCE_NAMES[constructorName];
  return (
    errorName !== undefined && (acceptedNames?.includes(errorName) ?? errorName === constructorName)
  );
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError || hasAppErrorBrand(value);
}

export class AppError extends Error {
  public override name: string;
  public readonly __isAppError = true as const;
  public readonly code: string;
  public readonly kind: ErrorKind;
  public readonly statusCode: ErrorStatusCode;
  public readonly publicMessage: string | undefined;
  public readonly details: Record<string, unknown> | undefined;
  public override cause: unknown;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | undefined;
  public readonly metadata: Record<string, unknown> | undefined;
  public readonly expose: boolean;
  public correlationId: string | undefined;

  public static override [Symbol.hasInstance](value: unknown): boolean {
    if (hasPrototypeInChain(value, this.prototype)) {
      return true;
    }
    return hasStructuralAppErrorInstance(value, this.name);
  }

  constructor(init: AppErrorInit);
  constructor(message: string, options?: AppErrorOptions);
  constructor(messageOrInit: string | AppErrorInit, options: AppErrorOptions = {}) {
    const init = resolveInit(messageOrInit, options);
    super(init.message);
    this.name = new.target.name;
    this.code = init.code;
    this.kind = init.kind;
    this.statusCode = init.statusCode;
    this.publicMessage = init.publicMessage;
    this.details = init.details;
    this.cause = init.cause;
    this.retryable = init.retryable;
    this.retryAfterMs = init.retryAfterMs;
    this.metadata = init.metadata;
    this.expose = init.expose;

    Object.setPrototypeOf(this, new.target.prototype);
    const maybeV8Error = Error as ErrorConstructor & {
      captureStackTrace?: (
        targetObject: object,
        constructorOpt?: abstract new (...args: never[]) => unknown,
      ) => void;
    };
    if (typeof maybeV8Error.captureStackTrace === 'function') {
      maybeV8Error.captureStackTrace(
        this,
        this.constructor as abstract new (...args: never[]) => unknown,
      );
    }
  }

  public attachCorrelationId(correlationId?: string): this {
    if (typeof correlationId !== 'string' || correlationId.length === 0) {
      return this;
    }
    this.correlationId ??= correlationId;
    return this;
  }

  public get retryAfter(): number | undefined {
    return this.retryAfterMs === undefined ? undefined : Math.ceil(this.retryAfterMs / 1000);
  }

  public toWire(isProduction: boolean): { ok: false; error: ErrorWire } {
    return {
      ok: false,
      error: {
        code: this.code,
        kind: this.kind,
        message:
          this.publicMessage !== undefined
            ? this.publicMessage
            : isProduction && this.kind === 'internal'
              ? 'Internal server error'
              : this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
        ...(typeof this.correlationId === 'string' && this.correlationId.length > 0
          ? { correlationId: this.correlationId }
          : {}),
      },
    };
  }

  public toJSON(): { ok: false; error: ErrorWire } {
    return this.toWire(false);
  }
}

export class BadRequestError extends AppError {
  constructor(
    message = 'Bad request',
    code: string = SYSTEM_ERROR_CODES.validation,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super({
      code,
      kind: 'validation',
      message,
      publicMessage: message,
      details,
      cause,
      retryable: false,
      statusCode: HTTP_STATUS.BAD_REQUEST,
    });
  }
}

export class UnprocessableError extends AppError {
  constructor(
    message = 'Unprocessable entity',
    code: string = SYSTEM_ERROR_CODES.validation,
    details?: Record<string, unknown>,
  ) {
    super({
      code,
      kind: 'validation',
      message,
      publicMessage: message,
      details,
      retryable: false,
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      expose: true,
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorized', code: string = SYSTEM_ERROR_CODES.authentication) {
    super({
      code,
      kind: 'authentication',
      message,
      publicMessage: message,
      retryable: false,
      statusCode: HTTP_STATUS.UNAUTHORIZED,
    });
  }
}

class AuthorizationError extends AppError {
  constructor(
    message = 'Forbidden',
    code: string = SYSTEM_ERROR_CODES.authorization,
    details?: Record<string, unknown>,
  ) {
    super({
      code,
      kind: 'authorization',
      message,
      publicMessage: message,
      details,
      retryable: false,
      statusCode: HTTP_STATUS.FORBIDDEN,
    });
  }
}

export class ForbiddenError extends AuthorizationError {}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: string = SYSTEM_ERROR_CODES.not_found) {
    super({
      code,
      kind: 'not_found',
      message,
      publicMessage: message,
      retryable: false,
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code: string = SYSTEM_ERROR_CODES.conflict) {
    super({
      code,
      kind: 'conflict',
      message,
      publicMessage: message,
      retryable: false,
      statusCode: HTTP_STATUS.CONFLICT,
    });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    message = 'Too many requests',
    code: string = SYSTEM_ERROR_CODES.rate_limit,
    options: {
      retryAfterMs?: number | undefined;
      details?: Record<string, unknown> | undefined;
    } = {},
  ) {
    super({
      code,
      kind: 'rate_limit',
      message,
      publicMessage: message,
      details: options.details,
      retryable: true,
      retryAfterMs: normalizeRetryAfterMs(options.retryAfterMs),
      statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
    });
  }
}

export class UnavailableError extends AppError {
  constructor(
    message = 'Service unavailable',
    code: string = SYSTEM_ERROR_CODES.unavailable,
    options: {
      retryAfterMs?: number | undefined;
      details?: Record<string, unknown> | undefined;
    } = {},
  ) {
    super({
      code,
      kind: 'unavailable',
      message,
      publicMessage: message,
      details: options.details,
      retryable: true,
      retryAfterMs: normalizeRetryAfterMs(options.retryAfterMs),
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    });
  }
}

export class InternalError extends AppError {
  constructor(
    message = 'Internal server error',
    code: string = SYSTEM_ERROR_CODES.internal,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super({
      code,
      kind: 'internal',
      message,
      details,
      cause,
      retryable: true,
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    });
  }
}

export class RequestSchemaError extends UnprocessableError {
  public readonly issues:
    Array<{ message: string; path?: ReadonlyArray<string | number> }> | undefined;

  constructor(issues: unknown) {
    const normalizedIssues = Array.isArray(issues)
      ? issues.map((issue) => {
          if (issue !== null && typeof issue === 'object' && 'message' in issue) {
            const pathValue = (issue as { path?: unknown }).path;
            const issueMessage = (issue as { message?: unknown }).message;
            const base = {
              message: typeof issueMessage === 'string' ? issueMessage : 'Validation failed',
            };
            if (Array.isArray(pathValue)) {
              return { ...base, path: pathValue as ReadonlyArray<string | number> };
            }
            return base;
          }
          return { message: 'Validation failed' };
        })
      : [{ message: 'Validation failed' }];

    super(normalizedIssues[0]?.message ?? 'Validation failed', SYSTEM_ERROR_CODES.validation, {
      issues: normalizedIssues,
    });
    this.issues = normalizedIssues;
  }
}

export function normalizeUnknownError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new InternalError(error.message, SYSTEM_ERROR_CODES.internal, undefined, error);
  }
  return new InternalError('Unknown error', SYSTEM_ERROR_CODES.internal, undefined, error);
}

export function toErrorWire(error: AppError, isProduction: boolean): ErrorWire {
  return error.toWire(isProduction).error;
}
