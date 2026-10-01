// main/shared/src/contracts/contract.tenants.ts
/**
 * Tenants Contracts
 *
 * HTTP contract for workspace (tenant), member, and invitation management.
 */

import {
  acceptInvitationResponseSchema,
  addMemberSchema,
  assignTenantRoleSchema,
  createInvitationSchema,
  createTenantRoleSchema,
  createTenantSchema,
  invitationSchema,
  invitationsListResponseSchema,
  listMembersQuerySchema,
  membershipActionResponseSchema,
  membershipSchema,
  membersListResponseSchema,
  tenantCustomRoleSchema,
  tenantListResponseSchema,
  tenantRolesListResponseSchema,
  tenantSchema,
  transferOwnershipSchema,
  updateMembershipBillingAdminSchema,
  updateMembershipRoleSchema,
  updateTenantRoleSchema,
  updateTenantSchema,
} from '../modules/core/tenant';
import { emptyBodySchema, errorResponseSchema } from '../modules/system';
import { uuidSchema } from '../schema';

import type { Contract } from '../api/api';

export const tenantsContract = {
  create: {
    method: 'POST' as const,
    path: '/api/tenants',
    body: createTenantSchema,
    responses: {
      200: tenantSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
    },
    summary: 'Create workspace',
  },

  list: {
    method: 'GET' as const,
    path: '/api/tenants/list',
    responses: {
      200: tenantListResponseSchema,
      401: errorResponseSchema,
    },
    summary: 'List workspaces',
  },

  get: {
    method: 'GET' as const,
    path: '/api/tenants/:id',
    pathParams: { id: uuidSchema },
    responses: {
      200: tenantSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Get workspace',
  },

  update: {
    method: 'POST' as const,
    path: '/api/tenants/:id/update',
    pathParams: { id: uuidSchema },
    body: updateTenantSchema,
    responses: {
      200: tenantSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Update workspace',
  },

  delete: {
    method: 'POST' as const,
    path: '/api/tenants/:id/delete',
    pathParams: { id: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: membershipActionResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Delete workspace',
  },

  transferOwnership: {
    method: 'POST' as const,
    path: '/api/tenants/:id/transfer-ownership',
    pathParams: { id: uuidSchema },
    body: transferOwnershipSchema,
    responses: {
      200: membershipActionResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Transfer workspace ownership',
  },

  listMembers: {
    method: 'GET' as const,
    path: '/api/tenants/:id/members',
    pathParams: { id: uuidSchema },
    query: listMembersQuerySchema,
    responses: {
      200: membersListResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'List workspace members',
  },

  addMember: {
    method: 'POST' as const,
    path: '/api/tenants/:id/members/add',
    pathParams: { id: uuidSchema },
    body: addMemberSchema,
    responses: {
      200: membershipSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Add workspace member',
  },

  updateMemberRole: {
    method: 'POST' as const,
    path: '/api/tenants/:id/members/:userId/role',
    pathParams: { id: uuidSchema, userId: uuidSchema },
    body: updateMembershipRoleSchema,
    responses: {
      200: membershipSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Update member role',
  },

  updateMemberBillingAdmin: {
    method: 'POST' as const,
    path: '/api/tenants/:id/members/:userId/billing-admin',
    pathParams: { id: uuidSchema, userId: uuidSchema },
    body: updateMembershipBillingAdminSchema,
    responses: {
      200: membershipSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Update member billing administrator access',
  },

  removeMember: {
    method: 'POST' as const,
    path: '/api/tenants/:id/members/:userId/remove',
    pathParams: { id: uuidSchema, userId: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: membershipActionResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Remove workspace member',
  },

  createRole: {
    method: 'POST' as const,
    path: '/api/tenants/:id/roles',
    pathParams: { id: uuidSchema },
    body: createTenantRoleSchema,
    responses: {
      200: tenantCustomRoleSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Create custom role',
  },

  listRoles: {
    method: 'GET' as const,
    path: '/api/tenants/:id/roles/list',
    pathParams: { id: uuidSchema },
    responses: {
      200: tenantRolesListResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'List custom roles',
  },

  updateRole: {
    method: 'POST' as const,
    path: '/api/tenants/:id/roles/:roleId/update',
    pathParams: { id: uuidSchema, roleId: uuidSchema },
    body: updateTenantRoleSchema,
    responses: {
      200: tenantCustomRoleSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Update custom role',
  },

  deleteRole: {
    method: 'POST' as const,
    path: '/api/tenants/:id/roles/:roleId/delete',
    pathParams: { id: uuidSchema, roleId: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: membershipActionResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Delete custom role',
  },

  assignMemberRole: {
    method: 'POST' as const,
    path: '/api/tenants/:id/members/:userId/custom-role',
    pathParams: { id: uuidSchema, userId: uuidSchema },
    body: assignTenantRoleSchema,
    responses: {
      200: membershipSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Assign custom role to member',
  },

  createInvitation: {
    method: 'POST' as const,
    path: '/api/tenants/:id/invitations',
    pathParams: { id: uuidSchema },
    body: createInvitationSchema,
    responses: {
      201: invitationSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Create invitation',
  },

  listInvitations: {
    method: 'GET' as const,
    path: '/api/tenants/:id/invitations/list',
    pathParams: { id: uuidSchema },
    responses: {
      200: invitationsListResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'List invitations',
  },

  acceptInvitation: {
    method: 'POST' as const,
    path: '/api/invitations/:id/accept',
    pathParams: { id: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: acceptInvitationResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Accept invitation',
  },

  revokeInvitation: {
    method: 'POST' as const,
    path: '/api/tenants/:id/invitations/:invitationId/revoke',
    pathParams: { id: uuidSchema, invitationId: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: invitationSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Revoke invitation',
  },

  resendInvitation: {
    method: 'POST' as const,
    path: '/api/tenants/:id/invitations/:invitationId/resend',
    pathParams: { id: uuidSchema, invitationId: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: membershipActionResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Resend invitation',
  },
} satisfies Contract;
