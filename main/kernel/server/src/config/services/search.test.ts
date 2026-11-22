// main/kernel/server/src/config/services/search.test.ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_SEARCH_SCHEMAS } from '../constants';

import { DEFAULT_SQL_SEARCH_CONFIG, loadSqlSearchConfig, validateSqlSearchConfig } from './search';

import type { SqlSearchProviderConfig } from '../env/env.search';
import type { FullEnv } from '../env/env.validation';

/**
 * Creates a base environment with search-related defaults (as applied by Zod schema).
 * Used to simulate properly parsed FullEnv in tests.
 */
function createBaseEnv(overrides: Partial<FullEnv> = {}): FullEnv {
  return {
    SEARCH_PROVIDER: 'sql',
    ...overrides,
  } as unknown as FullEnv;
}

describe('Search Configuration', () => {
  describe('SQL Search Configuration', () => {
    it('loads default configuration when no environment variables are set', () => {
      const env = createBaseEnv();
      const config = loadSqlSearchConfig(env);

      expect(config).toEqual({
        defaultPageSize: 50,
        maxPageSize: 1000,
        logging: false,
      });
    });

    it('loads custom configuration from environment variables', () => {
      const env = createBaseEnv({
        SQL_SEARCH_DEFAULT_PAGE_SIZE: 25,
        SQL_SEARCH_MAX_PAGE_SIZE: 500,
        SQL_SEARCH_MAX_QUERY_DEPTH: 10,
        SQL_SEARCH_MAX_CONDITIONS: 50,
        SQL_SEARCH_LOGGING: 'true',
        SQL_SEARCH_TIMEOUT_MS: 10000,
      });

      const config = loadSqlSearchConfig(env);

      expect(config).toEqual({
        defaultPageSize: 25,
        maxPageSize: 500,
        maxQueryDepth: 10,
        maxConditions: 50,
        logging: true,
        timeout: 10000,
      });
    });

    it('handles boolean conversion for logging', () => {
      const env = createBaseEnv({
        SQL_SEARCH_LOGGING: 'true',
      });

      const config = loadSqlSearchConfig(env);
      expect(config.logging).toBe(true);
    });

    it('handles zero values correctly for optional fields', () => {
      const env = createBaseEnv({
        SQL_SEARCH_MAX_QUERY_DEPTH: 0,
        SQL_SEARCH_MAX_CONDITIONS: 0,
        SQL_SEARCH_TIMEOUT_MS: 0,
      });

      const config = loadSqlSearchConfig(env);

      expect(config.maxQueryDepth).toBe(0);
      expect(config.maxConditions).toBe(0);
      expect(config.timeout).toBe(0);
    });

    it('validateSqlSearchConfig returns error when default page size exceeds max', () => {
      const config = {
        defaultPageSize: 1500,
        maxPageSize: 1000,
      } as unknown as SqlSearchProviderConfig;

      const errors = validateSqlSearchConfig(config);
      expect(errors).toContain('SQL_SEARCH_DEFAULT_PAGE_SIZE cannot exceed MAX_PAGE_SIZE');
    });

    it('validateSqlSearchConfig returns no errors when page sizes are valid', () => {
      const config = {
        defaultPageSize: 50,
        maxPageSize: 1000,
      } as unknown as SqlSearchProviderConfig;

      const errors = validateSqlSearchConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('exports default configuration constants', () => {
      expect(DEFAULT_SQL_SEARCH_CONFIG).toBeDefined();
      expect(DEFAULT_SQL_SEARCH_CONFIG.defaultPageSize).toBe(50);
      expect(DEFAULT_SQL_SEARCH_CONFIG.maxPageSize).toBe(1000);
    });

    it('exports default search schemas with correct structure', () => {
      expect(DEFAULT_SEARCH_SCHEMAS).toBeDefined();
      expect(DEFAULT_SEARCH_SCHEMAS['users']).toBeDefined();
      expect(DEFAULT_SEARCH_SCHEMAS['users']?.table).toBe('users');

      const emailColumn = DEFAULT_SEARCH_SCHEMAS['users']?.columns.find(
        (c: { field: string }) => c.field === 'email',
      );
      expect(emailColumn).toBeDefined();
      expect(emailColumn?.type).toBe('string');
      expect(emailColumn?.filterable).toBe(true);
    });
  });
});
