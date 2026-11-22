// main/modules/audit/contract/endpoints.ts
import { endpoint } from '@bslt/contract';

import { auditErrors } from './errors';
import {
  exportSecurityEventsBodySchema,
  exportSecurityEventsResponseSchema,
  listActivitiesQuerySchema,
  listActivitiesResponseSchema,
  listAuditEventsQuerySchema,
  listAuditEventsResponseSchema,
  listSecurityEventsBodySchema,
  listSecurityEventsResponseSchema,
  securityEventEntrySchema,
  securityEventParamsSchema,
  securityMetricsQuerySchema,
  securityMetricsResponseSchema,
} from './schemas';

export const auditEndpoints = {
  listActivities: endpoint({
    method: 'GET',
    path: '/api/activities',
    auth: 'user',
    query: listActivitiesQuerySchema,
    response: listActivitiesResponseSchema,
    summary: 'List recent activity timeline entries for the authenticated user',
  }),
  listAuditEvents: endpoint({
    method: 'GET',
    path: '/api/admin/audit-events',
    auth: 'admin',
    query: listAuditEventsQuerySchema,
    response: listAuditEventsResponseSchema,
    summary: 'List append-only audit log entries (platform admin)',
  }),
  listSecurityEvents: endpoint({
    method: 'POST',
    path: '/api/admin/security/events',
    auth: 'admin',
    body: listSecurityEventsBodySchema,
    response: listSecurityEventsResponseSchema,
    summary: 'List filtered security audit events (platform admin)',
  }),
  getSecurityEvent: endpoint({
    method: 'GET',
    path: '/api/admin/security/events/:id',
    auth: 'admin',
    params: securityEventParamsSchema,
    response: securityEventEntrySchema,
    errors: [auditErrors.SECURITY_EVENT_NOT_FOUND],
    summary: 'Get a single security audit event by ID (platform admin)',
  }),
  getSecurityMetrics: endpoint({
    method: 'GET',
    path: '/api/admin/security/metrics',
    auth: 'admin',
    query: securityMetricsQuerySchema,
    response: securityMetricsResponseSchema,
    summary: 'Get aggregated security event metrics over a time window (platform admin)',
  }),
  exportSecurityEvents: endpoint({
    method: 'POST',
    path: '/api/admin/security/export',
    auth: 'admin',
    body: exportSecurityEventsBodySchema,
    response: exportSecurityEventsResponseSchema,
    summary: 'Export filtered security audit events as CSV or JSON (platform admin)',
  }),
} as const;
