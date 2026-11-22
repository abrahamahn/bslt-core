// main/kernel/db/src/search/errors.ts
import { AppError, HTTP_STATUS, type ErrorStatusCode } from '@bslt/contract';

import { SEARCH_ERROR_TYPES } from './core-types';

type SearchErrorType = (typeof SEARCH_ERROR_TYPES)[keyof typeof SEARCH_ERROR_TYPES];

export class SearchError extends AppError {
  constructor(
    message: string,
    public readonly errorType: SearchErrorType,
    statusCode: number = HTTP_STATUS.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    super(message, { statusCode: statusCode as ErrorStatusCode, code: errorType, details });
    this.name = 'SearchError';
  }
}

export class InvalidQueryError extends SearchError {
  constructor(message = 'Invalid search query', details?: Record<string, unknown>) {
    super(message, SEARCH_ERROR_TYPES.InvalidQuery, HTTP_STATUS.BAD_REQUEST, details);
    this.name = 'InvalidQueryError';
  }
}

export class InvalidFilterError extends SearchError {
  constructor(
    message = 'Invalid filter condition',
    public readonly field?: string,
    public readonly operator?: string,
    details?: Record<string, unknown>,
  ) {
    super(message, SEARCH_ERROR_TYPES.InvalidFilter, HTTP_STATUS.BAD_REQUEST, {
      field,
      operator,
      ...details,
    });
    this.name = 'InvalidFilterError';
  }
}

export class InvalidOperatorError extends SearchError {
  constructor(operator: string, supportedOperators?: string[], details?: Record<string, unknown>) {
    super(
      `Unknown filter operator: ${operator}`,
      SEARCH_ERROR_TYPES.InvalidOperator,
      HTTP_STATUS.BAD_REQUEST,
      { operator, supportedOperators, ...details },
    );
    this.name = 'InvalidOperatorError';
  }
}

export class InvalidFieldError extends SearchError {
  constructor(field: string, allowedFields?: string[], details?: Record<string, unknown>) {
    super(`Invalid field: ${field}`, SEARCH_ERROR_TYPES.InvalidField, HTTP_STATUS.BAD_REQUEST, {
      field,
      allowedFields,
      ...details,
    });
    this.name = 'InvalidFieldError';
  }
}

export class InvalidSortError extends SearchError {
  constructor(message = 'Invalid sort configuration', details?: Record<string, unknown>) {
    super(message, SEARCH_ERROR_TYPES.InvalidSort, HTTP_STATUS.BAD_REQUEST, details);
    this.name = 'InvalidSortError';
  }
}

export class InvalidPaginationError extends SearchError {
  constructor(message = 'Invalid pagination parameters', details?: Record<string, unknown>) {
    super(message, SEARCH_ERROR_TYPES.InvalidPagination, HTTP_STATUS.BAD_REQUEST, details);
    this.name = 'InvalidPaginationError';
  }
}

export class InvalidCursorError extends SearchError {
  constructor(message = 'Invalid or expired cursor', details?: Record<string, unknown>) {
    super(message, SEARCH_ERROR_TYPES.InvalidCursor, HTTP_STATUS.BAD_REQUEST, details);
    this.name = 'InvalidCursorError';
  }
}

export class SearchProviderError extends SearchError {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly originalError?: Error,
    details?: Record<string, unknown>,
  ) {
    super(message, SEARCH_ERROR_TYPES.ProviderError, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      providerName,
      ...details,
    });
    this.name = 'SearchProviderError';
  }
}

export class SearchProviderUnavailableError extends SearchError {
  constructor(
    providerName: string,
    message = `Search provider '${providerName}' is unavailable`,
    details?: Record<string, unknown>,
  ) {
    super(message, SEARCH_ERROR_TYPES.ProviderUnavailable, HTTP_STATUS.SERVICE_UNAVAILABLE, {
      providerName,
      ...details,
    });
    this.name = 'SearchProviderUnavailableError';
  }
}

export class UnsupportedOperatorError extends SearchError {
  constructor(
    operator: string,
    providerName: string,
    supportedOperators?: string[],
    details?: Record<string, unknown>,
  ) {
    super(
      `Operator '${operator}' is not supported by provider '${providerName}'`,
      SEARCH_ERROR_TYPES.UnsupportedOperator,
      HTTP_STATUS.BAD_REQUEST,
      { operator, providerName, supportedOperators, ...details },
    );
    this.name = 'UnsupportedOperatorError';
  }
}

export class QueryTooComplexError extends SearchError {
  constructor(
    message = 'Query is too complex',
    public readonly maxDepth?: number,
    public readonly maxConditions?: number,
    details?: Record<string, unknown>,
  ) {
    super(message, SEARCH_ERROR_TYPES.QueryTooComplex, HTTP_STATUS.BAD_REQUEST, {
      maxDepth,
      maxConditions,
      ...details,
    });
    this.name = 'QueryTooComplexError';
  }
}

export class SearchTimeoutError extends SearchError {
  constructor(
    public readonly timeoutMs: number,
    message = `Search query timed out after ${String(timeoutMs)}ms`,
    details?: Record<string, unknown>,
  ) {
    super(message, SEARCH_ERROR_TYPES.SearchTimeout, HTTP_STATUS.GATEWAY_TIMEOUT, {
      timeoutMs,
      ...details,
    });
    this.name = 'SearchTimeoutError';
  }
}

export function isSearchError(error: unknown): error is SearchError {
  return error instanceof SearchError;
}

export function isInvalidQueryError(error: unknown): error is InvalidQueryError {
  return error instanceof InvalidQueryError;
}

export function isInvalidFilterError(error: unknown): error is InvalidFilterError {
  return error instanceof InvalidFilterError;
}

export function isSearchProviderError(error: unknown): error is SearchProviderError {
  return error instanceof SearchProviderError;
}

export function isSearchTimeoutError(error: unknown): error is SearchTimeoutError {
  return error instanceof SearchTimeoutError;
}
