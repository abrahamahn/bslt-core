// main/shared/src/modules/core/admin/admin.schemas.ts
/**
 * Admin Schemas
 *
 * Schemas for administrative monitoring and management.
 * @module Domain/Admin
 */

import { USER_STATUSES } from '../../../constants/core';
import { WEBHOOK_DELIVERY_STATUSES } from '../../../constants/system';
import {
  coerceNumber,
  createEnumSchema,
  createSchema,
  parseBoolean,
  parseNullable,
  parseNumber,
  parseOptional,
  parseString,
} from '../../../schema';
import {
  tenantIdSchema,
  userIdSchema,
  webhookDeliveryIdSchema,
  webhookIdSchema,
} from '../../../schema/ids';
import { paginatedResultSchema } from '../../db/pagination';
import {
  auditCategorySchema,
  auditSeveritySchema,
  type AuditCategory,
  type AuditSeverity,
} from '../audit-log/audit.log.schemas';
import { appRoleSchema, type AppRole } from '../auth/roles';
import { emailSchema, isoDateTimeSchema, usernameSchema, uuidSchema } from '../schemas';

import type { Schema } from '../../../schema';
import type { TenantId, UserId } from '../../../schema/ids';

// ============================================================================
// Types
// ============================================================================

/** User statuses for administrative filtering */
// Re-exported, not redeclared: single source is `constants/core/iam`.
export { USER_STATUSES };
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * The account-lockout duration ladder, in minutes — the ONE table.
 *
 * Every surface that offers a lockout duration renders from this, and the
 * request schema derives its ceiling from it, so no panel can offer a duration
 * the server refuses (which reads to the operator as a control that silently
 * does nothing).
 */
export const LOCKOUT_DURATION_MINUTES = {
  oneHour: 60,
  oneDay: 1440,
  sevenDays: 10_080,
  thirtyDays: 43_200,
} as const;

/** Longest lockout the server accepts — derived, never typed twice. */
export const MAX_LOCKOUT_DURATION_MINUTES: number = Math.max(
  ...Object.values(LOCKOUT_DURATION_MINUTES),
);

/** Default page size for the admin audit-event list. */
export const ADMIN_AUDIT_EVENTS_DEFAULT_LIMIT = 100;

/** Hard ceiling for the admin audit-event list. */
export const ADMIN_AUDIT_EVENTS_MAX_LIMIT = 500;

/**
 * Hard ceiling for `offset` on every admin list.
 *
 * Deep offsets make the database scan-and-discard, so an unbounded one is a
 * denial-of-service knob in a URL. The ceiling is far past any page an operator
 * can reach by clicking, so only a mistake or an attack meets it.
 */
export const ADMIN_LIST_MAX_OFFSET = 100_000;

/**
 * Query for the admin audit-event list.
 *
 * Every filter is applied by the DATABASE, together. The previous handler read
 * these off `request.query` by hand and honoured only the first one it found,
 * ignoring `category` entirely — so a filtered view searched the newest N rows
 * rather than the data, and reported nothing when the match lay deeper.
 */
export interface AdminAuditEventsQuery {
  tenantId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  category?: AuditCategory | undefined;
  severity?: AuditSeverity | undefined;
  limit: number;
}

export const adminAuditEventsQuerySchema: Schema<AdminAuditEventsQuery> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      tenantId: parseOptional(obj['tenantId'], (v) => tenantIdSchema.parse(v)),
      actorId: parseOptional(obj['actorId'], (v) => userIdSchema.parse(v)),
      action: parseOptional(obj['action'], (v) => parseString(v, 'action', { max: 100 })),
      category: parseOptional(obj['category'], (v) => auditCategorySchema.parse(v)),
      severity: parseOptional(obj['severity'], (v) => auditSeveritySchema.parse(v)),
      // Rejected, not clamped: `?limit=-5` and `?limit=abc` are mistakes worth
      // reporting, and silently substituting 100 hides them.
      limit:
        parseOptional(obj['limit'], (v) =>
          coerceNumber(v, 'limit', { int: true, min: 1, max: ADMIN_AUDIT_EVENTS_MAX_LIMIT }),
        ) ?? ADMIN_AUDIT_EVENTS_DEFAULT_LIMIT,
    };
  },
);

