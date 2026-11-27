// main/kernel/db/src/utils/pagination.helpers.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createPaginationHelpers } from './pagination.helpers';

import type { CursorPaginationQueryBuilder, OffsetPaginationQueryBuilder } from './pagination';

describe('createPaginationHelpers', () => {
  it('creates offset paginated results including empty and boundary pages', () => {
    const helpers = createPaginationHelpers();

    const empty = helpers.createOffsetResult([], 0, { page: 1, limit: 10, sortOrder: 'desc' });
    expect(empty.data).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.hasNext).toBe(false);
    expect(empty.hasPrev).toBe(false);
    expect(empty.totalPages).toBe(0);

    const middle = helpers.createOffsetResult(['a', 'b'], 5, {
      page: 2,
      limit: 2,
      sortOrder: 'desc',
    });
    expect(middle.hasNext).toBe(true);
    expect(middle.hasPrev).toBe(true);
    expect(middle.totalPages).toBe(3);

    const last = helpers.createOffsetResult(['e'], 5, { page: 3, limit: 2, sortOrder: 'desc' });
    expect(last.hasNext).toBe(false);
    expect(last.hasPrev).toBe(true);
  });

  it('creates cursor paginated results for both terminal and continuing pages', () => {
    const helpers = createPaginationHelpers();

    const terminal = helpers.createCursorResult([{ id: '1' }], null, false, 20);
    expect(terminal).toEqual({
      data: [{ id: '1' }],
      nextCursor: null,
      hasNext: false,
      limit: 20,
    });

    const continuing = helpers.createCursorResult([{ id: '1' }], 'cursor-abc', true, 1);
    expect(continuing.nextCursor).toBe('cursor-abc');
    expect(continuing.hasNext).toBe(true);
  });

  it('delegates applyOffsetPagination for success and propagates query builder failures', async () => {
    const helpers = createPaginationHelpers();
    const okBuilder: OffsetPaginationQueryBuilder<{ id: string }> = {
      orderBy: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue({ count: '3' }),
      offset: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
    };

    const result = await helpers.applyOffsetPagination(okBuilder, {
      page: 1,
      limit: 2,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(result).toEqual({ data: [{ id: '1' }, { id: '2' }], total: 3 });
    expect(okBuilder.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(okBuilder.offset).toHaveBeenCalledWith(0);
    expect(okBuilder.limit).toHaveBeenCalledWith(2);

    const failingBuilder: OffsetPaginationQueryBuilder<{ id: string }> = {
      orderBy: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(10),
      offset: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error('offset query failed')),
    };

    await expect(
      helpers.applyOffsetPagination(failingBuilder, { page: 1, limit: 10, sortOrder: 'desc' }),
    ).rejects.toThrow('offset query failed');
  });

  it('delegates applyCursorPagination for success and propagates query failures', async () => {
    const helpers = createPaginationHelpers();
    const okBuilder: CursorPaginationQueryBuilder<{ id: string; createdAt: string }> = {
      whereRaw: vi.fn().mockReturnThis(),
      orderByRaw: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: '1', createdAt: '2026-01-03T00:00:00.000Z' },
        { id: '2', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: '3', createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    };

    const page = await helpers.applyCursorPagination(
      okBuilder,
      { limit: 2, sortOrder: 'desc' },
      'createdAt',
    );
    expect(page.data).toHaveLength(2);
    expect(page.hasNext).toBe(true);
    expect(page.nextCursor).not.toBeNull();

    const failingBuilder: CursorPaginationQueryBuilder<{ id: string; createdAt: string }> = {
      whereRaw: vi.fn().mockReturnThis(),
      orderByRaw: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error('cursor query failed')),
    };

    await expect(
      helpers.applyCursorPagination(failingBuilder, { limit: 10, sortOrder: 'desc' }, 'createdAt'),
    ).rejects.toThrow('cursor query failed');
  });
});
