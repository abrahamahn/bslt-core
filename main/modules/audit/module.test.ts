// main/modules/audit/module.test.ts
import { describe, expect, it } from 'vitest';

import { defineModule } from '@bslt/contract';

import { auditModule } from './module';

describe('auditModule', () => {
  it('declares projection module with zero dependsOn and audit_log + audit_activity tables', () => {
    expect(auditModule.id).toBe('audit');
    expect(auditModule.dependsOn).toEqual([]);
    expect(auditModule.tables).toEqual(['audit_log', 'audit_activity']);
    expect(Object.keys(auditModule.endpoints)).toEqual([
      'listActivities',
      'listAuditEvents',
      'listSecurityEvents',
      'getSecurityEvent',
      'getSecurityMetrics',
      'exportSecurityEvents',
    ]);
    expect(Object.keys(auditModule.jobs)).toEqual(['activityRetention']);
  });

  it('freezes the manifest and rejects unprefixed tables', () => {
    expect(Object.isFrozen(auditModule)).toBe(true);
    expect(() =>
      defineModule({
        id: 'audit',
        summary: 'Bad table',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: ['security_events'],
      }),
    ).toThrow(/must equal "audit" or start with "audit_"/iu);
  });
});
