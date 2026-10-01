// main/shared/src/modules/system/config/env.tenancy.ts
/**
 * Tenancy Environment Configuration
 *
 * Selects the multi-tenant data-isolation strategy. Optional — defaults to
 * `shared-rls` (a single schema guarded by Row-Level Security). The alternative,
 * `schema-per-tenant`, routes each tenant's partitioned tables into a dedicated
 * Postgres schema and isolates access with `search_path` (see the `@bslt/db`
 * tenancy module). Default OFF: when `DB_TENANCY_MODE` is unset the runtime is
 * byte-identical to the shared-RLS model — no schema routing is emitted.
 *
 * @module config/env.tenancy
 */

import { TENANCY_MODES, type TenancyMode } from '../../../constants';
import { createEnumSchema, createSchema, parseObject, withDefault } from '../../../schema';

import type { Schema } from '../../../schema';

// Re-exported so config consumers keep a single import surface
// (`@bslt/shared/system/config`). The canonical source is `@bslt/shared/constants`.
export { TENANCY_MODES, type TenancyMode };

// ============================================================================
// Types
// ============================================================================

/** Validated tenancy configuration. */
export interface TenancyConfig {
  /** Data-isolation strategy. Defaults to `shared-rls`. */
  mode: TenancyMode;
}

/** Parsed tenancy environment variables. */
export interface TenancyEnv {
  DB_TENANCY_MODE: TenancyMode;
}

// ============================================================================
// Env Schema
// ============================================================================

const tenancyModeSchema = createEnumSchema(TENANCY_MODES, 'DB_TENANCY_MODE');

export const TenancyEnvSchema: Schema<TenancyEnv> = createSchema<TenancyEnv>((data: unknown) => {
  const obj = parseObject(data, 'TenancyEnv');
  return {
    DB_TENANCY_MODE: tenancyModeSchema.parse(withDefault(obj['DB_TENANCY_MODE'], 'shared-rls')),
  };
});
