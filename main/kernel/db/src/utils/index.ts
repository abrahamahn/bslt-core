// main/kernel/db/src/utils/index.ts
export {
  buildColumnList,
  buildInsertClause,
  buildSetClause,
  camelToSnake,
  camelizeKeys,
  formatJsonb,
  parseJsonb,
  snakeToCamel,
  snakeifyKeys,
  toCamelCase,
  toCamelCaseArray,
  toSnakeCase,
  type ColumnMapping,
} from './database';
export {
  applyOffsetPagination,
  applyCursorPagination,
  buildCursorCondition,
  buildCursorResult,
  combineConditions,
  type CountResult,
  type CursorPaginationQueryBuilder,
  type OffsetPaginationQueryBuilder,
} from './pagination';
export { PaginationError } from './pagination-core';
export {
  getQueryParam,
  parseLimitParam,
  parsePageParam,
  parseSortByParam,
  parseSortOrderParam,
} from './pagination-http';
export { buildPostgresDsn, type PostgresDsnParts } from './postgres-dsn';
export { isInTransaction, withTransaction } from './transaction';
