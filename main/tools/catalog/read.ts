// main/tools/catalog/read.ts
/**
 * The catalog reader: what a database holds, read back from `pg_catalog`
 * (restructure plan, section 9.1 item 3).
 *
 * Roles, extensions, schemas, types, sequences, functions, and per table its
 * columns, constraints, indexes, row-level security (enabled, forced, the
 * policies with their text), triggers, grants and comment (the `rls:<class>`
 * classification). `bslt db catalog` (./build.ts) reads it after each migration
 * source and attributes every object to the source that created it
 * (./attribute.ts).
 *
 * Left out on purpose, because they do not come from the migrations alone:
 * - objects that belong to an extension;
 * - the partitions of a partitioned table: the migrations create them for the
 *   current and the next month, so their names depend on the day. The parent
 *   records its partition key and its default partition;
 * - what an owner may do with its own object (ownership says it, and the list
 *   of privileges an owner holds differs between Postgres majors);
 * - oids, statistics and anything else that differs between two databases
 *   built from the same migrations.
 */
import { createHash } from 'node:crypto';

import { compareText } from '../snapshot/snapshot-file';

// ============================================================================
// Reading
// ============================================================================

/** What the reader needs of a database client (`RawDb` of `@bslt/db` fits). */
export interface CatalogQueryable {
  raw<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

export interface CatalogConnection extends CatalogQueryable {
  transaction<T>(callback: (tx: CatalogQueryable) => Promise<T>): Promise<T>;
}

/** A user schema: not a system schema, not a temporary one. */
const USER_SCHEMA = `n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'`;

/** `<alias>` (of catalog `<catalog>`) is not a member of an extension. */
const notOfExtension = (catalog: string, alias: string): string =>
  `NOT EXISTS (SELECT 1 FROM pg_depend ext WHERE ext.classid = '${catalog}'::regclass AND ext.objid = ${alias}.oid AND ext.deptype = 'e')`;

/** Tables and partitioned tables of user schemas, without partitions and extension members. */
const RELATION_FILTER = `c.relkind IN ('r', 'p') AND NOT c.relispartition
    AND ${USER_SCHEMA} AND ${notOfExtension('pg_class', 'c')}`;

/** Join the relation `c` (and its schema `n`) a row belongs to, keeping only those tables. */
const ofRelation = (on: string): string => `
    JOIN pg_class c ON ${on}
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${RELATION_FILTER}`;

const grantee = (alias: string): string =>
  `CASE WHEN ${alias}.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(${alias}.grantee) END`;

/**
 * The catalog queries. Each returns plain text and boolean columns only, so the
 * result does not depend on how the driver maps arrays or `name`.
 */
export const CATALOG_QUERIES = {
  roles: `
    SELECT r.rolname::text AS name, r.rolcanlogin AS login, r.rolsuper AS superuser,
           r.rolbypassrls AS bypass_rls, r.rolcreatedb AS create_db, r.rolcreaterole AS create_role,
           r.rolinherit AS inherit, r.rolreplication AS replication,
           coalesce((SELECT string_agg(g.rolname::text, ',' ORDER BY g.rolname::text COLLATE "C")
                     FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                     WHERE m.member = r.oid), '') AS member_of
    FROM pg_roles r`,
  extensions: `SELECT e.extname::text AS name FROM pg_extension e`,
  schemas: `
    SELECT n.nspname::text AS name, pg_get_userbyid(n.nspowner)::text AS owner
    FROM pg_namespace n WHERE ${USER_SCHEMA}`,
  schemaGrants: `
    SELECT n.nspname::text AS name, ${grantee('a')}::text AS grantee,
           a.privilege_type::text AS privilege, a.is_grantable AS grantable
    FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE ${USER_SCHEMA} AND a.grantee <> n.nspowner`,
  types: `
    SELECT n.nspname::text AS schema, t.typname::text AS name, t.typtype::text AS kind,
           pg_get_userbyid(t.typowner)::text AS owner,
           CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END AS base_type,
           t.typnotnull AS not_null
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype IN ('e', 'd') AND ${USER_SCHEMA} AND ${notOfExtension('pg_type', 't')}`,
  enumLabels: `
    SELECT n.nspname::text AS schema, t.typname::text AS name, e.enumlabel::text AS label,
           (row_number() OVER (PARTITION BY t.oid ORDER BY e.enumsortorder))::int AS position
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE ${USER_SCHEMA} AND ${notOfExtension('pg_type', 't')}`,
  domainConstraints: `
    SELECT n.nspname::text AS schema, t.typname::text AS name, con.conname::text AS constraint_name,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_type t ON t.oid = con.contypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE ${USER_SCHEMA} AND ${notOfExtension('pg_type', 't')}`,
  sequences: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, pg_get_userbyid(c.relowner)::text AS owner,
           format_type(s.seqtypid, NULL) AS type, s.seqstart::text AS start, s.seqincrement::text AS increment,
           s.seqcycle AS cycle,
           (SELECT d.refobjid::regclass::text || '.' || a.attname::text
            FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
            WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')
            LIMIT 1) AS owned_by
    FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${USER_SCHEMA} AND ${notOfExtension('pg_class', 'c')}`,
  sequenceGrants: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, ${grantee('a')}::text AS grantee,
           a.privilege_type::text AS privilege, a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
    WHERE c.relkind = 'S' AND ${USER_SCHEMA} AND ${notOfExtension('pg_class', 'c')}
      AND a.grantee <> c.relowner`,
  functions: `
    SELECT n.nspname::text AS schema, p.proname::text AS name,
           pg_get_function_identity_arguments(p.oid) AS arguments,
           pg_get_function_result(p.oid) AS returns, l.lanname::text AS language,
           p.prokind::text AS kind, p.prosecdef AS security_definer, p.provolatile::text AS volatility,
           p.proisstrict AS strict, p.proleakproof AS leakproof,
           coalesce(array_to_string(p.proconfig, chr(10)), '') AS config,
           pg_get_userbyid(p.proowner)::text AS owner, p.prosrc AS source
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
    WHERE ${USER_SCHEMA} AND ${notOfExtension('pg_proc', 'p')}`,
  functionGrants: `
    SELECT n.nspname::text AS schema, p.proname::text AS name,
           pg_get_function_identity_arguments(p.oid) AS arguments, ${grantee('a')}::text AS grantee,
           a.privilege_type::text AS privilege, a.is_grantable AS grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE ${USER_SCHEMA} AND ${notOfExtension('pg_proc', 'p')} AND a.grantee <> p.proowner`,
  tables: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind,
           pg_get_userbyid(c.relowner)::text AS owner, c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced, obj_description(c.oid, 'pg_class') AS comment,
           CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partition_key,
           (SELECT pt.partdefid::regclass::text FROM pg_partitioned_table pt
            WHERE pt.partrelid = c.oid AND pt.partdefid <> 0) AS default_partition
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${RELATION_FILTER}`,
  columns: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, a.attname::text AS column_name,
           a.attnum::int AS position, format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS default_expression,
           a.attidentity::text AS identity, a.attgenerated::text AS generated
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    ${ofRelation('c.oid = a.attrelid')} AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, con.conname::text AS constraint_name,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    ${ofRelation('c.oid = con.conrelid')} AND con.contype IN ('p', 'u', 'f', 'c', 'x')`,
  indexes: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, i.relname::text AS index_name,
           pg_get_indexdef(ix.indexrelid) AS definition, ix.indisvalid AS valid
    FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
    ${ofRelation('c.oid = ix.indrelid')}`,
  policies: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, pol.polname::text AS policy_name,
           pol.polcmd::text AS command, pol.polpermissive AS permissive,
           (SELECT string_agg(CASE WHEN r.role = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r.role)::text END,
                              ',' ORDER BY (CASE WHEN r.role = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r.role)::text END) COLLATE "C")
            FROM unnest(pol.polroles) AS r(role)) AS roles,
           pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expression
    FROM pg_policy pol
    ${ofRelation('c.oid = pol.polrelid')}`,
  triggers: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, t.tgname::text AS trigger_name,
           pg_get_triggerdef(t.oid) AS definition, t.tgenabled::text AS enabled
    FROM pg_trigger t
    ${ofRelation('c.oid = t.tgrelid')} AND NOT t.tgisinternal`,
  tableGrants: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, ${grantee('a')}::text AS grantee,
           a.privilege_type::text AS privilege, a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE ${RELATION_FILTER} AND a.grantee <> c.relowner`,
  columnGrants: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, att.attname::text AS column_name,
           ${grantee('a')}::text AS grantee, a.privilege_type::text AS privilege,
           a.is_grantable AS grantable
    FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(att.attacl) a
    WHERE ${RELATION_FILTER} AND att.attnum > 0 AND NOT att.attisdropped
      AND a.grantee <> c.relowner`,
  views: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind,
           pg_get_userbyid(c.relowner)::text AS owner, pg_get_viewdef(c.oid, true) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('v', 'm') AND ${USER_SCHEMA} AND ${notOfExtension('pg_class', 'c')}`,
  viewGrants: `
    SELECT n.nspname::text AS schema, c.relname::text AS name, ${grantee('a')}::text AS grantee,
           a.privilege_type::text AS privilege, a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.relkind IN ('v', 'm') AND ${USER_SCHEMA} AND ${notOfExtension('pg_class', 'c')}
      AND a.grantee <> c.relowner`,
} as const;

export type CatalogQuery = keyof typeof CATALOG_QUERIES;

type Row = Readonly<Record<string, unknown>>;

/** The rows of every catalog query, in whatever order the database returned them. */
export type CatalogRows = Readonly<Record<CatalogQuery, readonly Row[]>>;

/**
 * Run the catalog queries in one transaction with a fixed `search_path`: the
 * catalog prints a name unqualified exactly when its schema is on the path, so
 * the path is part of the output.
 */
export async function readCatalogRows(db: CatalogConnection): Promise<CatalogRows> {
  return db.transaction(async (tx) => {
    await tx.raw('SET LOCAL search_path TO public, pg_catalog');
    const rows: Partial<Record<CatalogQuery, readonly Row[]>> = {};
    for (const query of Object.keys(CATALOG_QUERIES) as CatalogQuery[]) {
      rows[query] = await tx.raw(`/* catalog:${query} */ ${CATALOG_QUERIES[query]}`);
    }
    return rows as CatalogRows;
  });
}

// ============================================================================
// Shaping
// ============================================================================

export interface CatalogPolicy {
  readonly name: string;
  readonly command: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly permissive: boolean;
  readonly roles: readonly string[];
  readonly using: string | null;
  readonly withCheck: string | null;
}

export interface CatalogTable {
  readonly schema: string;
  readonly name: string;
  readonly kind: 'table' | 'partitioned table';
  readonly owner: string;
  /** The table comment: the `rls:<class>` classification. */
  readonly comment: string | null;
  readonly rowSecurity: { readonly enabled: boolean; readonly forced: boolean };
  readonly partition: { readonly key: string; readonly default: string | null } | null;
  /** `<name> <type> [NOT NULL] [DEFAULT <expression>]`, in column order. */
  readonly columns: readonly string[];
  /** `<name> <definition>`, sorted. */
  readonly constraints: readonly string[];
  /** `CREATE INDEX` statements, sorted by index name. */
  readonly indexes: readonly string[];
  readonly policies: readonly CatalogPolicy[];
  /** `CREATE TRIGGER` statements, sorted by trigger name. */
  readonly triggers: readonly string[];
  /** `<grantee>: <privileges>`, sorted. The owner's own privileges are not listed. */
  readonly grants: readonly string[];
  /** `<grantee>: <privilege> (<columns>)`, sorted. */
  readonly columnGrants: readonly string[];
}

export interface CatalogRole {
  readonly name: string;
  readonly login: boolean;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
  readonly createDb: boolean;
  readonly createRole: boolean;
  readonly inherit: boolean;
  readonly replication: boolean;
  readonly memberOf: readonly string[];
}

export interface CatalogSchema {
  readonly name: string;
  readonly owner: string;
  readonly grants: readonly string[];
}

export interface CatalogEnum {
  readonly schema: string;
  readonly name: string;
  readonly owner: string;
  readonly kind: 'enum';
  /** In label order. */
  readonly labels: readonly string[];
}

export interface CatalogDomain {
  readonly schema: string;
  readonly name: string;
  readonly owner: string;
  readonly kind: 'domain';
  readonly baseType: string | null;
  readonly notNull: boolean;
  readonly constraints: readonly string[];
}

export type CatalogType = CatalogEnum | CatalogDomain;

export interface CatalogSequence {
  readonly schema: string;
  readonly name: string;
  readonly owner: string;
  readonly type: string;
  readonly start: string;
  readonly increment: string;
  readonly cycle: boolean;
  readonly ownedBy: string | null;
  readonly grants: readonly string[];
}

export interface CatalogFunction {
  readonly schema: string;
  /** `<name>(<identity arguments>)`. */
  readonly name: string;
  readonly kind: 'function' | 'procedure' | 'aggregate' | 'window';
  readonly returns: string | null;
  readonly language: string;
  readonly owner: string;
  readonly securityDefiner: boolean;
  readonly volatility: 'immutable' | 'stable' | 'volatile';
  readonly strict: boolean;
  readonly leakproof: boolean;
  readonly settings: readonly string[];
  /** The body is in the migrations; the catalog only has to notice that it changed. */
  readonly bodySha256: string;
  readonly grants: readonly string[];
}

export interface CatalogView {
  readonly schema: string;
  readonly name: string;
  readonly kind: 'view' | 'materialized view';
  readonly owner: string;
  readonly definition: string;
  readonly grants: readonly string[];
}

export interface DbCatalog {
  readonly roles: readonly CatalogRole[];
  readonly extensions: readonly string[];
  readonly schemas: readonly CatalogSchema[];
  readonly types: readonly CatalogType[];
  readonly sequences: readonly CatalogSequence[];
  readonly functions: readonly CatalogFunction[];
  readonly tables: readonly CatalogTable[];
  readonly views: readonly CatalogView[];
}

const text = (row: Row, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`catalog row has no text "${key}": ${JSON.stringify(row)}`);
  }
  return value;
};

