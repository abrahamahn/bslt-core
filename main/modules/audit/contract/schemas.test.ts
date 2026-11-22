// main/modules/audit/contract/schemas.test.ts
import { describe, expect, it } from 'vitest';

import { describe as describeSchema } from '@bslt/schema';

import {
  auditCategorySchema,
  auditLogEntrySchema,
  exportSecurityEventsBodySchema,
  listActivitiesQuerySchema,
  listAuditEventsQuerySchema,
  listSecurityEventsBodySchema,
  securityEventsFilterSchema,
  securityMetricsQuerySchema,
} from './schemas';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('audit contract schemas', () => {
  it('accepts all canonical audit categories including trust_safety, compliance, and kyc_access', () => {
    for (const cat of [
      'security',
      'data',
      'billing',
      'trust_safety',
      'compliance',
      'admin',
      'kyc_access',
      'system',
    ] as const) {
      expect(auditCategorySchema.parse(cat)).toBe(cat);
    }
    expect(describeSchema(auditLogEntrySchema).kind).toBe('object');
  });

  it('coerces valid query limits on listActivities and listAuditEvents', () => {
    expect(listActivitiesQuerySchema.parse({ limit: '50', action: 'tasks.task.created' })).toEqual({
      limit: 50,
      action: 'tasks.task.created',
    });
    expect(
      listAuditEventsQuerySchema.parse({
        limit: '100',
        category: 'kyc_access',
        severity: 'warn',
        tenantId: VALID_UUID,
      }),
    ).toEqual({
      limit: 100,
      category: 'kyc_access',
      severity: 'warn',
      tenantId: VALID_UUID,
    });
  });

  it('rejects out-of-range limits, invalid categories, and malformed UUIDs on audit queries', () => {
    expect(listActivitiesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listActivitiesQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(listActivitiesQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
    expect(listAuditEventsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listAuditEventsQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
    expect(listAuditEventsQuerySchema.safeParse({ category: 'unknown' }).success).toBe(false);
    expect(listAuditEventsQuerySchema.safeParse({ severity: 'fatal' }).success).toBe(false);
    expect(listAuditEventsQuerySchema.safeParse({ tenantId: 'not-a-uuid' }).success).toBe(false);
    expect(listAuditEventsQuerySchema.safeParse({ actorId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects inverted date ranges and invalid security filter inputs', () => {
    expect(
      securityEventsFilterSchema.safeParse({
        startDate: '2026-11-17T12:00:00.000Z',
        endDate: '2026-11-16T12:00:00.000Z',
      }).success,
    ).toBe(false);

    expect(securityEventsFilterSchema.safeParse('not-an-object').success).toBe(false);
    expect(listSecurityEventsBodySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listSecurityEventsBodySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listSecurityEventsBodySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(listSecurityEventsBodySchema.safeParse({ sortOrder: 'random' }).success).toBe(false);
  });

  it('rejects unknown metrics periods and unsupported export formats', () => {
    expect(securityMetricsQuerySchema.safeParse({ period: 'year' }).success).toBe(false);
    expect(securityMetricsQuerySchema.safeParse({ period: '' }).success).toBe(false);
    expect(exportSecurityEventsBodySchema.safeParse({ format: 'xml' }).success).toBe(false);
    expect(exportSecurityEventsBodySchema.safeParse({}).success).toBe(false);
  });
});
