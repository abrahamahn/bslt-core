// main/shared/src/modules/core/tenant/role.schemas.ts
/**
 * @file Tenant Role Schemas
 * @description Types and schemas for custom tenant role CRUD and assignment.
 * @module Core/Tenant
 */

import { createSchema, parseNumber, parseString, uuidSchema, type Schema } from '../../../schema';
import { tenantIdSchema } from '../../../schema/ids';
import { isoDateTimeSchema } from '../schemas';

import { ALL_TENANT_PERMISSIONS, isBuiltInRoleName } from './role.permissions';

import type { TenantId } from '../../../schema/ids';

// ============================================================================
// Types
// ============================================================================

/** Custom tenant role definition */
export interface TenantCustomRole {
  id: string;
  tenantId: TenantId;
  name: string;
  /** Permission bitmask — see TENANT_PERMISSIONS. */
  permissions: number;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a custom role */
export interface CreateTenantRole {
  name: string;
  permissions: number;
}

/** Input for updating a custom role */
export interface UpdateTenantRole {
  name?: string | undefined;
  permissions?: number | undefined;
}

/** Input for assigning (or clearing) a member's custom role */
export interface AssignTenantRole {
  customRoleId: string | null;
}

/** List of custom roles */
export interface TenantRolesListResponse {
  data: TenantCustomRole[];
}

// ============================================================================
// Field Parsers
// ============================================================================

function parseRoleName(value: unknown): string {
  const name = parseString(value, 'name', { trim: true, min: 1, max: 50 });
  if (isBuiltInRoleName(name)) {
    throw new Error('name cannot be a built-in role name');
  }
  return name;
}

function parsePermissionsMask(value: unknown): number {
  return parseNumber(value, 'permissions', { int: true, min: 0, max: ALL_TENANT_PERMISSIONS });
}

// ============================================================================
// Schemas
// ============================================================================

export const tenantCustomRoleSchema: Schema<TenantCustomRole> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: uuidSchema.parse(obj['id']),
    tenantId: tenantIdSchema.parse(obj['tenantId']),
    name: parseString(obj['name'], 'name', { trim: true, min: 1, max: 50 }),
    permissions: parseNumber(obj['permissions'], 'permissions', { int: true, min: 0 }),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
});

export const createTenantRoleSchema: Schema<CreateTenantRole> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    name: parseRoleName(obj['name']),
    permissions: parsePermissionsMask(obj['permissions']),
  };
});

export const updateTenantRoleSchema: Schema<UpdateTenantRole> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  if (obj['name'] === undefined && obj['permissions'] === undefined) {
    throw new Error('at least one of name or permissions is required');
  }

  return {
    name: obj['name'] === undefined ? undefined : parseRoleName(obj['name']),
    permissions:
      obj['permissions'] === undefined ? undefined : parsePermissionsMask(obj['permissions']),
  };
});

export const assignTenantRoleSchema: Schema<AssignTenantRole> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    customRoleId:
      obj['customRoleId'] === null
        ? null
        : parseString(obj['customRoleId'], 'customRoleId', { min: 1 }),
  };
});

export const tenantRolesListResponseSchema: Schema<TenantRolesListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['data'])) throw new Error('data must be an array');

    return {
      data: obj['data'].map((item) => tenantCustomRoleSchema.parse(item)),
    };
  },
);
