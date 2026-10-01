// main/shared/src/modules/workers/workers.ts
/**
 * Shared worker/scheduled-task contracts.
 *
 * This module stays runtime-agnostic. The server package owns the concrete
 * Node.js scheduling and shutdown behavior.
 */

export type TaskSchedule = 'hourly' | 'daily' | 'weekly';

export interface ScheduledTask {
  /** Unique task identifier. */
  name: string;
  /** Human-readable description of the job. */
  description: string;
  /** Execution cadence. */
  schedule: TaskSchedule;
  /** Execute the task and return the number of affected records. */
  execute: () => Promise<number>;
}

export interface ScheduledTaskRun {
  name: string;
  processedCount: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

export interface ScheduledTaskExecutor {
  run(task: ScheduledTask): Promise<ScheduledTaskRun>;
}
