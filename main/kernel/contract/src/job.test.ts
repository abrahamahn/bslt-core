// main/kernel/contract/src/job.test.ts
import { object, string } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import { job, type JobDef } from './job';

const payloadSchema = object({ deliveryId: string({ min: 1 }) });

describe('job definitions', () => {
  it('constructs valid <moduleId>.<name> job definitions', () => {
    const deliver: JobDef<'webhooks.deliver', typeof payloadSchema> = job(
      'webhooks.deliver',
      payloadSchema,
      {
        queue: 'default',
        maxAttempts: 5,
        timeoutMs: 10_000,
      },
    );
    expect(deliver.name).toBe('webhooks.deliver');
    expect(deliver.queue).toBe('default');
    expect(deliver.maxAttempts).toBe(5);
    expect(deliver.timeoutMs).toBe(10_000);
  });

  it('rejects malformed job names', () => {
    expect(() =>
      job('deliver', payloadSchema, { queue: 'default', maxAttempts: 3, timeoutMs: 1000 }),
    ).toThrow(/job name/i);
    expect(() =>
      job('Webhooks.deliver', payloadSchema, {
        queue: 'default',
        maxAttempts: 3,
        timeoutMs: 1000,
      }),
    ).toThrow(/job name/i);
    expect(() =>
      job('webhooks.', payloadSchema, { queue: 'default', maxAttempts: 3, timeoutMs: 1000 }),
    ).toThrow(/job name/i);
  });

  it('rejects non-positive or non-integer maxAttempts and timeoutMs', () => {
    expect(() =>
      job('webhooks.deliver', payloadSchema, { queue: 'default', maxAttempts: 0, timeoutMs: 1000 }),
    ).toThrow(/maxAttempts/i);
    expect(() =>
      job('webhooks.deliver', payloadSchema, {
        queue: 'default',
        maxAttempts: 1.5,
        timeoutMs: 1000,
      }),
    ).toThrow(/maxAttempts/i);
    expect(() =>
      job('webhooks.deliver', payloadSchema, { queue: 'media', maxAttempts: 2, timeoutMs: 0 }),
    ).toThrow(/timeoutMs/i);
    expect(() =>
      job('webhooks.deliver', payloadSchema, { queue: 'media', maxAttempts: 2, timeoutMs: -50 }),
    ).toThrow(/timeoutMs/i);
  });
});
