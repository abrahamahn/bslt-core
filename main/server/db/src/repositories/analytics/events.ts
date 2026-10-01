// main/server/db/src/repositories/analytics/events.ts
/**
 * Analytics Events Repository
 *
 * Data access for the partitioned events table. Insertion happens only after
 * the dispatch layer (sampling + PII redaction) has run; the unexported scan
 * and mark-exported pair drive the batched warehouse-export hook.
 */

import { inArray, insert, isNull, select, update } from '../../builder/index';
import {
  EVENTS_TABLE,
  EVENT_COLUMNS,
  type EventRecord,
  type NewEventRecord,
} from '../../schema/index';
import { toCamelCase, toSnakeCase } from '../../utils';

import type { RawDb } from '../../client';

export const DEFAULT_EXPORT_BATCH_SIZE = 500;

export interface EventRepository {
  /** Bulk-insert dispatched events; returns the number of rows written. */
  insertMany(events: NewEventRecord[]): Promise<number>;
  /** Oldest-first batch of events not yet drained by the export hook. */
  listUnexported(limit?: number): Promise<EventRecord[]>;
  /** Stamp exported_at on a drained batch; returns the number of rows updated. */
  markExported(ids: string[], exportedAt?: Date): Promise<number>;
}

function transform(row: Record<string, unknown>): EventRecord {
  return toCamelCase<EventRecord>(row, EVENT_COLUMNS);
}

export function createEventRepository(db: RawDb): EventRepository {
  return {
    async insertMany(events: NewEventRecord[]): Promise<number> {
      if (events.length === 0) return 0;
      const rows = events.map((event) => toSnakeCase(event, EVENT_COLUMNS));
      return db.execute(insert(EVENTS_TABLE).valuesMany(rows).toSql());
    },

    async listUnexported(limit: number = DEFAULT_EXPORT_BATCH_SIZE): Promise<EventRecord[]> {
      const results = await db.query(
        select(EVENTS_TABLE)
          .where(isNull('exported_at'))
          .orderBy('created_at', 'asc')
          .limit(limit)
          .toSql(),
      );
      return results.map(transform);
    },

    async markExported(ids: string[], exportedAt: Date = new Date()): Promise<number> {
      if (ids.length === 0) return 0;
      return db.execute(
        update(EVENTS_TABLE).set({ exported_at: exportedAt }).where(inArray('id', ids)).toSql(),
      );
    },
  };
}
