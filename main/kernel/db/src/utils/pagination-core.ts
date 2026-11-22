// main/kernel/db/src/utils/pagination-core.ts
import {
  AppError,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  HTTP_STATUS,
  PAGINATION_ERROR_TYPES,
  type CursorPaginatedResult,
  type PaginatedResult,
  type PaginationOptions,
} from '@bslt/contract';

export const DEFAULT_PAGINATION_LIMIT = 50;
export { DEFAULT_SORT_BY, DEFAULT_SORT_ORDER, PAGINATION_ERROR_TYPES };

type PaginationErrorType = (typeof PAGINATION_ERROR_TYPES)[keyof typeof PAGINATION_ERROR_TYPES];

/**
 * Error class for pagination-related errors.
 */
export class PaginationError extends AppError {
  public readonly type: PaginationErrorType;

  constructor(type: PaginationErrorType, message: string, details?: Record<string, unknown>) {
    super(message, {
      code: type,
      statusCode: HTTP_STATUS.BAD_REQUEST,
      details,
    });
    this.type = type;
  }

  static isPaginationError(error: unknown): error is PaginationError {
    return error instanceof PaginationError;
  }

  static isType(error: unknown, type: PaginationErrorType): boolean {
    return error instanceof PaginationError && error.type === type;
  }
}

export function calculateOffsetPaginationMetadata({
  page,
  limit,
  total,
}: {
  page: number;
  limit: number;
  total: number;
}): Pick<PaginatedResult<unknown>, 'hasNext' | 'hasPrev' | 'totalPages'> {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return {
    hasNext,
    hasPrev,
    totalPages,
  };
}

export function calculateSimpleCursorPaginationMetadata<T extends { id?: string | number }>(
  data: T[],
  limit: number,
): Pick<CursorPaginatedResult<T>, 'hasNext' | 'nextCursor'> {
  const hasNext = data.length > limit;
  const lastItemInRange = data[limit - 1];
  const nextCursor =
    hasNext && lastItemInRange !== undefined ? String(lastItemInRange.id ?? '') : null;

  return {
    hasNext,
    nextCursor: nextCursor !== null && nextCursor !== '' ? nextCursor : null,
  };
}

export function createCursorPaginatedResult<T extends { id?: string | number }>(
  data: T[],
  limit: number,
): CursorPaginatedResult<T> {
  const { hasNext, nextCursor } = calculateSimpleCursorPaginationMetadata(data, limit);
  const resultData = data.slice(0, limit);

  return {
    data: resultData,
    nextCursor,
    hasNext,
    limit,
  };
}

export function createPaginatedResult<T>(
  data: T[],
  total: number,
  options: PaginationOptions,
): PaginatedResult<T> {
  const { hasNext, hasPrev, totalPages } = calculateOffsetPaginationMetadata({
    page: options.page,
    limit: options.limit,
    total,
  });

  return {
    data,
    total,
    page: options.page,
    limit: options.limit,
    hasNext,
    hasPrev,
    totalPages,
  };
}
