// main/kernel/db/src/utils/pagination.helpers.ts
import { applyCursorPagination, applyOffsetPagination } from './pagination';
import { createPaginatedResult } from './pagination-core';

import type { CursorPaginationQueryBuilder, OffsetPaginationQueryBuilder } from './pagination';
import type {
  CursorPaginatedResult,
  CursorPaginationOptions,
  PaginatedResult,
  PaginationOptions,
} from '@bslt/contract';

export interface PaginationHelpers {
  createOffsetResult: <T>(
    data: T[],
    total: number,
    options: PaginationOptions,
  ) => PaginatedResult<T>;
  createCursorResult: <T>(
    data: T[],
    nextCursor: string | null,
    hasNext: boolean,
    limit: number,
  ) => CursorPaginatedResult<T>;
  applyOffsetPagination: <T>(
    queryBuilder: OffsetPaginationQueryBuilder<T>,
    options: PaginationOptions,
  ) => Promise<{ data: T[]; total: number }>;
  applyCursorPagination: <T extends Record<string, unknown>>(
    queryBuilder: CursorPaginationQueryBuilder<T>,
    options: CursorPaginationOptions,
    sortBy: string,
    tieBreakerField?: string,
  ) => Promise<{ data: T[]; hasNext: boolean; nextCursor: string | null }>;
}

export function createPaginationHelpers(): PaginationHelpers {
  return {
    createOffsetResult,
    createCursorResult,
    applyOffsetPagination,
    applyCursorPagination,
  };
}

function createOffsetResult<T>(
  data: T[],
  total: number,
  options: PaginationOptions,
): PaginatedResult<T> {
  return createPaginatedResult(data, total, options);
}

function createCursorResult<T>(
  data: T[],
  nextCursor: string | null,
  hasNext: boolean,
  limit: number,
): CursorPaginatedResult<T> {
  return {
    data,
    nextCursor,
    hasNext,
    limit,
  };
}
