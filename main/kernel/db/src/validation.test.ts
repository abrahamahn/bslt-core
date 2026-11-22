// main/kernel/db/src/validation.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REQUIRED_TABLES,
  requireValidSchema,
  SchemaValidationError,
  validateSchema,
} from './validation';

import type { RawDb } from './client';

/** The committed catalog, next to the migrations it is computed from. */
function catalogTables(): string[] {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../catalog.snapshot.json',
  );
  const catalog = JSON.parse(readFileSync(file, 'utf8')) as { tables: Array<{ name: string }> };
  return catalog.tables.map((table) => table.name).sort();
}

function dbWith(tables: readonly string[]): RawDb {
  return {
    raw: () => Promise.resolve(tables.map((tablename) => ({ tablename }))),
  } as unknown as RawDb;
}

describe('REQUIRED_TABLES', () => {
  it('is every table of the database catalog, not a list kept by hand', () => {
    expect([...REQUIRED_TABLES].sort()).toEqual(catalogTables());
  });

  it('names the tables the hand-written list had forgotten', () => {
    // Each of these is created by a migration source and read by the application.
    for (const table of [
      'identity_api_keys',
      'audit_log',
      'compliance_consents',
      'sys_jobs',
      'sys_migrations',
    ]) {
      expect(REQUIRED_TABLES).toContain(table);
    }
  });
});

describe('validateSchema', () => {
  it('accepts a database that has every required table', async () => {
    const result = await validateSchema(dbWith([...REQUIRED_TABLES, 'audit_log_default']));

    expect(result.valid).toBe(true);
    expect(result.missingTables).toEqual([]);
  });

  it('names the tables a database lacks, and requireValidSchema throws with them', async () => {
    const without = REQUIRED_TABLES.filter(
      (table) => table !== 'audit_log' && table !== 'identity_users',
    );

    expect((await validateSchema(dbWith(without))).missingTables.sort()).toEqual([
      'audit_log',
      'identity_users',
    ]);
    await expect(requireValidSchema(dbWith(without))).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(requireValidSchema(dbWith(without))).rejects.toThrow(/audit_log/u);
  });
});
