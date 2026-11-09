// main/server/db/src/search/sql-provider.ts
/**
 * SQL Search Provider
 *
 * Raw SQL-based search provider for PostgreSQL databases.
 * Translates search queries to SQL with proper escaping and parameterization.
 *
 * @module
 */

import { FILTER_OPERATORS } from '@bslt/shared/constants';
import {
  SearchError,
  SearchProviderError,
  type CursorSearchResult,
  type FacetConfig,
  type FacetedSearchQuery,
  type FacetedSearchResult,
  type FilterOperator,
  type SearchCapabilities,
  type SearchQuery,
  type SearchResult,
  type SortConfig,
} from '@bslt/shared/db';

import {
  buildCursorCondition,
  buildOrderByClause,
  buildWhereClause,
  createCursor,
  resolveColumnName,
  type SqlFragment,
} from './sql-query-translator';

import type { RawDb, Repositories } from '../index';
import type {
  SearchContext,
  ServerSearchProvider,
  SqlSearchProviderConfig,
  SqlTableConfig,
} from './types';

// ============================================================================
// Types
// ============================================================================

/** Row type for count queries */
type CountRow = Record<string, unknown> & { count: string | number };

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<SqlSearchProviderConfig, 'name'>> = {
  maxQueryDepth: 5,
  maxConditions: 50,
  defaultPageSize: 50,
  maxPageSize: 1000,
  timeout: 30000,
  logging: false,
};

const SUPPORTED_OPERATORS: FilterOperator[] = [
  FILTER_OPERATORS.EQ,
  FILTER_OPERATORS.NEQ,
  FILTER_OPERATORS.GT,
  FILTER_OPERATORS.GTE,
  FILTER_OPERATORS.LT,
  FILTER_OPERATORS.LTE,
  FILTER_OPERATORS.CONTAINS,
  FILTER_OPERATORS.StartsWith,
  FILTER_OPERATORS.EndsWith,
  FILTER_OPERATORS.LIKE,
  FILTER_OPERATORS.ILIKE,
  FILTER_OPERATORS.IN,
  FILTER_OPERATORS.NotIn,
  FILTER_OPERATORS.IsNull,
  FILTER_OPERATORS.IsNotNull,
  FILTER_OPERATORS.BETWEEN,
];

// ============================================================================
// SQL Search Provider
// ============================================================================

/**
 * SQL-based search provider using raw parameterized SQL.
 *
 * Translates search queries to SQL with proper escaping and parameterization.
 * Supports offset pagination, cursor pagination, faceted search, and compound filters.
 *
 * @example
 * ```typescript
 * const provider = new SqlSearchProvider(db, repos, {
 *   table: 'users',
 *   primaryKey: 'id',
 *   columns: [
 *     { field: 'name', column: 'name', type: 'string' },
 *     { field: 'email', column: 'email', type: 'string' },
 *   ],
 * });
 *
 * const results = await provider.search({
 *   filters: { field: 'name', operator: 'eq', value: 'John' },
 *   limit: 10,
 * });
 * ```
 */
export class SqlSearchProvider<
  TRecord extends Record<string, unknown> = Record<string, unknown>,
