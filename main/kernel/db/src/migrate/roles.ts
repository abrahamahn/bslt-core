// main/kernel/db/src/migrate/roles.ts
/**
 * Serialized DDL runner for cluster and database role bootstrap (`roles.ts`).
 */
import type { RawDb } from '../client';

export async function runLockedBootstrapStatements(
  admin: RawDb,
  lockKey: string,
  statements: readonly string[],
): Promise<void> {
  await admin.transaction(async (tx) => {
    await tx.raw('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
    for (const statement of statements) {
      await tx.raw(statement);
    }
  });
}