const optionalText = (row: Row, key: string): string | null => {
  const value = row[key];
  return typeof value === 'string' ? value : null;
};

const flag = (row: Row, key: string): boolean => {
  const value = row[key];
  if (typeof value !== 'boolean') {
    throw new Error(`catalog row has no boolean "${key}": ${JSON.stringify(row)}`);
  }
  return value;
};

const list = (value: string | null): string[] =>
  value === null || value === '' ? [] : value.split(',').sort(compareText);

/** The key of the object a row belongs to. */
const objectKey = (row: Row, ...extra: readonly string[]): string =>
  [text(row, 'schema'), text(row, 'name'), ...extra.map((key) => text(row, key))].join('\u0000');

function groupBy(rows: readonly Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group === undefined) groups.set(key(row), [row]);
    else group.push(row);
  }
  return groups;
}

/** `<grantee>: <privileges>` per grantee, sorted; `*` marks a privilege held with grant option. */
function grantLines(rows: readonly Row[]): string[] {
  const lines: string[] = [];
  for (const [name, grants] of groupBy(rows, (row) => text(row, 'grantee'))) {
    const privileges = grants
      .map(
        (row) => `${text(row, 'privilege')}${flag(row, 'grantable') ? ' WITH GRANT OPTION' : ''}`,
      )
      .sort(compareText);
    lines.push(`${name}: ${privileges.join(', ')}`);
  }
  return lines.sort(compareText);
}

