// main/modules/audit/web/format.test.ts
import { describe, expect, it } from 'vitest';

import {
  actorTypeTone,
  auditSeverityTone,
  formatActivityActionLabel,
  formatActivitySummary,
  formatAuditDateTime,
  formatAuditTimeAgo,
  formatSecurityEventType,
  securitySeverityTone,
  truncateAuditText,
} from './format';

describe('audit web format helpers', () => {
  it('handles invalid dates, empty strings, and unknown tones safely without throwing', () => {
    expect(formatAuditDateTime('not-a-date')).toBe('-');
    expect(formatAuditDateTime('')).toBe('-');
    expect(formatAuditTimeAgo('not-a-date')).toBe('-');
    expect(auditSeverityTone('critical')).toBe('danger');
    expect(auditSeverityTone('error')).toBe('danger');
    expect(auditSeverityTone('warn')).toBe('warning');
    expect(auditSeverityTone('info')).toBe('info');
    expect(securitySeverityTone('critical')).toBe('danger');
    expect(securitySeverityTone('high')).toBe('danger');
    expect(securitySeverityTone('medium')).toBe('warning');
    expect(securitySeverityTone('low')).toBe('info');
    expect(securitySeverityTone('unknown')).toBe('neutral');
    expect(actorTypeTone('system')).toBe('warning');
    expect(actorTypeTone('user')).toBe('info');
  });

  it('truncates long identifiers and formats activity summaries and security event types', () => {
    expect(truncateAuditText('1234567890abcdef', 8)).toBe('12345678...');
    expect(truncateAuditText('short', 8)).toBe('short');
    expect(formatSecurityEventType('token_reuse_detected')).toBe('Token Reuse Detected');
    expect(formatSecurityEventType('')).toBe('Unknown');
    expect(formatActivityActionLabel('user.login')).toBe('Signed in');
    expect(formatActivityActionLabel('tasks.task.created')).toBe('Tasks Task Created');
    expect(
      formatActivitySummary({
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: null,
        actorId: null,
        actorType: 'user',
        action: 'tasks.task.created',
        resourceType: '',
        resourceId: '',
        description: null,
        metadata: {},
        ipAddress: null,
        createdAt: '2026-11-17T00:00:00.000Z',
      }),
    ).toBeNull();
  });
});
