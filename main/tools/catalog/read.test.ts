// main/tools/catalog/read.test.ts
/**
 * The catalog reader without a database: what it does with the rows the
 * catalog queries return. The queries themselves are tested on a real database
 * in `tests/integration/database/db-catalog.real-db.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { diffLines } from '../snapshot/snapshot-file';

import {
  CATALOG_QUERIES,
  readCatalogRows,
  shapeCatalog,
  type CatalogQuery,
  type CatalogRows,
  type DbCatalog,
} from './read';

/** The bytes a catalog is compared by. */
const serializeDbCatalog = (catalog: DbCatalog): string => `${JSON.stringify(catalog, null, 2)}\n`;

type Row = Record<string, unknown>;

function catalogRows(overrides: Partial<Record<CatalogQuery, Row[]>> = {}): CatalogRows {
  const empty = Object.fromEntries(
    (Object.keys(CATALOG_QUERIES) as CatalogQuery[]).map((query) => [query, [] as Row[]]),
  ) as Record<CatalogQuery, Row[]>;
  return { ...empty, ...overrides };
}

const role = (name: string, memberOf = '', overrides: Row = {}): Row => ({
  name,
  login: false,
  superuser: false,
  bypass_rls: false,
  create_db: false,
  create_role: false,
  inherit: true,
  replication: false,
  member_of: memberOf,
  ...overrides,
});

const NOTES = { schema: 'public', name: 'notes' };

function notesRows(): Partial<Record<CatalogQuery, Row[]>> {
  return {
    roles: [
      role('postgres', '', { superuser: true, login: true }),
      role('bslt_owner', '', { login: true }),
      role('authenticated'),
      role('bslt_app', 'authenticated', { login: true }),
      role('somebody_else', '', { login: true }),
    ],
    extensions: [{ name: 'uuid-ossp' }, { name: 'plpgsql' }],
    schemas: [{ name: 'public', owner: 'pg_database_owner' }],
    schemaGrants: [
      { name: 'public', grantee: 'authenticated', privilege: 'USAGE', grantable: false },
    ],
    tables: [
      {
        ...NOTES,
        kind: 'r',
        owner: 'bslt_owner',
        rls_enabled: true,
        rls_forced: true,
        comment: 'rls:user',
        partition_key: null,
        default_partition: null,
      },
    ],
    columns: [
      {
        ...NOTES,
        column_name: 'body',
        position: 3,
        type: 'text',
        not_null: false,
        default_expression: null,
        identity: '',
        generated: '',
      },
      {
        ...NOTES,
        column_name: 'id',
        position: 1,
        type: 'uuid',
        not_null: true,
        default_expression: 'uuid_generate_v4()',
        identity: '',
        generated: '',
      },
      {
        ...NOTES,
        column_name: 'user_id',
        position: 2,
        type: 'uuid',
        not_null: true,
        default_expression: null,
        identity: '',
        generated: '',
      },
      {
        ...NOTES,
        column_name: 'body_length',
        position: 4,
        type: 'integer',
        not_null: false,
        default_expression: 'char_length(body)',
        identity: '',
        generated: 's',
      },
    ],
    constraints: [
      {
        ...NOTES,
        constraint_name: 'notes_user_id_fkey',
        definition: 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
      },
      { ...NOTES, constraint_name: 'notes_pkey', definition: 'PRIMARY KEY (id)' },
    ],
    indexes: [
      {
        ...NOTES,
        index_name: 'notes_pkey',
        definition: 'CREATE UNIQUE INDEX notes_pkey ON public.notes USING btree (id)',
        valid: true,
      },
      {
        ...NOTES,
        index_name: 'idx_notes_user',
        definition: 'CREATE INDEX idx_notes_user ON public.notes USING btree (user_id)',
        valid: true,
      },
    ],
    policies: [
      {
        ...NOTES,
        policy_name: 'rls_user_all',
        command: '*',
        permissive: true,
        roles: 'authenticated',
        using_expression: '(user_id = sys_current_user_id())',
        check_expression: '(user_id = sys_current_user_id())',
      },
    ],
    tableGrants: [
      { ...NOTES, grantee: 'authenticated', privilege: 'UPDATE', grantable: false },
      { ...NOTES, grantee: 'authenticated', privilege: 'SELECT', grantable: false },
      { ...NOTES, grantee: 'authenticated', privilege: 'INSERT', grantable: true },
    ],
    columnGrants: [
      {
        ...NOTES,
        column_name: 'body',
        grantee: 'authenticated',
        privilege: 'UPDATE',
        grantable: false,
      },
    ],
  };
}

