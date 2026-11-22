// main/kernel/db/src/repositories/system/outbox.ts
/**
 * Transactional Outbox Repository (`sys_outbox`, Plan §8.1–§8.3).
 */
import type { DbClient } from '../../client';

interface InsertOutboxEventParams {
  readonly name: string;
  readonly version: number;
  readonly payloadJson: string;
  readonly sealed: Buffer | null;
  readonly actorUserId: string | null;
  readonly orgId: string | null;
  readonly occurredAt: string;
}

interface OutboxClaimedRow {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly payload: Record<string, unknown> | string;
  readonly sealed_b64: string | null;
  readonly actor_user_id: string | null;
  readonly org_id: string | null;
  readonly occurred_at: Date | string;
}

export async function insertOutboxEvent(
  tx: DbClient,
  params: InsertOutboxEventParams,
): Promise<void> {
  await tx.execute({
    text: `INSERT INTO sys_outbox (name, version, payload, sealed, actor_user_id, org_id, occurred_at)
           VALUES ($1, $2, $3::text::jsonb, $4, COALESCE($5::uuid, sys_current_user_id()), COALESCE($6::uuid, sys_current_org_id()), $7::timestamptz)`,
    values: [
      params.name,
      params.version,
      params.payloadJson,
      params.sealed,
      params.actorUserId,
      params.orgId,
      params.occurredAt,
    ],
  });
}

export async function claimUndispatchedOutboxRows(
  tx: DbClient,
  batchSize: number,
): Promise<readonly OutboxClaimedRow[]> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`Outbox claim batchSize must be a positive integer, got ${String(batchSize)}`);
  }
  return tx.raw<OutboxClaimedRow>(
    `SELECT id::text AS id,
            name,
            version,
            payload,
            encode(sealed, 'base64') AS sealed_b64,
            actor_user_id,
            org_id,
            occurred_at
       FROM sys_outbox
      WHERE dispatched_at IS NULL
      ORDER BY id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [batchSize],
  );
}

export async function markOutboxDispatched(
  tx: DbClient,
  ids: readonly string[],
  dispatchedAtIso: string,
): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute({
    text: `UPDATE sys_outbox
              SET dispatched_at = $2::timestamptz
            WHERE id = ANY($1::bigint[])`,
    values: [ids, dispatchedAtIso],
  });
}

export async function pruneDispatchedOutbox(db: DbClient, cutoffIso: string): Promise<number> {
  return db.execute({
    text: `DELETE FROM sys_outbox
            WHERE dispatched_at IS NOT NULL
              AND dispatched_at < $1::timestamptz`,
    values: [cutoffIso],
  });
}
