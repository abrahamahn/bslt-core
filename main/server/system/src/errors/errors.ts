// main/server/system/src/errors/errors.ts

import {
  AppError,
  getKindForStatusCode,
  getStatusCodeForKind,
  normalizeUnknownError,
  toErrorWire,
} from '@bslt/shared/system';

import type {
  ErrorMapperLogger,
  ErrorMapperOptions,
  HttpErrorResponse,
  ToHttpErrorOptions,
} from './types';

function getLogLevel(error: AppError): 'info' | 'warn' | 'error' {
  switch (error.kind) {
    case 'rate_limit':
      return 'warn';
    case 'external_dependency':
    case 'timeout':
      return 'warn';
    case 'unavailable':
    case 'internal':
      return 'error';
    default:
      return 'info';
  }
}

function logAppError(
  logger: ErrorMapperLogger,
  originalError: unknown,
  appError: AppError,
  context?: Record<string, unknown>,
): void {
  const level = getLogLevel(appError);
  const message = `${appError.kind} error [${appError.code}]: ${appError.message}`;

  if (level === 'error') {
    logger.error(originalError, `Internal server error [${appError.code}]`, context);
    return;
  }

  if (level === 'warn') {
    logger.warn(context ?? {}, message);
    return;
  }

  if (logger.info !== undefined) {
    logger.info(message, context);
    return;
  }

  logger.warn(context ?? {}, message);
}

function buildHttpErrorResponse(appError: AppError, isProduction: boolean): HttpErrorResponse {
  const wireError = toErrorWire(appError, isProduction);
  const retryAfter =
    appError.retryAfterMs !== undefined ? Math.ceil(appError.retryAfterMs / 1000) : undefined;

  return {
    status: getStatusCodeForKind(appError.kind),
    wire: wireError,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  };
}

function resolveToAppError(error: unknown, correlationId?: string): AppError {
  return normalizeUnknownError(error).attachCorrelationId(correlationId);
}

export function toHttpErrorResponse(
  error: unknown,
  options: ToHttpErrorOptions = {},
): HttpErrorResponse {
  return buildHttpErrorResponse(
    resolveToAppError(error, options.correlationId),
    options.isProduction ?? false,
  );
}

export function mapErrorToHttpResponse(
  error: unknown,
  logger: ErrorMapperLogger,
  options: ErrorMapperOptions = {},
): HttpErrorResponse {
  const correlationId = options.logContext?.['correlationId'];
  const appError = resolveToAppError(
    error,
    typeof correlationId === 'string' ? correlationId : undefined,
  );

  logAppError(logger, error, appError, options.logContext);
  return buildHttpErrorResponse(appError, options.isProduction ?? false);
}

export function createHttpErrorResponse(
  status: HttpErrorResponse['status'],
  message: string,
  options: {
    code?: string;
    details?: Record<string, unknown>;
    correlationId?: string;
    retryAfter?: number;
  } = {},
): HttpErrorResponse {
  const kind = getKindForStatusCode(status);
  return {
    status,
    wire: {
      code: options.code ?? `system.${kind}`,
      kind,
      message,
      ...(options.details !== undefined ? { details: options.details } : {}),
      ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
    },
    ...(options.retryAfter !== undefined ? { retryAfter: options.retryAfter } : {}),
  };
}
