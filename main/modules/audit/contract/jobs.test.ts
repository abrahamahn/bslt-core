// main/modules/audit/contract/jobs.test.ts
import { describe, expect, it } from 'vitest';

import { auditJobs } from './jobs';

describe('auditJobs', () => {
  it('declares audit.activity_retention on the default queue', () => {
    expect(auditJobs.activityRetention.name).toBe('audit.activity_retention');
    expect(auditJobs.activityRetention.queue).toBe('default');
    expect(auditJobs.activityRetention.payload.parse({})).toEqual({});
  });

  it('rejects non-object payloads for activityRetention', () => {
    expect(auditJobs.activityRetention.payload.safeParse(null).success).toBe(false);
    expect(auditJobs.activityRetention.payload.safeParse('invalid').success).toBe(false);
    expect(auditJobs.activityRetention.payload.safeParse(42).success).toBe(false);
  });
});
