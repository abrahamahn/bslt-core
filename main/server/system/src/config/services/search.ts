// main/server/system/src/config/services/search.ts
import { CONFIG_SEARCH_DEFAULTS } from '@bslt/shared/constants';

import type { FullEnv, SqlSearchProviderConfig } from '@bslt/shared/system/config';

/**
 * Load SQL Search Configuration.
 *
 * **Use Case**:
 * Simple, ACID-compliant search for small-to-medium datasets using standard `ILIKE` queries.
 * No external infrastructure required, but less performant for fuzzy matching.
 *
 * @param env - Environment variable map
 * @returns SQL search provider configuration
 */
export function loadSqlSearchConfig(env: FullEnv): SqlSearchProviderConfig {
  const config: SqlSearchProviderConfig = {
    defaultPageSize: env.SQL_SEARCH_DEFAULT_PAGE_SIZE ?? CONFIG_SEARCH_DEFAULTS.DEFAULT_PAGE_SIZE,
    maxPageSize: env.SQL_SEARCH_MAX_PAGE_SIZE ?? CONFIG_SEARCH_DEFAULTS.MAX_PAGE_SIZE,
    logging: env.SQL_SEARCH_LOGGING === 'true',
  };

  if (env.SQL_SEARCH_MAX_QUERY_DEPTH !== undefined) {
    config.maxQueryDepth = env.SQL_SEARCH_MAX_QUERY_DEPTH;
  }

  if (env.SQL_SEARCH_MAX_CONDITIONS !== undefined) {
    config.maxConditions = env.SQL_SEARCH_MAX_CONDITIONS;
  }

  if (env.SQL_SEARCH_TIMEOUT_MS !== undefined) {
    config.timeout = env.SQL_SEARCH_TIMEOUT_MS;
  }

  return config;
}

/**
 * Validates SQL search configuration for consistency.
 *
 * @param config - SQL search provider configuration
 * @returns Array of validation error messages (empty if valid)
 */
export function validateSqlSearchConfig(config: SqlSearchProviderConfig): string[] {
  const errors: string[] = [];
  if (config.defaultPageSize > config.maxPageSize) {
    errors.push('SQL_SEARCH_DEFAULT_PAGE_SIZE cannot exceed MAX_PAGE_SIZE');
  }
  return errors;
}

/** Default SQL search configuration */
export const DEFAULT_SQL_SEARCH_CONFIG: SqlSearchProviderConfig = {
  defaultPageSize: CONFIG_SEARCH_DEFAULTS.DEFAULT_PAGE_SIZE,
  maxPageSize: CONFIG_SEARCH_DEFAULTS.MAX_PAGE_SIZE,
};
