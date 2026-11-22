// main/kernel/db/src/schema/system.ts
/**
 * System Infrastructure Schema Types
 *
 * TypeScript interfaces for jobs and audit_events tables.
 */

import { SYS_CRON_TABLE, SYS_JOBS_TABLE } from '../generated/rows';

export const JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'dead',
  'dead_letter',
  'cancelled',
] as const;

export const JOB_QUEUE_TABLE = SYS_JOBS_TABLE;
export const CRON_JOBS_TABLE = SYS_CRON_TABLE;
