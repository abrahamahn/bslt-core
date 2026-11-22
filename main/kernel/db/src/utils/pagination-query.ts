// main/kernel/db/src/utils/pagination-query.ts
import { createCursorForItem, decodeCursor, getSortableValue, type CursorData } from './cursor';
import { PaginationError } from './pagination-core';

import type { CursorPaginationOptions, SortOrder } from '@bslt/contract';

const SAFE_SQL_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

function safeSqlIdentifier(name: string, label: string): string {
  if (!SAFE_SQL_IDENTIFIER.test(name)) {
    throw new PaginationError(
      'INVALID_SORT_FIELD',
      `Invalid ${label}: "${name}". Must be a lowercase identifier (a-z, 0-9, _).`,
    );
  }
  return `"${name}"`;
}

export function buildCursorPaginationQuery(
  cursor: string | undefined,
  sortBy: string,
  sortOrder: SortOrder,
  tieBreakerField: string = 'id',
): {
  whereClause: string;
  orderByClause: string;
  params: unknown[];
} {
  const safeSortBy = safeSqlIdentifier(sortBy, 'sortBy');
  const safeTieBreaker = safeSqlIdentifier(tieBreakerField, 'tieBreakerField');

  const params: unknown[] = [];
  let whereClause = '';

  if (cursor !== undefined && cursor !== '') {
    const cursorData = decodeCursor(cursor);
    if (cursorData === null) {
      throw new PaginationError('INVALID_CURSOR', `Invalid cursor provided: ${cursor}`);
    }

    if (cursorData.sortOrder !== sortOrder) {
      throw new PaginationError(
        'CURSOR_SORT_MISMATCH',
        `Cursor sort order '${cursorData.sortOrder}' does not match requested sort order '${sortOrder}'`,
      );
    }

    const operator = sortOrder === 'asc' ? '>' : '<';
    whereClause = `(
      (${safeSortBy} ${operator} $1) OR
      (${safeSortBy} = $1 AND ${safeTieBreaker} ${operator} $2)
    )`;

    params.push(cursorData.value, cursorData.tieBreaker);
  }

  const direction = sortOrder.toUpperCase();
  const orderByClause = `${safeSortBy} ${direction}, ${safeTieBreaker} ${direction}`;

  return {
    whereClause,
    orderByClause,
    params,
  };
}

export function calculateCursorPaginationMetadata<T extends { id: unknown }>(
  items: T[],
  requestedLimit: number,
  sortBy: string,
  sortOrder: SortOrder,
  tieBreakerField?: keyof T,
): { hasNext: boolean; nextCursor: string | null };
export function calculateCursorPaginationMetadata<T>(
  items: T[],
  requestedLimit: number,
  sortBy: string,
  sortOrder: SortOrder,
  tieBreakerField: keyof T,
): { hasNext: boolean; nextCursor: string | null };
export function calculateCursorPaginationMetadata<T>(
  items: T[],
  requestedLimit: number,
  sortBy: string,
  sortOrder: SortOrder,
  tieBreakerField?: keyof T,
): {
  hasNext: boolean;
  nextCursor: string | null;
} {
  const field = tieBreakerField ?? ('id' as keyof T);
  const hasNext = items.length > requestedLimit;
  const actualItems = hasNext ? items.slice(0, -1) : items;

  const lastItem = actualItems[actualItems.length - 1];
  const nextCursor =
    hasNext && lastItem !== undefined
      ? createCursorForItem(lastItem, sortBy, sortOrder, field)
      : null;

  return {
    hasNext,
    nextCursor,
  };
}