/** Admin view of a user with additional security metadata */
export interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  firstName: string;
  lastName: string;
  role: AppRole;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  lockedUntil: string | null;
  lockReason: string | null;
  failedLoginAttempts: number;
  phone: string | null;
  phoneVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Sorting and filtering for user lists */
export interface AdminUserListFilters {
  search?: string | undefined;
  role?: AppRole | undefined;
  status?: UserStatus | undefined;
  /** Filter to users holding a current subscription on this plan id */
  plan?: string | undefined;
  sortBy?: 'email' | 'username' | 'firstName' | 'lastName' | 'createdAt' | 'updatedAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/** Update user details from admin context */
export interface AdminUpdateUserRequest {
  firstName?: string | undefined;
  lastName?: string | undefined;
  role?: AppRole | undefined;
}

/** Lock user account with reason */
export interface AdminLockUserRequest {
  reason: string;
  durationMinutes?: number | undefined;
}

/** Unlock user account with reason */
export interface UnlockAccountRequest {
  reason: string;
}

/** Force-logout a user (revoke all active sessions) with reason */
export interface AdminForceLogoutRequest {
  reason: string;
}

/** Hard ban a user account with reason */
export interface AdminHardBanRequest {
  reason: string;
}

/** Response for admin hard ban operations */
export interface AdminHardBanResponse {
  message: string;
  gracePeriodEnds: string;
}

/** Create a new user via the admin panel (invite flow — no admin-set password) */
export interface AdminCreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  username?: string | undefined;
  role?: AppRole | undefined;
}

/** Soft-delete (anonymize) a user account with reason */
export interface AdminDeleteUserRequest {
  reason: string;
}

/** Trigger a password reset for a user with reason (sends the user a reset link) */
export interface AdminResetPasswordRequest {
  reason: string;
}

/** Suspend a tenant with reason */
export interface AdminSuspendTenantRequest {
  reason: string;
}

/** Standard admin action response */
export interface AdminActionResponse {
  message: string;
  user?: AdminUser | undefined;
}

/** Admin view of a webhook without exposing the signing secret. */
export interface AdminWebhook {
  id: string;
  tenantId: TenantId | null;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Response for admin webhook lists. */
export interface AdminWebhookListResponse {
  webhooks: AdminWebhook[];
}

/** Admin view of a webhook delivery. */
export interface AdminWebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/** Response for admin webhook delivery lists. */
export interface AdminWebhookDeliveryListResponse {
  deliveries: AdminWebhookDelivery[];
}

/** Response for admin webhook replay operations. */
export interface AdminWebhookReplayResponse {
  success: boolean;
  deliveryId?: string | undefined;
  message?: string | undefined;
}

/** Response for admin user update operations */
export interface AdminUpdateUserResponse {
  message: string;
  user: AdminUser;
}

/** Response for admin lock user operations */
export interface AdminLockUserResponse {
  message: string;
  user: AdminUser;
}

/** Response for admin force-logout operations */
export interface AdminForceLogoutResponse {
  message: string;
  /** Number of refresh-token families revoked. */
  revokedSessions: number;
}

/** Type alias for the admin user list response */
export type AdminUserListResponse = ReturnType<typeof adminUserListResponseSchema.parse>;

// ============================================================================
// Schemas
// ============================================================================

export const userStatusSchema = createSchema((data: unknown) => {
  if (typeof data !== 'string' || !USER_STATUSES.includes(data as UserStatus)) {
    throw new Error(`Invalid user status. Expected one of: ${USER_STATUSES.join(', ')}`);
  }
  return data as UserStatus;
});

export const adminUserSchema: Schema<AdminUser> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    id: uuidSchema.parse(obj['id']),
    email: emailSchema.parse(obj['email']),
    username: parseNullable(obj['username'], (v) => usernameSchema.parse(v)),
    firstName: parseString(obj['firstName'], 'firstName'),
    lastName: parseString(obj['lastName'], 'lastName'),
    role: appRoleSchema.parse(obj['role']),
    emailVerified: parseBoolean(obj['emailVerified'], 'emailVerified'),
    emailVerifiedAt: parseNullable(obj['emailVerifiedAt'], (v) => isoDateTimeSchema.parse(v)),
    lockedUntil: parseNullable(obj['lockedUntil'], (v) => isoDateTimeSchema.parse(v)),
    lockReason: parseNullable(obj['lockReason'], (v) => parseString(v, 'lockReason')),
    failedLoginAttempts: parseNumber(obj['failedLoginAttempts'], 'failedLoginAttempts', {
      int: true,
    }),
    phone: parseNullable(obj['phone'], (v) => parseString(v, 'phone')),
    phoneVerified: parseBoolean(obj['phoneVerified'], 'phoneVerified'),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
});

