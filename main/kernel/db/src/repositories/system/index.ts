// main/kernel/db/src/repositories/system/index.ts
/**
 * System Repositories Barrel
 */

// Outbox
export {
  claimUndispatchedOutboxRows,
  insertOutboxEvent,
  markOutboxDispatched,
  pruneDispatchedOutbox,
} from './outbox';

// Cron
export {
  advanceCronSchedule,
  claimDueCronRows,
  tryAcquireCronLeaderLock,
  upsertCronSchedule,
  type DueCronRow,
} from './cron';

// Realtime
export { selectOwnedRealtimeRows, updateOwnedRealtimeRow } from './realtime';
