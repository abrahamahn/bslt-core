// main/kernel/db/src/utils/pagination-http.ts
import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  PAGINATION_ERROR_TYPES,
  PaginationError,
} from './pagination-core';

interface PaginationParamNames {
  page: string;
  limit: string;
  cursor: string;
  sortBy: string;
  sortOrder: string;
}

export const DEFAULT_PAGINATION_PARAMS: PaginationParamNames = {
  page: 'page',
  limit: 'limit',
  cursor: 'cursor',
  sortBy: 'sortBy',
  sortOrder: 'sortOrder',
};

interface PaginationParseConfig {
  defaultLimit?: number;
  maxLimit?: number;
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
}

export function parsePageParam(pageParam: string | string[] | undefined): number {
  if (pageParam == null) return 1;

  const page = Array.isArray(pageParam) ? (pageParam[0] ?? '') : pageParam;
  const parsed = Number(page);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PaginationError(
      PAGINATION_ERROR_TYPES.INVALID_PAGE,
      `Invalid page parameter: ${page}. Must be a positive integer.`,
    );
  }

  return parsed;
}

export function parseLimitParam(
  limitParam: string | string[] | undefined,
  config: PaginationParseConfig = {},
): number {
  const { defaultLimit = DEFAULT_PAGINATION_LIMIT, maxLimit = 1000 } = config;

  if (limitParam == null) return defaultLimit;

  const limit = Array.isArray(limitParam) ? (limitParam[0] ?? '') : limitParam;
  const parsed = Number(limit);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PaginationError(
      PAGINATION_ERROR_TYPES.INVALID_LIMIT,
      `Invalid limit parameter: ${limit}. Must be a positive integer.`,
    );
  }

  if (parsed > maxLimit) {
    throw new PaginationError(
      PAGINATION_ERROR_TYPES.INVALID_LIMIT,
      `Limit parameter ${String(parsed)} exceeds maximum allowed limit of ${String(maxLimit)}.`,
    );
  }

  return parsed;
}

export function parseSortByParam(
  sortByParam: string | string[] | undefined,
  config: PaginationParseConfig = {},
): string {
  const { defaultSortBy = DEFAULT_SORT_BY } = config;

  if (sortByParam === undefined) return defaultSortBy;

  const sortBy = Array.isArray(sortByParam) ? (sortByParam[0] ?? '') : sortByParam;

  if (sortBy.trim() === '') {
    throw new PaginationError(
      PAGINATION_ERROR_TYPES.INVALID_SORT_FIELD,
      'Invalid sortBy parameter: cannot be empty.',
    );
  }

  return sortBy;
}

export function parseSortOrderParam(
  sortOrderParam: string | string[] | undefined,
  config: PaginationParseConfig = {},
): 'asc' | 'desc' {
  const { defaultSortOrder = DEFAULT_SORT_ORDER } = config;

  if (sortOrderParam == null) return defaultSortOrder;

  const sortOrder = Array.isArray(sortOrderParam) ? (sortOrderParam[0] ?? '') : sortOrderParam;

  if (sortOrder === 'asc' || sortOrder === 'desc') {
    return sortOrder;
  }

  throw new PaginationError(
    PAGINATION_ERROR_TYPES.INVALID_SORT_ORDER,
    `Invalid sortOrder parameter: ${sortOrder}. Must be 'asc' or 'desc'.`,
  );
}

export function getQueryParam(
  query: Record<string, unknown>,
  key: string,
): string | string[] | undefined {
  if (key === '') return undefined;
  const value = query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value;
  }
  return undefined;
}
