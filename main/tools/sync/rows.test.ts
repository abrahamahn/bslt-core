// main/tools/sync/rows.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { attributedTo, soundCatalog, table } from '../catalog/fixtures';
import { REPO_ROOT } from '../lib/paths';

import {
  GENERATED_ROWS_DIRECTORIES,
  emitRlsTest,
  emitRows,
  emitRowsFile,
  emitTablesFile,
  parseColumnLine,
  rowTables,
  rowsFileOf,
  run,
  syncRows,
  typeOf,
} from './rows';

import type { AttributedCatalog } from '../catalog/attribute';

/** A catalog with one table that has a column of every kind the type map knows. */
function catalog(): AttributedCatalog {
  const sound = soundCatalog();
  return {
    ...sound,
    types: [
      attributedTo('identity', {
        schema: 'public',
        name: 'user_role',
        owner: 'bslt_owner',
        kind: 'enum' as const,
        labels: ['user', 'admin'],
      }),
    ],
    tables: [
      ...sound.tables,
      attributedTo(
        'tasks',
        table('task_runs', {
          columns: [
            'id uuid NOT NULL DEFAULT uuid_generate_v4()',
            'task_id uuid NOT NULL',
            'requested_by uuid',
            'role user_role NOT NULL',
            'state text NOT NULL',
            "payload jsonb NOT NULL DEFAULT '{}'::jsonb",
            'size_bytes bigint NOT NULL',
            'cost numeric(10,2)',
            'tags text[] NOT NULL',
            'attempts integer NOT NULL DEFAULT 0',
            'done boolean NOT NULL DEFAULT false',
            'started_at timestamp with time zone',
            'title_length integer GENERATED ALWAYS AS (char_length(state)) STORED',
          ],
          constraints: [
            'task_runs_pkey PRIMARY KEY (id)',
            "task_runs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'it''s done'::text])))",
            'task_runs_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE',
          ],
        }),
      ),
    ],
  };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A root with the Prettier configuration of the repository and nothing generated. */
function emptyRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-sync-rows-'));
  roots.push(root);
  mkdirSync(path.join(root, 'config'));
  writeFileSync(
    path.join(root, 'config/.prettierrc'),
    readFileSync(path.join(REPO_ROOT, 'config/.prettierrc'), 'utf8'),
  );
  return root;
}

describe('the type map', () => {
  const enums = new Map();

  it('maps the database types of the plan', () => {
    expect(typeOf('uuid', enums)).toBe('string');
    expect(typeOf('timestamp with time zone', enums)).toBe('Date');
    expect(typeOf('bigint', enums)).toBe('bigint');
    expect(typeOf('numeric', enums)).toBe('string');
    expect(typeOf('numeric(10,2)', enums)).toBe('string');
    expect(typeOf('jsonb', enums)).toBe('JsonValue');
    expect(typeOf('integer', enums)).toBe('number');
    expect(typeOf('character varying(255)', enums)).toBe('string');
    expect(typeOf('text[]', enums)).toBe('string[]');
  });

  it('stops on a type it does not know instead of typing a column unknown', () => {
    expect(() => typeOf('tsvector', enums)).toThrow(
      /no TypeScript type for the database type "tsvector"/u,
    );
  });
});

describe('parseColumnLine', () => {
  it('takes a catalog column line apart', () => {
    expect(parseColumnLine('created_at timestamp with time zone NOT NULL DEFAULT now()')).toEqual({
      name: 'created_at',
      type: 'timestamp with time zone',
      notNull: true,
      hasDefault: true,
      generated: false,
      definition: 'timestamp with time zone NOT NULL DEFAULT now()',
    });
    expect(parseColumnLine('note text')).toMatchObject({
      type: 'text',
      notNull: false,
      hasDefault: false,
    });
    // A default that mentions NOT NULL does not make the column NOT NULL.
    expect(parseColumnLine("note text DEFAULT 'x NOT NULL'::text")).toMatchObject({
      type: 'text',
      notNull: false,
      hasDefault: true,
    });
    expect(
      parseColumnLine('n integer GENERATED ALWAYS AS (char_length(state)) STORED'),
    ).toMatchObject({ type: 'integer', generated: true });
    expect(parseColumnLine('id bigint NOT NULL GENERATED ALWAYS AS IDENTITY')).toMatchObject({
      type: 'bigint',
      notNull: true,
      hasDefault: true,
      generated: false,
    });
  });
});

