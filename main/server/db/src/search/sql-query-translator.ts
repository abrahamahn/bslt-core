// main/server/db/src/search/sql-query-translator.ts
/**
 * SQL Search Query Translator
 *
 * Pure translation functions that convert abstract search filters, sort
 * specifications, and pagination cursors into parameterized SQL fragments.
 *
 * @module
 */

import { FILTER_OPERATORS, LOGICAL_OPERATORS } from '@bslt/shared/constants';
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  InvalidFilterError,
  isCompoundFilter,
  isFilterCondition,
  QueryTooComplexError,
  type CompoundFilter,
  type FilterCondition,
  type SearchQuery,
  type SortConfig,
} from '@bslt/shared/db';

import type { SqlTableConfig } from './types';

/**
 * SQL fragment with parameterized values.
 * Used internally to build complex SQL queries safely.
 */
export interface SqlFragment {
  /** SQL text with $1, $2, etc. placeholders */
  text: string;
  /** Parameter values corresponding to placeholders */
  values: unknown[];
}

export interface SqlTranslationConfig {
  maxQueryDepth: number;
  maxConditions: number;
}

/**
 * Escape SQL LIKE metacharacters in user input.
 * Prevents users from injecting wildcards like % or _ into search patterns.
 *
 * @param value - Raw user input string.
 * @returns Escaped string safe for use in LIKE/ILIKE patterns.
 * @complexity O(n) where n is the string length.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Resolve a field name to its actual column name.
 * Checks column mappings first, then validates against allowed columns.
 *
 * @param tableConfig - Table and column configuration.
 * @param field - Field name from the query.
 * @returns Resolved column name, or undefined if not found.
 * @complexity O(n) where n is the number of column mappings.
 */
export function resolveColumnName(tableConfig: SqlTableConfig, field: string): string | undefined {
  const mapping = tableConfig.columns.find((c) => c.field === field);
  if (mapping != null) {
    return mapping.column;
  }

  const isKnownColumn = tableConfig.columns.some((c) => c.column === field || c.field === field);
  if (tableConfig.columns.length === 0 || isKnownColumn) {
    return field;
  }

  return undefined;
}

/**
 * Build a WHERE clause from query filters.
 */
export function buildWhereClause<TRecord extends Record<string, unknown>>(
  query: SearchQuery<TRecord>,
  tableConfig: SqlTableConfig,
  config: SqlTranslationConfig,
  nextParam: () => string,
): SqlFragment | undefined {
  if (query.filters == null) {
    return undefined;
  }

  const context = { conditionCount: 0 };
  return translateFilter(query.filters, tableConfig, config, nextParam, 0, context);
}

/**
 * Translate a filter condition or compound filter to SQL.
 */
function translateFilter<TRecord extends Record<string, unknown>>(
  filter: FilterCondition<TRecord> | CompoundFilter<TRecord>,
  tableConfig: SqlTableConfig,
  config: SqlTranslationConfig,
  nextParam: () => string,
  depth = 0,
  context: { conditionCount: number } = { conditionCount: 0 },
): SqlFragment | undefined {
  if (depth > config.maxQueryDepth) {
    throw new QueryTooComplexError(
      `Filter nesting exceeds maximum depth of ${String(config.maxQueryDepth)}`,
      config.maxQueryDepth,
      config.maxConditions,
    );
  }

  if (isFilterCondition(filter)) {
    context.conditionCount++;
    if (context.conditionCount > config.maxConditions) {
      throw new QueryTooComplexError(
        `Filter exceeds maximum of ${String(config.maxConditions)} conditions`,
        config.maxQueryDepth,
        config.maxConditions,
      );
    }
    return translateCondition(filter, tableConfig, nextParam);
  }

  if (isCompoundFilter(filter)) {
    return translateCompound(filter, tableConfig, config, nextParam, depth, context);
  }

  return undefined;
}

/**
 * Translate a single filter condition to SQL.
 */
