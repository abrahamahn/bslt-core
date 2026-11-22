// main/tools/catalog/fixtures.ts
/**
 * Catalog entries for the unit tests of this directory: tables and catalogs as
 * the reader shapes them, built without a database.
 */
import type { AttributedCatalog, Attributed } from './attribute';
import type { CatalogFunction, CatalogPolicy, CatalogTable, DbCatalog } from './read';

const ADMIN =
  '( SELECT sys_current_user_is_platform_admin() AS sys_current_user_is_platform_admin)';

export function policy(
  name: string,
  command: CatalogPolicy['command'],
  using: string | null,
  withCheck: string | null,
  roles: readonly string[] = ['authenticated'],
  permissive = true,
): CatalogPolicy {
  return { name, command, permissive, roles, using, withCheck };
}

/** The four user policies of a class with the given predicate. */
export function userPolicies(predicate: string): CatalogPolicy[] {
  return [
    policy('rls_user_delete', 'DELETE', predicate, null),
    policy('rls_user_insert', 'INSERT', null, predicate),
    policy('rls_user_select', 'SELECT', predicate, null),
    policy('rls_user_update', 'UPDATE', predicate, predicate),
  ];
}

export const adminSelect = (): CatalogPolicy => policy('rls_admin_select', 'SELECT', ADMIN, null);

export const systemAccess = (): CatalogPolicy =>
  policy('system_access_policy', 'ALL', 'true', 'true', ['bslt_system']);

/** A table of class `owner_user` that equals its class; `overrides` change it. */
export function table(name: string, overrides: Partial<CatalogTable> = {}): CatalogTable {
  return {
    schema: 'public',
    name,
    kind: 'table',
    owner: 'bslt_owner',
    comment: 'rls:owner_user',
    rowSecurity: { enabled: true, forced: true },
    partition: null,
    columns: ['id uuid NOT NULL DEFAULT uuid_generate_v4()', 'user_id uuid NOT NULL', 'note text'],
    constraints: [`${name}_pkey PRIMARY KEY (id)`],
    indexes: [`CREATE UNIQUE INDEX ${name}_pkey ON public.${name} USING btree (id)`],
    policies: userPolicies('(user_id = sys_current_user_id())'),
    triggers: [],
    grants: ['authenticated: DELETE, INSERT, SELECT, UPDATE'],
    columnGrants: [],
    ...overrides,
  };
}

export function fn(name: string, body = 'x'): CatalogFunction {
  return {
    schema: 'public',
    name,
    kind: 'function',
    returns: 'uuid',
    language: 'sql',
    owner: 'bslt_owner',
    securityDefiner: false,
    volatility: 'stable',
    strict: false,
    leakproof: false,
    settings: [],
    bodySha256: body,
    grants: ['PUBLIC: EXECUTE'],
  };
}

/** A catalog reading; everything not given is empty. */
export function reading(parts: Partial<DbCatalog> = {}): DbCatalog {
  return {
    roles: [],
    extensions: ['plpgsql'],
    schemas: [{ name: 'public', owner: 'pg_database_owner', grants: [] }],
    types: [],
    sequences: [],
    functions: [],
    tables: [],
    views: [],
    ...parts,
  };
}

export const attributedTo = <T>(source: string, object: T): Attributed<T> => {
  const { schema, name, ...rest } = object as T & { schema: string; name: string };
  return { schema, name, source, ...rest } as unknown as Attributed<T>;
};

/** A sound committed catalog: the kernel and one owner with one table each. */
export function soundCatalog(parts: Partial<AttributedCatalog> = {}): AttributedCatalog {
  return {
    sources: [
      { id: 'kernel', dependsOn: [] },
      { id: 'identity', dependsOn: [] },
      { id: 'tasks', dependsOn: ['identity'] },
    ],
    roles: [],
    extensions: ['plpgsql'],
    schemas: [{ name: 'public', owner: 'pg_database_owner', grants: [] }],
    types: [],
    sequences: [],
    functions: [attributedTo('kernel', fn('sys_current_user_id()'))],
    tables: [
      attributedTo(
        'kernel',
        table('sys_jobs', {
          comment: 'rls:system',
          policies: [systemAccess()],
          grants: ['bslt_system: DELETE, INSERT, SELECT, UPDATE'],
        }),
      ),
      attributedTo(
        'tasks',
        table('tasks', {
          constraints: [
            'tasks_pkey PRIMARY KEY (id)',
            'tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
          ],
        }),
      ),
      attributedTo(
        'identity',
        table('users', {
          comment: 'rls:custom',
          policies: [
            policy('definer_read_policy', 'SELECT', 'true', null, ['bslt_definer']),
            policy('rls_user_select', 'SELECT', '(id = sys_current_user_id())', null),
          ],
          grants: ['authenticated: SELECT'],
        }),
      ),
    ],
    views: [],
    ...parts,
  };
}