describe('rowTables', () => {
  it('describes each column in TypeScript terms', () => {
    const runs = rowTables(catalog()).find((entry) => entry.table === 'task_runs');

    expect(runs).toMatchObject({
      source: 'tasks',
      typeName: 'TaskRuns',
      constantName: 'TASK_RUNS',
    });
    expect(
      Object.fromEntries((runs?.columns ?? []).map((column) => [column.property, column.type])),
    ).toEqual({
      id: 'string',
      taskId: 'string',
      requestedBy: 'string | null',
      role: 'UserRoleEnum',
      state: "'queued' | 'running' | 'it\\'s done'",
      payload: 'JsonValue',
      sizeBytes: 'bigint',
      cost: 'string | null',
      tags: 'string[]',
      attempts: 'number',
      done: 'boolean',
      startedAt: 'Date | null',
      titleLength: 'number | null',
    });
    const column = (name: string) => runs?.columns.find((entry) => entry.column === name);
    expect(column('task_id')).toMatchObject({ references: 'tasks.id', optionalOnInsert: false });
    expect(column('id')?.optionalOnInsert).toBe(true);
    expect(column('requested_by')?.optionalOnInsert).toBe(true);
    expect(column('title_length')?.generated).toBe(true);
  });

  it('sorts the tables by name', () => {
    const names = rowTables(catalog()).map((entry) => entry.table);
    expect(names).toEqual([...names].sort());
  });
});

