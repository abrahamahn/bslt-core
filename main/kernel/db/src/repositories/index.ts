// main/kernel/db/src/repositories/index.ts
/**
 * Kernel System Repository Exports
 *
 * Domain repositories live in their owning vertical modules (`main/modules/<id>/server/repository.ts`).
 */

export type { CursorPaginatedResult, CursorPaginationOptions, TimeRangeFilter } from './types';

export {
  advanceCronSchedule,
  claimDueCronRows,
  claimUndispatchedOutboxRows,
  insertOutboxEvent,
  markOutboxDispatched,
  pruneDispatchedOutbox,
  selectOwnedRealtimeRows,
  tryAcquireCronLeaderLock,
  updateOwnedRealtimeRow,
  upsertCronSchedule,
  type DueCronRow,
} from './system';
