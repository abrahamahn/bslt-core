// main/tools/sync/rows.ts
/**
 * `bslt sync rows`: the row types, column maps and table lists of `@bslt/db`,
 * and the structural row-level security test, generated from the committed
 * database catalog (restructure plan, sections 9.4, 9.5 and 14.2).
 *
 * Rung 3 of the derivation ladder: the catalog is SQL read back from a
 * database, so what TypeScript needs to know about it crosses a language
 * boundary and is a committed generated file. It needs no database.
 *
 * | Output                                                     | Holds                                   |
 * | ---------------------------------------------------------- | --------------------------------------- |
 * | `main/kernel/db/src/generated/rows.ts`                     | rows of the kernel's tables             |
 * | `main/kernel/db/src/generated/tables.ts`                   | the tables of every source              |
 * | `main/modules/<id>/server/generated/rows.ts`               | rows of each module's tables            |
 * | `tests/integration/database/generated/rls.real-db.test.ts` | one structural RLS case per table       |
 *
 * The anti-magic rules (plan 14.2): the files are committed, sorted and
 * deterministic; each starts with a header that names this command; each
 * derived line carries `// <- <key>` into the catalog; the generator emits
 * constants, types and one delegating call, never logic. The `generated-rows`
 * gate regenerates in memory and fails on a stale file and on a file in a
 * generated directory that the command did not produce.
 *
 * The fixed type map: uuid is `string`, timestamptz is `Date`, bigint is
 * `bigint`, numeric is `string`, jsonb is `JsonValue`, an enum and a text
 * column with an `= ANY (ARRAY[...])` CHECK are unions of their labels. (The
 * plan's branded `Id<'<table>'>` comes with each module's own `rows.ts`: the
 * hand types these files replace use plain strings in every signature.)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { snakeToCamel } from '@bslt/contract';

import { KERNEL_SOURCE } from '../catalog/audit';
import { DB_CATALOG, loadCatalog } from '../catalog/file';
import { describeTableRls } from '../catalog/rls';
import { fail, pass, type CheckResult } from '../gates/types';
import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';

import type { Attributed, AttributedCatalog } from '../catalog/attribute';
import type { CatalogEnum, CatalogTable } from '../catalog/read';

/** The command that writes the files. */
export const SYNC_ROWS_COMMAND = 'pnpm bslt sync rows';

/** Directories that hold only files this command writes (repository-relative). */
export const GENERATED_ROWS_DIRECTORIES = [
  'main/kernel/db/src/generated',
  'tests/integration/database/generated',
] as const;

const KERNEL_ROWS = 'main/kernel/db/src/generated/rows.ts';
const TABLES_FILE = 'main/kernel/db/src/generated/tables.ts';
const RLS_TEST = 'tests/integration/database/generated/rls.real-db.test.ts';

/** Where the rows of a source are written. */
export function rowsFileOf(source: string): string {
  if (source === KERNEL_SOURCE) return KERNEL_ROWS;
  return `main/modules/${source}/server/generated/rows.ts`;
}

// ============================================================================
// The model: what the catalog says about a table, in TypeScript terms
// ============================================================================

export interface RowColumn {
  /** The column name in the database. */
  readonly column: string;
  /** The property name in a row object. */
  readonly property: string;
  /** The catalog line of the column, without its name. */
  readonly definition: string;
  /** The TypeScript type, `| null` included. */
  readonly type: string;
  /** Whether an INSERT may leave it out: it has a default or is nullable. */
  readonly optionalOnInsert: boolean;
  /** A generated column: read, never written. */
  readonly generated: boolean;
  /** `<table>.<column>` a single-column foreign key points at, if any. */
  readonly references: string | null;
  /** The enum type the column has, if any. */
  readonly enumName: string | null;
}

export interface RowTable {
  readonly table: string;
  readonly source: string;
  /** `Users` for `users`: the stem of the generated names. */
  readonly typeName: string;
  /** `USERS` for `users`. */
  readonly constantName: string;
  readonly columns: readonly RowColumn[];
}

