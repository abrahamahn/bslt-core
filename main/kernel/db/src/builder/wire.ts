// main/kernel/db/src/builder/wire.ts
/**
 * Low-level `@bslt/protocols/pg` wire execution helpers used exclusively by
 * `createDbFromSql` in `../client.ts`.
 */
import type { PgPendingQuery, PgSql, PgTransactionSql } from '@bslt/protocols/pg';

type DriverClient = PgSql | PgTransactionSql;
type StatementResult<T> = T[] & { readonly count: number };

interface DriverQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

export async function applyDriverSettings(
  client: DriverClient,
  settings: DriverQuery | undefined,
): Promise<void> {
  if (settings === undefined) return;
  await client.unsafe(settings.text, [...settings.values]);
}

export function sendDriverStatement<T = Record<string, unknown>>(
  client: DriverClient,
  text: string,
  values: readonly unknown[],
  timeoutMs: number | undefined,
): PgPendingQuery<T[]> {
  const pending = client.unsafe<T[]>(text, [...values]);
  return timeoutMs !== undefined && timeoutMs > 0
    ? pending.signal(AbortSignal.timeout(timeoutMs))
    : pending;
}

export async function batchDriverStatementWithSettings<T>(
  sql: PgSql,
  settings: DriverQuery,
  text: string,
  values: readonly unknown[],
  timeoutMs: number | undefined,
): Promise<StatementResult<T>> {
  const [, result] = await sql.batch([
    sql.unsafe(settings.text, [...settings.values]),
    sendDriverStatement<T>(sql, text, values, timeoutMs),
  ]);
  return result;
}

export async function applyTransactionModes(
  tx: DriverClient,
  txOptions: readonly string[],
): Promise<void> {
  if (txOptions.length === 0) return;
  await tx.unsafe(`SET TRANSACTION ${txOptions.join(' ')}`);
}