/** `<grantee>: <privilege> (<columns>)`, sorted. */
function columnGrantLines(rows: readonly Row[]): string[] {
  const lines: string[] = [];
  const key = (row: Row): string =>
    `${text(row, 'grantee')}: ${text(row, 'privilege')}${flag(row, 'grantable') ? ' WITH GRANT OPTION' : ''}`;
  for (const [grant, columns] of groupBy(rows, key)) {
    const names = columns.map((row) => text(row, 'column_name')).sort(compareText);
    lines.push(`${grant} (${names.join(', ')})`);
  }
  return lines.sort(compareText);
}

function columnLine(row: Row): string {
  const expression = optionalText(row, 'default_expression');
  const generated = text(row, 'generated') !== '';
  const identity = text(row, 'identity');
  return [
    text(row, 'column_name'),
    text(row, 'type'),
    ...(flag(row, 'not_null') ? ['NOT NULL'] : []),
    ...(identity === 'a' ? ['GENERATED ALWAYS AS IDENTITY'] : []),
    ...(identity === 'd' ? ['GENERATED BY DEFAULT AS IDENTITY'] : []),
    ...(expression === null
      ? []
      : [generated ? `GENERATED ALWAYS AS (${expression}) STORED` : `DEFAULT ${expression}`]),
  ].join(' ');
}

