// main/shared/src/modules/core/tenant/membership.logic.ts
/**
 * @file Membership Logic
 * @description Business logic for invite status, transitions, and role validation.
 * @module Core/Tenant
 */

import type { Invitation, Membership } from './membership.schemas';
import type { TenantRole } from '../auth/roles';

// ============================================================================
// Constants
// ============================================================================

/** Numeric level for each role (ascending power). */
const ROLE_LEVELS = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
} as const;

function normalizeTenantRole(role: string): TenantRole {
  const normalized = role.toLowerCase();
  switch (normalized) {
    case 'owner':
    case 'admin':
    case 'member':
    case 'viewer':
      return normalized;
    default:
      throw new Error(`Invalid tenant role: ${role}`);
  }
}

export function getRoleLevel(role: TenantRole): number {
  switch (role) {
    case 'viewer':
      return ROLE_LEVELS.viewer;
    case 'member':
      return ROLE_LEVELS.member;
    case 'admin':
      return ROLE_LEVELS.admin;
    case 'owner':
      return ROLE_LEVELS.owner;
    default:
      throw new Error(`Invalid tenant role: ${String(role)}`);
  }
}
export { ROLE_LEVELS };

// ============================================================================
// Invite Lifecycle
// ============================================================================

/**
 * Checks if an invitation has expired based on current time.
 */
export function isInviteExpired(invite: Invitation): boolean {
  return new Date(invite.expiresAt) < new Date();
}

/**
 * Determines if an invitation can be accepted.
 */
export function canAcceptInvite(invite: Invitation): boolean {
  return invite.status === 'pending' && !isInviteExpired(invite);
}

/**
 * Determines if an invitation can be revoked.
 */
export function canRevokeInvite(invite: Invitation): boolean {
  return invite.status === 'pending';
}

// ============================================================================
// Role Logic
// ============================================================================

/**
 * Checks if a membership has at least the required role level.
 * Hierarchy: owner > admin > member > viewer
 */
export function hasAtLeastRole(
  membership: Membership,
  requiredRole: 'owner' | 'admin' | 'member' | 'viewer',
): boolean {
  const currentLevel = getRoleLevel(normalizeTenantRole(membership.role));
  const requiredLevel = getRoleLevel(normalizeTenantRole(requiredRole));

  return currentLevel >= requiredLevel;
}

/**
 * Determines if a membership grants billing-management capability.
 *
 * Billing access is orthogonal to the role hierarchy: it is granted to
 * owners implicitly and to other members via the `isBillingAdmin` flag.
 * This avoids conflating billing scope with the manager/owner role,
 * which also governs membership management and tenant settings.
 */
export function canManageBilling(membership: Pick<Membership, 'role' | 'isBillingAdmin'>): boolean {
  return membership.role === 'owner' || membership.isBillingAdmin;
}

// ============================================================================
// Role Hierarchy Protection
// ============================================================================

/**
 * Determines if an actor with `actorRole` can assign `targetRole` to another member.
 *
 * Rules:
 * - Owner can assign any role except owner (ownership is transferred, not assigned).
 * - Admin can assign member or viewer.
 * - Member and viewer cannot assign roles.
 */
export function canAssignRole(actorRole: TenantRole, targetRole: TenantRole): boolean {
  const actorLevel = getRoleLevel(actorRole);
  const targetLevel = getRoleLevel(targetRole);

  // Must be admin or above to assign roles
  if (actorLevel < getRoleLevel('admin')) return false;

  // Cannot assign a role at or above your own level
  return targetLevel < actorLevel;
}

/**
 * Determines if an actor can remove a member with `targetRole`.
 *
 * Rules:
 * - Owner can remove anyone except another owner.
 * - Admin can remove members and viewers (not other admins or owners).
 * - Member and viewer cannot remove anyone.
 */
export function canRemoveMember(actorRole: TenantRole, targetRole: TenantRole): boolean {
  const actorLevel = getRoleLevel(actorRole);
  const targetLevel = getRoleLevel(targetRole);

  // Must be admin or above to remove members
  if (actorLevel < getRoleLevel('admin')) return false;

  // Can only remove members with a strictly lower role
  return targetLevel < actorLevel;
}

/**
 * Determines if an actor can change a member's role from `fromRole` to `toRole`.
 *
 * Rules:
 * - Actor must be able to "manage" the target (target's current role < actor's role).
 * - Actor must be able to assign the new role (new role < actor's role).
 * - Cannot change to/from owner (ownership uses transfer, not role change).
 */
export function canChangeRole(
  actorRole: TenantRole,
  fromRole: TenantRole,
  toRole: TenantRole,
): boolean {
  // No-op changes are not allowed
  if (fromRole === toRole) return false;

  // Owner role changes use the transfer mechanism, not role change
  if (fromRole === 'owner' || toRole === 'owner') return false;

  const actorLevel = getRoleLevel(actorRole);
  const fromLevel = getRoleLevel(fromRole);
  const toLevel = getRoleLevel(toRole);

  // Must be admin or above
  if (actorLevel < getRoleLevel('admin')) return false;

  // Actor must outrank both the current and new role
  return fromLevel < actorLevel && toLevel < actorLevel;
}

// ============================================================================
// Orphan Prevention
// ============================================================================

/**
 * Determines if the given userId is the sole owner of the membership list.
 * Returns true if there is exactly one owner and that owner is the given user.
 */
export function isSoleOwner(memberships: Membership[], userId: string): boolean {
  const owners = memberships.filter((m) => m.role === 'owner');
  return owners.length === 1 && owners[0]?.userId === userId;
}

/**
 * Determines if a user can leave a tenant.
 * A user cannot leave if they are the sole owner — they must transfer ownership first.
 */
export function canLeave(memberships: Membership[], userId: string): boolean {
  return !isSoleOwner(memberships, userId);
}

/**
 * Returns the best candidate for automatic ownership transfer.
 * Priority: highest-role non-owner member, then by earliest join date.
 * Returns undefined if no candidates exist (sole member).
 */
export function getNextOwnerCandidate(
  memberships: Membership[],
  currentOwnerId: string,
): Membership | undefined {
  const candidates = memberships.filter((m) => m.userId !== currentOwnerId);

  if (candidates.length === 0) {
    return undefined;
  }

  // Sort by role level (descending) then by creation date (ascending)
  candidates.sort((a, b) => {
    const levelDiff = getRoleLevel(b.role) - getRoleLevel(a.role);
    if (levelDiff !== 0) return levelDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return candidates[0];
}
