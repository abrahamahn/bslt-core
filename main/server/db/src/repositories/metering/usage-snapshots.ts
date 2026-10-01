// main/server/db/src/repositories/metering/usage-snapshots.ts
/**
 * Usage Snapshots Repository (Functional)
 *
 * Data access layer for the usage_snapshots table.
 * Manages per-tenant per-period usage data with
 * UNIQUE(tenant_id, metric_key, period_start).
 *
 * @module
 */

import { applyUsageDelta } from '@bslt/shared/core';

import { and, eq, select, insert, rawCondition, update } from '../../builder/index';
import {
  type AggregationType,
  type NewUsageSnapshot,
  type UpdateUsageSnapshot,
  type UsageSnapshot,
  USAGE_SNAPSHOT_COLUMNS,
  USAGE_SNAPSHOTS_TABLE,
} from '../../schema/index';
import { toCamelCase, toSnakeCase } from '../../utils';

import type { SqlFragment } from '../../builder/index';
import type { RawDb } from '../../client';

// ============================================================================
// Usage Snapshot Repository Interface
// ============================================================================

/** A usage delta targeting one tenant/metric/period snapshot */
export interface UsageDelta {
  readonly tenantId: string;
  readonly metricKey: string;
  /** The delta for 'sum' aggregation; the candidate value for 'max'/'last' */
  readonly value: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/** Outcome of a limit-checked usage increment */
export type UsageLimitResult =
  | { readonly allowed: true; readonly snapshot: UsageSnapshot }
  | { readonly allowed: false; readonly currentValue: number };

/**
 * Work to run inside the same transaction as a limit-checked increment.
 * A throw rolls the increment back.
 */
export type UsageIncrementCallback = (tx: RawDb, snapshot: UsageSnapshot) => Promise<void>;

/**
 * Functional repository for usage snapshot operations
 */
export interface UsageSnapshotRepository {
  /**
   * Create a new usage snapshot
   * @param data - The snapshot data to insert
   * @returns The created snapshot
   * @throws Error if insert fails
   */
  create(data: NewUsageSnapshot): Promise<UsageSnapshot>;

  /**
   * Find a snapshot by its ID
   * @param id - The snapshot ID
   * @returns The snapshot or null if not found
   */
  findById(id: string): Promise<UsageSnapshot | null>;

  /**
   * Find all snapshots for a tenant
   * @param tenantId - The tenant ID
   * @param limit - Maximum results (default: 100)
   * @returns Array of snapshots, most recent period first
   */
  findByTenantId(tenantId: string, limit?: number): Promise<UsageSnapshot[]>;

  /**
   * Find snapshots for a tenant and specific metric
   * @param tenantId - The tenant ID
   * @param metricKey - The metric key
   * @param limit - Maximum results (default: 100)
   * @returns Array of snapshots, most recent period first
   */
  findByTenantAndMetric(
    tenantId: string,
    metricKey: string,
    limit?: number,
  ): Promise<UsageSnapshot[]>;

  /**
   * Update a snapshot's value
   * @param id - The snapshot ID
   * @param data - The fields to update
   * @returns The updated snapshot or null if not found
   */
  update(id: string, data: UpdateUsageSnapshot): Promise<UsageSnapshot | null>;

  /**
   * Create or update a snapshot (upsert on unique constraint)
   * @param data - The snapshot data to upsert
   * @returns The created or updated snapshot
   * @throws Error if upsert fails
   */
  upsert(data: NewUsageSnapshot): Promise<UsageSnapshot>;

  /**
   * Apply a usage delta atomically in a single upsert. The new value is
   * computed in SQL (`ON CONFLICT ... DO UPDATE`), so concurrent writers
   * cannot lose updates.
   * @param delta - The delta to apply
   * @param aggregation - How the delta combines with the stored value
   * @returns The updated snapshot
   * @throws Error if the upsert fails
   */
  increment(delta: UsageDelta, aggregation: AggregationType): Promise<UsageSnapshot>;

