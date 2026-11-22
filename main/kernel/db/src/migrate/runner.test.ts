// main/kernel/db/src/migrate/runner.test.ts
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checksumSql,
  isNoTransaction,
  orderSources,
  readSourceFiles,
  runMigrationsWithDb,
  type MigrationSource,
} from './runner';

import type { RawDb } from '../client';

const tempDirs: string[] = [];

async function sourceDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'bslt-runner-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const source = (id: string, dependsOn: readonly string[] = []): MigrationSource => ({
  id,
  dir: `/nowhere/${id}`,
  dependsOn,
});

describe('orderSources', () => {
  it('puts the kernel first, then every source after the sources it depends on, by id', () => {
    const ordered = orderSources([
      source('billing', ['orgs', 'identity']),
      source('tasks', ['identity']),
      source('orgs', ['identity']),
      source('kernel'),
      source('identity'),
      source('audit'),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual([
      'kernel',
      'audit',
      'identity',
      'orgs',
      'billing',
      'tasks',
    ]);
  });

  it('does not depend on the order the sources are listed in', () => {
    const sources = [
      source('kernel'),
      source('identity'),
      source('orgs', ['identity']),
      source('flags', ['orgs']),
      source('webhooks', ['orgs']),
      source('analytics', ['identity']),
    ];
    const expected = orderSources(sources).map((entry) => entry.id);

    expect(orderSources([...sources].reverse()).map((entry) => entry.id)).toEqual(expected);
    expect(expected).toEqual(['kernel', 'identity', 'analytics', 'orgs', 'flags', 'webhooks']);
  });

  it('refuses a cycle, naming the sources in it', () => {
    expect(() =>
      orderSources([source('a', ['b']), source('b', ['c']), source('c', ['a'])]),
    ).toThrow(/dependency cycle.*a.*b.*c/u);
  });

  it('refuses a dependency on a source that is not listed', () => {
    expect(() => orderSources([source('tasks', ['identity'])])).toThrow(
      'migration source "tasks" depends on "identity", which is not a source',
    );
  });

  it('refuses two sources with one id, and a kernel that depends on a source', () => {
    expect(() => orderSources([source('a'), source('a')])).toThrow(
      'migration source "a" is listed twice',
    );
    expect(() => orderSources([source('kernel', ['identity']), source('identity')])).toThrow(
      'the kernel source depends on nothing',
    );
  });
});

describe('checksumSql', () => {
  it('is the SHA-256 of the content', () => {
    expect(checksumSql('SELECT 1;\n')).toBe(
      createHash('sha256').update('SELECT 1;\n').digest('hex'),
    );
    expect(checksumSql('SELECT 1;\n')).not.toBe(checksumSql('SELECT 2;\n'));
  });

  it('is the same for a checkout with CRLF line ends', () => {
    expect(checksumSql('SELECT 1;\r\nSELECT 2;\r\n')).toBe(checksumSql('SELECT 1;\nSELECT 2;\n'));
  });
});

describe('isNoTransaction', () => {
  it('reads the marker from the leading comment lines', () => {
    expect(isNoTransaction('-- 0002_index.sql\n-- bslt:no-transaction\n\nCREATE INDEX ...;')).toBe(
      true,
    );
    expect(isNoTransaction('--  bslt:no-transaction  \nSELECT 1;')).toBe(true);
  });

  it('ignores the marker after the first statement, and inside other text', () => {
    expect(isNoTransaction('SELECT 1;\n-- bslt:no-transaction\n')).toBe(false);
    expect(isNoTransaction('-- see bslt:no-transaction in the docs\nSELECT 1;')).toBe(false);
    expect(isNoTransaction('SELECT 1;')).toBe(false);
  });
});

describe('readSourceFiles', () => {
  it('reads the migrations in number order, and the seeds apart', async () => {
    const dir = await sourceDir({
      '0002_more.sql': '-- bslt:no-transaction\nSELECT 2;\n',
      '0001_first.sql': 'SELECT 1;\n',
      'seeds/0001_rows.sql': 'SELECT 3;\n',
    });

    const files = await readSourceFiles({ id: 'tasks', dir, dependsOn: [] });

    expect(files.migrations.map((file) => [file.source, file.name, file.transactional])).toEqual([
      ['tasks', '0001_first.sql', true],
      ['tasks', '0002_more.sql', false],
    ]);
    expect(files.migrations[0]?.checksum).toBe(checksumSql('SELECT 1;\n'));
    expect(files.seeds.map((file) => [file.source, file.name])).toEqual([
      ['tasks', 'seeds/0001_rows.sql'],
    ]);
  });

  it('refuses a file whose name is not NNNN_<name>.sql', async () => {
    const dir = await sourceDir({
      '0001_first.sql': 'SELECT 1;',
      'notes.sql': 'SELECT 2;',
    });

    await expect(readSourceFiles({ id: 'tasks', dir, dependsOn: [] })).rejects.toThrow(
      'migration source "tasks": "notes.sql" is not named NNNN_<name>.sql',
    );
  });

  it('refuses two files with one number', async () => {
    const dir = await sourceDir({
      '0001_a.sql': 'SELECT 1;',
      '0001_b.sql': 'SELECT 2;',
    });

    await expect(readSourceFiles({ id: 'tasks', dir, dependsOn: [] })).rejects.toThrow(
      'migration source "tasks": 0001_a.sql and 0001_b.sql have the same number',
    );
  });

  it('refuses a seed that asks to run outside a transaction', async () => {
    const dir = await sourceDir({
      '0001_a.sql': 'SELECT 1;',
      'seeds/0001_rows.sql': '-- bslt:no-transaction\nSELECT 2;',
    });

    await expect(readSourceFiles({ id: 'tasks', dir, dependsOn: [] })).rejects.toThrow(
      'migration source "tasks": the seed seeds/0001_rows.sql cannot be marked bslt:no-transaction',
    );
  });

  it('says which source has no directory', async () => {
    await expect(
      readSourceFiles({ id: 'tasks', dir: '/nowhere/at/all', dependsOn: [] }),
    ).rejects.toThrow('migration source "tasks": cannot read /nowhere/at/all');
  });
});

describe('runMigrationsWithDb and the advisory lock', () => {
  /** A database that is up to date with no sources, and whose unlock fails. */
  function dbWhoseUnlockFails(onRecordRead?: () => void): RawDb {
    const raw = async (sql: string): Promise<unknown[]> => {
      if (sql.includes('pg_advisory_unlock')) throw new Error('connection lost');
      if (sql.includes('to_regclass')) {
        onRecordRead?.();
        return [{ found: true }];
      }
      return [];
    };
    return { raw } as unknown as RawDb;
  }

  it('keeps the result of the run and says so when the lock cannot be released', async () => {
    const lines: string[] = [];

    const result = await runMigrationsWithDb({
      db: dbWhoseUnlockFails(),
      sources: [],
      logger: { log: (line) => lines.push(line) },
    });

    expect(result).toEqual({ applied: [], skipped: [] });
    expect(lines).toContain('  could not release the migration lock: connection lost');
  });

  it('keeps the error of the run when the lock cannot be released either', async () => {
    const lines: string[] = [];

    await expect(
      runMigrationsWithDb({
        db: dbWhoseUnlockFails(() => {
          throw new Error('permission denied for table sys_migrations');
        }),
        sources: [],
        logger: { log: (line) => lines.push(line) },
      }),
    ).rejects.toThrow('permission denied for table sys_migrations');

    expect(lines).toContain('  could not release the migration lock: connection lost');
  });

  it('refuses an edited or deleted migration against lockedChecksums before opening any DB query', async () => {
    const dir = await sourceDir({
      '0001_tasks.sql': 'CREATE TABLE tasks_items (id uuid PRIMARY KEY);\n',
    });
    const rawSpy = async (): Promise<unknown[]> => {
      throw new Error('DB should never be queried when lockedChecksums fail');
    };
    const db = { raw: rawSpy } as unknown as RawDb;

    await expect(
      runMigrationsWithDb({
        db,
        sources: [{ id: 'tasks', dir, dependsOn: [] }],
        lockedChecksums: {
          'tasks/0001_tasks.sql': '0'.repeat(64),
        },
      }),
    ).rejects.toThrow(/tasks\/0001_tasks\.sql.*checksum|edited|immutable/iu);

    await expect(
      runMigrationsWithDb({
        db,
        sources: [{ id: 'tasks', dir, dependsOn: [] }],
        lockedChecksums: {
          'tasks/0001_tasks.sql': checksumSql('CREATE TABLE tasks_items (id uuid PRIMARY KEY);\n'),
          'tasks/0002_deleted.sql': 'f'.repeat(64),
        },
      }),
    ).rejects.toThrow(/tasks\/0002_deleted\.sql/u);
  });
});
