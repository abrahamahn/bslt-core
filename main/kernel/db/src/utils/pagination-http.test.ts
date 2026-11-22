// main/kernel/db/src/utils/pagination-http.test.ts
import { describe, expect, it } from 'vitest';

import { PAGINATION_ERROR_TYPES, PaginationError } from './pagination-core';
import {
  DEFAULT_PAGINATION_PARAMS,
  getQueryParam,
  parseLimitParam,
  parsePageParam,
  parseSortByParam,
  parseSortOrderParam,
} from './pagination-http';

describe('pagination-http parameter parsers', () => {
  it('parses valid page parameters and rejects non-positive/non-integer inputs', () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam('5')).toBe(5);
    expect(parsePageParam(['3', '7'])).toBe(3);

    expect(() => parsePageParam('0')).toThrow(PaginationError);
    expect(() => parsePageParam('-1')).toThrow(PaginationError);
    expect(() => parsePageParam('1.5')).toThrow(PaginationError);
    expect(() => parsePageParam('10abc')).toThrow(PaginationError);
    expect(() => parsePageParam('')).toThrow(PaginationError);
    expect(() => parsePageParam([])).toThrow(PaginationError);
  });

  it('parses valid limit parameters with default 50 and enforces maxLimit', () => {
    expect(parseLimitParam(undefined)).toBe(50);
    expect(parseLimitParam(undefined, { defaultLimit: 25 })).toBe(25);
    expect(parseLimitParam('1000')).toBe(1000);
    expect(parseLimitParam(['10', '50'])).toBe(10);

    expect(() => parseLimitParam('1001')).toThrow(PaginationError);
    expect(() => parseLimitParam('101', { maxLimit: 100 })).toThrow(PaginationError);
    expect(() => parseLimitParam('0')).toThrow(PaginationError);
    expect(() => parseLimitParam('-1')).toThrow(PaginationError);
    expect(() => parseLimitParam('10.9')).toThrow(PaginationError);
    expect(() => parseLimitParam('')).toThrow(PaginationError);
  });

  it('parses sortBy and rejects empty or whitespace-only inputs', () => {
    expect(parseSortByParam(undefined)).toBe('createdAt');
    expect(parseSortByParam(undefined, { defaultSortBy: 'name' })).toBe('name');
    expect(parseSortByParam('email')).toBe('email');

    expect(() => parseSortByParam('')).toThrow(PaginationError);
    expect(() => parseSortByParam('   ')).toThrow(PaginationError);
    expect(() => parseSortByParam([])).toThrow(PaginationError);
  });

  it('parses sortOrder strictly in lowercase and rejects tampered case or values', () => {
    expect(parseSortOrderParam(undefined)).toBe('desc');
    expect(parseSortOrderParam('asc')).toBe('asc');
    expect(parseSortOrderParam(['desc', 'asc'])).toBe('desc');

    expect(() => parseSortOrderParam('ASC')).toThrow(PaginationError);
    expect(() => parseSortOrderParam('DESC')).toThrow(PaginationError);
    expect(() => parseSortOrderParam(' asc')).toThrow(PaginationError);
    expect(() => parseSortOrderParam('1')).toThrow(PaginationError);

    try {
      parseSortOrderParam('ASC');
      expect.fail('expected PaginationError');
    } catch (err) {
      expect(PaginationError.isType(err, PAGINATION_ERROR_TYPES.INVALID_SORT_ORDER)).toBe(true);
    }
  });

  it('extracts string or string-array query params and rejects non-string shapes', () => {
    expect(getQueryParam({ page: '3' }, 'page')).toBe('3');
    expect(getQueryParam({ tags: ['a', 'b'] }, 'tags')).toEqual(['a', 'b']);
    expect(getQueryParam({ page: 3 }, 'page')).toBeUndefined();
    expect(getQueryParam({ active: true }, 'active')).toBeUndefined();
    expect(getQueryParam({ page: null }, 'page')).toBeUndefined();
    expect(getQueryParam({ tags: ['a', 1] }, 'tags')).toBeUndefined();
    expect(getQueryParam({ '': 'something' }, '')).toBeUndefined();
    expect(DEFAULT_PAGINATION_PARAMS.cursor).toBe('cursor');
  });
});
