// main/kernel/db/src/search/core-types.ts
import type { SortOrder } from '@bslt/contract';

export const FILTER_OPERATORS = Object.freeze({
  EQ: 'eq',
  NEQ: 'neq',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
  CONTAINS: 'contains',
  StartsWith: 'startsWith',
  EndsWith: 'endsWith',
  LIKE: 'like',
  ILIKE: 'ilike',
  IN: 'in',
  NotIn: 'notIn',
  IsNull: 'isNull',
  IsNotNull: 'isNotNull',
  BETWEEN: 'between',
  ArrayContains: 'arrayContains',
  ArrayContainsAny: 'arrayContainsAny',
  FullText: 'fullText',
} as const);

export const LOGICAL_OPERATORS = Object.freeze({
  AND: 'and',
  OR: 'or',
  NOT: 'not',
} as const);

export const SEARCH_ERROR_TYPES = Object.freeze({
  InvalidQuery: 'INVALID_QUERY',
  InvalidFilter: 'INVALID_FILTER',
  InvalidOperator: 'INVALID_OPERATOR',
  InvalidField: 'INVALID_FIELD',
  InvalidSort: 'INVALID_SORT',
  InvalidPagination: 'INVALID_PAGINATION',
  InvalidCursor: 'INVALID_CURSOR',
  ProviderError: 'PROVIDER_ERROR',
  ProviderUnavailable: 'PROVIDER_UNAVAILABLE',
  UnsupportedOperator: 'UNSUPPORTED_OPERATOR',
  QueryTooComplex: 'QUERY_TOO_COMPLEX',
  SearchTimeout: 'SEARCH_TIMEOUT',
} as const);

export type FilterOperator = (typeof FILTER_OPERATORS)[keyof typeof FILTER_OPERATORS];
type LogicalOperator = (typeof LOGICAL_OPERATORS)[keyof typeof LOGICAL_OPERATORS];

type FilterPrimitive = string | number | boolean | Date | null;

type FilterValue =
  FilterPrimitive | FilterPrimitive[] | { min: FilterPrimitive; max: FilterPrimitive };

export interface FilterCondition<T = Record<string, unknown>> {
  field: keyof T | string;
  operator: FilterOperator;
  value: FilterValue;
  caseSensitive?: boolean | undefined;
}

export interface CompoundFilter<T = Record<string, unknown>> {
  operator: LogicalOperator;
  conditions: Array<FilterCondition<T> | CompoundFilter<T>>;
}

export function isFilterCondition<T>(
  filter: FilterCondition<T> | CompoundFilter<T>,
): filter is FilterCondition<T> {
  return 'field' in filter && 'value' in filter;
}

export function isCompoundFilter<T>(
  filter: FilterCondition<T> | CompoundFilter<T>,
): filter is CompoundFilter<T> {
  return 'conditions' in filter && Array.isArray(filter.conditions);
}

export interface SortConfig<T = Record<string, unknown>> {
  field: keyof T | string;
  order: SortOrder;
  nulls?: 'first' | 'last' | undefined;
}

interface FullTextSearchConfig {
  query: string;
  fields?: string[] | undefined;
  fuzziness?: number | undefined;
  highlight?: boolean | undefined;
  highlightPrefix?: string | undefined;
  highlightSuffix?: string | undefined;
}

export interface SearchQuery<T = Record<string, unknown>> {
  filters?: FilterCondition<T> | CompoundFilter<T> | undefined;
  sort?: SortConfig<T>[] | undefined;
  search?: FullTextSearchConfig | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  select?: Array<keyof T | string> | undefined;
  includeCount?: boolean | undefined;
}

interface HighlightedField {
  field: string;
  highlighted: string;
  original: string;
}

interface SearchResultItem<T> {
  item: T;
  score?: number | undefined;
  highlights?: HighlightedField[] | undefined;
}

export interface SearchResult<T> {
  data: SearchResultItem<T>[];
  total?: number | undefined;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
  totalPages?: number | undefined;
  executionTime?: number | undefined;
}

export interface CursorSearchResult<T> {
  data: SearchResultItem<T>[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  limit: number;
  total?: number | undefined;
  executionTime?: number | undefined;
}

export interface SearchCapabilities {
  fullTextSearch: boolean;
  fuzzyMatching: boolean;
  highlighting: boolean;
  nestedFields: boolean;
  arrayOperations: boolean;
  cursorPagination: boolean;
  maxPageSize: number;
  supportedOperators: FilterOperator[];
}

interface FacetBucket {
  value: FilterPrimitive;
  count: number;
  selected?: boolean | undefined;
}

export interface FacetConfig {
  field: string;
  size?: number | undefined;
  sortBy?: 'count' | 'value' | undefined;
  sortOrder?: SortOrder | undefined;
  includeMissing?: boolean | undefined;
}

interface FacetResult {
  field: string;
  buckets: FacetBucket[];
  totalUnique?: number | undefined;
}

export interface FacetedSearchQuery<T = Record<string, unknown>> extends SearchQuery<T> {
  facets?: FacetConfig[] | undefined;
}

export interface FacetedSearchResult<T> extends SearchResult<T> {
  facets?: FacetResult[] | undefined;
}

export interface SqlColumnMapping {
  field: string;
  column: string;
  type?: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'array';
  sortable?: boolean;
  filterable?: boolean;
  expression?: string;
}

export interface SqlTableConfig {
  table: string;
  primaryKey: string | string[];
  columns: SqlColumnMapping[];
  searchColumns?: string[];
  defaultSort?: { column: string; order: 'asc' | 'desc' };
}
