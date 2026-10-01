// main/shared/src/constants/system/jobs.ts
/**
 * Background job / queue constants.
 */

export const JOB_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

export const JOB_PRIORITY_VALUES = {
  low: -10,
  normal: 0,
  high: 10,
  critical: 100,
} as const;

export const JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'dead_letter',
  'cancelled',
] as const;

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'dead_letter',
  'cancelled',
]);

export const JOB_STATUS_CONFIG: Record<
  string,
  { label: string; tone: 'info' | 'success' | 'warning' | 'danger' }
> = {
  pending: { label: 'Pending', tone: 'info' },
  processing: { label: 'Processing', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  dead_letter: { label: 'Dead Letter', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
};
