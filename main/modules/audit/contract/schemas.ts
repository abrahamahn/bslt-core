// main/modules/audit/contract/schemas.ts
import {
  array,
  boolean,
  enumOf,
  json,
  nullable,
  number,
  object,
  optional,
  record,
  refine,
  string,
  type Infer,
} from '@bslt/schema';

export const AUDIT_CATEGORIES = [
  'security',
  'data',
  'billing',
  'trust_safety',
  'compliance',
  'admin',
  'kyc_access',
  'system',
] as const;

const AUDIT_SEVERITIES = ['info', 'warn', 'error', 'critical'] as const;

export const SECURITY_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export const SECURITY_EVENT_TYPES = [
  'token_reuse_detected',
  'token_family_revoked',
  'account_locked',
  'account_unlocked',
  'suspicious_login',
  'password_changed',
  'email_changed',
  'login_failed',
  'login_success',
  'logout',
  'oauth_linked',
  'oauth_unlinked',
  'oauth_login_success',
  'oauth_login_failure',
  'magic_link_requested',
  'magic_link_verified',
  'magic_link_failed',
  'totp_enabled',
  'totp_disabled',
  'totp_verified',
  'totp_failed',
  'user_force_logout',
  'user_hard_banned',
  'user_soft_deleted',
] as const;

const SECURITY_METRICS_PERIODS = ['hour', 'day', 'week', 'month'] as const;

export const AUDIT_EVENTS_DEFAULT_LIMIT = 100;
const AUDIT_EVENTS_MAX_LIMIT = 500;
export const ACTIVITIES_DEFAULT_LIMIT = 50;
const ACTIVITIES_MAX_LIMIT = 200;
export const SECURITY_EVENTS_DEFAULT_LIMIT = 50;
const SECURITY_EVENTS_MAX_LIMIT = 200;

export const auditCategorySchema = enumOf(AUDIT_CATEGORIES);
export type AuditCategory = Infer<typeof auditCategorySchema>;

const auditSeveritySchema = enumOf(AUDIT_SEVERITIES);
export type AuditSeverity = Infer<typeof auditSeveritySchema>;

const actorTypeSchema = enumOf(['user', 'system'] as const);
export type AuditActorType = Infer<typeof actorTypeSchema>;

export const auditLogEntrySchema = object({
  id: string({ label: 'id', format: 'uuid' }),
  tenantId: nullable(string({ label: 'tenantId', format: 'uuid' })),
  actorId: nullable(string({ label: 'actorId', format: 'uuid' })),
  action: string({ label: 'action', min: 1, max: 200 }),
  category: auditCategorySchema,
  severity: auditSeveritySchema,
  resource: string({ label: 'resource', min: 1, max: 120 }),
  resourceId: nullable(string({ label: 'resourceId', max: 256 })),
  metadata: record(json()),
  ipAddress: nullable(string({ label: 'ipAddress', max: 128 })),
  userAgent: nullable(string({ label: 'userAgent', max: 1024 })),
  createdAt: string({ label: 'createdAt', min: 1 }),
});
export type AuditLogEntry = Infer<typeof auditLogEntrySchema>;

export const listAuditEventsQuerySchema = object({
  tenantId: optional(string({ label: 'tenantId', format: 'uuid' })),
  actorId: optional(string({ label: 'actorId', format: 'uuid' })),
  action: optional(string({ label: 'action', trim: true, min: 1, max: 200 })),
  category: optional(auditCategorySchema),
  severity: optional(auditSeveritySchema),
  limit: optional(
    number({
      label: 'limit',
      coerce: true,
      int: true,
      min: 1,
      max: AUDIT_EVENTS_MAX_LIMIT,
    }),
  ),
});
export type ListAuditEventsQuery = Infer<typeof listAuditEventsQuerySchema>;

export const listAuditEventsResponseSchema = object({
  events: array(auditLogEntrySchema),
  limit: number({ label: 'limit', int: true, min: 1, max: AUDIT_EVENTS_MAX_LIMIT }),
  truncated: boolean({ label: 'truncated' }),
});
export type ListAuditEventsResponse = Infer<typeof listAuditEventsResponseSchema>;

const activityEntrySchema = object({
  id: string({ label: 'id', format: 'uuid' }),
  tenantId: nullable(string({ label: 'tenantId', format: 'uuid' })),
  actorId: nullable(string({ label: 'actorId', format: 'uuid' })),
  actorType: actorTypeSchema,
  action: string({ label: 'action', min: 1, max: 200 }),
  resourceType: string({ label: 'resourceType', min: 1, max: 120 }),
  resourceId: string({ label: 'resourceId', min: 1, max: 256 }),
  description: nullable(string({ label: 'description', max: 1000 })),
  metadata: record(json()),
  ipAddress: nullable(string({ label: 'ipAddress', max: 128 })),
  createdAt: string({ label: 'createdAt', min: 1 }),
});
export type ActivityEntry = Infer<typeof activityEntrySchema>;

export const listActivitiesQuerySchema = object({
  resourceType: optional(string({ label: 'resourceType', trim: true, min: 1, max: 120 })),
  actorId: optional(string({ label: 'actorId', trim: true, min: 1, max: 128 })),
  action: optional(string({ label: 'action', trim: true, min: 1, max: 200 })),
  cursor: optional(string({ label: 'cursor', trim: true, min: 1, max: 256 })),
  limit: optional(
    number({
      label: 'limit',
      coerce: true,
      int: true,
      min: 1,
      max: ACTIVITIES_MAX_LIMIT,
    }),
  ),
});

