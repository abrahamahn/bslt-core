// main/kernel/db/src/repositories/system/search.ts
/**
 * Parameterized SQL execution helpers for `SqlSearchProvider`.
 */
import type { RawDb } from '../../client';

type CountRow = Record<string, unknown> & { count: string | number };

type FacetRow = Record<string, unknown> & {
  value: string | number | boolean | Date | null;
  count: string | number;
};

export async function querySearchRows<TRecord extends Record<string, unknown>>(
  db: RawDb,
  sqlText: string,
  values: unknown[],
): Promise<TRecord[]> {
  return db.raw<TRecord>(sqlText, values);
}

export async function querySearchFacetBuckets(
  db: RawDb,
  facetSql: string,
  values: unknown[],
): Promise<Array<{ value: string | number | boolean | Date | null; count: number }>> {
  const bucketResults = await db.raw<FacetRow>(facetSql, values);
  return bucketResults.map((row) => ({
    value: row.value,
    count:
      typeof row.count === 'number'
        ? row.count
        : parseInt(typeof row.count === 'string' ? row.count : String(row.count), 10),
  }));
}

export async function countSearchRows(
  db: RawDb,
  countSql: string,
  values: unknown[],
): Promise<number> {
  const countResult = await db.raw<CountRow>(countSql, values);
  const countValue = countResult[0]?.count;
  return typeof countValue === 'number' ? countValue : parseInt(String(countValue), 10);
}

export async function probeSearchTable(db: RawDb, tableName: string): Promise<boolean> {
  try {
    await db.raw(`SELECT 1 FROM ${tableName} LIMIT 1`, []);
    return true;
  } catch {
    return false;
  }
}
