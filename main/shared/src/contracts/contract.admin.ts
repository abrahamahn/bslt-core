// main/shared/src/contracts/contract.admin.ts
/**
 * Admin Contracts
 *
 * API Contract definitions for administrative management.
 * @module Domain/Admin
 */

import {
  adminActionResponseSchema,
  adminCreateUserRequestSchema,
  adminDeleteUserRequestSchema,
  adminForceLogoutRequestSchema,
  adminForceLogoutResponseSchema,
  adminHardBanRequestSchema,
  adminHardBanResponseSchema,
  adminLockUserRequestSchema,
  adminPlanResponseSchema,
  adminPlansListResponseSchema,
  adminResetPasswordRequestSchema,
  adminStripeStatusSchema,
  adminSuspendTenantRequestSchema,
  adminTenantDetailSchema,
  adminTenantStateChangeResponseSchema,
  adminTenantsListResponseSchema,
  adminUpdateUserRequestSchema,
  adminUserListFiltersSchema,
  adminUserListResponseSchema,
  adminUserSchema,
  adminWebhookDeliveryListResponseSchema,
  adminWebhookListResponseSchema,
  adminWebhookReplayResponseSchema,
  auditLogFilterSchema,
  auditLogListResponseSchema,
  createPlanRequestSchema,
  deletePlanRequestSchema,
  endImpersonationRequestSchema,
  endImpersonationResponseSchema,
  grantSubscriptionRequestSchema,
  grantSubscriptionResponseSchema,
  impersonationResponseSchema,
  routeManifestResponseSchema,
  securityEventDetailResponseSchema,
  securityEventsExportRequestSchema,
  securityEventsExportResponseSchema,
  securityEventsListRequestSchema,
  securityEventsListResponseSchema,
  securityMetricsRequestSchema,
  securityMetricsResponseSchema,
  stripeConnectionTestResultSchema,
  subscriptionActionResponseSchema,
  syncStripeResponseSchema,
  systemStatsResponseSchema,
  unlockAccountRequestSchema,
  updatePlanRequestSchema,
  uuidSchema,
} from '../modules/core';
import { paginationOptionsSchema } from '../modules/db';
import { emptyBodySchema, errorResponseSchema, successResponseSchema } from '../modules/system';
import {
  planIdSchema,
  tenantIdSchema,
  userIdSchema,
  webhookDeliveryIdSchema,
  webhookIdSchema,
} from '../schema/ids';

import type { Contract } from '../api/api';

