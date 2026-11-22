// main/modules/audit/contract/jobs.ts
import { job } from '@bslt/contract';
import { object } from '@bslt/schema';

const emptyJobPayloadSchema = object({});

export const auditJobs = {
  activityRetention: job('audit.activity_retention', emptyJobPayloadSchema, {
    queue: 'default',
    maxAttempts: 2,
    timeoutMs: 60_000,
  }),
} as const;