export const adminUserListFiltersSchema: Schema<AdminUserListFilters> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      search: parseOptional(obj['search'], (v) => parseString(v, 'search', { max: 100 })),
      role: parseOptional(obj['role'], (v) => appRoleSchema.parse(v)),
      status: parseOptional(obj['status'], (v) => userStatusSchema.parse(v)),
      plan: parseOptional(obj['plan'], (v) => parseString(v, 'plan', { max: 100 })),
      sortBy: parseOptional(obj['sortBy'], (v) => {
        const valid: ReadonlyArray<AdminUserListFilters['sortBy']> = [
          'email',
          'username',
          'firstName',
          'lastName',
          'createdAt',
          'updatedAt',
        ];
        if (typeof v !== 'string' || !valid.includes(v as AdminUserListFilters['sortBy'])) {
          throw new Error('Invalid sortBy');
        }
        return v as NonNullable<AdminUserListFilters['sortBy']>;
      }),
      sortOrder: parseOptional(obj['sortOrder'], (v) => {
        if (v !== 'asc' && v !== 'desc') throw new Error('Invalid sortOrder');
        return v;
      }),
      page: parseOptional(obj['page'], (v) => coerceNumber(v, 'page', { int: true, min: 1 })),
      limit: parseOptional(obj['limit'], (v) =>
        coerceNumber(v, 'limit', { int: true, min: 1, max: 100 }),
      ),
    };
  },
);

/** Default page size for the admin user search. */
export const ADMIN_USER_SEARCH_DEFAULT_LIMIT = 20;

/** Hard ceiling for the admin user search page size. */
export const ADMIN_USER_SEARCH_MAX_LIMIT = 100;

/**
 * Query for the admin user search.
 *
 * Distinct from {@link AdminUserListFilters}: the search is a single free-text
 * term against several columns with offset paging, not a filter/sort set, so
 * reusing the list filters here would document a query the route never reads.
 */
export interface AdminUserSearchQuery {
  q: string;
  limit: number;
  offset: number;
}

export const adminUserSearchQuerySchema: Schema<AdminUserSearchQuery> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      // Required: a blank search is a caller bug, and answering it with the
      // whole user table is the worst possible interpretation of it.
      q: parseString(obj['q'], 'q', { trim: true, min: 1, max: 100 }),
      limit:
        parseOptional(obj['limit'], (v) =>
          coerceNumber(v, 'limit', { int: true, min: 1, max: ADMIN_USER_SEARCH_MAX_LIMIT }),
        ) ?? ADMIN_USER_SEARCH_DEFAULT_LIMIT,
      offset:
        parseOptional(obj['offset'], (v) =>
          coerceNumber(v, 'offset', { int: true, min: 0, max: ADMIN_LIST_MAX_OFFSET }),
        ) ?? 0,
    };
  },
);

export const adminUserListResponseSchema = paginatedResultSchema(adminUserSchema);

export const adminUpdateUserRequestSchema: Schema<AdminUpdateUserRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const result: AdminUpdateUserRequest = {};
    if (obj['firstName'] !== undefined)
      result.firstName = parseString(obj['firstName'], 'firstName', {
        min: 1,
        max: 50,
      });
    if (obj['lastName'] !== undefined)
      result.lastName = parseString(obj['lastName'], 'lastName', { max: 50 });
    if (obj['role'] !== undefined) result.role = appRoleSchema.parse(obj['role']);
    if (Object.keys(result).length === 0) throw new Error('At least one field must be provided');
    return result;
  },
);

