// main/modules/audit/contract/endpoints.test.ts
import { describe, expect, it } from 'vitest';

import { auditEndpoints } from './endpoints';

describe('auditEndpoints', () => {
  it('preserves byte-identical paths and auth levels for activities, audit-events, and security console', () => {
    expect(auditEndpoints.listActivities.method).toBe('GET');
    expect(auditEndpoints.listActivities.path).toBe('/api/activities');
    expect(auditEndpoints.listActivities.auth).toBe('user');

    expect(auditEndpoints.listAuditEvents.method).toBe('GET');
    expect(auditEndpoints.listAuditEvents.path).toBe('/api/admin/audit-events');
    expect(auditEndpoints.listAuditEvents.auth).toBe('admin');

    expect(auditEndpoints.listSecurityEvents.method).toBe('POST');
    expect(auditEndpoints.listSecurityEvents.path).toBe('/api/admin/security/events');
    expect(auditEndpoints.listSecurityEvents.auth).toBe('admin');

    expect(auditEndpoints.getSecurityEvent.method).toBe('GET');
    expect(auditEndpoints.getSecurityEvent.path).toBe('/api/admin/security/events/:id');
    expect(auditEndpoints.getSecurityEvent.auth).toBe('admin');
    expect(auditEndpoints.getSecurityEvent.errors).toEqual(['audit.SECURITY_EVENT_NOT_FOUND']);

    expect(auditEndpoints.getSecurityMetrics.method).toBe('GET');
    expect(auditEndpoints.getSecurityMetrics.path).toBe('/api/admin/security/metrics');
    expect(auditEndpoints.getSecurityMetrics.auth).toBe('admin');

    expect(auditEndpoints.exportSecurityEvents.method).toBe('POST');
    expect(auditEndpoints.exportSecurityEvents.path).toBe('/api/admin/security/export');
    expect(auditEndpoints.exportSecurityEvents.auth).toBe('admin');
  });

  it('rejects non-UUID :id params on getSecurityEvent', () => {
    expect(auditEndpoints.getSecurityEvent.params?.safeParse({ id: 'invalid' }).success).toBe(
      false,
    );
    expect(auditEndpoints.getSecurityEvent.params?.safeParse({}).success).toBe(false);
  });
});
