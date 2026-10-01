// main/shared/src/constants/system/tenancy.ts
/**
 * Tenancy Constants
 *
 * Canonical enumeration of the multi-tenant data-isolation strategies. Kept in
 * the primitive constants layer so both the config schema (`shared-system`) and
 * the database mechanism (`server-db`) can share one source of truth without
 * crossing a layer boundary.
 *
 * @module constants/system/tenancy
 */

/** Supported multi-tenant data-isolation strategies. */
export const TENANCY_MODES = ['shared-rls', 'schema-per-tenant'] as const;

/**
 * Multi-tenant data-isolation strategy.
 * - `shared-rls`: one schema guarded by Row-Level Security (default).
 * - `schema-per-tenant`: a dedicated Postgres schema per tenant, isolated by
 *   `search_path`.
 */
export type TenancyMode = (typeof TENANCY_MODES)[number];
