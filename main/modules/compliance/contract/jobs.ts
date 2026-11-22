// main/modules/compliance/contract/jobs.ts
import { job } from '@bslt/contract';
import { object } from '@bslt/schema';

export const complianceJobs = {
  cleanupExpiredExports: job('compliance.cleanup_expired_exports', object({}), {
    queue: 'default',
    maxAttempts: 3,
    timeoutMs: 60_000,
  }),
} as const;