function reversed(rows: CatalogRows): CatalogRows {
  return Object.fromEntries(
    Object.entries(rows).map(([query, set]) => [query, [...set].reverse()]),
  ) as unknown as CatalogRows;
}

describe('shapeCatalog', () => {
  it('describes a table: columns in column order, the rest sorted', () => {
    const catalog = shapeCatalog(catalogRows(notesRows()));

    expect(catalog.tables).toEqual([
      {
        schema: 'public',
        name: 'notes',
        kind: 'table',
        owner: 'bslt_owner',
        comment: 'rls:user',
        rowSecurity: { enabled: true, forced: true },
        partition: null,
        columns: [
          'id uuid NOT NULL DEFAULT uuid_generate_v4()',
          'user_id uuid NOT NULL',
          'body text',
          'body_length integer GENERATED ALWAYS AS (char_length(body)) STORED',
        ],
        constraints: [
          'notes_pkey PRIMARY KEY (id)',
          'notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
        ],
        indexes: [
          'CREATE INDEX idx_notes_user ON public.notes USING btree (user_id)',
          'CREATE UNIQUE INDEX notes_pkey ON public.notes USING btree (id)',
        ],
        policies: [
          {
            name: 'rls_user_all',
            command: 'ALL',
            permissive: true,
            roles: ['authenticated'],
            using: '(user_id = sys_current_user_id())',
            withCheck: '(user_id = sys_current_user_id())',
          },
        ],
        triggers: [],
        grants: ['authenticated: INSERT WITH GRANT OPTION, SELECT, UPDATE'],
        columnGrants: ['authenticated: UPDATE (body)'],
      },
    ]);
    expect(catalog.extensions).toEqual(['plpgsql', 'uuid-ossp']);
    expect(catalog.schemas).toEqual([
      { name: 'public', owner: 'pg_database_owner', grants: ['authenticated: USAGE'] },
    ]);
  });

  it('lists the roles the catalog names and their members, not the rest of the cluster', () => {
    const catalog = shapeCatalog(catalogRows(notesRows()));

    expect(catalog.roles.map((entry) => entry['name'])).toEqual([
      'authenticated',
      'bslt_app',
      'bslt_owner',
    ]);
    expect(catalog.roles[1]).toEqual({
      name: 'bslt_app',
      login: true,
      superuser: false,
      bypassRls: false,
      createDb: false,
      createRole: false,
      inherit: true,
      replication: false,
      memberOf: ['authenticated'],
    });
  });

  it('describes a partitioned table by its key and its default partition', () => {
    const rows = notesRows();
    const [table] = rows.tables ?? [];
    const catalog = shapeCatalog(
      catalogRows({
        ...rows,
        tables: [
          {
            ...table,
            kind: 'p',
            partition_key: 'RANGE (created_at)',
            default_partition: 'notes_default',
          },
        ],
      }),
    );

    expect(catalog.tables[0]).toMatchObject({
      kind: 'partitioned table',
      partition: { key: 'RANGE (created_at)', default: 'notes_default' },
    });
  });

  it('describes enums in label order, domains, sequences and functions', () => {
    const catalog = shapeCatalog(
      catalogRows({
        types: [
          {
            schema: 'public',
            name: 'mood',
            kind: 'e',
            owner: 'bslt_owner',
            base_type: null,
            not_null: false,
          },
          {
            schema: 'public',
            name: 'email',
            kind: 'd',
            owner: 'bslt_owner',
            base_type: 'text',
            not_null: true,
          },
        ],
        enumLabels: [
          { schema: 'public', name: 'mood', label: 'sad', position: 2 },
          { schema: 'public', name: 'mood', label: 'ok', position: 1 },
        ],
        domainConstraints: [
          {
            schema: 'public',
            name: 'email',
            constraint_name: 'email_check',
            definition: "CHECK ((VALUE ~ '@'::text))",
          },
        ],
        sequences: [
          {
            schema: 'public',
            name: 'migrations_id_seq',
            owner: 'bslt_owner',
            type: 'integer',
            start: '1',
            increment: '1',
            cycle: false,
            owned_by: 'migrations.id',
          },
        ],
        functions: [
          {
            schema: 'public',
            name: 'sys_current_user_id',
            arguments: '',
            returns: 'uuid',
            language: 'sql',
            kind: 'f',
            security_definer: false,
            volatility: 's',
            strict: false,
            leakproof: false,
            config: 'search_path=public, pg_temp',
            owner: 'bslt_owner',
            source: 'SELECT 1',
          },
        ],
        functionGrants: [
          {
            schema: 'public',
            name: 'sys_current_user_id',
            arguments: '',
            grantee: 'PUBLIC',
            privilege: 'EXECUTE',
            grantable: false,
          },
          {
            schema: 'public',
            name: 'sys_current_user_id',
            arguments: 'uuid',
            grantee: 'authenticated',
            privilege: 'EXECUTE',
            grantable: false,
          },
        ],
      }),
    );

    expect(catalog.types).toEqual([
      {
        schema: 'public',
        name: 'email',
        owner: 'bslt_owner',
        kind: 'domain',
        baseType: 'text',
        notNull: true,
        constraints: ["email_check CHECK ((VALUE ~ '@'::text))"],
      },
      { schema: 'public', name: 'mood', owner: 'bslt_owner', kind: 'enum', labels: ['ok', 'sad'] },
    ]);
    expect(catalog.sequences[0]).toMatchObject({
      name: 'migrations_id_seq',
      ownedBy: 'migrations.id',
    });
    expect(catalog.functions).toEqual([
      {
        schema: 'public',
        name: 'sys_current_user_id()',
        kind: 'function',
        returns: 'uuid',
        language: 'sql',
        owner: 'bslt_owner',
        securityDefiner: false,
        volatility: 'stable',
        strict: false,
        leakproof: false,
        settings: ['search_path=public, pg_temp'],
        // sha256('SELECT 1')
        bodySha256: 'e004ebd5b5532a4b85984a62f8ad48a81aa3460c1ca07701f386135d72cdecf5',
        // The grant on the other overload is not this function's.
        grants: ['PUBLIC: EXECUTE'],
      },
    ]);
  });

  it('gives the same bytes whatever order the database returned the rows in', () => {
    const rows = catalogRows(notesRows());

    expect(serializeDbCatalog(shapeCatalog(reversed(rows)))).toBe(
      serializeDbCatalog(shapeCatalog(rows)),
    );
    expect(serializeDbCatalog(shapeCatalog(rows))).toBe(serializeDbCatalog(shapeCatalog(rows)));
  });

  it('shows a changed policy, a new grant and a function body that changed', () => {
    const before = serializeDbCatalog(shapeCatalog(catalogRows(notesRows())));

    const seeded = notesRows();
    seeded.policies = (seeded.policies ?? []).map((policy) => ({
      ...policy,
      using_expression: 'true',
    }));
    seeded.tableGrants = [
      ...(seeded.tableGrants ?? []),
      { ...NOTES, grantee: 'PUBLIC', privilege: 'SELECT', grantable: false },
    ];
    seeded.tables = (seeded.tables ?? []).map((table) => ({ ...table, rls_forced: false }));
    const after = serializeDbCatalog(shapeCatalog(catalogRows(seeded)));

    const diff = diffLines(before, after);
    expect(diff).toContain('-           "using": "(user_id = sys_current_user_id())",');
    expect(diff).toContain('+           "using": "true",');
    expect(diff).toContain('+         "PUBLIC: SELECT",');
    expect(diff).toContain('-         "forced": true');
    expect(diff).toContain('+         "forced": false');
  });

  it('stops on a row that lacks a column it reads', () => {
    expect(() => shapeCatalog(catalogRows({ extensions: [{ nome: 'x' }] }))).toThrow(/"name"/u);
  });
});

