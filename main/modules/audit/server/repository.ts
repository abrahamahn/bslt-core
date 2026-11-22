// main/modules/audit/server/repository.ts
import { formatJsonb, toCamelCase, type RawDb } from '@bslt/db';

import {
  AUDIT_ACTIVITY_COLUMNS,
  AUDIT_LOG_COLUMNS,
  type AuditActivityRow,
  type AuditLogRow,
} from './generated/rows';

import type { AuditActorType, AuditCategory, AuditSeverity } from '../contract';
import type { JsonValue } from '@bslt/schema';

interface AppendAuditLogInput {
  readonly orgId?: string | null | undefined;
  readonly actorId?: string | null | undefined;
  readonly subjectEmail?: string | null | undefined;
  readonly action: string;
  readonly category: AuditCategory;
  readonly severity: AuditSeverity;
  readonly resource: string;
  readonly resourceId?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly idempotencyKey?: string | null | undefined;
  readonly createdAt?: Date | undefined;
}

interface ListAuditLogsFilter {
  readonly orgId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly action?: string | undefined;
  readonly category?: AuditCategory | undefined;
  readonly severity?: AuditSeverity | undefined;
  readonly startDate?: Date | undefined;
  readonly endDate?: Date | undefined;
  readonly limit?: number | undefined;
}

export interface ListSecurityLogsFilter {
  readonly eventType?: string | undefined;
  readonly severity?: AuditSeverity | undefined;
  readonly userId?: string | undefined;
  readonly email?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly startDate?: Date | undefined;
  readonly endDate?: Date | undefined;
}

interface ListSecurityLogsOptions {
  readonly filter?: ListSecurityLogsFilter | undefined;
  readonly sortColumn?: 'created_at' | 'severity' | 'action' | undefined;
  readonly sortOrder?: 'asc' | 'desc' | undefined;
  readonly limit: number;
  readonly offset: number;
}

interface AppendAuditActivityInput {
  readonly orgId?: string | null | undefined;
  readonly actorId?: string | null | undefined;
  readonly actorType: AuditActorType;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly description?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly idempotencyKey?: string | null | undefined;
  readonly createdAt?: Date | undefined;
}

interface ListActivitiesFilter {
  readonly actorId?: string | undefined;
  readonly orgId?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly action?: string | undefined;
  readonly limit?: number | undefined;
}

interface SecuritySummaryRow {
  readonly action: string;
  readonly severity: string;
}

export interface AuditRepository {
  appendLog(input: AppendAuditLogInput): Promise<AuditLogRow | null>;
  listLogs(filter: ListAuditLogsFilter): Promise<AuditLogRow[]>;
  findSecurityLogById(id: string): Promise<AuditLogRow | null>;
  listSecurityLogs(options: ListSecurityLogsOptions): Promise<AuditLogRow[]>;
  countSecurityLogs(filter?: ListSecurityLogsFilter): Promise<number>;
  listSecuritySummary(start: Date, end: Date): Promise<SecuritySummaryRow[]>;
  appendActivity(input: AppendAuditActivityInput): Promise<AuditActivityRow | null>;
  listActivities(filter: ListActivitiesFilter): Promise<AuditActivityRow[]>;
  deleteActivitiesOlderThan(cutoff: Date): Promise<number>;
  deleteActivitiesByActorId(actorId: string): Promise<number>;
}

function parseJsonColumn(value: unknown): JsonValue {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return {};
    }
  }
  if (value === null || value === undefined) {
    return {};
  }
  return value as JsonValue;
}

function mapLogRow(row: Record<string, unknown>): AuditLogRow {
  const camel = toCamelCase<AuditLogRow>(row, AUDIT_LOG_COLUMNS);
  const createdAt =
    camel.createdAt instanceof Date ? camel.createdAt : new Date(String(camel.createdAt));
  return {
    ...camel,
    metadata: parseJsonColumn(row['metadata']),
    createdAt,
  };
}

function mapActivityRow(row: Record<string, unknown>): AuditActivityRow {
  const camel = toCamelCase<AuditActivityRow>(row, AUDIT_ACTIVITY_COLUMNS);
  const createdAt =
    camel.createdAt instanceof Date ? camel.createdAt : new Date(String(camel.createdAt));
  return {
    ...camel,
    metadata: parseJsonColumn(row['metadata']),
    createdAt,
  };
}

