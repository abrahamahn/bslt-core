// main/shared/src/modules/system/config/env.search.ts
/**
 * Search Environment Configuration
 *
 * Search types, env interface, and validation schema.
 * Merged from config/types/services.ts (search section), config/types/index.ts, and config/env.ts.
 *
 * @module config/env.search
 */

import {
  coerceNumber,
  createEnumSchema,
  createSchema,
  parseObject,
  parseOptional,
  withDefault,
} from '../../../schema';

import { trueFalseSchema } from './env.base';

import type { SqlColumnMapping, SqlTableConfig } from '../../../constants/config';
import type { Schema } from '../../../schema';

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
export interface SqlSearchConfig {
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

export const SearchEnvSchema: Schema<SearchEnv> = createSchema<SearchEnv>((data: unknown) => {
  const obj = parseObject(data, 'SearchEnv');
  return {
    SEARCH_PROVIDER: createEnumSchema(['sql'] as const, 'SEARCH_PROVIDER').parse(
      withDefault(obj['SEARCH_PROVIDER'], 'sql'),
    ),
    SQL_SEARCH_DEFAULT_PAGE_SIZE: parseOptional(obj['SQL_SEARCH_DEFAULT_PAGE_SIZE'], (v: unknown) =>
      coerceNumber(v, 'SQL_SEARCH_DEFAULT_PAGE_SIZE'),
    ),
    SQL_SEARCH_MAX_PAGE_SIZE: parseOptional(obj['SQL_SEARCH_MAX_PAGE_SIZE'], (v: unknown) =>
      coerceNumber(v, 'SQL_SEARCH_MAX_PAGE_SIZE'),
    ),
    SQL_SEARCH_MAX_QUERY_DEPTH: parseOptional(obj['SQL_SEARCH_MAX_QUERY_DEPTH'], (v: unknown) =>
      coerceNumber(v, 'SQL_SEARCH_MAX_QUERY_DEPTH'),
    ),
    SQL_SEARCH_MAX_CONDITIONS: parseOptional(obj['SQL_SEARCH_MAX_CONDITIONS'], (v: unknown) =>
      coerceNumber(v, 'SQL_SEARCH_MAX_CONDITIONS'),
    ),
    SQL_SEARCH_LOGGING: parseOptional(obj['SQL_SEARCH_LOGGING'], (v: unknown) =>
      trueFalseSchema.parse(v),
    ),
    SQL_SEARCH_TIMEOUT_MS: parseOptional(obj['SQL_SEARCH_TIMEOUT_MS'], (v: unknown) =>
      coerceNumber(v, 'SQL_SEARCH_TIMEOUT_MS'),
    ),
  };
});
