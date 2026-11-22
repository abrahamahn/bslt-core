// main/kernel/db/src/utils/pagination-query.test.ts
import { describe, expect, it } from 'vitest';

import { encodeCursor } from './cursor';
import { PaginationError } from './pagination-core';
import {
  buildCursorPaginationQuery,
  calculateCursorPaginationMetadata,
  paginateArrayWithCursor,
  paginateLargeArrayWithCursor,
} from './pagination-query';

describe('buildCursorPaginationQuery', () => {
  it('builds query with and without valid cursor', () => {
    const withoutCursor = buildCursorPaginationQuery(undefined, 'createdAt', 'desc');
    expect(withoutCursor.whereClause).toBe('');
    expect(withoutCursor.orderByClause).toBe('"createdAt" DESC, "id" DESC');
    expect(withoutCursor.params).toEqual([]);

    const cursor = encodeCursor({
      value: '2024-01-01T00:00:00Z',
      tieBreaker: '123',
      sortOrder: 'desc',
    });
    const withCursor = buildCursorPaginationQuery(cursor, 'createdAt', 'desc');
    expect(withCursor.whereClause).toContain('"createdAt" < $1');
    expect(withCursor.params).toEqual(['2024-01-01T00:00:00Z', '123']);
  });

  it('rejects SQL injection attempts, invalid cursors, and mismatched sort orders', () => {
    expect(() =>
      buildCursorPaginationQuery(undefined, 'createdAt; DROP TABLE users', 'asc'),
    ).toThrow(PaginationError);
    expect(() => buildCursorPaginationQuery(undefined, "name'--", 'desc')).toThrow(PaginationError);
    expect(() => buildCursorPaginationQuery(undefined, '1field', 'asc')).toThrow(PaginationError);
    expect(() => buildCursorPaginationQuery(undefined, '', 'asc')).toThrow(PaginationError);
    expect(() => buildCursorPaginationQuery(undefined, 'LOWER(name)', 'asc')).toThrow(
      PaginationError,
    );
    expect(() => buildCursorPaginationQuery(undefined, 'a'.repeat(64), 'asc')).toThrow(
      PaginationError,
    );
    expect(() => buildCursorPaginationQuery(undefined, 'createdAt', 'asc', 'tie-breaker')).toThrow(
      PaginationError,
    );
    expect(() => buildCursorPaginationQuery('invalid-cursor', 'createdAt', 'desc')).toThrow(
      PaginationError,
    );

    const ascCursor = encodeCursor({
      value: '2024-01-01T00:00:00Z',
      tieBreaker: '123',
      sortOrder: 'asc',
    });
    expect(() => buildCursorPaginationQuery(ascCursor, 'createdAt', 'desc')).toThrow(
      PaginationError,
    );
  });
});

describe('cursor array pagination and metadata', () => {
  it('computes metadata from lookahead items without leaking the lookahead item', () => {
    const items = [
      { id: '10', name: 'alpha' },
      { id: '20', name: 'beta' },
      { id: '30', name: 'gamma' },
    ];
    const result = calculateCursorPaginationMetadata(items, 2, 'name', 'asc');
    expect(result.hasNext).toBe(true);
    expect(Buffer.from(result.nextCursor!, 'base64url').toString('utf8')).not.toContain('30');
    expect(calculateCursorPaginationMetadata([], 10, 'id', 'asc')).toEqual({
      hasNext: false,
      nextCursor: null,
    });
  });

  it('paginates small and large arrays deterministically across pages', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1), score: i }));
    const first = paginateArrayWithCursor(items, { limit: 7, sortOrder: 'asc' }, 'score');
    expect(first.data).toHaveLength(7);
    expect(first.hasNext).toBe(true);

    let cursor: string | null = null;
    let collected = 0;
    do {
      const page: { data: unknown[]; nextCursor: string | null } = paginateLargeArrayWithCursor(
        items,
        { cursor: cursor ?? undefined, limit: 7, sortOrder: 'asc' },
        'score',
      );
      collected += page.data.length;
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(collected).toBe(25);
  });
});
