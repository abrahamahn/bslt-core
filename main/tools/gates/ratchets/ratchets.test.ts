// main/tools/gates/ratchets/ratchets.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../lib/paths';

import { readBudgets } from './ratchet';
import { RATCHETS, findRatchet, productionFiles } from './ratchets';

const SWALLOW = 'void save().catch(() => {});\n';
const BUILDER = "import { select } from '@bslt/db/builder';\nselect('users');\n";
const INTERVAL = 'setInterval(tick, 1000);\n';
const STYLE = 'export const A = () => <div style={{ color: "red" }} />;\n';
const SCHEMA = 'export const a = createSchema((data: unknown) => data);\n';

const TREE: Readonly<Record<string, string>> = {
  // Production code: counted.
  'main/apps/server/src/a.ts': SWALLOW + BUILDER + INTERVAL + SCHEMA,
  'main/modules/tasks/server/service.ts': BUILDER + INTERVAL,
  'main/apps/web/src/Page.tsx': SWALLOW + INTERVAL + STYLE,
  'main/modules/tasks/web/TasksPage.tsx': INTERVAL + STYLE,
  'main/kernel/react/src/Hook.tsx': STYLE,
  'main/modules/tasks/contract/b.ts': SCHEMA,
  'main/kernel/db/src/queue/store.ts': BUILDER,
  // Not production code: never counted.
  'main/apps/server/src/a.test.ts': SWALLOW + BUILDER + INTERVAL + SCHEMA,
  'main/modules/tasks/server/repository.real-db.test.ts': BUILDER + SWALLOW,
  'main/apps/server/src/__tests__/helper.ts': SWALLOW + INTERVAL,
  'main/kernel/db/src/testing/seed.ts': BUILDER + SWALLOW,
  'main/apps/server/dist/a.ts': SWALLOW + INTERVAL,
  'main/apps/server/node_modules/x/index.ts': SWALLOW + INTERVAL,
  'main/apps/web/src/Page.test.tsx': STYLE,
  'main/apps/server/src/types.d.ts': 'export declare const x: number;\n',
  // Outside the source roots.
  'main/tools/x.ts': SWALLOW + INTERVAL,
  'tests/e2e/y.ts': SWALLOW + INTERVAL,
  // Where the construct belongs.
  'main/kernel/db/src/repositories/users.ts': BUILDER,
  'main/modules/tasks/server/repository.ts': BUILDER,
  'main/kernel/db/src/builder/select.ts': "import { raw } from './types';\nraw('1');\n",
  'main/kernel/db/src/migrate/runner.ts': BUILDER,
  'main/kernel/ui/src/Box.tsx': STYLE,
  'main/kernel/schema/src/factory.ts': SCHEMA,
};

let root = '';

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bslt-ratchets-'));
  for (const [file, text] of Object.entries(TREE)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function filesOf(id: string): string[] {
  const ratchet = findRatchet(id);
  if (ratchet === undefined) throw new Error(`no ratchet ${id}`);
  return ratchet.count(root).map((site) => site.file);
}

describe('productionFiles', () => {
  it('lists the sources of the source roots, without tests, test helpers or build output', () => {
    expect(productionFiles(root)).toEqual([
      'main/apps/server/src/a.ts',
      'main/apps/web/src/Page.tsx',
      'main/kernel/db/src/builder/select.ts',
      'main/kernel/db/src/migrate/runner.ts',
      'main/kernel/db/src/queue/store.ts',
      'main/kernel/db/src/repositories/users.ts',
      'main/kernel/react/src/Hook.tsx',
      'main/kernel/schema/src/factory.ts',
      'main/kernel/ui/src/Box.tsx',
      'main/modules/tasks/contract/b.ts',
      'main/modules/tasks/server/repository.ts',
      'main/modules/tasks/server/service.ts',
      'main/modules/tasks/web/TasksPage.tsx',
    ]);
  });
});

describe('the ratchets', () => {
  it('swallowed-catch counts production code of every package', () => {
    expect(filesOf('swallowed-catch')).toEqual([
      'main/apps/server/src/a.ts',
      'main/apps/web/src/Page.tsx',
    ]);
  });

  it('raw-sql-outside-repos leaves out the repositories (including module server/repository.ts), the builder and the migration runner', () => {
    expect(filesOf('raw-sql-outside-repos')).toEqual([
      'main/apps/server/src/a.ts',
      'main/kernel/db/src/queue/store.ts',
      'main/modules/tasks/server/service.ts',
    ]);
  });

  it('setinterval counts server code only (including module server/): a browser has no scheduler to move a timer to', () => {
    expect(filesOf('setinterval')).toEqual([
      'main/apps/server/src/a.ts',
      'main/modules/tasks/server/service.ts',
    ]);
  });

  it('inline-style counts components outside @bslt/ui', () => {
    expect(filesOf('inline-style')).toEqual([
      'main/apps/web/src/Page.tsx',
      'main/kernel/react/src/Hook.tsx',
      'main/modules/tasks/web/TasksPage.tsx',
    ]);
  });

  it('opaque-schema leaves out the schema library', () => {
    expect(filesOf('opaque-schema')).toEqual([
      'main/apps/server/src/a.ts',
      'main/modules/tasks/contract/b.ts',
    ]);
  });

  it('have unique ids, and the committed budgets file has exactly one budget for each', () => {
    const ids = RATCHETS.map((ratchet) => ratchet.id);
    expect(ids).toEqual([
      'swallowed-catch',
      'raw-sql-outside-repos',
      'setinterval',
      'inline-style',
      'opaque-schema',
      'unused-exports',
    ]);
    expect(Object.keys(readBudgets(REPO_ROOT))).toEqual([...ids].sort());
  });
});
