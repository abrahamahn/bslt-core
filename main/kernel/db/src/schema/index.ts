// main/kernel/db/src/schema/index.ts
/**
 * Kernel System Schema Exports
 *
 * Domain tables live in their owning vertical modules (`main/modules/<id>/server/generated/rows.ts`).
 */

export { CRON_JOBS_TABLE, JOB_QUEUE_TABLE, JOB_STATUSES } from './system';
