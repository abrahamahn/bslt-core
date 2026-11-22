// main/modules/audit/server/service.test.ts
import { describe, expect, it, vi } from 'vitest';

import { event } from '@bslt/contract';
import { object, string } from '@bslt/schema';

import {
  deriveAuditTarget,
  exportSecurityEvents,
  getSecurityEvent,
  getSecurityMetrics,
  listAuditEvents,
  listSecurityEvents,
  mapSecuritySeverityToAudit,
  recordFlaggedActivityEvent,
  recordFlaggedAuditEvent,
} from './service';

import type { AuditRepository } from './repository';

const LOG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('audit service', () => {
  it('derives noun and resourceId from <module>.<noun>.<verb> event names', () => {
    expect(deriveAuditTarget('tasks.task.created', { taskId: 't-99', userId: USER_ID })).toEqual({
      action: 'tasks.task.created',
      resource: 'task',
      resourceId: 't-99',
    });

    expect(deriveAuditTarget('compliance.kyc_record.viewed', { kycRecordId: 'kyc-7' })).toEqual({
      action: 'compliance.kyc_record.viewed',
      resource: 'kyc_record',
      resourceId: 'kyc-7',
    });
  });

  it('ignores unflagged events in recordFlaggedAuditEvent and recordFlaggedActivityEvent', async () => {
    const appendLog = vi.fn();
    const appendActivity = vi.fn();
    const repo = { appendLog, appendActivity } as unknown as AuditRepository;
    const unflaggedDef = event('tasks.task.listed', object({ userId: string() }));

    const auditResult = await recordFlaggedAuditEvent(repo, {
      eventId: 'ev-1',
      name: 'tasks.task.listed',
      version: 1,
      payload: { userId: USER_ID },
      actorUserId: USER_ID,
      orgId: null,
      occurredAt: '2026-11-17T00:00:00.000Z',
      def: unflaggedDef,
    });
    expect(auditResult).toBeNull();
    expect(appendLog).not.toHaveBeenCalled();

    const activityResult = await recordFlaggedActivityEvent(repo, {
      eventId: 'ev-1',
      name: 'tasks.task.listed',
      version: 1,
      payload: { userId: USER_ID },
      actorUserId: USER_ID,
      orgId: null,
      occurredAt: '2026-11-17T00:00:00.000Z',
      def: unflaggedDef,
    });
    expect(activityResult).toBeNull();
    expect(appendActivity).not.toHaveBeenCalled();
  });

  it('detects truncation when listLogs returns limit + 1 rows', async () => {
    const sample = {
      id: LOG_ID,
      orgId: null,
      actorId: USER_ID,
      subjectEmail: null,
      action: 'moderation.case.decided',
      category: 'trust_safety',
      severity: 'warn',
      resource: 'case',
      resourceId: 'case-1',
      metadata: {},
      ipAddress: null,
      userAgent: null,
      idempotencyKey: null,
      createdAt: new Date('2026-11-17T00:00:00.000Z'),
    };
    const repo = {
      listLogs: vi.fn().mockResolvedValue([sample, { ...sample, id: USER_ID }]),
    } as unknown as AuditRepository;

    const result = await listAuditEvents(repo, { limit: 1 });
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.limit).toBe(1);
  });

  it('returns null when getSecurityEvent misses and maps severities symmetrically', async () => {
    const repo = {
      findSecurityLogById: vi.fn().mockResolvedValue(null),
    } as unknown as AuditRepository;

    expect(await getSecurityEvent(repo, LOG_ID)).toBeNull();
    expect(mapSecuritySeverityToAudit('low')).toBe('info');
    expect(mapSecuritySeverityToAudit('medium')).toBe('warn');
    expect(mapSecuritySeverityToAudit('high')).toBe('error');
    expect(mapSecuritySeverityToAudit('critical')).toBe('critical');
    expect(mapSecuritySeverityToAudit('unknown-level')).toBeNull();
  });

  it('computes security metrics and exports escaped CSV and JSON', async () => {
    const now = new Date('2026-11-17T12:00:00.000Z');
    const secRow = {
      id: LOG_ID,
      orgId: null,
      actorId: USER_ID,
      subjectEmail: 'user@example.com',
      action: 'security.token_reuse_detected',
      category: 'security',
      severity: 'critical',
      resource: 'security',
      resourceId: USER_ID,
      metadata: { note: 'quote "here"' },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0, Chrome',
      idempotencyKey: null,
      createdAt: now,
    };
    const repo = {
      listSecuritySummary: vi.fn().mockResolvedValue([
        { action: 'security.token_reuse_detected', severity: 'critical' },
        { action: 'security.account_locked', severity: 'error' },
        { action: 'security.suspicious_login', severity: 'warn' },
        { action: 'security.login_success', severity: 'info' },
      ]),
      listSecurityLogs: vi.fn().mockResolvedValue([secRow]),
      countSecurityLogs: vi.fn().mockResolvedValue(1),
    } as unknown as AuditRepository;

    const metrics = await getSecurityMetrics(repo, 'day', now);
    expect(metrics.totalEvents).toBe(4);
    expect(metrics.criticalEvents).toBe(1);
    expect(metrics.highEvents).toBe(1);
    expect(metrics.mediumEvents).toBe(1);
    expect(metrics.lowEvents).toBe(1);
    expect(metrics.tokenReuseCount).toBe(1);
    expect(metrics.accountLockedCount).toBe(1);
    expect(metrics.suspiciousLoginCount).toBe(1);

    const listed = await listSecurityEvents(repo, { page: 1, limit: 10 });
    expect(listed.data[0]?.eventType).toBe('token_reuse_detected');
    expect(listed.data[0]?.severity).toBe('critical');

    const csv = await exportSecurityEvents(repo, { format: 'csv' }, now);
    expect(csv.contentType).toBe('text/csv');
    expect(csv.filename).toBe('security-events-2026-11-17.csv');
    expect(csv.data).toContain('"Mozilla/5.0, Chrome"');

    const jsonOut = await exportSecurityEvents(repo, { format: 'json' }, now);
    expect(jsonOut.contentType).toBe('application/json');
    expect(JSON.parse(jsonOut.data)).toHaveLength(1);
  });
});
