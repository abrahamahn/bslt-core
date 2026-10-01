// main/shared/src/modules/system/errors/errors.ts
import { HTTP_STATUS } from '../../../constants/system';

export const ERROR_CODES = {
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
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_KINDS = [
  'validation',
  'authentication',
  'authorization',
  'not_found',
  'conflict',
  'rate_limit',
  'external_dependency',
  'timeout',
  'unavailable',
  'internal',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export type ErrorContext = Record<string, unknown>;

export type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504;

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationIssue {
  path: ReadonlyArray<string | number>;
  message: string;
  code: string;
}

export interface ErrorWire {
  code: string;
  kind: ErrorKind;
  message: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export interface AppErrorInit {
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

type LegacyAppErrorOptions = {
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
  validation: HTTP_STATUS.BAD_REQUEST as ErrorStatusCode,
  authentication: HTTP_STATUS.UNAUTHORIZED as ErrorStatusCode,
  authorization: HTTP_STATUS.FORBIDDEN as ErrorStatusCode,
  not_found: HTTP_STATUS.NOT_FOUND as ErrorStatusCode,
  conflict: HTTP_STATUS.CONFLICT as ErrorStatusCode,
  rate_limit: HTTP_STATUS.TOO_MANY_REQUESTS as ErrorStatusCode,
  external_dependency: HTTP_STATUS.BAD_GATEWAY as ErrorStatusCode,
  timeout: HTTP_STATUS.GATEWAY_TIMEOUT as ErrorStatusCode,
  unavailable: HTTP_STATUS.SERVICE_UNAVAILABLE as ErrorStatusCode,
  internal: HTTP_STATUS.INTERNAL_SERVER_ERROR as ErrorStatusCode,
};

function defaultCodeForKind(kind: ErrorKind): string {
  return ERROR_CODES[kind];
}

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

function statusCodeFromKind(kind: ErrorKind): ErrorStatusCode {
  return KIND_TO_STATUS[kind];
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
  options: LegacyAppErrorOptions,
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
      expose: messageOrInit.expose ?? statusCodeFromKind(kind) < 500,
      metadata: messageOrInit.metadata,
      statusCode: messageOrInit.statusCode ?? statusCodeFromKind(kind),
    };
  }

  const kind = options.kind ?? kindFromStatusCode(options.statusCode);
  return {
    code: options.code ?? defaultCodeForKind(kind),
    kind,
    message: messageOrInit,
    publicMessage: options.publicMessage,
    details: options.details,
    cause: options.cause,
    retryable: options.retryable ?? kind !== 'validation',
    retryAfterMs: normalizeRetryAfterMs(options.retryAfterMs),
    expose: options.expose ?? statusCodeFromKind(kind) < 500,
    metadata: options.metadata,
    statusCode: options.statusCode ?? statusCodeFromKind(kind),
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

function getErrorName(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

const STRUCTURAL_APP_ERROR_INSTANCE_NAMES: Record<string, readonly string[] | undefined> = {
  AppError: undefined,
  AuthenticationError: ['AuthenticationError', 'UnauthorizedError'],
  AuthorizationError: ['AuthorizationError', 'ForbiddenError'],
  BadRequestError: ['BadRequestError'],
  ConflictError: ['ConflictError'],
  ExternalDependencyError: ['ExternalDependencyError'],
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
  ValidationError: ['ValidationError'],
};

function hasStructuralAppErrorInstance(value: unknown, constructorName: string): boolean {
  if (!hasAppErrorBrand(value)) {
    return false;
  }

  if (constructorName === 'AppError') {
    return true;
  }

  const errorName = getErrorName(value);
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
  constructor(message: string, options?: LegacyAppErrorOptions);
  constructor(messageOrInit: string | AppErrorInit, options: LegacyAppErrorOptions = {}) {
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
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
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

export class ValidationError extends AppError {
  public readonly fields: Record<string, string[]>;

  constructor(message: string, issues: FieldError[] | Record<string, string[]>) {
    const fields = Array.isArray(issues)
      ? issues.reduce<Record<string, string[]>>((acc, issue) => {
          (acc[issue.field] ??= []).push(issue.message);
          return acc;
        }, {})
      : issues;

    super({
      code: ERROR_CODES.validation,
      kind: 'validation',
      message,
      publicMessage: message,
      details: { fields },
      retryable: false,
      statusCode: HTTP_STATUS.BAD_REQUEST,
    });

    this.fields = fields;
  }
}

export class BadRequestError extends AppError {
  constructor(
    message = 'Bad request',
    code: string = ERROR_CODES.validation,
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
    code: string = ERROR_CODES.validation,
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
  constructor(message = 'Unauthorized', code: string = ERROR_CODES.authentication) {
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

export class UnauthorizedError extends AuthenticationError {}

export class AuthorizationError extends AppError {
  constructor(message = 'Forbidden', code: string = ERROR_CODES.authorization) {
    super({
      code,
      kind: 'authorization',
      message,
      publicMessage: message,
      retryable: false,
      statusCode: HTTP_STATUS.FORBIDDEN,
    });
  }
}

export class ForbiddenError extends AuthorizationError {}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: string = ERROR_CODES.not_found) {
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
  constructor(message = 'Conflict', code: string = ERROR_CODES.conflict) {
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
    code: string = ERROR_CODES.rate_limit,
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

export class RateLimitError extends TooManyRequestsError {}

export class ExternalDependencyError extends AppError {
  constructor(
    message = 'External dependency failed',
    code: string = ERROR_CODES.external_dependency,
    details?: Record<string, unknown>,
  ) {
    super({
      code,
      kind: 'external_dependency',
      message,
      publicMessage: message,
      details,
      retryable: true,
      statusCode: HTTP_STATUS.BAD_GATEWAY,
    });
  }
}

export class TimeoutError extends AppError {
  constructor(
    message = 'Request timed out',
    code: string = ERROR_CODES.timeout,
    options: {
      retryAfterMs?: number | undefined;
      details?: Record<string, unknown> | undefined;
    } = {},
  ) {
    super({
      code,
      kind: 'timeout',
      message,
      publicMessage: message,
      details: options.details,
      retryable: true,
      retryAfterMs: options.retryAfterMs,
      statusCode: HTTP_STATUS.GATEWAY_TIMEOUT,
    });
  }
}

export class UnavailableError extends AppError {
  constructor(
    message = 'Service unavailable',
    code: string = ERROR_CODES.unavailable,
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

export class ServiceUnavailableError extends UnavailableError {}

export class InternalError extends AppError {
  constructor(
    message = 'Internal server error',
    code: string = ERROR_CODES.internal,
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
    | Array<{ message: string; path?: ReadonlyArray<string | number> }>
    | undefined;

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

    super(normalizedIssues[0]?.message ?? 'Validation failed', ERROR_CODES.validation, {
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
    return new InternalError(error.message, ERROR_CODES.internal, undefined, error);
  }

  return new InternalError('Unknown error', ERROR_CODES.internal, undefined, error);
}

export function toErrorWire(error: AppError, isProduction: boolean): ErrorWire {
  return error.toWire(isProduction).error;
}
