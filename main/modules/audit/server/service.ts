// main/modules/audit/server/service.ts
import {
  ACTIVITIES_DEFAULT_LIMIT,
  AUDIT_EVENTS_DEFAULT_LIMIT,
  SECURITY_EVENTS_DEFAULT_LIMIT,
  type ActivityEntry,
  type AuditLogEntry,
  type AuditSeverity,
  type ExportSecurityEventsBody,
  type ExportSecurityEventsResponse,
  type ListActivitiesResponse,
  type ListAuditEventsQuery,
  type ListAuditEventsResponse,
  type ListSecurityEventsBody,
  type ListSecurityEventsResponse,
  type SecurityEventEntry,
  type SecurityEventsFilter,
  type SecurityMetricsPeriod,
  type SecurityMetricsResponse,
} from '../contract';

import type { AuditActivityRow, AuditLogRow } from './generated/rows';
import type { AuditRepository, ListSecurityLogsFilter } from './repository';
import type { JsonValue } from '@bslt/schema';
import type { DeliveredEvent } from '@bslt/server-system/module';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const DEFAULT_ACTIVITY_RETENTION_DAYS = 90;
const SECURITY_EXPORT_MAX_ROWS = 10_000;

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/gu, (_m, ch: string) => ch.toUpperCase());
}

function toJsonRecord(raw: unknown): Readonly<Record<string, JsonValue>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = JSON.parse(JSON.stringify(v)) as JsonValue;
    } else if (typeof v === 'object') {
      out[k] = JSON.parse(JSON.stringify(v)) as JsonValue;
    }
  }
  return out;
}

export function deriveAuditTarget(
  eventName: string,
  payload: Readonly<Record<string, unknown>>,
): {
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
} {
  const parts = eventName.split('.');
  const noun = parts[1] !== undefined && parts[1] !== '' ? parts[1] : (parts[0] ?? 'resource');
  const camelNounId = `${snakeToCamel(noun)}Id`;
  const candidates = [
    payload[camelNounId],
    payload['membershipId'],
    payload['resourceId'],
    payload['id'],
    payload['userId'],
  ];
  let resourceId: string | null = null;
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      resourceId = candidate;
      break;
    }
  }
  return {
    action: eventName,
    resource: noun,
    resourceId,
  };
}

export async function recordFlaggedAuditEvent(
  repo: AuditRepository,
  event: DeliveredEvent<Record<string, unknown>>,
): Promise<AuditLogRow | null> {
  const auditMeta = event.def?.audit;
  if (auditMeta === undefined) {
    return null;
  }
  const { action, resource, resourceId } = deriveAuditTarget(event.name, event.payload);
  const subjectEmail =
    typeof event.payload['email'] === 'string' && event.payload['email'] !== ''
      ? event.payload['email']
      : null;

  return repo.appendLog({
    orgId: event.orgId,
    actorId: event.actorUserId,
    subjectEmail,
    action,
    category: auditMeta.category,
    severity: auditMeta.severity,
    resource,
    resourceId,
    metadata: toJsonRecord(event.payload),
    idempotencyKey: `audit:${event.eventId}`,
    createdAt: new Date(event.occurredAt),
  });
}

export async function recordFlaggedActivityEvent(
  repo: AuditRepository,
  event: DeliveredEvent<Record<string, unknown>>,
): Promise<AuditActivityRow | null> {
  if (event.def?.activity !== true) {
    return null;
  }
  const { action, resource, resourceId } = deriveAuditTarget(event.name, event.payload);
  const resolvedResourceId = resourceId ?? event.actorUserId ?? event.orgId ?? event.eventId;

  return repo.appendActivity({
    orgId: event.orgId,
    actorId: event.actorUserId,
    actorType: event.actorUserId !== null ? 'user' : 'system',
    action,
    resourceType: resource,
    resourceId: resolvedResourceId,
    description: null,
    metadata: toJsonRecord(event.payload),
    idempotencyKey: `activity:${event.eventId}`,
    createdAt: new Date(event.occurredAt),
  });
}

export function mapSecuritySeverityToAudit(severity: string): AuditSeverity | null {
  switch (severity) {
    case 'low':
    case 'info':
      return 'info';
    case 'medium':
    case 'warn':
      return 'warn';
    case 'high':
    case 'error':
      return 'error';
    case 'critical':
      return 'critical';
    default:
      return null;
  }
}

function mapAuditSeverityToSecurity(severity: string): string {
  switch (severity) {
    case 'info':
      return 'low';
    case 'warn':
      return 'medium';
    case 'error':
      return 'high';
    case 'critical':
      return 'critical';
    default:
      return 'low';
  }
}