export const adminLockUserRequestSchema: Schema<AdminLockUserRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseString(obj['reason'], 'reason', { min: 1, max: 500 }),
      durationMinutes: parseOptional(obj['durationMinutes'], (v) =>
        parseNumber(v, 'durationMinutes', {
          int: true,
          min: 1,
          max: MAX_LOCKOUT_DURATION_MINUTES,
        }),
      ),
    };
  },
);

export const unlockAccountRequestSchema: Schema<UnlockAccountRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseString(obj['reason'], 'reason', { min: 1, max: 500 }),
    };
  },
);

export const adminForceLogoutRequestSchema: Schema<AdminForceLogoutRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseString(obj['reason'], 'reason', { min: 1, max: 500 }),
    };
  },
);

export const adminHardBanRequestSchema: Schema<AdminHardBanRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseString(obj['reason'], 'reason', { min: 1, max: 500 }),
    };
  },
);

export const adminHardBanResponseSchema: Schema<AdminHardBanResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      message: parseString(obj['message'], 'message'),
      gracePeriodEnds: isoDateTimeSchema.parse(obj['gracePeriodEnds']),
    };
  },
);

export const adminCreateUserRequestSchema: Schema<AdminCreateUserRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      email: emailSchema.parse(obj['email']),
      firstName: parseString(obj['firstName'], 'firstName', { min: 1, max: 100 }),
      lastName: parseString(obj['lastName'], 'lastName', { min: 1, max: 100 }),
      username: parseOptional(obj['username'], (v) => usernameSchema.parse(v)),
      role: parseOptional(obj['role'], (v) => appRoleSchema.parse(v)),
    };
  },
);

export const adminDeleteUserRequestSchema: Schema<AdminDeleteUserRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseString(obj['reason'], 'reason', { min: 1, max: 500 }),
    };
  },
);

export const adminResetPasswordRequestSchema: Schema<AdminResetPasswordRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseString(obj['reason'], 'reason', { min: 1, max: 500 }),
    };
  },
);

export const adminActionResponseSchema: Schema<AdminActionResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      message: parseString(obj['message'], 'message'),
      user: parseOptional(obj['user'], (v) => adminUserSchema.parse(v)),
    };
  },
);

/** Default page size for the admin webhook list. */
export const ADMIN_WEBHOOKS_DEFAULT_LIMIT = 100;

/** Hard ceiling for the admin webhook list page size. */
export const ADMIN_WEBHOOKS_MAX_LIMIT = 200;

/** Default page size for the admin webhook-delivery list. */
export const ADMIN_WEBHOOK_DELIVERIES_DEFAULT_LIMIT = 100;

/** Hard ceiling for the admin webhook-delivery list page size. */
export const ADMIN_WEBHOOK_DELIVERIES_MAX_LIMIT = 200;

/** Query for the admin webhook list. */
export interface AdminWebhookListQuery {
  /** Restrict to one tenant's webhooks; absent means every tenant. */
  tenantId?: TenantId | undefined;
  limit: number;
}

export const adminWebhookListQuerySchema: Schema<AdminWebhookListQuery> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      // A UUID, not a string: `tenant_id = $1` deserves an id, and a malformed
      // one is a 400 rather than a query that quietly matches nothing.
      tenantId: parseOptional(obj['tenantId'], (v) => tenantIdSchema.parse(v)),
      limit:
        parseOptional(obj['limit'], (v) =>
          coerceNumber(v, 'limit', { int: true, min: 1, max: ADMIN_WEBHOOKS_MAX_LIMIT }),
        ) ?? ADMIN_WEBHOOKS_DEFAULT_LIMIT,
    };
  },
);

const webhookDeliveryStatusSchema = createEnumSchema(
  WEBHOOK_DELIVERY_STATUSES,
  'webhook delivery status',
);

/**
 * Query for the admin webhook-delivery list.
 *
 * `status` is derived from `WEBHOOK_DELIVERY_STATUSES` rather than importing
 * the comms module's alias: comms depends on core, not the reverse.
 */
