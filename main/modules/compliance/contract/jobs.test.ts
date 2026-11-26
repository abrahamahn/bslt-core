// main/modules/compliance/contract/jobs.test.ts
import { describe, expect, it } from 'vitest';

import { complianceJobs } from './jobs';

describe('complianceJobs', () => {
  it('configures cleanupExpiredExports with bounded retries, timeout, and empty object payload', () => {
    const job = complianceJobs.cleanupExpiredExports;
    expect(job.name).toBe('compliance.cleanup_expired_exports');
    expect(job.queue).toBe('default');
    expect(job.maxAttempts).toBe(3);
    expect(job.timeoutMs).toBe(60_000);
    expect(job.payload.safeParse({}).success).toBe(true);
    expect(job.payload.safeParse('invalid').success).toBe(false);
  });
});
