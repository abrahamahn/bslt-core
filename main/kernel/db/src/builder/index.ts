// main/kernel/db/src/builder/index.ts

// Types
export {
  combine,
  EMPTY_FRAGMENT,
  escapeIdentifier,
  formatTable,
  fragment,
  isSqlFragment,
  param,
  raw,
  type DbValue,
  type JoinSpec,
  type QueryBuilder,
  type QueryResult,
  type SortDirection,
  type SortSpec,
  type SqlFragment,
  type SqlText,
  type TableSpec,
} from './types';

// Conditions
export {
  and,
  any,
  arrayContains,
  arrayOverlaps,
  between,
  colEq,
  contains,
  endsWith,
  eq,
  eqSubquery,
  escapeLikePattern,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  jsonbContainedBy,
  jsonbContains,
  jsonbEq,
  jsonbHasAllKeys,
  jsonbHasAnyKey,
  jsonbHasKey,
  jsonbPath,
  jsonbPathEq,
  jsonbPathText,
  like,
  lt,
  lte,
  ne,
  not,
  notBetween,
  notExists,
  notIlike,
  notInArray,
  notLike,
  or,
  rawCondition,
  startsWith,
} from './conditions';

// Select
export { select, selectCount, selectExists } from './select';

// Insert
export { insert } from './insert';

// Update
export { update } from './update';

// Delete
export { del, deleteFrom, truncate, truncateCascade } from './delete';

// Window Functions
export {
  arrayAgg,
  avg,
  count,
  cumeDist,
  denseRank,
  emptyWindow,
  firstValue,
  lag,
  lastValue,
  lead,
  max,
  min,
  nthValue,
  ntile,
  orderBy,
  partitionBy,
  percentRank,
  rank,
  rowNumber,
  stringAgg,
  sum,
} from './window';