describe('readCatalogRows', () => {
  it('runs every catalog query in one transaction, on a fixed search path', async () => {
    const statements: string[] = [];
    let transactions = 0;
    const tx = {
      raw: <T>(sql: string): Promise<T[]> => {
        statements.push(sql);
        const tag = /^\/\* catalog:(\w+) \*\//u.exec(sql)?.[1];
        return Promise.resolve((tag === 'extensions' ? [{ name: 'plpgsql' }] : []) as T[]);
      },
    };
    const db = {
      raw: (): Promise<never[]> => Promise.reject(new Error('a query ran outside the transaction')),
      transaction: <T>(callback: (inner: typeof tx) => Promise<T>): Promise<T> => {
        transactions += 1;
        return callback(tx);
      },
    };

    const rows = await readCatalogRows(db);

    expect(transactions).toBe(1);
    expect(statements[0]).toBe('SET LOCAL search_path TO public, pg_catalog');
    expect(statements.slice(1).map((sql) => /^\/\* catalog:(\w+) \*\//u.exec(sql)?.[1])).toEqual(
      Object.keys(CATALOG_QUERIES),
    );
    expect(Object.keys(rows)).toEqual(Object.keys(CATALOG_QUERIES));
    expect(rows.extensions).toEqual([{ name: 'plpgsql' }]);
  });
});
