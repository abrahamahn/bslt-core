// main/server/db/src/tenancy.ts
/**
 * Per-Tenant Schema Isolation (schema-per-tenant tenancy mode)
 *
 * Mechanism for the optional, env-gated `schema-per-tenant` data-isolation
 * strategy. It is the alternative to the default `shared-rls` model: instead of
 * one shared schema guarded by Row-Level Security, each tenant's *partitioned*
 * tables live in a dedicated Postgres schema (`tenant_<...>`), and a per-request
 * `search_path` is the isolation boundary.
 *
 * This module is a pure + provisioning toolkit. It carries **no runtime state**
 * and makes no decision on its own — the composition root decides the mode from
 * config and calls into it. When the mode is `shared-rls`, none of this runs and
 * the client emits no `search_path` statement (byte-identical to today).
 *
 * ## What lives here
 * - {@link tenantSchemaName} — deterministic, collision-resistant, injection-safe
 *   schema identifier for a tenant id.
 * - {@link isValidSchemaName} — the strict identifier guard used before any schema
 *   name is interpolated into SQL (`SET search_path`, `CREATE SCHEMA`, DDL).
 * - {@link resolveTenantSchema} — pure mode+tenantId → schema-name decision.
 * - {@link TENANT_PARTITIONED_TABLES} — the registry of tables that live in
 *   per-tenant schemas. **A fork adds its product tables here.**
 * - {@link provisionTenantSchema} — idempotently create a tenant's schema + tables.
 * - {@link replayPartitionedMigrations} — re-apply the partitioned DDL across
 *   existing tenant schemas (run after adding/changing a partitioned table).
 * - {@link listTenantSchemas} — enumerate existing `tenant_*` schemas.
 *
 * @module tenancy
 */

import { createHash } from 'node:crypto';

import type { RawDb } from './client';
import type { TenancyMode } from '@bslt/shared/constants';

// ============================================================================
// Schema naming & validation
// ============================================================================

/** Postgres identifiers are capped at 63 bytes. */
const MAX_IDENTIFIER_LENGTH = 63;

/** All tenant schemas share this prefix — also how {@link listTenantSchemas} finds them. */
export const TENANT_SCHEMA_PREFIX = 'tenant_';

/** Hex chars of the id hash suffix (64 bits) that guarantees collision-resistance. */
const HASH_SUFFIX_LENGTH = 16;

/**
 * A valid, unquoted Postgres schema identifier: starts with a lowercase letter
 * or underscore, followed by lowercase letters, digits, or underscores, ≤ 63
 * bytes. Deliberately strict — this is the security boundary for every place a
 * schema name is interpolated into SQL.
 */
const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Whether `name` is a safe, unquoted Postgres schema identifier.
 *
 * This is the injection guard: any schema name derived from a tenant id (or read
 * back from the catalog) MUST pass this before being interpolated into
 * `SET search_path`, `CREATE SCHEMA`, or table DDL.
 */
export function isValidSchemaName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length <= MAX_IDENTIFIER_LENGTH &&
    SCHEMA_NAME_PATTERN.test(name)
  );
}

/**
 * Deterministic, collision-resistant, injection-safe schema name for a tenant.
 *
 * Shape: `tenant_<sanitized-id>_<hash>` where `<sanitized-id>` is the id lowered
 * and reduced to `[a-z0-9_]`, and `<hash>` is the first 64 bits of the SHA-256 of
 * the *raw* id (hex). The hash suffix keeps the name collision-resistant even
 * when the sanitized/truncated id would otherwise clash (e.g. `a-b` vs `a_b`),
 * and the whole result is bounded to ≤ 63 bytes and always matches
 * {@link isValidSchemaName}.
 *
 * @throws if `tenantId` is empty.
 */
export function tenantSchemaName(tenantId: string): string {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantSchemaName: tenantId must be a non-empty string');
  }

  const hash = createHash('sha256').update(tenantId).digest('hex').slice(0, HASH_SUFFIX_LENGTH);
  const slug = tenantId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Reserve room for: prefix + slug + '_' + hash, capped at 63 bytes.
  const reserved = TENANT_SCHEMA_PREFIX.length + 1 + HASH_SUFFIX_LENGTH;
  const maxSlug = Math.max(0, MAX_IDENTIFIER_LENGTH - reserved);
  const truncatedSlug = slug.slice(0, maxSlug);

  const name =
    truncatedSlug === ''
      ? `${TENANT_SCHEMA_PREFIX}${hash}`
      : `${TENANT_SCHEMA_PREFIX}${truncatedSlug}_${hash}`;

  // Invariant: the constructed name is always a valid identifier. Guard defensively.
  if (!isValidSchemaName(name)) {
    throw new Error(`tenantSchemaName: derived an invalid schema name for tenant "${tenantId}"`);
  }
  return name;
}

/**
 * Pure mode → schema-name decision. Returns the tenant's schema name in
 * `schema-per-tenant` mode, or `undefined` in `shared-rls` mode (or when there is
 * no tenant to scope to). `undefined` means "emit no `search_path`" — the
 * byte-unchanged default path.
 */
export function resolveTenantSchema(
  mode: TenancyMode,
  tenantId: string | undefined,
): string | undefined {
  if (mode !== 'schema-per-tenant') return undefined;
  if (tenantId === undefined || tenantId === '') return undefined;
  return tenantSchemaName(tenantId);
}

