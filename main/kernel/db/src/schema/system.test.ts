// main/kernel/db/src/schema/system.test.ts
import { describe, expect, it } from 'vitest';

import { CRON_JOBS_TABLE, JOB_QUEUE_TABLE, JOB_STATUSES } from './system';

describe('system schema constants', () => {
  it('exposes the canonical background job statuses without duplicates', () => {
    expect(JOB_STATUSES).toEqual([
      'pending',
      'processing',
      'completed',
      'failed',
      'dead',
      'dead_letter',
      'cancelled',
    ]);
    expect(new Set(JOB_STATUSES).size).toBe(JOB_STATUSES.length);
  });

  it('rejects unknown or empty status values outside JOB_STATUSES', () => {
    const allowed = new Set<string>(JOB_STATUSES);
    expect(allowed.has('')).toBe(false);
    expect(allowed.has('running')).toBe(false);
    expect(allowed.has('PENDING')).toBe(false);
    expect(allowed.has('retrying')).toBe(false);
  });

  it('binds JOB_QUEUE_TABLE and CRON_JOBS_TABLE to distinct non-empty SQL table names', () => {
    expect(typeof JOB_QUEUE_TABLE).toBe('string');
    expect(typeof CRON_JOBS_TABLE).toBe('string');
    expect(JOB_QUEUE_TABLE.length).toBeGreaterThan(0);
    expect(CRON_JOBS_TABLE.length).toBeGreaterThan(0);
    expect(JOB_QUEUE_TABLE).not.toBe(CRON_JOBS_TABLE);
  });
});
