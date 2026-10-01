// main/server/db/src/schema/tasks.ts
/**
 * Tasks Schema Types
 *
 * TypeScript interfaces for the starter product tasks table.
 * Maps to migration 0800_tasks.sql.
 */

export const TASKS_TABLE = 'tasks';

export interface TaskRecord {
  id: string;
  ownerId: string;
  title: string;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTaskRecord {
  id?: string;
  ownerId: string;
  title: string;
  completed?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateTaskRecord {
  title?: string;
  completed?: boolean;
  updatedAt?: Date;
}

export const TASK_COLUMNS = {
  id: 'id',
  ownerId: 'owner_id',
  title: 'title',
  completed: 'completed',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
} as const;
