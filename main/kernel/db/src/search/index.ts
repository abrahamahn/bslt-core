// main/kernel/db/src/search/index.ts
/**
 * Search Module Barrel Exports
 */

export { FILTER_OPERATORS } from './core-types';
export { SqlSearchProvider, createSqlSearchProvider } from './sql-provider';

export type {
  IndexHint,
  SearchContext,
  SearchMetrics,
  SearchProviderConfig,
  SearchProviderFactoryOptions,
  SearchProviderType,
  SearchResultWithMetrics,
  ServerSearchProvider,
  SqlColumnMapping,
  SqlCursorData,
  SqlFilterResult,
  SqlOperatorMap,
  SqlOperatorTranslator,
  SqlQueryOptions,
  SqlSearchProviderConfig,
  SqlTableConfig,
} from './types';