function buildSecurityWhere(filter: ListSecurityLogsFilter | undefined): {
  readonly whereSql: string;
  readonly params: unknown[];
} {
  const clauses: string[] = [`category = 'security'`];
  const params: unknown[] = [];

  if (filter !== undefined) {
    if (filter.eventType !== undefined && filter.eventType !== '') {
      params.push(filter.eventType);
      const idx = params.length;
      clauses.push(`(action = $${String(idx)} OR action = ('security.' || $${String(idx)}))`);
    }
    if (filter.severity !== undefined) {
      params.push(filter.severity);
      clauses.push(`severity = $${String(params.length)}`);
    }
    if (filter.userId !== undefined && filter.userId !== '') {
      params.push(filter.userId);
      clauses.push(`actor_id::text = $${String(params.length)}`);
    }
    if (filter.email !== undefined && filter.email !== '') {
      params.push(`%${filter.email}%`);
      clauses.push(`subject_email ILIKE $${String(params.length)}`);
    }
    if (filter.ipAddress !== undefined && filter.ipAddress !== '') {
      params.push(filter.ipAddress);
      clauses.push(`ip_address = $${String(params.length)}`);
    }
    if (filter.startDate !== undefined && !Number.isNaN(filter.startDate.getTime())) {
      params.push(filter.startDate.toISOString());
      clauses.push(`created_at >= $${String(params.length)}::timestamptz`);
    }
    if (filter.endDate !== undefined && !Number.isNaN(filter.endDate.getTime())) {
      params.push(filter.endDate.toISOString());
      clauses.push(`created_at <= $${String(params.length)}::timestamptz`);
    }
  }

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

export function auditRepository(tx: RawDb): AuditRepository {
  return {
    async appendLog(input) {
      const hasKey = input.idempotencyKey !== undefined && input.idempotencyKey !== null;
      const conflictClause = hasKey
        ? 'ON CONFLICT (idempotency_key) WHERE (idempotency_key IS NOT NULL) DO NOTHING'
        : '';
      const createdAtIso = (input.createdAt ?? new Date()).toISOString();
      const rows = await tx.raw(
        `INSERT INTO audit_log
           (org_id, actor_id, subject_email, action, category, severity, resource, resource_id, metadata, ip_address, user_agent, idempotency_key, created_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10, $11, $12, $13::timestamptz)
         ${conflictClause}
         RETURNING *`,
        [
          input.orgId ?? null,
          input.actorId ?? null,
          input.subjectEmail ?? null,
          input.action,
          input.category,
          input.severity,
          input.resource,
          input.resourceId ?? null,
          formatJsonb(input.metadata ?? {}),
          input.ipAddress ?? null,
          input.userAgent ?? null,
          input.idempotencyKey ?? null,
          createdAtIso,
        ],
      );
      const first = rows[0];
      return first !== undefined ? mapLogRow(first) : null;
    },

    async listLogs(filter) {
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (filter.orgId !== undefined) {
        params.push(filter.orgId);
        clauses.push(`org_id = $${String(params.length)}::uuid`);
      }
      if (filter.actorId !== undefined) {
        params.push(filter.actorId);
        clauses.push(`actor_id = $${String(params.length)}::uuid`);
      }
      if (filter.action !== undefined && filter.action !== '') {
        params.push(filter.action);
        clauses.push(`action = $${String(params.length)}`);
      }
      if (filter.category !== undefined) {
        params.push(filter.category);
        clauses.push(`category = $${String(params.length)}`);
      }
      if (filter.severity !== undefined) {
        params.push(filter.severity);
        clauses.push(`severity = $${String(params.length)}`);
      }
      if (filter.startDate !== undefined) {
        params.push(filter.startDate.toISOString());
        clauses.push(`created_at >= $${String(params.length)}::timestamptz`);
      }
      if (filter.endDate !== undefined) {
        params.push(filter.endDate.toISOString());
        clauses.push(`created_at <= $${String(params.length)}::timestamptz`);
      }

      const limit = filter.limit ?? 100;
      params.push(limit);
      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await tx.raw(
        `SELECT * FROM audit_log ${whereSql} ORDER BY created_at DESC LIMIT $${String(params.length)}`,
        params,
      );
      return rows.map(mapLogRow);
    },

    async findSecurityLogById(id) {
      const rows = await tx.raw(
        `SELECT * FROM audit_log WHERE id = $1::uuid AND category = 'security' LIMIT 1`,
        [id],
      );
      const first = rows[0];
      return first !== undefined ? mapLogRow(first) : null;
    },

    async listSecurityLogs(options) {
      const { whereSql, params } = buildSecurityWhere(options.filter);
      const sortCol = options.sortColumn ?? 'created_at';
      const dir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
      params.push(options.limit, options.offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;
      const rows = await tx.raw(
        `SELECT * FROM audit_log ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT $${String(limitIdx)} OFFSET $${String(offsetIdx)}`,
        params,
      );
      return rows.map(mapLogRow);
    },

    async countSecurityLogs(filter) {
      const { whereSql, params } = buildSecurityWhere(filter);
      const rows = await tx.raw<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM audit_log ${whereSql}`,
        params,
      );
      return rows[0]?.count ?? 0;
    },

    async listSecuritySummary(start, end) {
      const rows = await tx.raw<{ action: string; severity: string }>(
        `SELECT action, severity
           FROM audit_log
          WHERE category = 'security'
            AND created_at >= $1::timestamptz
            AND created_at <= $2::timestamptz`,
        [start.toISOString(), end.toISOString()],
      );
      return rows;
    },

    async appendActivity(input) {
      const hasKey = input.idempotencyKey !== undefined && input.idempotencyKey !== null;
      const conflictClause = hasKey
        ? 'ON CONFLICT (idempotency_key) WHERE (idempotency_key IS NOT NULL) DO NOTHING'
        : '';
      const createdAtIso = (input.createdAt ?? new Date()).toISOString();
      const rows = await tx.raw(
        `INSERT INTO audit_activity
           (org_id, actor_id, actor_type, action, resource_type, resource_id, description, metadata, ip_address, idempotency_key, created_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9, $10, $11::timestamptz)
         ${conflictClause}
         RETURNING *`,
        [
          input.orgId ?? null,
          input.actorId ?? null,
          input.actorType,
          input.action,
          input.resourceType,
          input.resourceId,
          input.description ?? null,
          formatJsonb(input.metadata ?? {}),
          input.ipAddress ?? null,
          input.idempotencyKey ?? null,
          createdAtIso,
        ],
      );
      const first = rows[0];
      return first !== undefined ? mapActivityRow(first) : null;
    },

    async listActivities(filter) {
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (filter.actorId !== undefined && filter.actorId !== '') {
        params.push(filter.actorId);
        clauses.push(`actor_id = $${String(params.length)}::uuid`);
      }
      if (filter.orgId !== undefined && filter.orgId !== '') {
        params.push(filter.orgId);
        clauses.push(`org_id = $${String(params.length)}::uuid`);
      }
      if (filter.resourceType !== undefined && filter.resourceType !== '') {
        params.push(filter.resourceType);
        clauses.push(`resource_type = $${String(params.length)}`);
      }
      if (filter.action !== undefined && filter.action !== '') {
        params.push(filter.action);
        clauses.push(`action = $${String(params.length)}`);
      }

      const limit = filter.limit ?? 50;
      params.push(limit);
      const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await tx.raw(
        `SELECT * FROM audit_activity ${whereSql} ORDER BY created_at DESC LIMIT $${String(params.length)}`,
        params,
      );
      return rows.map(mapActivityRow);
    },

    async deleteActivitiesOlderThan(cutoff) {
      const rows = await tx.raw<{ id: string }>(
        `DELETE FROM audit_activity WHERE created_at < $1::timestamptz RETURNING id`,
        [cutoff.toISOString()],
      );
      return rows.length;
    },

    async deleteActivitiesByActorId(actorId) {
      const rows = await tx.raw<{ id: string }>(
        `DELETE FROM audit_activity WHERE actor_id = $1::uuid RETURNING id`,
        [actorId],
      );
      return rows.length;
    },
  };
}