function translateCondition<TRecord extends Record<string, unknown>>(
  condition: FilterCondition<TRecord>,
  tableConfig: SqlTableConfig,
  nextParam: () => string,
): SqlFragment | undefined {
  const fieldName = String(condition.field);
  const columnName = resolveColumnName(tableConfig, fieldName);
  if (columnName == null || columnName === '') {
    throw new InvalidFilterError(`Unknown field: ${fieldName}`, fieldName);
  }

  const value = condition.value;
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

  switch (condition.operator) {
    case FILTER_OPERATORS.EQ:
      return { text: `${columnName} = $${nextParam()}`, values: [value] };

    case FILTER_OPERATORS.NEQ:
      return { text: `${columnName} <> $${nextParam()}`, values: [value] };

    case FILTER_OPERATORS.GT:
      return { text: `${columnName} > $${nextParam()}`, values: [value] };

    case FILTER_OPERATORS.GTE:
      return { text: `${columnName} >= $${nextParam()}`, values: [value] };

    case FILTER_OPERATORS.LT:
      return { text: `${columnName} < $${nextParam()}`, values: [value] };

    case FILTER_OPERATORS.LTE:
      return { text: `${columnName} <= $${nextParam()}`, values: [value] };

    case FILTER_OPERATORS.CONTAINS:
      return {
        text: `${columnName} ILIKE $${nextParam()}`,
        values: [`%${escapeLikePattern(stringValue)}%`],
      };

    case FILTER_OPERATORS.StartsWith:
      return {
        text: `${columnName} ILIKE $${nextParam()}`,
        values: [`${escapeLikePattern(stringValue)}%`],
      };

    case FILTER_OPERATORS.EndsWith:
      return {
        text: `${columnName} ILIKE $${nextParam()}`,
        values: [`%${escapeLikePattern(stringValue)}`],
      };

    case FILTER_OPERATORS.LIKE:
      return {
        text:
          condition.caseSensitive === true
            ? `${columnName} LIKE $${nextParam()}`
            : `${columnName} ILIKE $${nextParam()}`,
        values: [value],
      };

    case FILTER_OPERATORS.ILIKE:
      return { text: `${columnName} ILIKE $${nextParam()}`, values: [value] };

    case FILTER_OPERATORS.IN: {
      if (!Array.isArray(value) || value.length === 0) {
        return { text: 'false', values: [] };
      }
      const placeholders = value.map(() => `$${nextParam()}`).join(', ');
      return { text: `${columnName} IN (${placeholders})`, values: value };
    }

    case FILTER_OPERATORS.NotIn: {
      if (!Array.isArray(value) || value.length === 0) {
        return undefined;
      }
      const placeholders = value.map(() => `$${nextParam()}`).join(', ');
      return { text: `${columnName} NOT IN (${placeholders})`, values: value };
    }

    case FILTER_OPERATORS.IsNull:
      return { text: `${columnName} IS NULL`, values: [] };

    case FILTER_OPERATORS.IsNotNull:
      return { text: `${columnName} IS NOT NULL`, values: [] };

    case FILTER_OPERATORS.BETWEEN:
      if (typeof value === 'object' && value !== null && 'min' in value && 'max' in value) {
        return {
          text: `${columnName} BETWEEN $${nextParam()} AND $${nextParam()}`,
          values: [value.min, value.max],
        };
      }
      throw new InvalidFilterError(
        'BETWEEN operator requires {min, max} value',
        fieldName,
        condition.operator,
      );

    case FILTER_OPERATORS.ArrayContains:
    case FILTER_OPERATORS.ArrayContainsAny:
    case FILTER_OPERATORS.FullText:
    default:
      throw new InvalidFilterError(
        `Unsupported operator: ${condition.operator as string}`,
        fieldName,
        condition.operator,
      );
  }
}

/**
 * Translate a compound filter (AND/OR/NOT) to SQL.
 */