const POLICY_COMMANDS = {
  '*': 'ALL',
  r: 'SELECT',
  a: 'INSERT',
  w: 'UPDATE',
  d: 'DELETE',
} as const;

function policyOf(row: Row): CatalogPolicy {
  const command = POLICY_COMMANDS[text(row, 'command') as keyof typeof POLICY_COMMANDS] as
    CatalogPolicy['command'] | undefined;
  if (command === undefined) throw new Error(`unknown policy command: ${JSON.stringify(row)}`);
  return {
    name: text(row, 'policy_name'),
    command,
    permissive: flag(row, 'permissive'),
    roles: list(optionalText(row, 'roles')),
    using: optionalText(row, 'using_expression'),
    withCheck: optionalText(row, 'check_expression'),
  };
}

const VOLATILITY = { i: 'immutable', s: 'stable', v: 'volatile' } as const;
const FUNCTION_KINDS = { f: 'function', p: 'procedure', a: 'aggregate', w: 'window' } as const;
/** `pg_trigger.tgenabled` other than the default `O` (fires in origin and local mode). */
const TRIGGER_STATES: Readonly<Record<string, string>> = {
  D: ' [DISABLED]',
  R: ' [ENABLE REPLICA]',
  A: ' [ENABLE ALWAYS]',
};