// ============================================================================
// Partitioned-table registry
// ============================================================================

/**
 * A table that lives inside each tenant's dedicated schema (not the shared
 * `public` schema). The `ddl` factory receives the already-validated target
 * schema name and returns idempotent (`IF NOT EXISTS`) DDL for the table and its
 * indexes, fully schema-qualified.
 */
export interface PartitionedTable {
  /** Unqualified table name as it exists inside each tenant schema. */
  readonly name: string;
  /** Idempotent, schema-qualified DDL for the table + its indexes. */
  readonly ddl: (schema: string) => string;
}

/** Demo partitioned table name. Forks replace/extend this with their product tables. */
export const TENANT_ITEMS_TABLE = 'tenant_items';

/**
 * Worked-example partitioned table. It has **no RLS** — in `schema-per-tenant`
 * mode `search_path` is the only isolation boundary, which the isolation
 * integration test proves end-to-end. A fork models its own product tables the
 * same way and registers them in {@link TENANT_PARTITIONED_TABLES}.
 */
function tenantItemsDdl(schema: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${schema}".${TENANT_ITEMS_TABLE} (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id   UUID NOT NULL,
      name        TEXT NOT NULL,
      quantity    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ${TENANT_ITEMS_TABLE}_tenant_id_idx
      ON "${schema}".${TENANT_ITEMS_TABLE} (tenant_id);
  `;
}

/**
 * Registry of tables that live in per-tenant schemas under `schema-per-tenant`
 * mode. Ships with a single worked example ({@link TENANT_ITEMS_TABLE}).
 *
 * **A fork opts a product table into schema isolation by adding it here.** The
 * same registry drives both provisioning ({@link provisionTenantSchema}) and
 * per-schema migration replay ({@link replayPartitionedMigrations}), so the DDL
 * has one source of truth.
 */
export const TENANT_PARTITIONED_TABLES: readonly PartitionedTable[] = [
  { name: TENANT_ITEMS_TABLE, ddl: tenantItemsDdl },
];

// ============================================================================
// Provisioning & replay
// ============================================================================

/**
 * Create `schema` (if absent) and apply every partitioned table's DDL into it.
 * Shared by provisioning and replay; validates the schema name before any
 * interpolation. Idempotent.
 */
async function applyPartitionedSchema(
  db: RawDb,
  schema: string,
  tables: readonly PartitionedTable[],
): Promise<void> {
  if (!isValidSchemaName(schema)) {
    throw new Error(`applyPartitionedSchema: refusing unsafe schema name "${schema}"`);
  }
  await db.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  for (const table of tables) {
    await db.raw(table.ddl(schema));
  }
}

/**
 * Idempotently provision a tenant's dedicated schema and its partitioned tables.
 * Call this on tenant creation when the mode is `schema-per-tenant`.
 *
 * @returns The provisioned schema name.
 */
export async function provisionTenantSchema(
  db: RawDb,
  tenantId: string,
  tables: readonly PartitionedTable[] = TENANT_PARTITIONED_TABLES,
): Promise<string> {
  const schema = tenantSchemaName(tenantId);
  await applyPartitionedSchema(db, schema, tables);
  return schema;
}

/**
 * Re-apply the partitioned-table DDL across a set of existing tenant schemas.
 * Run this after a fork adds or changes a table in {@link TENANT_PARTITIONED_TABLES}
 * so already-provisioned tenants pick up the new/changed table. Idempotent.
 *
 * Pair with {@link listTenantSchemas} to replay across every provisioned tenant.
 */
export async function replayPartitionedMigrations(
  db: RawDb,
  schemaNames: readonly string[],
  tables: readonly PartitionedTable[] = TENANT_PARTITIONED_TABLES,
): Promise<void> {
  for (const schema of schemaNames) {
    await applyPartitionedSchema(db, schema, tables);
  }
}

/**
 * Build the tenant-creation provisioning hook for the active tenancy mode.
 *
 * Returns `undefined` in `shared-rls` mode — the seam is a no-op and tenant
 * creation is byte-unchanged. In `schema-per-tenant` mode it returns a function
 * that idempotently provisions the new tenant's schema + partitioned tables.
 * Wire the result into {@link provisionTenantSchema}'s callers (`createTenant`,
 * `ensurePersonalTenant`).
 */
export function makeTenantSchemaProvisioner(
  mode: TenancyMode,
  db: RawDb,
  tables: readonly PartitionedTable[] = TENANT_PARTITIONED_TABLES,
): ((tenantId: string) => Promise<void>) | undefined {
  if (mode !== 'schema-per-tenant') return undefined;
  return async (tenantId: string): Promise<void> => {
    await provisionTenantSchema(db, tenantId, tables);
  };
}

/**
 * List existing `tenant_*` schemas from the catalog. Every returned name is
 * validated by {@link isValidSchemaName}, so results are safe to interpolate.
 */
export async function listTenantSchemas(db: RawDb): Promise<string[]> {
  const rows = await db.query<{ schema_name: string }>({
    text: `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1 ORDER BY schema_name`,
    values: [`${TENANT_SCHEMA_PREFIX}%`],
  });
  return rows.map((r) => r.schema_name).filter(isValidSchemaName);
}
