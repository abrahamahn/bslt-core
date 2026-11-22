// main/tools/catalog/rls-structure.ts
/**
 * `describeRlsStructure`: the structural row-level security test, per table
 * (restructure plan 9.4, proof item 1).
 *
 * `pnpm bslt sync rows` generates the list of tables with what the committed
 * catalog says about each (class, owner column, commands per role, hand-written
 * policies) and one call of this function
 * (tests/integration/database/generated/rls.real-db.test.ts). For each table it
 * reads the catalog of the suite's database, built by the real migration
 * runner, and checks that:
 *
 * - row security is enabled and forced (the migrator's own `sys_migrations`,
 *   class `internal`, is the one table that is not);
 * - the policies and grants equal the template of the class (./rls.ts): the
 *   policies of a custom table are the listed ones;
 * - the class, the owner column and the commands are the generated ones.
 *
 * And once: the database has no table the generated list does not name.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { readDbCatalog } from './read';
import { describeTableRls, type TableRls } from './rls';

import type { CatalogConnection, CatalogTable } from './read';

/** One generated case: a table and what the catalog says about its row security. */
export interface RlsStructureCase extends TableRls {
  readonly table: string;
}

/** What the function needs of a `describeRealDb` suite. */
export interface RlsStructureSuite {
  readonly database: { readonly adminDb: CatalogConnection };
}

/**
 * Generate the structural tests.
 *
 * @param realDb - The handle of the surrounding `describeRealDb` suite.
 * @param cases - One case per table of the catalog.
 */
export function describeRlsStructure(
  realDb: RlsStructureSuite,
  cases: readonly RlsStructureCase[],
): void {
  let tables: Map<string, CatalogTable>;

  beforeAll(async () => {
    const catalog = await readDbCatalog(realDb.database.adminDb);
    tables = new Map(catalog.tables.map((table) => [table.name, table]));
  }, 60_000);

  const live = (name: string): CatalogTable => {
    const table = tables.get(name);
    if (table === undefined) throw new Error(`the database has no table ${name}`);
    return table;
  };

  it('the database has exactly the tables of the generated list', () => {
    expect([...tables.keys()].sort()).toEqual(cases.map((entry) => entry.table).sort());
  });

  describe.each(cases)('$table ($class)', ({ table, ...expected }) => {
    it('row security is enabled and forced', () => {
      // Forcing sys_migrations would bind the migrator that owns it.
      const forced = expected.class !== 'internal';
      expect(live(table).rowSecurity).toEqual({ enabled: forced, forced });
    });

    it('the policies and grants equal the template of the class', () => {
      expect(describeTableRls(live(table)).problems).toEqual([]);
    });

    it('the class, owner column and commands are the ones of the catalog', () => {
      expect(describeTableRls(live(table)).rls).toEqual(expected);
    });
  });
}
