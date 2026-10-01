// main/shared/src/modules/core/tenant/role.permissions.ts
/**
 * @file Tenant Permission Bitmasks
 * @description Permission bits for tenant-scoped actions and the resolution
 *   logic for custom roles.
 *
 *   Resolution semantics (narrow-only, the safer choice):
 *   - Each built-in role has a base bitmask derived from what the tenant
 *     handlers gate today (owner = everything, admin = member management +
 *     org update, member/viewer = no management permissions).
 *   - A custom role REFINES a membership: effective = base AND custom.
 *     Custom roles can only narrow the built-in base, never exceed it.
 *   - Owner is always all-permissions and immutable; custom refinement is
 *     never applied to owners.
 * @module Core/Tenant
 */

import type { TenantRole } from '../auth/roles';

// ============================================================================
// Permission Bits
// ============================================================================

/** Tenant permission bits. Stored as a BIGINT bitmask in `tenant_roles.permissions`. */
export const TENANT_PERMISSIONS = {
  /** Invite or directly add members (and manage pending invitations). */
  MEMBERS_INVITE: 1 << 0,
  /** Remove other members from the workspace. */
  MEMBERS_REMOVE: 1 << 1,
  /** Change other members' built-in roles. */
  MEMBERS_ROLE: 1 << 2,
  /** Update workspace settings (name, logo, metadata). */
  ORG_UPDATE: 1 << 3,
  /** Manage workspace billing (owner-base only today). */
  ORG_BILLING: 1 << 4,
  /** Delete the workspace (owner-base only today). */
  ORG_DELETE: 1 << 5,
} as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[keyof typeof TENANT_PERMISSIONS];

/** Human-readable labels for the permission editor UI. */
export const TENANT_PERMISSION_LABELS: ReadonlyArray<{
  readonly bit: TenantPermission;
  readonly key: string;
  readonly label: string;
}> = [
  { bit: TENANT_PERMISSIONS.MEMBERS_INVITE, key: 'members.invite', label: 'Invite members' },
  { bit: TENANT_PERMISSIONS.MEMBERS_REMOVE, key: 'members.remove', label: 'Remove members' },
  { bit: TENANT_PERMISSIONS.MEMBERS_ROLE, key: 'members.role', label: 'Change member roles' },
  { bit: TENANT_PERMISSIONS.ORG_UPDATE, key: 'org.update', label: 'Update workspace settings' },
  { bit: TENANT_PERMISSIONS.ORG_BILLING, key: 'org.billing', label: 'Manage billing' },
  { bit: TENANT_PERMISSIONS.ORG_DELETE, key: 'org.delete', label: 'Delete workspace' },
];

/** Bitwise union of every defined permission. */
export const ALL_TENANT_PERMISSIONS: number = TENANT_PERMISSION_LABELS.reduce(
  (mask, { bit }) => mask | bit,
  0,
);

// ============================================================================
// Bitmask Helpers
// ============================================================================

/** Checks whether `mask` includes the given permission bit. */
export function hasPermission(mask: number, permission: TenantPermission): boolean {
  return (mask & permission) === permission;
}

/** Composes permission bits into a single bitmask. */
export function composePermissions(...permissions: readonly TenantPermission[]): number {
  return permissions.reduce<number>((mask, bit) => mask | bit, 0);
}

/** True when `mask` only contains defined permission bits. */
export function isValidPermissionMask(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 0 && (mask & ~ALL_TENANT_PERMISSIONS) === 0;
}

// ============================================================================
// Resolution
// ============================================================================

/** Base bitmask for each built-in role, derived from today's handler gates. */
export function getBaseRolePermissions(role: TenantRole): number {
  switch (role) {
    case 'owner':
      return ALL_TENANT_PERMISSIONS;
    case 'admin':
      return composePermissions(
        TENANT_PERMISSIONS.MEMBERS_INVITE,
        TENANT_PERMISSIONS.MEMBERS_REMOVE,
        TENANT_PERMISSIONS.MEMBERS_ROLE,
        TENANT_PERMISSIONS.ORG_UPDATE,
      );
    case 'member':
    case 'viewer':
      return 0;
  }
}

/**
 * Resolves a member's effective permissions through the inheritance chain:
 * built-in role base, optionally narrowed by a custom role bitmask.
 *
 * Owner always resolves to all permissions — custom refinement never applies.
 */
export function resolveMemberPermissions(
  role: TenantRole,
  customPermissions: number | null,
): number {
  const base = getBaseRolePermissions(role);
  if (role === 'owner' || customPermissions === null) {
    return base;
  }
  return base & customPermissions;
}

// ============================================================================
// Built-in Role Protection
// ============================================================================

const BUILT_IN_ROLE_NAMES: readonly string[] = ['owner', 'admin', 'member', 'viewer'];

/** True when `name` collides (case-insensitively) with a built-in role name. */
export function isBuiltInRoleName(name: string): boolean {
  return BUILT_IN_ROLE_NAMES.includes(name.trim().toLowerCase());
}