function toEventTypeDisplay(action: string): string {
  return action.startsWith('security.') ? action.slice('security.'.length) : action;
}

function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  const metaObj =
    row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, JsonValue>)
      : {};
  return {
    id: row.id,
    tenantId: row.orgId,
    actorId: row.actorId,
    action: row.action,
    category: row.category,
    severity: row.severity,
    resource: row.resource,
    resourceId: row.resourceId,
    metadata: metaObj,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

function toActivityEntry(row: AuditActivityRow): ActivityEntry {
  const metaObj =
    row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, JsonValue>)
      : {};
  return {
    id: row.id,
    tenantId: row.orgId,
    actorId: row.actorId,
    actorType: row.actorType === 'system' ? 'system' : 'user',
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    description: row.description,
    metadata: metaObj,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSecurityEventEntry(row: AuditLogRow): SecurityEventEntry {
  const metaObj =
    row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, JsonValue>)
      : {};
  return {
    id: row.id,
    userId: row.actorId,
    email: row.subjectEmail,
    eventType: toEventTypeDisplay(row.action),
    severity: mapAuditSeverityToSecurity(row.severity),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: metaObj,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeSecurityFilter(filter: SecurityEventsFilter | undefined): ListSecurityLogsFilter {
  if (filter === undefined) return {};
  const mappedSeverity =
    filter.severity !== undefined && filter.severity !== ''
      ? (mapSecuritySeverityToAudit(filter.severity) ?? ('__unmatched__' as AuditSeverity))
      : undefined;
  return {
    ...(filter.eventType !== undefined && filter.eventType !== ''
      ? { eventType: filter.eventType }
      : {}),
    ...(mappedSeverity !== undefined ? { severity: mappedSeverity } : {}),
    ...(filter.userId !== undefined && filter.userId !== '' ? { userId: filter.userId } : {}),
    ...(filter.email !== undefined && filter.email !== '' ? { email: filter.email } : {}),
    ...(filter.ipAddress !== undefined && filter.ipAddress !== ''
      ? { ipAddress: filter.ipAddress }
      : {}),
    ...(filter.startDate !== undefined && filter.startDate !== ''
      ? { startDate: new Date(filter.startDate) }
      : {}),
    ...(filter.endDate !== undefined && filter.endDate !== ''
      ? { endDate: new Date(filter.endDate) }
      : {}),
  };
}

export async function listAuditEvents(
  repo: AuditRepository,
  query: ListAuditEventsQuery,
): Promise<ListAuditEventsResponse> {
  const limit = query.limit ?? AUDIT_EVENTS_DEFAULT_LIMIT;
  const rows = await repo.listLogs({
    ...(query.tenantId !== undefined ? { orgId: query.tenantId } : {}),
    ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
    ...(query.action !== undefined ? { action: query.action } : {}),
    ...(query.category !== undefined ? { category: query.category } : {}),
    ...(query.severity !== undefined ? { severity: query.severity } : {}),
    limit: limit + 1,
  });
  const truncated = rows.length > limit;
  const sliced = truncated ? rows.slice(0, limit) : rows;
  return {
    events: sliced.map(toAuditLogEntry),
    limit,
    truncated,
  };
}

export async function listUserActivities(
  repo: AuditRepository,
  viewerUserId: string,
  query: {
    readonly resourceType?: string | undefined;
    readonly action?: string | undefined;
    readonly limit?: number | undefined;
  },
): Promise<ListActivitiesResponse> {
  const limit = query.limit ?? ACTIVITIES_DEFAULT_LIMIT;
  const rows = await repo.listActivities({
    actorId: viewerUserId,
    ...(query.resourceType !== undefined ? { resourceType: query.resourceType } : {}),
    ...(query.action !== undefined ? { action: query.action } : {}),
    limit,
  });
  return {
    activities: rows.map(toActivityEntry),
  };
}

export async function listSecurityEvents(
  repo: AuditRepository,
  body: ListSecurityEventsBody,
): Promise<ListSecurityEventsResponse> {
  const page = body.page ?? 1;
  const limit = body.limit ?? SECURITY_EVENTS_DEFAULT_LIMIT;
  const offset = (page - 1) * limit;
  const sortColumn =
    body.sortBy === 'severity' ? 'severity' : body.sortBy === 'eventType' ? 'action' : 'created_at';
  const normalizedFilter = normalizeSecurityFilter(body.filter);

  const [rows, total] = await Promise.all([
    repo.listSecurityLogs({
      filter: normalizedFilter,
      sortColumn,
      sortOrder: body.sortOrder ?? 'desc',
      limit,
      offset,
    }),
    repo.countSecurityLogs(normalizedFilter),
  ]);

  const totalPages = Math.ceil(total / limit);
  return {
    data: rows.map(toSecurityEventEntry),
    total,
    page,
    limit,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    totalPages,
  };
}

export async function getSecurityEvent(
  repo: AuditRepository,
  id: string,
): Promise<SecurityEventEntry | null> {
  const row = await repo.findSecurityLogById(id);
  return row !== null ? toSecurityEventEntry(row) : null;
}

function periodStartFor(period: SecurityMetricsPeriod, now: Date): Date {
  switch (period) {
    case 'hour':
      return new Date(now.getTime() - MS_PER_HOUR);
    case 'day':
      return new Date(now.getTime() - MS_PER_DAY);
    case 'week':
      return new Date(now.getTime() - 7 * MS_PER_DAY);
    case 'month':
      return new Date(now.getTime() - 30 * MS_PER_DAY);
  }
}

export async function getSecurityMetrics(
  repo: AuditRepository,
  period: SecurityMetricsPeriod = 'day',
  now: Date = new Date(),
): Promise<SecurityMetricsResponse> {
  const start = periodStartFor(period, now);
  const summaryRows = await repo.listSecuritySummary(start, now);

  let criticalEvents = 0;
  let highEvents = 0;
  let mediumEvents = 0;
  let lowEvents = 0;
  let tokenReuseCount = 0;
  let accountLockedCount = 0;
  let suspiciousLoginCount = 0;
  const eventsByType: Record<string, number> = {};

  for (const row of summaryRows) {
    const secSeverity = mapAuditSeverityToSecurity(row.severity);
    if (secSeverity === 'critical') criticalEvents += 1;
    else if (secSeverity === 'high') highEvents += 1;
    else if (secSeverity === 'medium') mediumEvents += 1;
    else lowEvents += 1;

    const eventType = toEventTypeDisplay(row.action);
    if (eventType === 'token_reuse_detected') tokenReuseCount += 1;
    if (eventType === 'account_locked') accountLockedCount += 1;
    if (eventType === 'suspicious_login') suspiciousLoginCount += 1;
    eventsByType[eventType] = (eventsByType[eventType] ?? 0) + 1;
  }

  return {
    totalEvents: summaryRows.length,
    criticalEvents,
    highEvents,
    mediumEvents,
    lowEvents,
    tokenReuseCount,
    accountLockedCount,
    suspiciousLoginCount,
    eventsByType,
    period,
    periodStart: start.toISOString(),
    periodEnd: now.toISOString(),
  };
}

function escapeCsvCell(value: string): string {
  const safeFormula = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safeFormula.replace(/"/gu, '""')}"`;
}

export async function exportSecurityEvents(
  repo: AuditRepository,
  body: ExportSecurityEventsBody,
  now: Date = new Date(),
): Promise<ExportSecurityEventsResponse> {
  const normalizedFilter = normalizeSecurityFilter(body.filter);
  const rows = await repo.listSecurityLogs({
    filter: normalizedFilter,
    sortColumn: 'created_at',
    sortOrder: 'desc',
    limit: SECURITY_EXPORT_MAX_ROWS,
    offset: 0,
  });
  const apiEvents = rows.map(toSecurityEventEntry);
  const dateStamp = now.toISOString().slice(0, 10);

  if (body.format === 'json') {
    return {
      data: JSON.stringify(apiEvents, null, 2),
      filename: `security-events-${dateStamp}.json`,
      contentType: 'application/json',
    };
  }

  const headers = [
    'id',
    'userId',
    'email',
    'eventType',
    'severity',
    'ipAddress',
    'userAgent',
    'metadata',
    'createdAt',
  ];
  const csvRows = [headers.join(',')];
  for (const ev of apiEvents) {
    csvRows.push(
      [
        ev.id,
        ev.userId ?? '',
        escapeCsvCell(ev.email ?? ''),
        escapeCsvCell(ev.eventType),
        ev.severity,
        ev.ipAddress ?? '',
        escapeCsvCell(ev.userAgent ?? ''),
        escapeCsvCell(JSON.stringify(ev.metadata ?? {})),
        ev.createdAt,
      ].join(','),
    );
  }

  return {
    data: csvRows.join('\n'),
    filename: `security-events-${dateStamp}.csv`,
    contentType: 'text/csv',
  };
}

export async function pruneOldActivities(
  repo: AuditRepository,
  now: Date,
  retentionDays: number = DEFAULT_ACTIVITY_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);
  return repo.deleteActivitiesOlderThan(cutoff);
}
