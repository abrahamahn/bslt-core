// main/kernel/db/src/repositories/system/realtime.ts
/**
 * Policy-bound realtime record queries with ownership and optimistic locking.
 */
import { and, eq, inArray, select, update } from '../../builder';

import type { DbClient } from '../../client';

export async function selectOwnedRealtimeRows<TRecord extends Record<string, unknown>>(
  db: DbClient,
  params: {
    readonly tableName: string;
    readonly readableColumns: readonly string[];
    readonly ownerColumn: string;
    readonly userId: string;
    readonly ids: readonly string[];
  },
): Promise<TRecord[]> {
  return db.query<TRecord>(
    select(params.tableName)
      .columns(...params.readableColumns)
      .where(and(inArray('id', [...params.ids]), eq(params.ownerColumn, params.userId)))
      .toSql(),
  );
}

export async function updateOwnedRealtimeRow(
  db: DbClient,
  params: {
    readonly tableName: string;
    readonly ownerColumn: string;
    readonly userId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly nextVersion: number;
    readonly writable: Record<string, unknown>;
    readonly updatedAt: Date;
  },
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    update(params.tableName)
      .set({ ...params.writable, version: params.nextVersion, updated_at: params.updatedAt })
      .where(
        and(
          eq('id', params.id),
          eq('version', params.expectedVersion),
          eq(params.ownerColumn, params.userId),
        ),
      )
      .returning('id')
      .toSql(),
  );
  return result.length === 1;
}
