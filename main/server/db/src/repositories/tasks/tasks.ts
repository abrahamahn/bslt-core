// main/server/db/src/repositories/tasks/tasks.ts
/**
 * Tasks Repository
 *
 * Data access layer for the starter product tasks table.
 */

import { and, deleteFrom, eq, insert, select, update } from '../../builder/index';
import {
  TASKS_TABLE,
  TASK_COLUMNS,
  type NewTaskRecord,
  type TaskRecord,
  type UpdateTaskRecord,
} from '../../schema/index';
import { toCamelCase, toSnakeCase } from '../../utils';

import type { RawDb } from '../../client';

export interface TaskRepository {
  listByOwner(ownerId: string): Promise<TaskRecord[]>;
  create(data: NewTaskRecord): Promise<TaskRecord>;
  updateForOwner(ownerId: string, id: string, data: UpdateTaskRecord): Promise<TaskRecord | null>;
  deleteForOwner(ownerId: string, id: string): Promise<TaskRecord | null>;
}

function transformTask(row: Record<string, unknown>): TaskRecord {
  return toCamelCase<TaskRecord>(row, TASK_COLUMNS);
}

export function createTaskRepository(db: RawDb): TaskRepository {
  return {
    async listByOwner(ownerId: string): Promise<TaskRecord[]> {
      const results = await db.query(
        select(TASKS_TABLE).where(eq('owner_id', ownerId)).orderBy('created_at', 'desc').toSql(),
      );
      return results.map(transformTask);
    },

    async create(data: NewTaskRecord): Promise<TaskRecord> {
      const snakeData = toSnakeCase(data, TASK_COLUMNS);
      const result = await db.queryOne(
        insert(TASKS_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create task');
      }
      return transformTask(result);
    },

    async updateForOwner(
      ownerId: string,
      id: string,
      data: UpdateTaskRecord,
    ): Promise<TaskRecord | null> {
      const snakeData = toSnakeCase({ ...data, updatedAt: new Date() }, TASK_COLUMNS);
      const result = await db.queryOne(
        update(TASKS_TABLE)
          .set(snakeData)
          .where(and(eq('id', id), eq('owner_id', ownerId)))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transformTask(result) : null;
    },

    async deleteForOwner(ownerId: string, id: string): Promise<TaskRecord | null> {
      const result = await db.queryOne(
        deleteFrom(TASKS_TABLE)
          .where(and(eq('id', id), eq('owner_id', ownerId)))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transformTask(result) : null;
    },
  };
}