const pascal = (name: string): string => {
  const camel = snakeToCamel(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
};

/** The name of the union type generated for an enum. */
export const enumTypeName = (name: string): string => `${pascal(name)}Enum`;

const literal = (value: string): string =>
  `'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`;

const BASE_TYPES: Readonly<Record<string, string>> = {
  uuid: 'string',
  text: 'string',
  boolean: 'boolean',
  smallint: 'number',
  integer: 'number',
  real: 'number',
  'double precision': 'number',
  bigint: 'bigint',
  numeric: 'string',
  jsonb: 'JsonValue',
  json: 'JsonValue',
  date: 'Date',
  'timestamp with time zone': 'Date',
  'timestamp without time zone': 'Date',
  bytea: 'Uint8Array',
};

/**
 * The TypeScript type of a database type.
 *
 * @throws {Error} For a type the map does not know: add it to the map on
 *   purpose instead of typing a column `unknown`.
 */
export function typeOf(databaseType: string, enums: ReadonlyMap<string, CatalogEnum>): string {
  if (databaseType.endsWith('[]')) {
    const element = typeOf(databaseType.slice(0, -2), enums);
    return element.includes(' ') ? `Array<${element}>` : `${element}[]`;
  }
  const withoutLength = databaseType.replace(/\(\d+(?:,\d+)?\)$/u, '');
  if (withoutLength === 'character varying' || withoutLength === 'character') return 'string';
  if (withoutLength === 'numeric') return 'string';
  const base = BASE_TYPES[databaseType];
  if (base !== undefined) return base;
  if (enums.has(databaseType)) return enumTypeName(databaseType);
  throw new Error(
    `bslt sync rows: no TypeScript type for the database type "${databaseType}"; add it to BASE_TYPES in main/tools/sync/rows.ts`,
  );
}

interface ParsedColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  readonly generated: boolean;
  readonly definition: string;
}

/** Take a column line of the catalog (`<name> <type> [NOT NULL] [DEFAULT ...]`) apart. */
export function parseColumnLine(line: string): ParsedColumn {
  const space = line.indexOf(' ');
  const name = line.slice(0, space);
  const definition = line.slice(space + 1);
  const tail = / (?:DEFAULT|GENERATED) /u.exec(definition);
  const beforeTail = tail === null ? definition : definition.slice(0, tail.index);
  const notNull = beforeTail.endsWith(' NOT NULL');
  return {
    name,
    type: notNull ? beforeTail.slice(0, -' NOT NULL'.length) : beforeTail,
    notNull,
    hasDefault: tail !== null,
    generated: / GENERATED ALWAYS AS \(/u.test(definition),
    definition,
  };
}

/** The labels of `CHECK ((<column> = ANY (ARRAY['a'::text, ...])))`, per column. */
function checkUnions(table: CatalogTable): Map<string, string[]> {
  const unions = new Map<string, string[]>();
  for (const constraint of table.constraints) {
    const match = /^\S+ CHECK \(\(([a-z_][a-z0-9_]*) = ANY \(ARRAY\[(.+)\]\)\)\)$/u.exec(
      constraint,
    );
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const labels = match[2].split(', ').map((item) => /^'((?:[^']|'')*)'::text$/u.exec(item)?.[1]);
    if (labels.every((label): label is string => label !== undefined)) {
      unions.set(
        match[1],
        labels.map((label) => label.replace(/''/gu, "'")),
      );
    }
  }
  return unions;
}

