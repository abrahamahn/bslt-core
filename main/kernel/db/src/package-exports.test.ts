// main/kernel/db/src/package-exports.test.ts
import { describe, expect, it } from 'vitest';

import { and, eq } from '@bslt/db/builder';
import { buildConnectionString } from '@bslt/db/client';
import { createMemoryQueueStore } from '@bslt/db/queue';
import { insertOutboxEvent } from '@bslt/db/repositories';
import { JOB_QUEUE_TABLE } from '@bslt/db/schema';
import { withTransaction } from '@bslt/db/utils';

describe('@bslt/db subpath exports', () => {
  it('resolves the published kernel consumer surfaces', () => {
    expect(typeof buildConnectionString).toBe('function');
    expect(typeof insertOutboxEvent).toBe('function');
    expect(typeof createMemoryQueueStore).toBe('function');
    expect(typeof withTransaction).toBe('function');
    expect(typeof and).toBe('function');
    expect(typeof eq).toBe('function');
    expect(JOB_QUEUE_TABLE).toBe('sys_jobs');
  });
});
