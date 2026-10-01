// main/server/db/src/repositories/types.ts
/**
 * Repository Types
 *
 * Common types used across all repositories.
 * Pagination types are re-exported from @bslt/shared for DRY compliance.
 */

import type {
  CursorPaginatedResult as SharedCursorPaginatedResult,
  CursorPaginationOptions as SharedCursorPaginationOptions,
} from '@bslt/shared/db';

export type CursorPaginatedResult<T> = SharedCursorPaginatedResult<T>;
export type CursorPaginationOptions = SharedCursorPaginationOptions;

/**
 * Time range filter
 */
export interface TimeRangeFilter {
  /** Start of range (inclusive) */
  from?: Date;
  /** End of range (inclusive) */
  to?: Date;
}

/**
 * Base repository interface
 */
export interface Repository<T, TNew, TUpdate = Partial<T>> {
  findById(id: string): Promise<T | null>;
  create(data: TNew): Promise<T>;
  update(id: string, data: TUpdate): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}