export function paginateArrayWithCursor<T extends { id: unknown }>(
  items: T[],
  options: CursorPaginationOptions,
  sortBy?: string,
  tieBreakerField?: keyof T,
): { data: T[]; nextCursor: string | null; hasNext: boolean };
export function paginateArrayWithCursor<T>(
  items: T[],
  options: CursorPaginationOptions,
  sortBy: string,
  tieBreakerField: keyof T,
): { data: T[]; nextCursor: string | null; hasNext: boolean };
export function paginateArrayWithCursor<T>(
  items: T[],
  options: CursorPaginationOptions,
  sortBy: string = 'id',
  tieBreakerField?: keyof T,
): {
  data: T[];
  nextCursor: string | null;
  hasNext: boolean;
} {
  const field = tieBreakerField ?? ('id' as keyof T);
  const { cursor, limit, sortOrder } = options;
  const effectiveSortBy = options.sortBy ?? sortBy;

  const sortedItems = [...items].sort((a, b) => {
    const aValue = getSortableValue(a, effectiveSortBy);
    const bValue = getSortableValue(b, effectiveSortBy);

    let comparison = 0;
    if (aValue < bValue) comparison = -1;
    if (aValue > bValue) comparison = 1;

    if (comparison === 0) {
      const aTieBreaker = String(getSortableValue(a, String(field)));
      const bTieBreaker = String(getSortableValue(b, String(field)));
      comparison = aTieBreaker.localeCompare(bTieBreaker);
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  let startIndex = 0;
  if (cursor !== undefined && cursor !== '') {
    const cursorData = decodeCursor(cursor);
    if (cursorData !== null) {
      const cursorIndex = sortedItems.findIndex((item) => {
        const itemValue = getSortableValue(item, effectiveSortBy);
        const itemTieBreaker = String(getSortableValue(item, String(field)));

        if (sortOrder === 'asc') {
          return (
            itemValue > cursorData.value ||
            (itemValue === cursorData.value && itemTieBreaker > cursorData.tieBreaker)
          );
        }
        return (
          itemValue < cursorData.value ||
          (itemValue === cursorData.value && itemTieBreaker < cursorData.tieBreaker)
        );
      });
      startIndex = cursorIndex === -1 ? sortedItems.length : cursorIndex;
    }
  }

  const endIndex = startIndex + limit + 1;
  const paginatedItems = sortedItems.slice(startIndex, endIndex);

  const metadata = calculateCursorPaginationMetadata(
    paginatedItems,
    limit,
    effectiveSortBy,
    sortOrder,
    field,
  );

  return {
    data: paginatedItems.slice(0, limit),
    nextCursor: metadata.nextCursor,
    hasNext: metadata.hasNext,
  };
}

function sortItemsEfficiently<T>(
  items: T[],
  sortBy: string,
  sortOrder: SortOrder,
  tieBreakerField: keyof T,
): T[] {
  return [...items].sort((a, b) => {
    const aValue = getSortableValue(a, sortBy);
    const bValue = getSortableValue(b, sortBy);

    if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;

    const aTieBreaker = String(getSortableValue(a, String(tieBreakerField)));
    const bTieBreaker = String(getSortableValue(b, String(tieBreakerField)));
    const tieBreakerComparison = aTieBreaker.localeCompare(bTieBreaker);

    return sortOrder === 'asc' ? tieBreakerComparison : -tieBreakerComparison;
  });
}

function findCursorIndexBinary<T>(
  sortedItems: T[],
  cursorData: CursorData,
  sortBy: string,
  sortOrder: SortOrder,
  tieBreakerField: keyof T,
): number {
  let left = 0;
  let right = sortedItems.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const item = sortedItems[mid];

    if (item === undefined) break;

    const itemValue = getSortableValue(item, sortBy);
    const itemTieBreaker = String(getSortableValue(item, String(tieBreakerField)));

    const shouldContinue =
      sortOrder === 'asc'
        ? itemValue < cursorData.value ||
          (itemValue === cursorData.value && itemTieBreaker <= cursorData.tieBreaker)
        : itemValue > cursorData.value ||
          (itemValue === cursorData.value && itemTieBreaker >= cursorData.tieBreaker);

    if (shouldContinue) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

export function paginateLargeArrayWithCursor<T extends { id: unknown }>(
  items: T[],
  options: CursorPaginationOptions,
  sortBy?: string,
  tieBreakerField?: keyof T,
): { data: T[]; nextCursor: string | null; hasNext: boolean };
export function paginateLargeArrayWithCursor<T>(
  items: T[],
  options: CursorPaginationOptions,
  sortBy: string,
  tieBreakerField: keyof T,
): { data: T[]; nextCursor: string | null; hasNext: boolean };
export function paginateLargeArrayWithCursor<T>(
  items: T[],
  options: CursorPaginationOptions,
  sortBy: string = 'id',
  tieBreakerField?: keyof T,
): {
  data: T[];
  nextCursor: string | null;
  hasNext: boolean;
} {
  const field = tieBreakerField ?? ('id' as keyof T);
  const { cursor, limit, sortOrder } = options;
  const effectiveSortBy = options.sortBy ?? sortBy;

  const sortedItems = sortItemsEfficiently(items, effectiveSortBy, sortOrder, field);

  let startIndex = 0;
  if (cursor !== undefined && cursor !== '') {
    const cursorData = decodeCursor(cursor);
    if (cursorData !== null) {
      startIndex = findCursorIndexBinary(
        sortedItems,
        cursorData,
        effectiveSortBy,
        sortOrder,
        field,
      );
    }
  }

  const endIndex = Math.min(startIndex + limit + 1, sortedItems.length);
  const paginatedItems = sortedItems.slice(startIndex, endIndex);

  const metadata = calculateCursorPaginationMetadata(
    paginatedItems,
    limit,
    effectiveSortBy,
    sortOrder,
    field,
  );

  return {
    data: paginatedItems.slice(0, limit),
    nextCursor: metadata.nextCursor,
    hasNext: metadata.hasNext,
  };
}
