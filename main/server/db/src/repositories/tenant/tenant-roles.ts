// main/server/db/src/repositories/tenant/tenant-roles.ts
/**
 * Tenant Roles Repository (Functional)
 *
 * Data access layer for the tenant_roles table — custom role definitions
 * that narrow a member's built-in role grants (Advanced RBAC).
 *
 * @module
 */

import { and, deleteFrom, eq, insert, select, update } from '../../builder/index';
import {
  type NewTenantCustomRole,
  type TenantCustomRole,
  type UpdateTenantCustomRole,
  MEMBERSHIPS_TABLE,
  TENANT_ROLE_COLUMNS,
  TENANT_ROLES_TABLE,
} from '../../schema/index';
import { toCamelCase, toSnakeCase } from '../../utils';

import type { RawDb } from '../../client';

// ============================================================================
// Tenant Role Repository Interface
// ============================================================================

/**
 * Functional repository for custom tenant role operations
 */
export interface TenantRoleRepository {
  /**
   * Create a new custom role
   * @param data - The role data to insert
   * @returns The created role
   * @throws Error if insert fails
   */
  create(data: NewTenantCustomRole): Promise<TenantCustomRole>;

  /**
   * Find a role by ID
   * @param id - The role ID
   * @returns The role or null if not found
   */
  findById(id: string): Promise<TenantCustomRole | null>;

  /**
   * Find all custom roles for a tenant
   * @param tenantId - The tenant ID
   * @returns Array of roles ordered by name
   */
  findByTenantId(tenantId: string): Promise<TenantCustomRole[]>;

  /**
   * Find a role by tenant and name (unique pair)
   * @param tenantId - The tenant ID
   * @param name - The role name
   * @returns The role or null if not found
   */
  findByTenantAndName(tenantId: string, name: string): Promise<TenantCustomRole | null>;

  /**
   * Count memberships currently assigned to a role
   * @param id - The role ID
   * @returns Number of memberships referencing the role
   */
  countAssignments(id: string): Promise<number>;

  /**
   * Update a custom role
   * @param id - The role ID to update
   * @param data - The fields to update
   * @returns The updated role or null if not found
   */
  update(id: string, data: UpdateTenantCustomRole): Promise<TenantCustomRole | null>;

  /**
   * Delete a custom role. The memberships.custom_role_id FK is ON DELETE
   * SET NULL, so assigned members fall back to their built-in role base.
   * @param id - The role ID to delete
   * @returns True if the role was deleted
   */
  delete(id: string): Promise<boolean>;
}

// ============================================================================
// Tenant Role Repository Implementation
// ============================================================================

/**
 * Transform raw database row to TenantCustomRole type.
 * BIGINT permissions arrive as a string from the pg driver; the mask uses
 * only a handful of low bits, so Number() is lossless here.
 */
function transformTenantRole(row: Record<string, unknown>): TenantCustomRole {
  const role = toCamelCase<
    Omit<TenantCustomRole, 'permissions'> & { permissions: string | number }
  >(row, TENANT_ROLE_COLUMNS);
  return { ...role, permissions: Number(role.permissions) };
}

/**
 * Create a tenant role repository bound to a database connection
 * @param db - The raw database client
 * @returns TenantRoleRepository implementation
 */
export function createTenantRoleRepository(db: RawDb): TenantRoleRepository {
  return {
    async create(data: NewTenantCustomRole): Promise<TenantCustomRole> {
      const snakeData = toSnakeCase(data, TENANT_ROLE_COLUMNS);
      const result = await db.queryOne(
        insert(TENANT_ROLES_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create tenant role');
      }
      return transformTenantRole(result);
    },

    async findById(id: string): Promise<TenantCustomRole | null> {
      const result = await db.queryOne(select(TENANT_ROLES_TABLE).where(eq('id', id)).toSql());
      return result !== null ? transformTenantRole(result) : null;
    },

    async findByTenantId(tenantId: string): Promise<TenantCustomRole[]> {
      const results = await db.query(
        select(TENANT_ROLES_TABLE).where(eq('tenant_id', tenantId)).orderBy('name', 'asc').toSql(),
      );
      return results.map(transformTenantRole);
    },

    async findByTenantAndName(tenantId: string, name: string): Promise<TenantCustomRole | null> {
      const result = await db.queryOne(
        select(TENANT_ROLES_TABLE)
          .where(and(eq('tenant_id', tenantId), eq('name', name)))
          .toSql(),
      );
      return result !== null ? transformTenantRole(result) : null;
    },

    async countAssignments(id: string): Promise<number> {
      const result = await db.queryOne({
        text: `SELECT COUNT(*)::int AS count FROM ${MEMBERSHIPS_TABLE} WHERE custom_role_id = $1`,
        values: [id],
      });
      return (result?.['count'] as number | undefined) ?? 0;
    },

    async update(id: string, data: UpdateTenantCustomRole): Promise<TenantCustomRole | null> {
      const snakeData = toSnakeCase(data, TENANT_ROLE_COLUMNS);
      const result = await db.queryOne(
        update(TENANT_ROLES_TABLE).set(snakeData).where(eq('id', id)).returningAll().toSql(),
      );
      return result !== null ? transformTenantRole(result) : null;
    },

    async delete(id: string): Promise<boolean> {
      const count = await db.execute(deleteFrom(TENANT_ROLES_TABLE).where(eq('id', id)).toSql());
      return count > 0;
    },
  };
}