const bySchemaAndName = (
  a: { readonly schema: string; readonly name: string },
  b: { readonly schema: string; readonly name: string },
): number => compareText(a.schema, b.schema) || compareText(a.name, b.name);

/**
 * The roles the catalog is about: every role it names as an owner, a grantee
 * or a policy role, and every role that is a member of one of those (a login
 * role reaches the tables through the role it is a member of). Other roles of
 * the cluster are not part of what the migrations and the role bootstrap build.
 */
function catalogRoles(rows: CatalogRows): Set<string> {
  const names = new Set<string>();
  for (const set of Object.values(rows)) {
    for (const row of set) {
      for (const key of ['owner', 'grantee'] as const) {
        const value = row[key];
        if (typeof value === 'string') names.add(value);
      }
      for (const role of list(optionalText(row, 'roles'))) names.add(role);
    }
  }
  names.delete('PUBLIC');
  for (let grew = true; grew;) {
    grew = false;
    for (const role of rows.roles) {
      const name = text(role, 'name');
      if (names.has(name)) continue;
      if (list(optionalText(role, 'member_of')).some((group) => names.has(group))) {
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
}

/**
 * Shape the query rows into the catalog. The result depends on the rows only,
 * not on their order.
 */
export function shapeCatalog(rows: CatalogRows): DbCatalog {
  const of = (query: CatalogQuery, key: string): Row[] =>
    rows[query].filter((row) => objectKey(row) === key);

  const referenced = catalogRoles(rows);
  const roles = rows.roles
    .filter((row) => referenced.has(text(row, 'name')))
    .map((row) => ({
      name: text(row, 'name'),
      login: flag(row, 'login'),
      superuser: flag(row, 'superuser'),
      bypassRls: flag(row, 'bypass_rls'),
      createDb: flag(row, 'create_db'),
      createRole: flag(row, 'create_role'),
      inherit: flag(row, 'inherit'),
      replication: flag(row, 'replication'),
      memberOf: list(optionalText(row, 'member_of')),
    }))
    .sort((a, b) => compareText(a.name, b.name));

  const schemas = rows.schemas
    .map((row) => ({
      name: text(row, 'name'),
      owner: text(row, 'owner'),
      grants: grantLines(rows.schemaGrants.filter((g) => text(g, 'name') === text(row, 'name'))),
    }))
    .sort((a, b) => compareText(a.name, b.name));

  const types = rows.types
    .map((row): CatalogType => {
      const key = objectKey(row);
      const base = {
        schema: text(row, 'schema'),
        name: text(row, 'name'),
        owner: text(row, 'owner'),
      };
      if (text(row, 'kind') === 'e') {
        return {
          ...base,
          kind: 'enum' as const,
          labels: of('enumLabels', key)
            .sort((a, b) => Number(a['position']) - Number(b['position']))
            .map((label) => text(label, 'label')),
        };
      }
      return {
        ...base,
        kind: 'domain' as const,
        baseType: optionalText(row, 'base_type'),
        notNull: flag(row, 'not_null'),
        constraints: of('domainConstraints', key)
          .map((con) => `${text(con, 'constraint_name')} ${text(con, 'definition')}`)
          .sort(compareText),
      };
    })
    .sort(bySchemaAndName);

  const sequences = rows.sequences
    .map((row): CatalogSequence => ({
      schema: text(row, 'schema'),
      name: text(row, 'name'),
      owner: text(row, 'owner'),
      type: text(row, 'type'),
      start: text(row, 'start'),
      increment: text(row, 'increment'),
      cycle: flag(row, 'cycle'),
      ownedBy: optionalText(row, 'owned_by'),
      grants: grantLines(of('sequenceGrants', objectKey(row))),
    }))
    .sort(bySchemaAndName);

  const functions = rows.functions
    .map((row): CatalogFunction => {
      const source = text(row, 'source');
      return {
        schema: text(row, 'schema'),
        name: `${text(row, 'name')}(${text(row, 'arguments')})`,
        kind: FUNCTION_KINDS[text(row, 'kind') as keyof typeof FUNCTION_KINDS],
        returns: optionalText(row, 'returns'),
        language: text(row, 'language'),
        owner: text(row, 'owner'),
        securityDefiner: flag(row, 'security_definer'),
        volatility: VOLATILITY[text(row, 'volatility') as keyof typeof VOLATILITY],
        strict: flag(row, 'strict'),
        leakproof: flag(row, 'leakproof'),
        settings:
          text(row, 'config') === '' ? [] : text(row, 'config').split('\n').sort(compareText),
        bodySha256: createHash('sha256').update(source).digest('hex'),
        grants: grantLines(
          rows.functionGrants.filter(
            (grant) => objectKey(grant, 'arguments') === objectKey(row, 'arguments'),
          ),
        ),
      };
    })
    .sort(bySchemaAndName);

  const tables = rows.tables
    .map((row): CatalogTable => {
      const key = objectKey(row);
      const partitionKey = optionalText(row, 'partition_key');
      return {
        schema: text(row, 'schema'),
        name: text(row, 'name'),
        kind: text(row, 'kind') === 'p' ? 'partitioned table' : 'table',
        owner: text(row, 'owner'),
        comment: optionalText(row, 'comment'),
        rowSecurity: { enabled: flag(row, 'rls_enabled'), forced: flag(row, 'rls_forced') },
        partition:
          partitionKey === null
            ? null
            : { key: partitionKey, default: optionalText(row, 'default_partition') },
        columns: of('columns', key)
          .sort((a, b) => Number(a['position']) - Number(b['position']))
          .map(columnLine),
        constraints: of('constraints', key)
          .map((con) => `${text(con, 'constraint_name')} ${text(con, 'definition')}`)
          .sort(compareText),
        indexes: of('indexes', key)
          .sort((a, b) => compareText(text(a, 'index_name'), text(b, 'index_name')))
          .map(
            (index) => `${text(index, 'definition')}${flag(index, 'valid') ? '' : ' [INVALID]'}`,
          ),
        policies: of('policies', key)
          .map(policyOf)
          .sort((a, b) => compareText(a.name, b.name)),
        triggers: of('triggers', key)
          .sort((a, b) => compareText(text(a, 'trigger_name'), text(b, 'trigger_name')))
          .map(
            (trigger) =>
              `${text(trigger, 'definition')}${TRIGGER_STATES[text(trigger, 'enabled')] ?? ''}`,
          ),
        grants: grantLines(of('tableGrants', key)),
        columnGrants: columnGrantLines(of('columnGrants', key)),
      };
    })
    .sort(bySchemaAndName);

  const views = rows.views
    .map((row): CatalogView => ({
      schema: text(row, 'schema'),
      name: text(row, 'name'),
      kind: text(row, 'kind') === 'm' ? 'materialized view' : 'view',
      owner: text(row, 'owner'),
      definition: text(row, 'definition'),
      grants: grantLines(of('viewGrants', objectKey(row))),
    }))
    .sort(bySchemaAndName);

  return {
    roles,
    extensions: rows.extensions.map((row) => text(row, 'name')).sort(compareText),
    schemas,
    types,
    sequences,
    functions,
    tables,
    views,
  };
}

/** Read the catalog of a database. */
export async function readDbCatalog(db: CatalogConnection): Promise<DbCatalog> {
  return shapeCatalog(await readCatalogRows(db));
}
