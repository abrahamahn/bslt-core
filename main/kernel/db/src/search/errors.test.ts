// main/kernel/db/src/search/errors.test.ts
import { describe, expect, test } from 'vitest';

import { AppError } from '@bslt/contract';

import { SEARCH_ERROR_TYPES } from './core-types';
import {
  InvalidCursorError,
  InvalidFieldError,
  InvalidFilterError,
  InvalidOperatorError,
  InvalidPaginationError,
  InvalidQueryError,
  InvalidSortError,
  isInvalidFilterError,
  isInvalidQueryError,
  isSearchError,
  isSearchProviderError,
  isSearchTimeoutError,
  QueryTooComplexError,
  SearchError,
  SearchProviderError,
  SearchProviderUnavailableError,
  SearchTimeoutError,
  UnsupportedOperatorError,
} from './errors';

describe('search errors', () => {
  test('constructs all search error subclasses with unique codes and HTTP status codes', () => {
    const errors: SearchError[] = [
      new InvalidQueryError(),
      new InvalidFilterError('msg', 'field', 'op'),
      new InvalidOperatorError('op', ['eq']),
      new InvalidFieldError('field', ['id']),
      new InvalidSortError(),
      new InvalidPaginationError(),
      new InvalidCursorError(),
      new SearchProviderError('msg', 'sql', new Error('boom')),
      new SearchProviderUnavailableError('sql'),
      new UnsupportedOperatorError('op', 'sql'),
      new QueryTooComplexError('complex', 5, 50),
      new SearchTimeoutError(1000),
    ];

    const codes = new Set(errors.map((e) => e.errorType));
    expect(codes.size).toBe(errors.length);

    for (const err of errors) {
      expect(err).toBeInstanceOf(SearchError);
      expect(err).toBeInstanceOf(AppError);
      expect(err.toJSON().ok).toBe(false);
    }

    expect(new SearchProviderError('m', 'p').statusCode).toBe(500);
    expect(new SearchProviderUnavailableError('p').statusCode).toBe(503);
    expect(new SearchTimeoutError(1000).statusCode).toBe(504);
    expect(new InvalidQueryError().expose).toBe(true);
    expect(new SearchProviderError('m', 'p').expose).toBe(false);
  });

  test('rejects non-matching types across type guards adversarially', () => {
    const base = new SearchError('base', SEARCH_ERROR_TYPES.InvalidQuery);
    expect(base instanceof InvalidQueryError).toBe(false);
    expect(isSearchError(null)).toBe(false);
    expect(isSearchError(undefined)).toBe(false);
    expect(isSearchError({ message: 'fake' })).toBe(false);
    expect(isInvalidQueryError(new InvalidFilterError())).toBe(false);
    expect(isInvalidFilterError(new InvalidQueryError())).toBe(false);
    expect(isSearchProviderError(base)).toBe(false);
    expect(isSearchTimeoutError(base)).toBe(false);
    expect(isSearchProviderError(new SearchProviderError('m', 'sql'))).toBe(true);
    expect(isSearchTimeoutError(new SearchTimeoutError(500))).toBe(true);
  });
});
