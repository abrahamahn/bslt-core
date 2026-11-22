// main/kernel/db/src/queue/memory.store.ts
/**
 * In-Memory Queue Store
 *
 * Simple in-memory implementation for testing and development.
 * Not suitable for production (no persistence, no horizontal scaling).
 *
 * @module @bslt/db/queue
 */

import type { QueueSnapshotMetrics, QueueStore, Task, TaskError, TaskResult } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Internal representation of a task with status tracking
 */
interface StoredTask extends Task {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  error?: TaskError;
  lastError?: string;
  deadAt?: string;
  completedAt?: string;
  durationMs?: number;
}

// ============================================================================
// Memory Store
// ============================================================================

/**
 * In-memory queue store backed by a Map.
 * Uses linear scan for dequeue (acceptable for dev/test workloads).
 *
 * @complexity O(n) dequeue, O(1) enqueue/complete/fail
 */
export class MemoryQueueStore implements QueueStore {
  private readonly tasks = new Map<string, StoredTask>();
  private readonly idempotencyKeys = new Set<string>();

  /**
   * Enqueue a new task.
   * If the task carries an idempotency key that has already been seen,
   * the enqueue is silently skipped (no error, no duplicate job).
   *
   * @param task - The task to enqueue
   * @complexity O(1)
   */
  enqueue(task: Task): Promise<void> {
    if (task.idempotencyKey != null && task.idempotencyKey !== '') {
      const dedupeKey = `${task.name}:${task.idempotencyKey}`;
      if (this.idempotencyKeys.has(dedupeKey)) {
        return Promise.resolve();
      }
      this.idempotencyKeys.add(dedupeKey);
    }

    this.tasks.set(task.id, { ...task, status: 'pending' });
    return Promise.resolve();
  }

  /**
   * Dequeue the next ready task (highest priority, then oldest scheduledAt <= now)
   *
   * @param now - Current timestamp as ISO string
   * @param queue - Optional queue lane filter
   * @returns The dequeued task or null
   * @complexity O(n) where n is the number of tasks
   */
  dequeue(now: string, queue?: string): Promise<Task | null> {
    const nowTime = new Date(now).getTime();

    let best: StoredTask | null = null;
    let bestPriority = -Infinity;
    let bestTime = Infinity;

    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') continue;
      if (queue !== undefined && (task.queue ?? 'default') !== queue) continue;

      const scheduledTime = new Date(task.scheduledAt).getTime();
      if (scheduledTime > nowTime) continue;

      const taskPriority = task.priority ?? 0;
      if (
        taskPriority > bestPriority ||
        (taskPriority === bestPriority && scheduledTime < bestTime)
      ) {
        best = task;
        bestPriority = taskPriority;
        bestTime = scheduledTime;
      }
    }

    if (best === null) return Promise.resolve(null);

    best.status = 'processing';
    best.attempts += 1;

