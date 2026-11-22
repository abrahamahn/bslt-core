// main/kernel/db/src/repositories/types.ts
/**
 * Repository Types
 *
 * Common types used across kernel repositories.
 */

import type {
  CursorPaginatedResult as ContractCursorPaginatedResult,
  CursorPaginationOptions as ContractCursorPaginationOptions,
} from '@bslt/contract';

export type CursorPaginatedResult<T> = ContractCursorPaginatedResult<T>;
export type CursorPaginationOptions = ContractCursorPaginationOptions;

/**
 * Time range filter
 */
export interface TimeRangeFilter {
  /** Start of range (inclusive) */
  from?: Date;
  /** End of range (inclusive) */
  to?: Date;
}
