// main/shared/src/modules/core/users/index.ts

/**
 * @file Users Barrel
 * @description Public API for user-related schemas, types, roles, permissions, and lifecycle logic.
 * @module Core/Users
 */

// --- attestation.policy ---
export {
  createSignupAttestation,
  isAttestationConfirmed,
  MINIMUM_SIGNUP_AGE,
  SIGNUP_ATTESTATION_STATEMENT,
  SIGNUP_ATTESTATION_VERSION,
} from './attestation.policy';
export type { SignupAttestation } from './attestation.policy';

// --- lifecycle.logic ---
export {
  calculateDeletionGracePeriodEnd,
  canDeactivate,
  canReactivate,
  canRequestDeletion,
  getAccountStatus,
  isAccountActive,
  isAccountDeactivated,
  isAccountPendingDeletion,
  isWithinDeletionGracePeriod,
} from './lifecycle.logic';

// --- lifecycle.schemas ---
export {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  accountLifecycleResponseSchema,
  deactivateAccountRequestSchema,
  deleteAccountRequestSchema,
} from './lifecycle.schemas';
export type {
  AccountLifecycleFields,
  AccountLifecycleResponse,
  AccountStatus,
  DeactivateAccountRequest,
  DeleteAccountRequest,
} from './lifecycle.schemas';

// --- username.schemas ---
export {
  getNextUsernameChangeDate,
  isUsernameChangeCooldownActive,
  RESERVED_USERNAMES,
  updateUsernameRequestSchema,
  updateUsernameResponseSchema,
} from './username.schemas';
export type { UpdateUsernameRequest, UpdateUsernameResponse } from './username.schemas';

// --- users.permissions ---
export { canUser, hasRole, isOwner, isRegularUser } from './users.permissions';

// --- users.roles ---
export { getAllRoles, getRoleDisplayName, isAdmin, isModerator, isUser } from './users.roles';

// --- users.schemas ---
export {
  avatarDeleteResponseSchema,
  avatarUploadRequestSchema,
  avatarUploadResponseSchema,
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  getProfileFieldLabel,
  getUserDisplayName,
  PROFILE_COMPLETENESS_FIELDS,
  PROFILE_FIELD_LABELS,
  profileCompletenessResponseSchema,
  revokeAllSessionsResponseSchema,
  revokeSessionResponseSchema,
  sessionSchema,
  sessionsListResponseSchema,
  updateProfileRequestSchema,
  USER_ROLES,
  userRoleSchema,
  userSchema,
} from './users.schemas';
export type {
  AvatarDeleteResponse,
  AvatarUploadRequest,
  AvatarUploadResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ProfileCompletenessResponse,
  RevokeAllSessionsResponse,
  RevokeSessionResponse,
  Session,
  SessionsListResponse,
  UpdateProfileRequest,
  User,
  UserRole,
} from './users.schemas';