export interface AdminWebhookDeliveryListQuery {
  limit: number;
  status?: (typeof WEBHOOK_DELIVERY_STATUSES)[number] | undefined;
}

export const adminWebhookDeliveryListQuerySchema: Schema<AdminWebhookDeliveryListQuery> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      limit:
        parseOptional(obj['limit'], (v) =>
          coerceNumber(v, 'limit', { int: true, min: 1, max: ADMIN_WEBHOOK_DELIVERIES_MAX_LIMIT }),
        ) ?? ADMIN_WEBHOOK_DELIVERIES_DEFAULT_LIMIT,
      // Closed enum: `?status=faild` filtered to nothing and looked like "no
      // failures" — the most dangerous empty list this panel can show.
      status: parseOptional(obj['status'], (v) => webhookDeliveryStatusSchema.parse(v)),
    };
  });

export const adminWebhookSchema: Schema<AdminWebhook> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    id: webhookIdSchema.parse(obj['id']),
    tenantId: parseNullable(obj['tenantId'], (v) => tenantIdSchema.parse(v)),
    url: parseString(obj['url'], 'url', { url: true }),
    events: parseStringList(obj['events'], 'events'),
    isActive: parseBoolean(obj['isActive'], 'isActive'),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
});

export const adminWebhookListResponseSchema: Schema<AdminWebhookListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (!Array.isArray(obj['webhooks'])) {
      throw new Error('webhooks must be an array');
    }
    return {
      webhooks: obj['webhooks'].map((webhook) => adminWebhookSchema.parse(webhook)),
    };
  },
);

export const adminWebhookDeliverySchema: Schema<AdminWebhookDelivery> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      id: webhookDeliveryIdSchema.parse(obj['id']),
      webhookId: webhookIdSchema.parse(obj['webhookId']),
      eventType: parseString(obj['eventType'], 'eventType', { min: 1 }),
      status: parseString(obj['status'], 'status', { min: 1 }),
      attempts: parseNumber(obj['attempts'], 'attempts', { int: true, min: 0 }),
      responseStatus: parseNullable(obj['responseStatus'], (v) =>
        parseNumber(v, 'responseStatus', { int: true }),
      ),
      nextRetryAt: parseNullable(obj['nextRetryAt'], (v) => isoDateTimeSchema.parse(v)),
      deliveredAt: parseNullable(obj['deliveredAt'], (v) => isoDateTimeSchema.parse(v)),
      createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    };
  },
);

export const adminWebhookDeliveryListResponseSchema: Schema<AdminWebhookDeliveryListResponse> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (!Array.isArray(obj['deliveries'])) {
      throw new Error('deliveries must be an array');
    }
    return {
      deliveries: obj['deliveries'].map((delivery) => adminWebhookDeliverySchema.parse(delivery)),
    };
  });

export const adminWebhookReplayResponseSchema: Schema<AdminWebhookReplayResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      success: parseBoolean(obj['success'], 'success'),
      deliveryId: parseOptional(obj['deliveryId'], (v) => webhookDeliveryIdSchema.parse(v)),
      message: parseOptional(obj['message'], (v) => parseString(v, 'message')),
    };
  },
);

/**
 * Schema for admin update user response.
 *
 * @complexity O(1)
 */
export const adminUpdateUserResponseSchema: Schema<AdminUpdateUserResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      message: parseString(obj['message'], 'message'),
      user: adminUserSchema.parse(obj['user']),
    };
  },
);

/**
 * Schema for admin lock user response.
 *
 * @complexity O(1)
 */
export const adminLockUserResponseSchema: Schema<AdminLockUserResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      message: parseString(obj['message'], 'message'),
      user: adminUserSchema.parse(obj['user']),
    };
  },
);

/**
 * Schema for admin force-logout response.
 *
 * @complexity O(1)
 */
export const adminForceLogoutResponseSchema: Schema<AdminForceLogoutResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      message: parseString(obj['message'], 'message'),
      revokedSessions: parseNumber(obj['revokedSessions'], 'revokedSessions', {
        int: true,
        min: 0,
      }),
    };
  },
);