/** `<table>.<column>` per column with a single-column foreign key. */
function foreignKeys(table: CatalogTable): Map<string, string> {
  const keys = new Map<string, string>();
  for (const constraint of table.constraints) {
    const match =
      /^\S+ FOREIGN KEY \(([a-z_][a-z0-9_]*)\) REFERENCES ((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\(([a-z_][a-z0-9_]*)\)/u.exec(
        constraint,
      );
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      keys.set(match[1], `${match[2]}.${match[3]}`);
    }
  }
  return keys;
}

/** The tables of the catalog in TypeScript terms, sorted by name. */
export function rowTables(catalog: AttributedCatalog): RowTable[] {
  const enums = new Map(
    catalog.types
      .filter((type): type is Attributed<CatalogEnum> => type.kind === 'enum')
      .map((type) => [type.name, type]),
  );
  return [...catalog.tables]
    .sort((left, right) => compareText(left.name, right.name))
    .map((table) => {
      const unions = checkUnions(table);
      const keys = foreignKeys(table);
      return {
        table: table.name,
        source: table.source,
        typeName: pascal(table.name),
        constantName: table.name.toUpperCase(),
        columns: table.columns.map((line): RowColumn => {
          const parsed = parseColumnLine(line);
          const union = parsed.type === 'text' ? unions.get(parsed.name) : undefined;
          const base =
            union === undefined ? typeOf(parsed.type, enums) : union.map(literal).join(' | ');
          return {
            column: parsed.name,
            property: snakeToCamel(parsed.name),
            definition: parsed.definition,
            type: parsed.notNull ? base : `${base} | null`,
            optionalOnInsert: parsed.hasDefault || !parsed.notNull,
            generated: parsed.generated,
            references: keys.get(parsed.name) ?? null,
            enumName: enums.has(parsed.type.replace(/\[\]$/u, ''))
              ? parsed.type.replace(/\[\]$/u, '')
              : null,
          };
        }),
      };
    });
}

// ============================================================================
// Emitting
// ============================================================================

const CATALOG_NAME = path.posix.basename(DB_CATALOG.file);

function header(file: string, what: string): string[] {
  return [
    `// ${file}`,
    `// @generated by \`${SYNC_ROWS_COMMAND}\` from ${DB_CATALOG.file} (${what}). Do not edit.`,
    `// Each \`<-\` names the key of ${CATALOG_NAME} a line is derived from.`,
  ];
}

/** Relative import specifier from one generated file to another. */
function importPath(from: string, to: string): string {
  const relative = path.posix.relative(path.posix.dirname(from), to).replace(/\.ts$/u, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** The rows file of one source. */
export function emitRowsFile(catalog: AttributedCatalog, source: string): string {
  const file = rowsFileOf(source);
  const isModuleFile = file.startsWith('main/modules/');
  const tables = rowTables(catalog).filter((table) => table.source === source);
  const enums = catalog.types
    .filter((type): type is Attributed<CatalogEnum> => type.kind === 'enum')
    .sort((left, right) => compareText(left.name, right.name));
  const ownEnums = enums.filter((type) => type.source === source);
  const enumByName = new Map(enums.map((type) => [type.name, type]));
  const enumSources = new Map(enums.map((type) => [type.name, type.source]));

  // Enums of other sources that a column of this source has.
  const foreignEnums = new Map<string, string[]>();
  const foreignEnumTypes = new Set<string>();
  for (const table of tables) {
    for (const column of table.columns) {
      const owner = column.enumName === null ? undefined : enumSources.get(column.enumName);
      if (column.enumName === null || owner === undefined || owner === source) continue;
      foreignEnumTypes.add(column.enumName);
      const names = foreignEnums.get(owner) ?? [];
      if (!names.includes(enumTypeName(column.enumName))) names.push(enumTypeName(column.enumName));
      foreignEnums.set(owner, names);
    }
  }
  const usesJson = tables.some((table) =>
    table.columns.some((column) => /\bJsonValue\b/u.test(column.type)),
  );

  const lines = [...header(file, `source "${source}"`), ''];
  if (isModuleFile) {
    const localPreludes: string[] = [];
    if (usesJson) {
      localPreludes.push(
        'type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };',
      );
    }
    for (const enumName of [...foreignEnumTypes].sort(compareText)) {
      const enumDef = enumByName.get(enumName);
      if (enumDef !== undefined) {
        localPreludes.push(
          `type ${enumTypeName(enumDef.name)} = ${enumDef.labels.map(literal).join(' | ')}; // <- types.${enumDef.name}`,
        );
      }
    }
    if (localPreludes.length > 0) lines.push(...localPreludes, '');
  } else {
    const imports: string[] = [];
    if (usesJson) {
      imports.push(
        `import type { JsonValue } from '${importPath(file, 'main/kernel/db/src/json.ts')}';`,
      );
    }
    for (const owner of [...foreignEnums.keys()].sort(compareText)) {
      const names = (foreignEnums.get(owner) ?? []).sort(compareText).join(', ');
      imports.push(`import type { ${names} } from '${importPath(file, rowsFileOf(owner))}';`);
    }
    if (imports.length > 0) lines.push(...imports, '');
  }

  for (const type of ownEnums) {
    lines.push(
      `export type ${enumTypeName(type.name)} = ${type.labels.map(literal).join(' | ')}; // <- types.${type.name}`,
      '',
    );
  }

  for (const table of tables) {
    const { typeName, constantName } = table;
    lines.push(
      `export const ${constantName}_TABLE = ${literal(table.table)}; // <- tables.${table.table}`,
      '',
      `/** A row of \`${table.table}\`. */`,
      `export interface ${typeName}Row {`,
    );
    for (const column of table.columns) {
      const target = column.references === null ? '' : ` -> ${column.references}`;
      lines.push(
        `  ${column.property}: ${column.type}; // <- tables.${table.table}.columns: ${column.column} ${column.definition}${target}`,
      );
    }
    lines.push(
      '}',
      '',
      `/** What an INSERT into \`${table.table}\` takes: a column with a default, or a nullable one, is optional. */`,
      `export interface ${typeName}Insert {`,
    );
    for (const column of table.columns.filter((entry) => !entry.generated)) {
      lines.push(
        `  ${column.property}${column.optionalOnInsert ? '?' : ''}: ${column.type}; // <- tables.${table.table}.columns: ${column.column}`,
      );
    }
    lines.push(
      '}',
      '',
      `/** What an UPDATE of \`${table.table}\` may set. */`,
      `export interface ${typeName}Update {`,
    );
    for (const column of table.columns.filter((entry) => !entry.generated)) {
      lines.push(
        `  ${column.property}?: ${column.type}; // <- tables.${table.table}.columns: ${column.column}`,
      );
    }
    lines.push(
      '}',
      '',
      `/** Property name to column name, for every column of \`${table.table}\`. */`,
      `export const ${constantName}_COLUMNS = {`,
    );
    for (const column of table.columns) {
      lines.push(
        `  ${column.property}: ${literal(column.column)}, // <- tables.${table.table}.columns: ${column.column}`,
      );
    }
    lines.push('} as const;', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** The table list: every table of every source. */
export function emitTablesFile(catalog: AttributedCatalog): string {
  const tables = rowTables(catalog);
  const lines = [
    ...header(TABLES_FILE, 'every source'),
    '',
    '/** The tables each migration source creates, sources in apply order, tables sorted. */',
    'export const TABLES_BY_SOURCE = {',
  ];
  for (const source of catalog.sources) {
    const names = tables.filter((table) => table.source === source.id).map((table) => table.table);
    lines.push(`  ${source.id}: [${names.map(literal).join(', ')}], // <- sources.${source.id}`);
  }
  lines.push(
    '} as const;',
    '',
    '/** Every table the migration sources create, sorted. */',
    'export const TABLES = [',
    ...tables.map(
      (table) => `  ${literal(table.table)}, // <- tables.${table.table} (${table.source})`,
    ),
    '] as const;',
    '',
    '/** The name of a table of the catalog. */',
    'export type TableName = (typeof TABLES)[number];',
  );
  return `${lines.join('\n')}\n`;
}

const list = (values: readonly string[]): string => `[${values.map(literal).join(', ')}]`;

/** The structural row-level security test: one case per table. */
export function emitRlsTest(catalog: AttributedCatalog): string {
  const lines = [
    ...header(RLS_TEST, 'the row-level security of every table'),
    '',
    "import { describeRealDb } from '@bslt/testing/real-db';",
    "import { describeRlsStructure } from '@bslt/tools/catalog/rls-structure';",
    '',
    '/**',
    ' * Per table: row security is forced, the policies and grants equal the template',
    ' * of its class (the hand-written policies of a custom table are listed), and',
    ' * the class, owner column and commands are the ones below (restructure plan',
    ' * 9.4, proof item 1). The checks are in main/tools/catalog/rls-structure.ts.',
    ' */',
    "describeRealDb('Row-level security structure, per table (Real DB)', (realDb) => {",
    '  describeRlsStructure(realDb, [',
  ];
  for (const table of [...catalog.tables].sort((left, right) =>
    compareText(left.name, right.name),
  )) {
    const { rls } = describeTableRls(table);
    if (rls === null) {
      throw new Error(
        `bslt sync rows: table ${table.name} has no row-level security class; \`pnpm bslt db audit\` says what is wrong`,
      );
    }
    lines.push(
      '    {',
      `      table: ${literal(table.name)}, // <- tables.${table.name} (${table.source})`,
      `      class: ${literal(rls.class)},`,
      `      ownerColumn: ${rls.ownerColumn === null ? 'null' : literal(rls.ownerColumn)},`,
      `      user: ${list(rls.user)},`,
      `      admin: ${list(rls.admin)},`,
      `      system: ${list(rls.system)},`,
      `      custom: ${list(rls.custom)},`,
      `      definerRead: ${list(rls.definerRead)},`,
      `      audience: ${String(rls.audience)},`,
      '    },',
    );
  }
  lines.push('  ]);', '});');
  return `${lines.join('\n')}\n`;
}

/** Every file the command writes, by repository-relative path, unformatted. */
export function emitRows(catalog: AttributedCatalog): Map<string, string> {
  const files = new Map<string, string>();
  const withTables = new Set(catalog.tables.map((table) => table.source));
  for (const source of catalog.sources) {
    if (withTables.has(source.id))
      files.set(rowsFileOf(source.id), emitRowsFile(catalog, source.id));
  }
  files.set(TABLES_FILE, emitTablesFile(catalog));
  files.set(RLS_TEST, emitRlsTest(catalog));
  return files;
}

// ============================================================================
// The command and the gate
// ============================================================================

/** Format the way the `format` gate checks: Prettier with the repository's configuration. */
async function formatted(
  files: ReadonlyMap<string, string>,
  root: string,
): Promise<Map<string, string>> {
  const prettier = await import('prettier');
  const config = await prettier.resolveConfig(path.join(root, 'main/tools/sync/rows.ts'), {
    config: path.join(root, 'config/.prettierrc'),
  });
  const result = new Map<string, string>();
  for (const [file, content] of files) {
    result.set(
      file,
      await prettier.format(content, { ...config, filepath: path.join(root, file) }),
    );
  }
  return result;
}

/** Every file under the generated directories, repository-relative. */
function existingFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    const absolute = path.join(root, directory);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else found.push(child);
    }
  };
  for (const directory of GENERATED_ROWS_DIRECTORIES) walk(directory);
  const modulesRoot = path.join(root, 'main/modules');
  if (existsSync(modulesRoot)) {
    for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`main/modules/${entry.name}/server/generated`);
      }
    }
  }
  return found.sort(compareText);
}

