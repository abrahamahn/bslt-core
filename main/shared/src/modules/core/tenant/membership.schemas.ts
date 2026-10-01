// main/shared/src/modules/core/tenant/membership.schemas.ts
/**
 * @file Membership Schemas
 * @description Types and schemas for tenant memberships and invitations.
 * @module Core/Tenant
 */

import { INVITATION_STATUSES } from '../../../constants/core';
import {
  coerceNumber,
  createEnumSchema,
  createSchema,
  parseBoolean,
  parseOptional,
  parseString,
  withDefault,
  type Schema,
} from '../../../schema';
import {
  inviteIdSchema,
  membershipIdSchema,
  tenantIdSchema,
  userIdSchema,
} from '../../../schema/ids';
import { tenantRoleSchema } from '../auth/roles';
import { emailSchema, isoDateTimeSchema } from '../schemas';

import type { InviteId, MembershipId, TenantId, UserId } from '../../../schema/ids';
import type { TenantRole } from '../auth/roles';

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Invitation status enum schema */
const invitationStatusSchema = createEnumSchema(INVITATION_STATUSES, 'invitation status');

// ============================================================================
// Types
// ============================================================================

/** Full membership entity */
export interface Membership {
  id: MembershipId;
  tenantId: TenantId;
  userId: UserId;
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  role: TenantRole;
  /**
   * Grants billing-management capability orthogonally to the role hierarchy.
   * Owners are implicit billing admins; non-owners can be granted explicitly.
   */
  isBillingAdmin: boolean;
  /** Custom role refining (narrowing) this member's built-in grants, if any. */
  customRoleId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full invitation entity */
export interface Invitation {
  id: InviteId;
  tenantId: TenantId;
  email: string;
  role: TenantRole;
  status: InvitationStatus;
  invitedById: UserId;
  expiresAt: string;
  acceptedAt?: string | undefined;
  createdAt: string;
}

/** Input for creating an invitation */
export interface CreateInvitation {
  email: string;
  role: TenantRole;
}

/** Input for updating a membership role */
export interface UpdateMembershipRole {
  role: TenantRole;
}

/** Input for toggling billing administrator access on a membership */
export interface UpdateMembershipBillingAdmin {
  isBillingAdmin: boolean;
}

/** Input for directly adding a member to a tenant */
export interface AddMember {
  userId: string;
  role: TenantRole;
}

/** Input for accepting an invitation */
export interface AcceptInvitation {
  token: string;
}

// ============================================================================
// Schemas
// ============================================================================

export const membershipSchema: Schema<Membership> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: membershipIdSchema.parse(obj['id']),
    tenantId: tenantIdSchema.parse(obj['tenantId']),
    userId: userIdSchema.parse(obj['userId']),
    email: parseOptional(obj['email'], (v) => emailSchema.parse(v)),
    firstName: parseOptional(obj['firstName'], (v) =>
      parseString(v, 'firstName', { trim: true, max: 100 }),
    ),
    lastName: parseOptional(obj['lastName'], (v) =>
      parseString(v, 'lastName', { trim: true, max: 100 }),
    ),
    role: tenantRoleSchema.parse(obj['role']),
    isBillingAdmin: parseBoolean(withDefault(obj['isBillingAdmin'], false), 'isBillingAdmin'),
    customRoleId:
      obj['customRoleId'] == null
        ? null
        : parseString(obj['customRoleId'], 'customRoleId', { min: 1 }),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
});

export const invitationSchema: Schema<Invitation> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: inviteIdSchema.parse(obj['id']),
    tenantId: tenantIdSchema.parse(obj['tenantId']),
    email: emailSchema.parse(obj['email']),
    role: tenantRoleSchema.parse(obj['role']),
    status: invitationStatusSchema.parse(withDefault(obj['status'], 'pending')),
    invitedById: userIdSchema.parse(obj['invitedById']),
    expiresAt: isoDateTimeSchema.parse(obj['expiresAt']),
    acceptedAt: parseOptional(obj['acceptedAt'], (v) => isoDateTimeSchema.parse(v)),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
  };
});

// ============================================================================
// DTOs & Validation
// ============================================================================

export const createInvitationSchema: Schema<CreateInvitation> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    email: emailSchema.parse(obj['email']),
    role: tenantRoleSchema.parse(obj['role']),
  };
});

export const updateMembershipRoleSchema: Schema<UpdateMembershipRole> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      role: tenantRoleSchema.parse(obj['role']),
    };
  },
);

export const updateMembershipBillingAdminSchema: Schema<UpdateMembershipBillingAdmin> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      isBillingAdmin: parseBoolean(obj['isBillingAdmin'], 'isBillingAdmin'),
    };
  });

export const addMemberSchema: Schema<AddMember> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    userId: parseString(obj['userId'], 'userId', { min: 1 }),
    role: tenantRoleSchema.parse(obj['role']),
  };
});

export const acceptInvitationSchema: Schema<AcceptInvitation> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    token: parseString(obj['token'], 'token', { min: 1 }),
  };
});

/** Optional offset pagination for the members list. URL values arrive as strings. */
export interface ListMembersQuery {
  limit?: number | undefined;
  offset?: number | undefined;
}

export const listMembersQuerySchema: Schema<ListMembersQuery> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    limit: parseOptional(obj['limit'], (v) =>
      coerceNumber(v, 'limit', { int: true, min: 1, max: 100 }),
    ),
    offset: parseOptional(obj['offset'], (v) => coerceNumber(v, 'offset', { int: true, min: 0 })),
  };
});

// ============================================================================
// Response Schemas
// ============================================================================

/** List of members (one page) with the total membership count and caller's role. */
export interface MembersListResponse {
  data: Membership[];
  total: number;
  currentUserRole: TenantRole;
}

/** List of invitations */
export interface InvitationsListResponse {
  data: Invitation[];
}

/** Generic membership action response */
export interface MembershipActionResponse {
  message: string;
}

/** Response for accepting an invitation */
export interface AcceptInvitationResponse {
  message: string;
  tenantId: TenantId;
  invitation: Invitation;
}

export const membersListResponseSchema: Schema<MembersListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['data'])) throw new Error('data must be an array');

    return {
      data: obj['data'].map((item) => membershipSchema.parse(item)),
      total: coerceNumber(obj['total'], 'total', { int: true, min: 0 }),
      currentUserRole: tenantRoleSchema.parse(obj['currentUserRole']),
    };
  },
);

export const invitationsListResponseSchema: Schema<InvitationsListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['data'])) throw new Error('data must be an array');

    return {
      data: obj['data'].map((item) => invitationSchema.parse(item)),
    };
  },
);

export const membershipActionResponseSchema: Schema<MembershipActionResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      message: parseString(obj['message'], 'message'),
    };
  },
);

export const acceptInvitationResponseSchema: Schema<AcceptInvitationResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      message: parseString(obj['message'], 'message'),
      tenantId: tenantIdSchema.parse(obj['tenantId']),
      invitation: invitationSchema.parse(obj['invitation']),
    };
  },
);