  /**
   * Apply a usage delta only if the result stays within the limit.
   * Check and write happen in one transaction with the snapshot row locked
   * (SELECT ... FOR UPDATE), so concurrent calls at the limit admit exactly
   * as many as the limit allows. A denied call leaves usage unchanged
   * (the snapshot row itself is created at value 0 if absent).
   * @param delta - The delta to apply
   * @param aggregation - How the delta combines with the stored value
   * @param limit - Maximum allowed value (-1 or Infinity for unlimited)
   * @param inTransaction - Optional work to run inside the same transaction;
   *   a throw rolls the increment back
   * @returns Allowed with the updated snapshot, or denied with current value
   */
  incrementWithinLimit(
    delta: UsageDelta,
    aggregation: AggregationType,
    limit: number,
    inTransaction?: UsageIncrementCallback,
  ): Promise<UsageLimitResult>;
}

// ============================================================================
// Usage Snapshot Repository Implementation
// ============================================================================

/**
 * Transform raw database row to UsageSnapshot type
 * @param row - Raw database row with snake_case keys
 * @returns Typed UsageSnapshot object
 * @complexity O(n) where n is number of columns
 */
function normalizeSnapshotValue(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error('Invalid usage snapshot value returned from database');
}

function transformSnapshot(row: Record<string, unknown>): UsageSnapshot {
  const snapshot = toCamelCase<UsageSnapshot>(row, USAGE_SNAPSHOT_COLUMNS);
  return {
    ...snapshot,
    value: normalizeSnapshotValue(row['value']),
  };
}

/** Columns of the usage_snapshots_unique constraint */
const CONFLICT_COLUMNS = ['tenant_id', 'metric_key', 'period_start'];

/**
 * SET fragment computing the new value in SQL so concurrent upserts
 * cannot lose updates. For 'sum' the raw (possibly negative) delta is
 * parameterized because EXCLUDED.value carries the 0-floored insert value.
 */
function incrementSet(aggregation: AggregationType, delta: number): SqlFragment {
  switch (aggregation) {
    case 'max':
      return rawCondition(
        'value = GREATEST(usage_snapshots.value, EXCLUDED.value), updated_at = EXCLUDED.updated_at',
      );
    case 'last':
      return rawCondition('value = EXCLUDED.value, updated_at = EXCLUDED.updated_at');
    case 'sum':
    default:
      return rawCondition(
        'value = GREATEST(0, usage_snapshots.value + $1), updated_at = EXCLUDED.updated_at',
        [delta],
      );
  }
}

/** Snapshot row for inserting a delta's target period */
function deltaInsertRow(delta: UsageDelta, value: number): Record<string, unknown> {
  return toSnakeCase(
    {
      tenantId: delta.tenantId,
      metricKey: delta.metricKey,
      value,
      periodStart: delta.periodStart,
      periodEnd: delta.periodEnd,
      updatedAt: new Date(),
    },
    USAGE_SNAPSHOT_COLUMNS,
  );
}

/**
 * Create a usage snapshot repository bound to a database connection
 * @param db - The raw database client
 * @returns UsageSnapshotRepository implementation
 */
export function createUsageSnapshotRepository(db: RawDb): UsageSnapshotRepository {
  return {
    async create(data: NewUsageSnapshot): Promise<UsageSnapshot> {
      const snakeData = toSnakeCase(data, USAGE_SNAPSHOT_COLUMNS);
      const result = await db.queryOne(
        insert(USAGE_SNAPSHOTS_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create usage snapshot');
      }
      return transformSnapshot(result);
    },

    async findById(id: string): Promise<UsageSnapshot | null> {
      const result = await db.queryOne(select(USAGE_SNAPSHOTS_TABLE).where(eq('id', id)).toSql());
      return result !== null ? transformSnapshot(result) : null;
    },

    async findByTenantId(tenantId: string, limit = 100): Promise<UsageSnapshot[]> {
      const results = await db.query(
        select(USAGE_SNAPSHOTS_TABLE)
          .where(eq('tenant_id', tenantId))
          .orderBy('period_start', 'desc')
          .limit(limit)
          .toSql(),
      );
      return results.map(transformSnapshot);
    },

    async findByTenantAndMetric(
      tenantId: string,
      metricKey: string,
      limit = 100,
    ): Promise<UsageSnapshot[]> {
      const results = await db.query(
        select(USAGE_SNAPSHOTS_TABLE)
          .where(and(eq('tenant_id', tenantId), eq('metric_key', metricKey)))
          .orderBy('period_start', 'desc')
          .limit(limit)
          .toSql(),
      );
      return results.map(transformSnapshot);
    },

    async update(id: string, data: UpdateUsageSnapshot): Promise<UsageSnapshot | null> {
      const snakeData = toSnakeCase(data, USAGE_SNAPSHOT_COLUMNS);
      const result = await db.queryOne(
        update(USAGE_SNAPSHOTS_TABLE).set(snakeData).where(eq('id', id)).returningAll().toSql(),
      );
      return result !== null ? transformSnapshot(result) : null;
    },

    async upsert(data: NewUsageSnapshot): Promise<UsageSnapshot> {
      const snakeData = toSnakeCase(data, USAGE_SNAPSHOT_COLUMNS);
      const result = await db.queryOne(
        insert(USAGE_SNAPSHOTS_TABLE)
          .values(snakeData)
          .onConflictDoUpdate(['tenant_id', 'metric_key', 'period_start'], ['value', 'updated_at'])
          .returningAll()
          .toSql(),
      );
      if (result === null) {
        throw new Error('Failed to upsert usage snapshot');
      }
      return transformSnapshot(result);
    },

    async increment(delta: UsageDelta, aggregation: AggregationType): Promise<UsageSnapshot> {
      const result = await db.queryOne(
        insert(USAGE_SNAPSHOTS_TABLE)
          .values(deltaInsertRow(delta, applyUsageDelta(0, delta.value, aggregation)))
          .onConflictDoUpdateRaw(CONFLICT_COLUMNS, incrementSet(aggregation, delta.value))
          .returningAll()
          .toSql(),
      );
      if (result === null) {
        throw new Error('Failed to increment usage snapshot');
      }
      return transformSnapshot(result);
    },

    async incrementWithinLimit(
      delta: UsageDelta,
      aggregation: AggregationType,
      limit: number,
      inTransaction?: UsageIncrementCallback,
    ): Promise<UsageLimitResult> {
      return db.transaction(async (tx) => {
        // Materialize the row so FOR UPDATE always has a target; concurrent
        // seeds serialize on the unique constraint.
        await tx.execute(
          insert(USAGE_SNAPSHOTS_TABLE)
            .values(deltaInsertRow(delta, 0))
            .onConflictDoNothing(CONFLICT_COLUMNS)
            .toSql(),
        );
        const lockedRow = await tx.queryOne(
          select(USAGE_SNAPSHOTS_TABLE)
            .where(
              and(
                eq('tenant_id', delta.tenantId),
                eq('metric_key', delta.metricKey),
                eq('period_start', delta.periodStart),
              ),
            )
            .forUpdate()
            .toSql(),
        );
        if (lockedRow === null) {
          throw new Error('Failed to lock usage snapshot row');
        }
        const locked = transformSnapshot(lockedRow);
        const nextValue = applyUsageDelta(locked.value, delta.value, aggregation);
        const unlimited = limit === -1 || limit === Infinity;
        if (!unlimited && nextValue > limit) {
          return { allowed: false, currentValue: locked.value };
        }
        const updatedRow = await tx.queryOne(
          update(USAGE_SNAPSHOTS_TABLE)
            .set(toSnakeCase({ value: nextValue, updatedAt: new Date() }, USAGE_SNAPSHOT_COLUMNS))
            .where(eq('id', locked.id))
            .returningAll()
            .toSql(),
        );
        if (updatedRow === null) {
          throw new Error('Failed to update usage snapshot');
        }
        const snapshot = transformSnapshot(updatedRow);
        if (inTransaction !== undefined) {
          await inTransaction(tx, snapshot);
        }
        return { allowed: true, snapshot };
      });
    },
  };
}