export interface SyncRowsOptions {
  readonly check?: boolean;
  readonly root?: string;
  /** Default: the committed catalog. */
  readonly catalog?: AttributedCatalog;
}

export interface SyncRowsResult {
  /** Files whose content is not what the command generates (written, unless `check`). */
  readonly stale: readonly string[];
  /** Files in a generated directory that the command does not produce (deleted, unless `check`). */
  readonly orphans: readonly string[];
  readonly total: number;
}

/** Generate the files; with `check` compare and change nothing. */
export async function syncRows(options: SyncRowsOptions = {}): Promise<SyncRowsResult> {
  const root = options.root ?? REPO_ROOT;
  const files = await formatted(emitRows(options.catalog ?? loadCatalog(root)), root);
  const stale: string[] = [];
  for (const [file, content] of files) {
    const absolute = path.join(root, file);
    if (existsSync(absolute) && readFileSync(absolute, 'utf8') === content) continue;
    stale.push(file);
    if (options.check !== true) {
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
  }
  const orphans = existingFiles(root).filter((file) => !files.has(file));
  if (options.check !== true) {
    for (const orphan of orphans) rmSync(path.join(root, orphan));
  }
  return { stale: stale.sort(compareText), orphans, total: files.size };
}

/** The `generated-rows` gate: the generated files are what the catalog gives now. */
export async function run(options: { readonly root?: string } = {}): Promise<CheckResult> {
  const { stale, orphans, total } = await syncRows({ ...options, check: true });
  if (stale.length === 0 && orphans.length === 0) {
    return pass(`${String(total)} files generated from ${DB_CATALOG.file} are up to date`);
  }
  return fail('the files generated from the database catalog are stale', [
    ...stale.map((file) => `${file}: not what \`${SYNC_ROWS_COMMAND}\` generates`),
    ...orphans.map(
      (file) => `${file}: in a generated directory, but no command produces it (delete it)`,
    ),
    `Run \`${SYNC_ROWS_COMMAND}\` and commit the result; never edit a generated file.`,
  ]);
}