export const adminSuspendTenantRequestSchema: Schema<AdminSuspendTenantRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseString(obj['reason'], 'reason', { min: 1, max: 500 }),
    };
  },
);

// ============================================================================
// Admin Tenant Response Schemas
// ============================================================================

/** Admin view of a tenant */
export interface AdminTenant {
  id: TenantId;
  name: string;
  slug: string;
  logoUrl: string | null;
  ownerId: UserId;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Detailed admin tenant view */
export interface AdminTenantDetail extends AdminTenant {
  metadata: Record<string, unknown>;
  allowedEmailDomains: string[];
}

/** Tenant list response */
export interface AdminTenantListResponse {
  tenants: AdminTenant[];
  total: number;
  limit: number;
  offset: number;
}

/** Response for suspend / unsuspend tenant operations */
export interface AdminTenantStateChangeResponse {
  message: string;
  tenant: AdminTenant;
}

/** Impersonation response */
export interface ImpersonationResponse {
  message: string;
  token: string;
  targetUserId: string;
  targetEmail: string;
  expiresAt: string;
}

/** End impersonation request */
export interface EndImpersonationRequest {
  targetUserId: string;
}

/** End impersonation response */
export interface EndImpersonationResponse {
  success: boolean;
  message: string;
}

/** System stats response */
export interface SystemStatsResponse {
  totalUsers: number;
  totalTenants: number;
  activeSubscriptions: number;
  monthlyRevenue: number;
}

export const ADMIN_ROUTE_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
] as const;
export type AdminRouteMethod = (typeof ADMIN_ROUTE_METHODS)[number];

/** Route manifest entry */
export interface AdminRouteManifestEntry {
  path: string;
  method: AdminRouteMethod;
  isPublic: boolean;
  roles: string[];
  hasSchema: boolean;
  module: string;
  deprecated?: boolean | undefined;
  summary?: string | undefined;
  tags?: string[] | undefined;
}

/** Route manifest response */
export interface RouteManifestResponse {
  routes: readonly AdminRouteManifestEntry[];
  count: number;
}

function parseAdminMetadata(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('metadata must be an object');
  }
  return value as Record<string, unknown>;
}

function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((item) => parseString(item, `${field}[]`));
}

export const adminTenantSchema: Schema<AdminTenant> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: tenantIdSchema.parse(obj['id']),
    name: parseString(obj['name'], 'name'),
    slug: parseString(obj['slug'], 'slug'),
    logoUrl: parseNullable(obj['logoUrl'], (v) => parseString(v, 'logoUrl')),
    ownerId: userIdSchema.parse(obj['ownerId']),
    isActive: parseBoolean(obj['isActive'], 'isActive'),
    memberCount: parseNumber(obj['memberCount'], 'memberCount', {
      int: true,
      min: 0,
    }),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
});

export const adminTenantDetailSchema: Schema<AdminTenantDetail> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    ...adminTenantSchema.parse(obj),
    metadata: parseAdminMetadata(obj['metadata']),
    allowedEmailDomains: parseStringList(obj['allowedEmailDomains'], 'allowedEmailDomains'),
  };
});

/** Default page size for the admin tenant list. */
export const ADMIN_TENANTS_DEFAULT_LIMIT = 20;

/** Hard ceiling for the admin tenant list page size. */
export const ADMIN_TENANTS_MAX_LIMIT = 100;

/** Query for the admin tenant list. */
export interface AdminTenantListQuery {
  limit: number;
  offset: number;
  search?: string | undefined;
}

export const adminTenantListQuerySchema: Schema<AdminTenantListQuery> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      // `?limit=100000` used to reach the database verbatim — every tenant row
      // and its member count in one response.
      limit:
        parseOptional(obj['limit'], (v) =>
          coerceNumber(v, 'limit', { int: true, min: 1, max: ADMIN_TENANTS_MAX_LIMIT }),
        ) ?? ADMIN_TENANTS_DEFAULT_LIMIT,
      offset:
        parseOptional(obj['offset'], (v) =>
          coerceNumber(v, 'offset', { int: true, min: 0, max: ADMIN_LIST_MAX_OFFSET }),
        ) ?? 0,
      search: parseOptional(obj['search'], (v) => parseString(v, 'search', { max: 100 })),
    };
  },
);

