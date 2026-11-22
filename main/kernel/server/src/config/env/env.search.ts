// main/kernel/server/src/config/env/env.search.ts
/**
 * Search Environment Configuration
 *
 * Search types, env interface, and validation schema.
 * Merged from config/types/services.ts (search section), config/types/index.ts, and config/env.ts.
 *
 * @module config/env.search
 */

import { defaulted, enumOf, number, object, optional } from '@bslt/schema';

import { trueFalseSchema } from './env.base';

import type { SqlColumnMapping, SqlTableConfig } from '@bslt/db';
import type { Schema } from '@bslt/schema';

export type { SqlColumnMapping, SqlTableConfig };

// ============================================================================
// Types
// ============================================================================

/** SQL-based search provider configuration. */
export interface SqlSearchProviderConfig {
  defaultPageSize: number;
  maxPageSize: number;
  maxQueryDepth?: number;
  maxConditions?: number;
  logging?: boolean;
  timeout?: number;
}

/** Unified search configuration for SQL provider. */
interface SqlSearchConfig {
  provider: 'sql';
  config: SqlSearchProviderConfig;
}

/** Unified search configuration. */
export type SearchConfig = SqlSearchConfig;

// ============================================================================
// Env Interface
// ============================================================================

/** Search environment variables */
export interface SearchEnv {
  SEARCH_PROVIDER: 'sql';
  SQL_SEARCH_DEFAULT_PAGE_SIZE?: number | undefined;
  SQL_SEARCH_MAX_PAGE_SIZE?: number | undefined;
  SQL_SEARCH_MAX_QUERY_DEPTH?: number | undefined;
  SQL_SEARCH_MAX_CONDITIONS?: number | undefined;
  SQL_SEARCH_LOGGING?: 'true' | 'false' | undefined;
  SQL_SEARCH_TIMEOUT_MS?: number | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const SearchEnvSchema: Schema<SearchEnv> = object(
  {
    SEARCH_PROVIDER: defaulted(enumOf(['sql'] as const, 'SEARCH_PROVIDER'), 'sql'),
    SQL_SEARCH_DEFAULT_PAGE_SIZE: optional(
      number({ coerce: true, label: 'SQL_SEARCH_DEFAULT_PAGE_SIZE' }),
    ),
    SQL_SEARCH_MAX_PAGE_SIZE: optional(number({ coerce: true, label: 'SQL_SEARCH_MAX_PAGE_SIZE' })),
    SQL_SEARCH_MAX_QUERY_DEPTH: optional(
      number({ coerce: true, label: 'SQL_SEARCH_MAX_QUERY_DEPTH' }),
    ),
    SQL_SEARCH_MAX_CONDITIONS: optional(
      number({ coerce: true, label: 'SQL_SEARCH_MAX_CONDITIONS' }),
    ),
    SQL_SEARCH_LOGGING: optional(trueFalseSchema),
    SQL_SEARCH_TIMEOUT_MS: optional(number({ coerce: true, label: 'SQL_SEARCH_TIMEOUT_MS' })),
  },
  { unknownKeys: 'strip' },
);