describe('the generated files', () => {
  it('writes a kernel file, one file per module that has tables, the table list and the RLS test', () => {
    expect([...emitRows(catalog()).keys()]).toEqual([
      'main/kernel/db/src/generated/rows.ts',
      'main/modules/identity/server/generated/rows.ts',
      'main/modules/tasks/server/generated/rows.ts',
      'main/kernel/db/src/generated/tables.ts',
      'tests/integration/database/generated/rls.real-db.test.ts',
    ]);
    expect(rowsFileOf('kernel')).toBe('main/kernel/db/src/generated/rows.ts');
    expect(rowsFileOf('tasks')).toBe('main/modules/tasks/server/generated/rows.ts');
  });

  it('starts every file with its path and a header that names the command and the catalog', () => {
    for (const [file, content] of emitRows(catalog())) {
      const [first, second] = content.split('\n');
      expect(first).toBe(`// ${file}`);
      expect(second).toContain(
        '@generated by `pnpm bslt sync rows` from main/kernel/db/catalog.snapshot.json',
      );
      expect(second).toContain('Do not edit.');
    }
  });

  it('emits self-contained row, insert and update types and the column map of a module table, each line with its key', () => {
    const file = emitRowsFile(catalog(), 'tasks');

    expect(file).toContain('type JsonValue =');
    expect(file).toContain("type UserRoleEnum = 'user' | 'admin'; // <- types.user_role");
    expect(file).not.toContain("from '../");
    expect(file).toContain("export const TASK_RUNS_TABLE = 'task_runs'; // <- tables.task_runs");
    expect(file).toContain(
      '  taskId: string; // <- tables.task_runs.columns: task_id uuid NOT NULL -> tasks.id',
    );
    expect(file).toContain("  taskId: 'task_id', // <- tables.task_runs.columns: task_id");
    const section = (name: string): string => {
      const start = file.indexOf(`export interface ${name} {`);
      return file.slice(start, file.indexOf('\n}', start));
    };
    // A default or a nullable column is optional on insert; a generated column is not written.
    expect(section('TaskRunsInsert')).toContain('  id?: string;');
    expect(section('TaskRunsInsert')).toContain('  taskId: string;');
    expect(section('TaskRunsInsert')).toContain('  requestedBy?: string | null;');
    expect(section('TaskRunsInsert')).not.toContain('titleLength');
    expect(section('TaskRunsUpdate')).toContain('  taskId?: string;');
    expect(section('TaskRunsUpdate')).not.toContain('titleLength');
    expect(section('TaskRunsRow')).toContain('  titleLength: number | null;');
  });

  it('emits an enum as a union in the file of the source that owns it', () => {
    expect(emitRowsFile(catalog(), 'identity')).toContain(
      "export type UserRoleEnum = 'user' | 'admin'; // <- types.user_role",
    );
    expect(emitRowsFile(catalog(), 'tasks')).not.toContain('export type UserRoleEnum');
  });

  it('lists the tables of every source, sources in apply order', () => {
    const file = emitTablesFile(catalog());

    expect(file).toContain("  kernel: ['sys_jobs'], // <- sources.kernel");
    expect(file).toContain("  tasks: ['task_runs', 'tasks'], // <- sources.tasks");
    expect(file.indexOf('  kernel:')).toBeLessThan(file.indexOf('  identity:'));
    expect(file).toContain("  'users', // <- tables.users (identity)");
  });

  it('emits one RLS case per table and one delegating call', () => {
    const file = emitRlsTest(catalog());

    expect(file.match(/describeRlsStructure\(/gu)).toHaveLength(1);
    expect(file).toContain("      table: 'tasks', // <- tables.tasks (tasks)");
    expect(file).toContain("      class: 'owner_user',");
    expect(file).toContain("      ownerColumn: 'user_id',");
    expect(file).toContain("      user: ['select', 'insert', 'update', 'delete'],");
    expect(file).toContain("      custom: ['rls_user_select'],");
    expect(file).toContain("      definerRead: ['definer_read_policy'],");
  });

  it('refuses to generate the RLS test for a table without a class', () => {
    const sound = soundCatalog();
    expect(() =>
      emitRlsTest({
        ...sound,
        tables: [...sound.tables, attributedTo('tasks', table('notes', { comment: null }))],
      }),
    ).toThrow(/table notes has no row-level security class/u);
  });
});

describe('bslt sync rows', () => {
  it('writes the files, formatted, and is then up to date', async () => {
    const root = emptyRoot();

    const first = await syncRows({ root, catalog: catalog() });

    expect(first.stale).toHaveLength(5);
    expect(first.orphans).toEqual([]);
    for (const file of first.stale) expect(existsSync(path.join(root, file))).toBe(true);
    expect(await syncRows({ root, catalog: catalog() })).toMatchObject({ stale: [], orphans: [] });
    expect(await syncRows({ root, catalog: catalog(), check: true })).toMatchObject({ stale: [] });
  });

  it('--check reports a stale file and changes nothing', async () => {
    const root = emptyRoot();
    await syncRows({ root, catalog: catalog() });
    const file = path.join(root, 'main/modules/tasks/server/generated/rows.ts');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nexport const EDITED = true;\n`);

    const checked = await syncRows({ root, catalog: catalog(), check: true });

    expect(checked.stale).toEqual(['main/modules/tasks/server/generated/rows.ts']);
    expect(readFileSync(file, 'utf8')).toContain('EDITED');
  });

  it('reports a file no command produces in a generated directory or module server/generated, and removes it on a write', async () => {
    const root = emptyRoot();
    await syncRows({ root, catalog: catalog() });
    const kernelOrphan = `${GENERATED_ROWS_DIRECTORIES[0]}/extra.ts`;
    const moduleOrphan = 'main/modules/tasks/server/generated/extra.ts';
    writeFileSync(path.join(root, kernelOrphan), 'export {};\n');
    writeFileSync(path.join(root, moduleOrphan), 'export {};\n');

    expect((await syncRows({ root, catalog: catalog(), check: true })).orphans).toEqual([
      kernelOrphan,
      moduleOrphan,
    ]);
    expect(existsSync(path.join(root, kernelOrphan))).toBe(true);
    expect(existsSync(path.join(root, moduleOrphan))).toBe(true);

    expect((await syncRows({ root, catalog: catalog() })).orphans).toEqual([
      kernelOrphan,
      moduleOrphan,
    ]);
    expect(existsSync(path.join(root, kernelOrphan))).toBe(false);
    expect(existsSync(path.join(root, moduleOrphan))).toBe(false);
  });
});

describe('the generated-rows gate', () => {
  it('is green on the committed files of this repository', async () => {
    const result = await run();

    expect(result.problems ?? []).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