function translateCompound<TRecord extends Record<string, unknown>>(
  compound: CompoundFilter<TRecord>,
  tableConfig: SqlTableConfig,
  config: SqlTranslationConfig,
  nextParam: () => string,
  depth = 0,
  context: { conditionCount: number } = { conditionCount: 0 },
): SqlFragment | undefined {
  const fragments = compound.conditions
    .map((condition: FilterCondition<TRecord> | CompoundFilter<TRecord>) =>
      translateFilter(condition, tableConfig, config, nextParam, depth + 1, context),
    )
    .filter((fragment: SqlFragment | undefined): fragment is SqlFragment => fragment !== undefined);

  if (fragments.length === 0) {
    return undefined;
  }

  const combinedText = fragments
    .map((fragment: SqlFragment) => `(${fragment.text})`)
    .join(compound.operator === LOGICAL_OPERATORS.AND ? ' AND ' : ' OR ');
  const combinedValues = fragments.flatMap((fragment: SqlFragment) => fragment.values);

  switch (compound.operator) {
    case LOGICAL_OPERATORS.AND:
      return { text: combinedText, values: combinedValues };

    case LOGICAL_OPERATORS.OR:
      return { text: combinedText, values: combinedValues };

    case LOGICAL_OPERATORS.NOT:
      return { text: `NOT (${combinedText})`, values: combinedValues };

    default:
      throw new InvalidFilterError(`Unknown logical operator: ${String(compound.operator)}`);
  }
}

/**
 * Build an ORDER BY clause from sort configuration.
 */
export function buildOrderByClause<TRecord extends Record<string, unknown>>(
  tableConfig: SqlTableConfig,
  sort?: SortConfig<TRecord>[],
): string {
  if (sort == null || sort.length === 0) {
    const pkKey = Array.isArray(tableConfig.primaryKey)
      ? tableConfig.primaryKey[0]
      : tableConfig.primaryKey;
    const pkColumn =
      pkKey != null && pkKey !== '' ? resolveColumnName(tableConfig, pkKey) : undefined;
    return pkColumn != null && pkColumn !== '' ? `${pkColumn} ASC` : '';
  }

  return sort
    .map((s) => {
      const columnName = resolveColumnName(tableConfig, String(s.field));
      if (columnName == null || columnName === '') return null;
      return `${columnName} ${s.order === 'desc' ? 'DESC' : 'ASC'}`;
    })
    .filter((s): s is string => s !== null)
    .join(', ');
}

/**
 * Build a cursor condition for keyset pagination.
 */
export function buildCursorCondition<TRecord extends Record<string, unknown>>(
  cursor: string,
  sort: SortConfig<TRecord>[],
  tableConfig: SqlTableConfig,
  nextParam: () => string,
): SqlFragment | undefined {
  try {
    const decoded = decodeCursor(cursor);

    if (decoded == null) {
      throw new InvalidCursorError('Invalid cursor format');
    }

    const firstSort = sort[0];
    const sortField = firstSort != null ? String(firstSort.field) : 'id';
    const sortOrder = firstSort?.order ?? 'asc';
    const cursorValue = decoded.value;

    const columnName = resolveColumnName(tableConfig, sortField);
    if (columnName == null || columnName === '') {
      throw new InvalidCursorError(`Unknown sort field in cursor: ${sortField}`);
    }

    const operator = sortOrder === 'desc' ? '<' : '>';
    return {
      text: `${columnName} ${operator} $${nextParam()}`,
      values: [cursorValue],
    };
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw error;
    }
    throw new InvalidCursorError('Failed to decode cursor');
  }
}

/**
 * Create an encoded cursor from a record and sort configuration.
 */
export function createCursor<TRecord extends Record<string, unknown>>(
  record: TRecord,
  sort: SortConfig<TRecord>[],
): string {
  const firstSort = sort[0];
  const sortField = firstSort != null ? String(firstSort.field) : 'id';
  const sortValue = record[sortField];
  const tieBreaker = String(record['id'] ?? record[sortField]);

  return encodeCursor({
    value: sortValue as string | number | Date,
    tieBreaker,
    sortOrder: firstSort?.order ?? 'asc',
  });
}