> implements ServerSearchProvider<TRecord> {
  readonly name: string;
  private readonly config: Required<Omit<SqlSearchProviderConfig, 'name'>>;
  private readonly tableConfig: SqlTableConfig;
  private paramIndex: number = 0;

  /**
   * Create a new SQL search provider.
   *
   * @param db - Raw database client for executing queries.
   * @param _repos - Repository container (reserved for future use).
   * @param tableConfig - Table and column configuration.
   * @param config - Optional provider configuration overrides.
   */
  constructor(
    private readonly db: RawDb,
    _repos: Repositories,
    tableConfig: Partial<SqlTableConfig> & { table: string },
    config?: SqlSearchProviderConfig,
  ) {
    this.name = config?.name ?? 'sql';
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tableConfig = {
      ...tableConfig,
      primaryKey: tableConfig.primaryKey ?? 'id',
      columns: tableConfig.columns ?? [],
    };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get provider capabilities.
   *
   * @returns Search capabilities supported by this SQL provider.
   */
  getCapabilities(): SearchCapabilities {
    return {
      fullTextSearch: false,
      fuzzyMatching: false,
      highlighting: false,
      nestedFields: false,
      arrayOperations: true,
      cursorPagination: true,
      maxPageSize: this.config.maxPageSize,
      supportedOperators: SUPPORTED_OPERATORS,
    };
  }

  /**
   * Execute a search query with offset pagination.
   *
   * @param query - Search query with filters, pagination, sorting.
   * @param _context - Optional execution context (unused).
   * @returns Paginated search results.
   * @throws {SearchProviderError} When the SQL query execution fails.
   */
  async search(
    query: SearchQuery<TRecord>,
    _context?: SearchContext,
  ): Promise<SearchResult<TRecord>> {
    const startTime = performance.now();

    try {
      const page = query.page ?? 1;
      const limit = Math.min(query.limit ?? this.config.defaultPageSize, this.config.maxPageSize);
      const offset = (page - 1) * limit;

      // Reset param index for this query
      this.paramIndex = 0;

      // Build WHERE clause
      const whereFragment = this.buildWhereClause(query);
      const orderByClause = this.buildOrderByClause(query.sort);

      // Build the query
      const whereClause = whereFragment != null ? `WHERE ${whereFragment.text}` : '';
      const orderBy = orderByClause !== '' ? `ORDER BY ${orderByClause}` : '';

      const sqlText = `SELECT * FROM ${this.tableConfig.table} ${whereClause} ${orderBy} LIMIT $${this.nextParam()} OFFSET $${this.nextParam()}`;
      const values = [...(whereFragment?.values ?? []), limit + 1, offset];

      const results = await this.db.raw<TRecord>(sqlText, values);

      const hasNext = results.length > limit;
      const data = hasNext ? results.slice(0, limit) : results;

      // Get total count if requested
      const total = query.includeCount === true ? await this.count(query) : undefined;

      const executionTime = performance.now() - startTime;

      return {
        data: data.map((item) => ({ item })),
        page,
        limit,
        hasNext,
        hasPrev: page > 1,
        total,
        totalPages: total !== undefined ? Math.ceil(total / limit) : undefined,
        executionTime,
      };
    } catch (error) {
      throw this.wrapError(error, 'search');
    }
  }

  /**
   * Execute a search query with cursor pagination.
   *
   * @param query - Search query with cursor-based pagination.
   * @param _context - Optional execution context (unused).
   * @returns Cursor-paginated search results.
   * @throws {InvalidCursorError} When the cursor cannot be decoded.
   * @throws {SearchProviderError} When the SQL query execution fails.
   */
  async searchWithCursor(
    query: SearchQuery<TRecord>,
    _context?: SearchContext,
  ): Promise<CursorSearchResult<TRecord>> {
    const startTime = performance.now();

    try {
      const limit = Math.min(query.limit ?? this.config.defaultPageSize, this.config.maxPageSize);

      // Reset param index for this query
      this.paramIndex = 0;

      // Build base WHERE clause
      let whereFragment = this.buildWhereClause(query);

      // Apply cursor if provided
      if (query.cursor != null && query.cursor !== '') {
        const cursorFragment = this.buildCursorCondition(query.cursor, query.sort ?? []);
        if (cursorFragment != null) {
          if (whereFragment != null) {
            whereFragment = {
              text: `(${whereFragment.text}) AND (${cursorFragment.text})`,
              values: [...whereFragment.values, ...cursorFragment.values],
            };
          } else {
            whereFragment = cursorFragment;
          }
        }
      }

      const orderByClause = this.buildOrderByClause(query.sort);
      const whereClause = whereFragment != null ? `WHERE ${whereFragment.text}` : '';
      const orderBy = orderByClause !== '' ? `ORDER BY ${orderByClause}` : '';

      const sqlText = `SELECT * FROM ${this.tableConfig.table} ${whereClause} ${orderBy} LIMIT $${this.nextParam()}`;
      const values = [...(whereFragment?.values ?? []), limit + 1];

      const results = await this.db.raw<TRecord>(sqlText, values);

      const hasNext = results.length > limit;
      const data = hasNext ? results.slice(0, limit) : results;

      // Generate cursors
      const lastItem = data[data.length - 1];
      const nextCursor =
        hasNext && lastItem != null ? this.createCursor(lastItem, query.sort ?? []) : null;

      // Get total count if requested
      const total = query.includeCount === true ? await this.count(query) : undefined;

      const executionTime = performance.now() - startTime;

      return {
        data: data.map((item) => ({ item })),
        nextCursor,
        prevCursor: null,
        hasNext,
        hasPrev: query.cursor !== undefined,
        limit,
        total,
        executionTime,
      };
    } catch (error) {
      throw this.wrapError(error, 'searchWithCursor');
    }
  }

  /**
   * Execute a faceted search query.
   *
   * @param query - Search query with facet configuration.
   * @param context - Optional execution context.
   * @returns Faceted search results with bucket counts.
   * @throws {SearchProviderError} When any query execution fails.
   */
  async searchFaceted(
    query: FacetedSearchQuery<TRecord>,
    context?: SearchContext,
  ): Promise<FacetedSearchResult<TRecord>> {
    const startTime = performance.now();

    try {
      // Get regular search results
      const searchResult = await this.search(query, context);

      // Build facets if requested
      const facets =
        query.facets != null && query.facets.length > 0
          ? await Promise.all(
              query.facets.map(async (facetConfig: FacetConfig) => {
                const columnName = this.resolveColumnName(facetConfig.field);
                if (columnName == null || columnName === '') {
                  return {
                    field: facetConfig.field,
                    buckets: [],
                  };
                }

                // Reset param index for each facet query
                this.paramIndex = 0;
                const whereFragment = this.buildWhereClause(query);
                const facetLimit = facetConfig.size ?? 10;

                const whereClause = whereFragment != null ? `WHERE ${whereFragment.text}` : '';
                const facetSql = `SELECT ${columnName} as value, COUNT(*) as count FROM ${this.tableConfig.table} ${whereClause} GROUP BY ${columnName} ORDER BY count DESC LIMIT $${this.nextParam()}`;
                const values = [...(whereFragment?.values ?? []), facetLimit];

                type FacetRow = Record<string, unknown> & {
                  value: string | number | boolean | Date | null;
                  count: string | number;
                };
                const bucketResults = await this.db.raw<FacetRow>(facetSql, values);

                return {
                  field: facetConfig.field,
                  buckets: bucketResults.map((row) => ({
                    value: row.value,
                    count:
                      typeof row.count === 'number'
                        ? row.count
                        : parseInt(
                            typeof row.count === 'string' ? row.count : String(row.count),
                            10,
                          ),
                  })),
                };
              }),
            )
          : undefined;

      const executionTime = performance.now() - startTime;

      return {
        ...searchResult,
        facets,
        executionTime,
      };
    } catch (error) {
      throw this.wrapError(error, 'searchFaceted');
    }
  }

  /**
   * Count matching results without fetching data.
   *
   * @param query - Search query to count matches for.
   * @param _context - Optional execution context (unused).
   * @returns Number of matching records.
   * @throws {SearchProviderError} When the count query fails.
   */
  async count(query: SearchQuery<TRecord>, _context?: SearchContext): Promise<number> {
    try {
      // Reset param index for this query
      this.paramIndex = 0;
      const whereFragment = this.buildWhereClause(query);
      const whereClause = whereFragment != null ? `WHERE ${whereFragment.text}` : '';

      const countSql = `SELECT COUNT(*) as count FROM ${this.tableConfig.table} ${whereClause}`;
      const countResult = await this.db.raw<CountRow>(countSql, whereFragment?.values ?? []);
      const countValue = countResult[0]?.count;
      return typeof countValue === 'number' ? countValue : parseInt(String(countValue), 10);
    } catch (error) {
      throw this.wrapError(error, 'count');
    }
  }

  /**
   * Check if the provider is healthy/available.
   *
   * @returns `true` if the underlying table is queryable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.db.raw(`SELECT 1 FROM ${this.tableConfig.table} LIMIT 1`, []);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close the provider and release resources.
   * No-op since the database connection is managed externally.
   */
  async close(): Promise<void> {
    // No cleanup needed - connection managed externally
  }

  // ============================================================================
  // Private Methods - Parameter Management
  // ============================================================================

  /**
   * Get the next parameter index for parameterized queries.
   *
   * @returns Next sequential parameter number.
   * @complexity O(1)
   */
  private nextParam(): string {
    return String(++this.paramIndex);
  }

  // ============================================================================
  // Private Methods - Query Translation Delegation
  // ============================================================================

  private buildWhereClause(query: SearchQuery<TRecord>): SqlFragment | undefined {
    return buildWhereClause(query, this.tableConfig, this.config, () => this.nextParam());
  }

  private buildOrderByClause(sort?: SortConfig<TRecord>[]): string {
    return buildOrderByClause(this.tableConfig, sort);
  }

  private buildCursorCondition(
    cursor: string,
    sort: SortConfig<TRecord>[],
  ): SqlFragment | undefined {
    return buildCursorCondition(cursor, sort, this.tableConfig, () => this.nextParam());
  }

  private createCursor(record: TRecord, sort: SortConfig<TRecord>[]): string {
    return createCursor(record, sort);
  }

  private resolveColumnName(field: string): string | undefined {
    return resolveColumnName(this.tableConfig, field);
  }

  /**
   * Wrap an unknown error into a SearchError subclass.
   *
   * @param error - Original error.
   * @param operation - Name of the operation that failed.
   * @returns SearchError wrapping the original error.
   */
  private wrapError(error: unknown, operation: string): SearchError {
    // Preserve all SearchError subclasses (QueryTooComplexError, InvalidFilterError, etc.)
    if (error instanceof SearchError) {
      return error;
    }

    const message =
      error instanceof Error ? error.message : 'Unknown error during search operation';

    return new SearchProviderError(
      `SQL search ${operation} failed: ${message}`,
      this.name,
      error instanceof Error ? error : undefined,
    );
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a SQL search provider.
 *
 * @param db - Raw database client.
 * @param repos - Repository container.
 * @param tableConfig - Table and column configuration.
 * @param config - Optional provider configuration.
 * @returns Configured SQL search provider instance.
 */
export function createSqlSearchProvider<
  TRecord extends Record<string, unknown> = Record<string, unknown>,
>(
  db: RawDb,
  repos: Repositories,
  tableConfig: Partial<SqlTableConfig> & { table: string },
  config?: SqlSearchProviderConfig,
): SqlSearchProvider<TRecord> {
  return new SqlSearchProvider(db, repos, tableConfig, config);
}