export const listActivitiesResponseSchema = object({
  activities: array(activityEntrySchema),
});
export type ListActivitiesResponse = Infer<typeof listActivitiesResponseSchema>;

const baseSecurityEventsFilterSchema = object({
  eventType: optional(string({ label: 'eventType', max: 200 })),
  severity: optional(string({ label: 'severity', max: 32 })),
  userId: optional(string({ label: 'userId', max: 128 })),
  email: optional(string({ label: 'email', max: 320 })),
  ipAddress: optional(string({ label: 'ipAddress', max: 128 })),
  startDate: optional(string({ label: 'startDate', max: 64 })),
  endDate: optional(string({ label: 'endDate', max: 64 })),
});

export const securityEventsFilterSchema = refine(
  baseSecurityEventsFilterSchema,
  (filter) => {
    if (
      filter.startDate !== undefined &&
      filter.startDate !== '' &&
      filter.endDate !== undefined &&
      filter.endDate !== ''
    ) {
      const startMs = Date.parse(filter.startDate);
      const endMs = Date.parse(filter.endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return false;
      }
      return startMs <= endMs;
    }
    if (filter.startDate !== undefined && filter.startDate !== '') {
      return !Number.isNaN(Date.parse(filter.startDate));
    }
    if (filter.endDate !== undefined && filter.endDate !== '') {
      return !Number.isNaN(Date.parse(filter.endDate));
    }
    return true;
  },
  'startDate and endDate must be valid dates with startDate <= endDate',
);
export type SecurityEventsFilter = Infer<typeof securityEventsFilterSchema>;

export const listSecurityEventsBodySchema = object({
  page: optional(number({ label: 'page', int: true, min: 1 })),
  limit: optional(number({ label: 'limit', int: true, min: 1, max: SECURITY_EVENTS_MAX_LIMIT })),
  sortBy: optional(string({ label: 'sortBy', min: 1, max: 64 })),
  sortOrder: optional(enumOf(['asc', 'desc'] as const)),
  filter: optional(securityEventsFilterSchema),
});
export type ListSecurityEventsBody = Infer<typeof listSecurityEventsBodySchema>;

export const securityEventEntrySchema = object({
  id: string({ label: 'id', format: 'uuid' }),
  userId: nullable(string({ label: 'userId', format: 'uuid' })),
  email: nullable(string({ label: 'email', max: 320 })),
  eventType: string({ label: 'eventType', min: 1, max: 200 }),
  severity: string({ label: 'severity', min: 1, max: 32 }),
  ipAddress: nullable(string({ label: 'ipAddress', max: 128 })),
  userAgent: nullable(string({ label: 'userAgent', max: 1024 })),
  metadata: nullable(record(json())),
  createdAt: string({ label: 'createdAt', min: 1 }),
});
export type SecurityEventEntry = Infer<typeof securityEventEntrySchema>;

export const listSecurityEventsResponseSchema = object({
  data: array(securityEventEntrySchema),
  total: number({ label: 'total', int: true, min: 0 }),
  page: number({ label: 'page', int: true, min: 1 }),
  limit: number({ label: 'limit', int: true, min: 1, max: SECURITY_EVENTS_MAX_LIMIT }),
  hasNext: boolean({ label: 'hasNext' }),
  hasPrev: boolean({ label: 'hasPrev' }),
  totalPages: number({ label: 'totalPages', int: true, min: 0 }),
});
export type ListSecurityEventsResponse = Infer<typeof listSecurityEventsResponseSchema>;

export const securityEventParamsSchema = object({
  id: string({ label: 'id', format: 'uuid' }),
});

const securityMetricsPeriodSchema = enumOf(SECURITY_METRICS_PERIODS);
export type SecurityMetricsPeriod = Infer<typeof securityMetricsPeriodSchema>;

export const securityMetricsQuerySchema = object({
  period: optional(securityMetricsPeriodSchema),
});

export const securityMetricsResponseSchema = object({
  totalEvents: number({ label: 'totalEvents', int: true, min: 0 }),
  criticalEvents: number({ label: 'criticalEvents', int: true, min: 0 }),
  highEvents: number({ label: 'highEvents', int: true, min: 0 }),
  mediumEvents: number({ label: 'mediumEvents', int: true, min: 0 }),
  lowEvents: number({ label: 'lowEvents', int: true, min: 0 }),
  tokenReuseCount: number({ label: 'tokenReuseCount', int: true, min: 0 }),
  accountLockedCount: number({ label: 'accountLockedCount', int: true, min: 0 }),
  suspiciousLoginCount: number({ label: 'suspiciousLoginCount', int: true, min: 0 }),
  eventsByType: record(number({ int: true, min: 0 })),
  period: securityMetricsPeriodSchema,
  periodStart: string({ label: 'periodStart', min: 1 }),
  periodEnd: string({ label: 'periodEnd', min: 1 }),
});
export type SecurityMetricsResponse = Infer<typeof securityMetricsResponseSchema>;

export const exportSecurityEventsBodySchema = object({
  format: enumOf(['csv', 'json'] as const),
  filter: optional(securityEventsFilterSchema),
});
export type ExportSecurityEventsBody = Infer<typeof exportSecurityEventsBodySchema>;

export const exportSecurityEventsResponseSchema = object({
  data: string({ label: 'data' }),
  filename: string({ label: 'filename', min: 1 }),
  contentType: string({ label: 'contentType', min: 1 }),
});
export type ExportSecurityEventsResponse = Infer<typeof exportSecurityEventsResponseSchema>;