export const adminTenantListResponseSchema: Schema<AdminTenantListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const tenants = obj['tenants'];
    if (!Array.isArray(tenants)) {
      throw new Error('tenants must be an array');
    }
    return {
      tenants: tenants.map((tenant) => adminTenantSchema.parse(tenant)),
      total: parseNumber(obj['total'], 'total', { int: true, min: 0 }),
      limit: parseNumber(obj['limit'], 'limit', { int: true, min: 0 }),
      offset: parseNumber(obj['offset'], 'offset', { int: true, min: 0 }),
    };
  },
);

export const adminTenantStateChangeResponseSchema: Schema<AdminTenantStateChangeResponse> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      message: parseString(obj['message'], 'message'),
      tenant: adminTenantSchema.parse(obj['tenant']),
    };
  });

export const adminTenantsListResponseSchema = adminTenantListResponseSchema;

export const impersonationResponseSchema: Schema<ImpersonationResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      message: parseString(obj['message'], 'message'),
      token: parseString(obj['token'], 'token'),
      targetUserId: parseString(obj['targetUserId'], 'targetUserId'),
      targetEmail: emailSchema.parse(obj['targetEmail']),
      expiresAt: isoDateTimeSchema.parse(obj['expiresAt']),
    };
  },
);

export const endImpersonationRequestSchema: Schema<EndImpersonationRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      targetUserId: userIdSchema.parse(obj['targetUserId']),
    };
  },
);

export const endImpersonationResponseSchema: Schema<EndImpersonationResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      success: parseBoolean(obj['success'], 'success'),
      message: parseString(obj['message'], 'message'),
    };
  },
);

export const systemStatsResponseSchema: Schema<SystemStatsResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      totalUsers: parseNumber(obj['totalUsers'], 'totalUsers', {
        int: true,
        min: 0,
      }),
      totalTenants: parseNumber(obj['totalTenants'], 'totalTenants', {
        int: true,
        min: 0,
      }),
      activeSubscriptions: parseNumber(obj['activeSubscriptions'], 'activeSubscriptions', {
        int: true,
        min: 0,
      }),
      monthlyRevenue: parseNumber(obj['monthlyRevenue'], 'monthlyRevenue', {
        min: 0,
      }),
    };
  },
);

export const routeManifestEntrySchema: Schema<AdminRouteManifestEntry> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const method = parseString(obj['method'], 'method');
    if (!ADMIN_ROUTE_METHODS.includes(method as AdminRouteMethod)) {
      throw new Error(`Invalid method. Expected one of: ${ADMIN_ROUTE_METHODS.join(', ')}`);
    }
    const roles = obj['roles'];
    if (!Array.isArray(roles)) {
      throw new Error('roles must be an array');
    }
    const tags = obj['tags'];
    if (tags !== undefined && !Array.isArray(tags)) {
      throw new Error('tags must be an array');
    }
    const tagList = Array.isArray(tags) ? tags : undefined;

    return {
      path: parseString(obj['path'], 'path'),
      method: method as AdminRouteMethod,
      isPublic: parseBoolean(obj['isPublic'], 'isPublic'),
      roles: roles.map((item) => parseString(item, 'roles[]')),
      hasSchema: parseBoolean(obj['hasSchema'], 'hasSchema'),
      module: parseString(obj['module'], 'module'),
      deprecated: parseOptional(obj['deprecated'], (v) => parseBoolean(v, 'deprecated')),
      summary: parseOptional(obj['summary'], (v) => parseString(v, 'summary')),
      tags: tagList?.map((item) => parseString(item, 'tags[]')),
    };
  },
);

export const routeManifestResponseSchema: Schema<RouteManifestResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['routes'])) throw new Error('routes must be an array');

    return {
      routes: obj['routes'].map((item) => routeManifestEntrySchema.parse(item)),
      count: parseNumber(obj['count'], 'count', { int: true, min: 0 }),
    };
  },
);