    return Promise.resolve({
      id: best.id,
      name: best.name,
      ...(best.queue !== undefined ? { queue: best.queue } : {}),
      ...(best.priority !== undefined ? { priority: best.priority } : {}),
      args: best.args,
      scheduledAt: best.scheduledAt,
      attempts: best.attempts,
      maxAttempts: best.maxAttempts,
      createdAt: best.createdAt,
    });
  }

  /**
   * Mark task as completed
   *
   * @param taskId - ID of the task to complete
   * @param result - Completion result with timing info
   * @complexity O(1)
   */
  complete(taskId: string, result: TaskResult): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task === undefined) return Promise.resolve();

    task.status = 'completed';
    task.completedAt = result.completedAt;
    task.durationMs = result.durationMs;
    return Promise.resolve();
  }

  /**
   * Mark task as failed, optionally scheduling a retry
   *
   * @param taskId - ID of the failed task
   * @param error - Serialized error information
   * @param nextAttemptAt - If provided, reschedule for retry at this ISO timestamp
   * @complexity O(1)
   */
  fail(taskId: string, error: TaskError, nextAttemptAt?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task === undefined) return Promise.resolve();

    task.error = error;
    task.lastError = `${error.name}: ${error.message}`;

    if (nextAttemptAt != null && nextAttemptAt !== '') {
      task.status = 'pending';
      task.scheduledAt = nextAttemptAt;
    } else {
      const nowIso = new Date().toISOString();
      task.status = 'dead';
      task.deadAt = nowIso;
      task.completedAt = nowIso;
    }
    return Promise.resolve();
  }

  /**
   * Get task by ID
   *
   * @param taskId - ID of the task to retrieve
   * @returns The task or null if not found
   * @complexity O(1)
   */
  get(taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (task === undefined) return Promise.resolve(null);

    return Promise.resolve({
      id: task.id,
      name: task.name,
      ...(task.queue !== undefined ? { queue: task.queue } : {}),
      ...(task.priority !== undefined ? { priority: task.priority } : {}),
      ...(task.idempotencyKey !== undefined ? { idempotencyKey: task.idempotencyKey } : {}),
      args: task.args,
      scheduledAt: task.scheduledAt,
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      createdAt: task.createdAt,
    });
  }

  /**
   * Get count of pending tasks
   *
   * @returns Number of tasks in pending status
   * @complexity O(n)
   */
  getPendingCount(): Promise<number> {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') count++;
    }
    return Promise.resolve(count);
  }

  /**
   * Get count of failed tasks
   *
   * @returns Number of tasks in failed status
   * @complexity O(n)
   */
  getFailedCount(): Promise<number> {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'failed' || task.status === 'dead') count++;
    }
    return Promise.resolve(count);
  }

  /**
   * Get count of dead tasks
   */
  getDeadCount(): Promise<number> {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'dead') count++;
    }
    return Promise.resolve(count);
  }

  /**
   * Compute operational metrics snapshot
   */
  getQueueMetrics(queue?: string): Promise<QueueSnapshotMetrics> {
    const now = Date.now();
    let depth = 0;
    let oldestScheduled = Infinity;
    let totalAttempts = 0;
    let deadCount = 0;

    for (const task of this.tasks.values()) {
      if (queue !== undefined && (task.queue ?? 'default') !== queue) continue;
      totalAttempts += task.attempts;
      if (task.status === 'pending') {
        depth += 1;
        const scheduled = new Date(task.scheduledAt).getTime();
        if (scheduled < oldestScheduled) {
          oldestScheduled = scheduled;
        }
      } else if (task.status === 'dead') {
        deadCount += 1;
      }
    }

    return Promise.resolve({
      depth,
      oldestPendingAgeMs: oldestScheduled === Infinity ? 0 : Math.max(0, now - oldestScheduled),
      totalAttempts,
      deadCount,
    });
  }

  /**
   * Clear all completed tasks older than the given timestamp
   *
   * @param before - ISO timestamp cutoff
   * @returns Number of tasks cleared
   * @complexity O(n)
   */
  clearCompleted(before: string): Promise<number> {
    const beforeTime = new Date(before).getTime();
    let count = 0;

    for (const [id, task] of this.tasks.entries()) {
      if (task.status !== 'completed') continue;
      const completedAt = task.completedAt;
      if (completedAt == null || completedAt === '') continue;

      const completedTime = new Date(completedAt).getTime();
      if (completedTime < beforeTime) {
        this.tasks.delete(id);
        count++;
      }
    }

    return Promise.resolve(count);
  }

  /**
   * Clear all tasks (for testing)
   */
  clear(): void {
    this.tasks.clear();
    this.idempotencyKeys.clear();
  }

  /**
   * Get all stored tasks (for debugging)
   *
   * @returns Array of all stored tasks with status
   */
  getAll(): StoredTask[] {
    return Array.from(this.tasks.values());
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new in-memory queue store
 *
 * @returns A new MemoryQueueStore instance
 */
export function createMemoryQueueStore(): MemoryQueueStore {
  return new MemoryQueueStore();
}
