// main/kernel/db/src/utils/pagination-core.test.ts
import { describe, expect, it } from 'vitest';

import {
  calculateOffsetPaginationMetadata,
  calculateSimpleCursorPaginationMetadata,
  createCursorPaginatedResult,
  createPaginatedResult,
  PAGINATION_ERROR_TYPES,
  PaginationError,
} from './pagination-core';

describe('PaginationError', () => {
  it('sets correct properties and details', () => {
    const error = new PaginationError(PAGINATION_ERROR_TYPES.INVALID_CURSOR, 'Bad cursor');
    expect(error.message).toBe('Bad cursor');
    expect(error.type).toBe('INVALID_CURSOR');
    expect(error.name).toBe('PaginationError');
    expect(error.details).toBeUndefined();

    const withDetails = new PaginationError(PAGINATION_ERROR_TYPES.INVALID_LIMIT, 'Bad limit', {
      min: 1,
      max: 1000,
    });
    expect(withDetails.details).toEqual({ min: 1, max: 1000 });
  });

  it('validates isPaginationError and isType guards adversarially', () => {
    const error = new PaginationError(PAGINATION_ERROR_TYPES.INVALID_CURSOR, 'test');
    expect(PaginationError.isPaginationError(error)).toBe(true);
    expect(PaginationError.isPaginationError(new Error('test'))).toBe(false);
    expect(PaginationError.isPaginationError('string')).toBe(false);
    expect(PaginationError.isPaginationError(null)).toBe(false);
    expect(PaginationError.isPaginationError(undefined)).toBe(false);

    expect(PaginationError.isType(error, PAGINATION_ERROR_TYPES.INVALID_CURSOR)).toBe(true);
    expect(PaginationError.isType(error, PAGINATION_ERROR_TYPES.INVALID_LIMIT)).toBe(false);
    expect(PaginationError.isType(new Error('test'), PAGINATION_ERROR_TYPES.INVALID_CURSOR)).toBe(
      false,
    );
    expect(PaginationError.isType(null, PAGINATION_ERROR_TYPES.INVALID_CURSOR)).toBe(false);
  });
});

describe('pagination metadata helpers', () => {
  it('calculates offset metadata across boundary cases', () => {
    expect(calculateOffsetPaginationMetadata({ page: 1, limit: 10, total: 50 })).toEqual({
      hasNext: true,
      hasPrev: false,
      totalPages: 5,
    });
    expect(calculateOffsetPaginationMetadata({ page: 5, limit: 10, total: 50 })).toEqual({
      hasNext: false,
      hasPrev: true,
      totalPages: 5,
    });
    expect(calculateOffsetPaginationMetadata({ page: 1, limit: 10, total: 0 })).toEqual({
      hasNext: false,
      hasPrev: false,
      totalPages: 0,
    });
    expect(calculateOffsetPaginationMetadata({ page: 10, limit: 10, total: 5 })).toEqual({
      hasNext: false,
      hasPrev: true,
      totalPages: 1,
    });
  });

  it('calculates cursor metadata and trims lookahead items', () => {
    const data = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    expect(calculateSimpleCursorPaginationMetadata(data, 3)).toEqual({
      hasNext: true,
      nextCursor: '3',
    });
    expect(calculateSimpleCursorPaginationMetadata([{}, { id: '2' }], 1)).toEqual({
      hasNext: true,
      nextCursor: null,
    });

    const trimmed = createCursorPaginatedResult(data, 3);
    expect(trimmed.data).toHaveLength(3);
    expect(trimmed.hasNext).toBe(true);
    expect(trimmed.nextCursor).toBe('3');

    const offsetResult = createPaginatedResult(['a', 'b'], 20, {
      page: 1,
      limit: 10,
      sortOrder: 'desc',
    });
    expect(offsetResult.totalPages).toBe(2);
    expect(offsetResult.hasNext).toBe(true);
    expect(offsetResult.hasPrev).toBe(false);
  });
});