export const adminContract = {
  /**
   * List all users with filtering and pagination.
   */
  listUsers: {
    method: 'GET' as const,
    path: '/api/admin/users',
    query: adminUserListFiltersSchema,
    responses: {
      200: successResponseSchema(adminUserListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'List all users with filtering and pagination (admin only)',
  },

  /**
   * Get a single user by ID.
   */
  getUser: {
    method: 'GET' as const,
    path: '/api/admin/users/:id',
    pathParams: { id: userIdSchema },
    responses: {
      200: successResponseSchema(adminUserSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Get a single user by ID (admin only)',
  },

  /**
   * Update user details.
   */
  updateUser: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/update',
    pathParams: { id: userIdSchema },
    body: adminUpdateUserRequestSchema,
    responses: {
      200: successResponseSchema(adminActionResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Update user details (admin only)',
  },

  /**
   * Lock a user account.
   */
  lockUser: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/lock',
    pathParams: { id: userIdSchema },
    body: adminLockUserRequestSchema,
    responses: {
      200: successResponseSchema(adminActionResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Lock a user account (admin only)',
  },

  /**
   * Unlock a locked user account (by ID).
   */
  unlockUser: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/unlock',
    pathParams: { id: userIdSchema },
    body: unlockAccountRequestSchema,
    responses: {
      200: successResponseSchema(adminActionResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Unlock a locked user account by ID (admin only)',
  },

  searchUsers: {
    method: 'GET' as const,
    path: '/api/admin/users/search',
    query: adminUserListFiltersSchema,
    responses: {
      200: successResponseSchema(adminUserListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Search users with filtering and pagination (admin only)',
  },

  /**
   * Force-logout a user: revoke every active session/refresh-token family
   * without banning the account. The user must re-authenticate everywhere.
   */
  forceLogoutUser: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/force-logout',
    pathParams: { id: userIdSchema },
    body: adminForceLogoutRequestSchema,
    responses: {
      200: successResponseSchema(adminForceLogoutResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Force-logout a user by revoking all active sessions (admin only)',
  },

  hardBanUser: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/hard-ban',
    pathParams: { id: userIdSchema },
    body: adminHardBanRequestSchema,
    responses: {
      200: successResponseSchema(adminHardBanResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Hard ban a user account (admin only)',
  },

  createUser: {
    method: 'POST' as const,
    path: '/api/admin/users/create',
    body: adminCreateUserRequestSchema,
    responses: {
      200: successResponseSchema(adminActionResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      409: errorResponseSchema,
    },
    summary: 'Create a new user via invite (admin only)',
  },

  deleteUser: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/delete',
    pathParams: { id: userIdSchema },
    body: adminDeleteUserRequestSchema,
    responses: {
      200: successResponseSchema(adminActionResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Soft-delete (anonymize) a user account (admin only)',
  },

  resetUserPassword: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/reset-password',
    pathParams: { id: userIdSchema },
    body: adminResetPasswordRequestSchema,
    responses: {
      200: successResponseSchema(adminActionResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Trigger a password-reset email for a user (admin only)',
  },

  listSecurityEvents: {
    method: 'POST' as const,
    path: '/api/admin/security/events',
    body: securityEventsListRequestSchema,
    responses: {
      200: successResponseSchema(securityEventsListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'List security events (admin only)',
  },

  getSecurityEvent: {
    method: 'GET' as const,
    path: '/api/admin/security/events/:id',
    pathParams: { id: uuidSchema },
    responses: {
      200: successResponseSchema(securityEventDetailResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Get security event details (admin only)',
  },

  getSecurityMetrics: {
    method: 'GET' as const,
    path: '/api/admin/security/metrics',
    query: securityMetricsRequestSchema,
    responses: {
      200: successResponseSchema(securityMetricsResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Get security metrics (admin only)',
  },

  exportSecurityEvents: {
    method: 'POST' as const,
    path: '/api/admin/security/export',
    body: securityEventsExportRequestSchema,
    responses: {
      200: successResponseSchema(securityEventsExportResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Export security events (admin only)',
  },

  listAdminTenants: {
    method: 'GET' as const,
    path: '/api/admin/tenants',
    responses: {
      200: successResponseSchema(adminTenantsListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'List tenants (admin only)',
  },

  getAdminTenant: {
    method: 'GET' as const,
    path: '/api/admin/tenants/:id',
    pathParams: { id: tenantIdSchema },
    responses: {
      200: successResponseSchema(adminTenantDetailSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Get tenant details (admin only)',
  },

  suspendTenant: {
    method: 'POST' as const,
    path: '/api/admin/tenants/:id/suspend',
    pathParams: { id: tenantIdSchema },
    body: adminSuspendTenantRequestSchema,
    responses: {
      200: successResponseSchema(adminTenantStateChangeResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Suspend tenant (admin only)',
  },

  unsuspendTenant: {
    method: 'POST' as const,
    path: '/api/admin/tenants/:id/unsuspend',
    pathParams: { id: tenantIdSchema },
    body: emptyBodySchema,
    responses: {
      200: successResponseSchema(adminTenantStateChangeResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Unsuspend tenant (admin only)',
  },

  startImpersonation: {
    method: 'POST' as const,
    path: '/api/admin/impersonate/:userId',
    pathParams: { userId: userIdSchema },
    body: emptyBodySchema,
    responses: {
      200: successResponseSchema(impersonationResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Start user impersonation (admin only)',
  },

  endImpersonation: {
    method: 'POST' as const,
    path: '/api/admin/impersonate/end',
    body: endImpersonationRequestSchema,
    responses: {
      200: successResponseSchema(endImpersonationResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'End user impersonation (admin only)',
  },

  listAdminWebhooks: {
    method: 'GET' as const,
    path: '/api/admin/webhooks',
    query: paginationOptionsSchema,
    responses: {
      200: successResponseSchema(adminWebhookListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'List webhooks across tenants (admin only)',
  },

  listAdminWebhookDeliveries: {
    method: 'GET' as const,
    path: '/api/admin/webhooks/:id/deliveries',
    pathParams: { id: webhookIdSchema },
    query: paginationOptionsSchema,
    responses: {
      200: successResponseSchema(adminWebhookDeliveryListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'List webhook deliveries (admin only)',
  },

  replayAdminWebhookDelivery: {
    method: 'POST' as const,
    path: '/api/admin/webhooks/:id/deliveries/:deliveryId/replay',
    pathParams: { id: webhookIdSchema, deliveryId: webhookDeliveryIdSchema },
    body: emptyBodySchema,
    responses: {
      200: successResponseSchema(adminWebhookReplayResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Replay webhook delivery (admin only)',
  },

  listAdminPlans: {
    method: 'GET' as const,
    path: '/api/admin/billing/plans',
    responses: {
      200: successResponseSchema(adminPlansListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'List billing plans (admin only)',
  },

  getAdminPlan: {
    method: 'GET' as const,
    path: '/api/admin/billing/plans/:id',
    pathParams: { id: planIdSchema },
    responses: {
      200: successResponseSchema(adminPlanResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Get billing plan details (admin only)',
  },

  createAdminPlan: {
    method: 'POST' as const,
    path: '/api/admin/billing/plans/create',
    body: createPlanRequestSchema,
    responses: {
      201: successResponseSchema(adminPlanResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Create billing plan (admin only)',
  },

  grantUserSubscription: {
    method: 'POST' as const,
    path: '/api/admin/users/:id/subscription',
    pathParams: { id: userIdSchema },
    body: grantSubscriptionRequestSchema,
    responses: {
      200: grantSubscriptionResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
      409: errorResponseSchema,
    },
    summary: 'Grant/override a user subscription (admin only)',
  },

  updateAdminPlan: {
    method: 'POST' as const,
    path: '/api/admin/billing/plans/:id/update',
    pathParams: { id: planIdSchema },
    body: updatePlanRequestSchema,
    responses: {
      200: successResponseSchema(adminPlanResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Update billing plan (admin only)',
  },

  syncAdminPlanToStripe: {
    method: 'POST' as const,
    path: '/api/admin/billing/plans/:id/sync-stripe',
    pathParams: { id: planIdSchema },
    body: emptyBodySchema,
    responses: {
      200: successResponseSchema(syncStripeResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
      500: errorResponseSchema,
    },
    summary: 'Sync billing plan to Stripe (admin only)',
  },

  deactivateAdminPlan: {
    method: 'POST' as const,
    path: '/api/admin/billing/plans/:id/deactivate',
    pathParams: { id: planIdSchema },
    body: emptyBodySchema,
    responses: {
      200: successResponseSchema(subscriptionActionResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Deactivate billing plan (admin only)',
  },

  deleteAdminPlan: {
    method: 'POST' as const,
    path: '/api/admin/billing/plans/:id/delete',
    pathParams: { id: planIdSchema },
    body: deletePlanRequestSchema,
    responses: {
      200: successResponseSchema(subscriptionActionResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
      409: errorResponseSchema,
    },
    summary: 'Delete a billing plan (admin only; force removes referencing subscriptions)',
  },

  getAdminStripeStatus: {
    method: 'GET' as const,
    path: '/api/admin/billing/stripe-status',
    responses: {
      200: successResponseSchema(adminStripeStatusSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Read masked Stripe configuration status (admin only)',
  },

  testAdminStripeConnection: {
    method: 'POST' as const,
    path: '/api/admin/billing/stripe-status/test',
    body: emptyBodySchema,
    responses: {
      200: successResponseSchema(stripeConnectionTestResultSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Run a live Stripe connectivity check (admin only)',
  },

  getAdminMetrics: {
    method: 'GET' as const,
    path: '/api/admin/metrics',
    responses: {
      200: successResponseSchema(systemStatsResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Get admin metrics dashboard payload',
  },

  getAdminHealth: {
    method: 'GET' as const,
    path: '/api/admin/health',
    responses: {
      200: successResponseSchema(systemStatsResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Get admin health summary',
  },

  getRouteManifest: {
    method: 'GET' as const,
    path: '/api/admin/routes',
    responses: {
      200: successResponseSchema(routeManifestResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Get registered route manifest',
  },

  listLogs: {
    method: 'GET' as const,
    path: '/api/admin/audit-events',
    query: auditLogFilterSchema,
    responses: {
      200: successResponseSchema(auditLogListResponseSchema),
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'Query audit logs (Admin/Owner only)',
  },
} satisfies Contract;
