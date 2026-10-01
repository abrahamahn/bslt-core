// main/server/db/src/schema/events.ts
/**
 * Analytics Events Schema Types
 *
 * TypeScript interfaces for the partitioned events table (product analytics,
 * distinct from audit logs). Maps to migration 0912_events.sql.
 */

export const EVENTS_TABLE = 'events';

export interface EventRecord {
  id: string;
  userId: string;
  name: string;
  props: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
  exportedAt: Date | null;
}

export interface NewEventRecord {
  id?: string;
  userId: string;
  name: string;
  props: Record<string, unknown>;
  occurredAt: Date;
  createdAt?: Date;
  exportedAt?: Date | null;
}

export const EVENT_COLUMNS = {
  id: 'id',
  userId: 'user_id',
  name: 'name',
  props: 'props',
  occurredAt: 'occurred_at',
  createdAt: 'created_at',
  exportedAt: 'exported_at',
} as const;
