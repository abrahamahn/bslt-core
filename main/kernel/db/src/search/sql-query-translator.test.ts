// main/kernel/db/src/search/sql-query-translator.test.ts

import { describe, expect, it } from 'vitest';

import { FILTER_OPERATORS } from './core-types';
import {
  buildFullTextOrderBy,
  buildOrderByClause,
  buildWhereClause,
  escapeLikePattern,
  resolveColumnName,
} from './sql-query-translator';

import type { SqlTableConfig } from './types';

const tableConfig: SqlTableConfig = {
  table: 'users',
  primaryKey: 'id',
  columns: [
    { field: 'id', column: 'id', type: 'string' },
    { field: 'firstName', column: 'first_name', type: 'string' },
  ],
};

describe('sql-query-translator', () => {
  it('escapes LIKE wildcard characters', () => {
    expect(escapeLikePattern('100%_test\\path')).toBe('100\\%\\_test\\\\path');
  });

  it('resolves mapped and known columns', () => {
    expect(resolveColumnName(tableConfig, 'firstName')).toBe('first_name');
    expect(resolveColumnName(tableConfig, 'id')).toBe('id');
    expect(resolveColumnName(tableConfig, 'unknown')).toBeUndefined();
  });

  it('builds WHERE and ORDER BY clauses', () => {
    let idx = 0;
    const where = buildWhereClause(
      {
        filters: {
          field: 'firstName',
          operator: FILTER_OPERATORS.EQ,
          value: 'Ada',
        },
      },
      tableConfig,
      { maxQueryDepth: 5, maxConditions: 20 },
      () => String(++idx),
    );
    expect(where).toEqual({ text: 'first_name = $1', values: ['Ada'] });
    expect(buildOrderByClause(tableConfig, [{ field: 'firstName', order: 'desc' }])).toBe(
      'first_name DESC',
    );
  });

  it('translates FullText filter operator and multi-column query.search with ts_rank ordering', () => {
    let idx = 0;
    const ftsFilter = buildWhereClause(
      {
        filters: {
          field: 'firstName',
          operator: FILTER_OPERATORS.FullText,
          value: 'Ada Lovelace',
        },
      },
      tableConfig,
      { maxQueryDepth: 5, maxConditions: 20 },
      () => String(++idx),
    );
    expect(ftsFilter).toEqual({
      text: "to_tsvector('simple', COALESCE(first_name::text, '')) @@ websearch_to_tsquery('simple', $1)",
      values: ['Ada Lovelace'],
    });

    idx = 0;
    const blankFilter = buildWhereClause(
      {
        filters: {
          field: 'firstName',
          operator: FILTER_OPERATORS.FullText,
          value: '   ',
        },
      },
      tableConfig,
      { maxQueryDepth: 5, maxConditions: 20 },
      () => String(++idx),
    );
    expect(blankFilter).toEqual({ text: 'false', values: [] });

    idx = 0;
    const searchQuery = {
      search: { query: 'ada', fields: ['firstName', 'id'] },
    };
    const searchWhere = buildWhereClause(
      searchQuery,
      tableConfig,
      { maxQueryDepth: 5, maxConditions: 20 },
      () => String(++idx),
    );
    expect(searchWhere).toEqual({
      text: "to_tsvector('simple', concat_ws(' ', COALESCE(first_name::text, ''), COALESCE(id::text, ''))) @@ websearch_to_tsquery('simple', $1)",
      values: ['ada'],
    });

    const rankOrder = buildFullTextOrderBy(searchQuery, tableConfig, () => String(++idx));
    expect(rankOrder).toEqual({
      text: "ts_rank(to_tsvector('simple', concat_ws(' ', COALESCE(first_name::text, ''), COALESCE(id::text, ''))), websearch_to_tsquery('simple', $2)) DESC",
      values: ['ada'],
    });
  });
});
