// main/shared/src/modules/core/tenant/index.ts

/**
 * @file Tenant Module Barrel
 * @description Re-exports all tenant domain types, schemas, and utilities.
 * @module Core/Tenant
 */

// --- domain-restrictions ---
export { extractEmailDomain, isEmailDomainAllowed } from './domain.restrictions';

// --- tenant.schemas ---
export {
  createTenantSchema,
  tenantListResponseSchema,
  tenantSchema,
  transferOwnershipSchema,
  updateTenantSchema,
  type CreateTenantInput,
  type Tenant,
  type TenantListResponse,
  type TransferOwnershipInput,
  type UpdateTenantInput,
} from './tenant.schemas';

// --- tenant.settings.schemas ---
export {
  createTenantSettingSchema,
  tenantSettingSchema,
  updateTenantSettingSchema,
  type CreateTenantSetting,
  type TenantSetting,
  type UpdateTenantSetting,
} from './tenant.settings.schemas';

// --- membership.display ---
export { getInvitationStatusTone, getTenantRoleTone } from './membership.display';

// --- membership.logic ---
export {
  canAcceptInvite,
  canAssignRole,
  canChangeRole,
  canLeave,
  canRemoveMember,
  canRevokeInvite,
  getNextOwnerCandidate,
  getRoleLevel,
  hasAtLeastRole,
  isInviteExpired,
  isSoleOwner,
  ROLE_LEVELS,
} from './membership.logic';

// --- role.permissions ---
export {
  ALL_TENANT_PERMISSIONS,
  composePermissions,
  getBaseRolePermissions,
  hasPermission,
  isBuiltInRoleName,
  isValidPermissionMask,
  resolveMemberPermissions,
  TENANT_PERMISSION_LABELS,
  TENANT_PERMISSIONS,
  type TenantPermission,
} from './role.permissions';

// --- role.schemas ---
export {
  assignTenantRoleSchema,
  createTenantRoleSchema,
  tenantCustomRoleSchema,
  tenantRolesListResponseSchema,
  updateTenantRoleSchema,
  type AssignTenantRole,
  type CreateTenantRole,
  type TenantCustomRole,
  type TenantRolesListResponse,
  type UpdateTenantRole,
} from './role.schemas';

// --- membership.schemas ---
export {
  acceptInvitationResponseSchema,
  acceptInvitationSchema,
  addMemberSchema,
  createInvitationSchema,
  invitationSchema,
  invitationsListResponseSchema,
  listMembersQuerySchema,
  membershipActionResponseSchema,
  membershipSchema,
  membersListResponseSchema,
  updateMembershipBillingAdminSchema,
  updateMembershipRoleSchema,
  type AcceptInvitation,
  type AcceptInvitationResponse,
  type AddMember,
  type CreateInvitation,
  type Invitation,
  type InvitationStatus,
  type InvitationsListResponse,
  type ListMembersQuery,
  type Membership,
  type MembershipActionResponse,
  type MembersListResponse,
  type UpdateMembershipBillingAdmin,
  type UpdateMembershipRole,
} from './membership.schemas';
