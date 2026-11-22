// main/tools/sync/permissions.test.ts
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createOrgBitLookup,
  PERMISSION_LOCKFILE,
  run,
  syncPermissions,
  validatePermissionLockfile,
} from './permissions';

const tempDirs: string[] = [];

function createTempWorkspace(
  modulePermissions: Readonly<Record<string, readonly string[]>>,
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-permissions-'));
  tempDirs.push(root);

  const installedExports: string[] = [];
  const imports: string[] = [];
  for (const [id, perms] of Object.entries(modulePermissions)) {
    const modDir = path.join(root, 'main/modules', id);
    mkdirSync(modDir, { recursive: true });
    const exportName = `${id}Module`;
    installedExports.push(exportName);
    imports.push(`import { ${exportName} } from '@bslt/${id}/module';`);
    writeFileSync(
      path.join(modDir, 'module.ts'),
      `import { defineModule } from '@bslt/contract';
export const ${exportName} = defineModule({
  id: '${id}',
  summary: '${id} module',
  status: 'stable',
  dependsOn: [],
  permissions: ${JSON.stringify(perms)},
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});
`,
    );
  }

  writeFileSync(
    path.join(root, 'bslt.config.ts'),
    `import { defineConfig } from '@bslt/contract';
${imports.join('\n')}
export default defineConfig({
  name: 'BSLT',
  installedModules: [${installedExports.join(', ')}] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
  );

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('bslt sync permissions & lockfile gate', () => {
  it('fails check when bslt.lock.json is missing or malformed JSON', async () => {
    const root = createTempWorkspace({ orgs: ['orgs.members.invite'] });
    const missing = await run({ root });
    expect(missing.ok).toBe(false);
    expect(missing.problems?.some((p) => p.includes(PERMISSION_LOCKFILE))).toBe(true);

    writeFileSync(path.join(root, PERMISSION_LOCKFILE), '{invalid-json');
    const malformed = await run({ root });
    expect(malformed.ok).toBe(false);
  });

  it('rejects negative, non-integer, >= 63, duplicate, and non-contiguous permission bits', () => {
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': -1 },
        tombstoned: [],
      }),
    ).not.toEqual([]);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 1.5 },
        tombstoned: [],
      }),
    ).not.toEqual([]);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 63 },
        tombstoned: [],
      }),
    ).not.toEqual([]);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 0, 'orgs.b': 0 },
        tombstoned: [],
      }),
    ).not.toEqual([]);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 0, 'orgs.b': 2 },
        tombstoned: [],
      }),
    ).not.toEqual([]);
  });

  it('rejects reusing a tombstoned permission name or tombstoned bit index', async () => {
    const root = createTempWorkspace({ orgs: ['orgs.members.invite', 'orgs.legacy.action'] });
    writeFileSync(
      path.join(root, PERMISSION_LOCKFILE),
      JSON.stringify(
        {
          orgPermissionBits: { 'orgs.members.invite': 0 },
          tombstoned: [{ permission: 'orgs.legacy.action', bit: 1 }],
        },
        null,
        2,
      ),
    );

    await expect(syncPermissions({ root })).rejects.toThrow(/tombstoned/iu);

    const reusedBitProblems = validatePermissionLockfile({
      orgPermissionBits: { 'orgs.members.invite': 0, 'orgs.new.action': 1 },
      tombstoned: [{ permission: 'orgs.legacy.action', bit: 1 }],
    });
    expect(reusedBitProblems.some((p) => p.includes('1'))).toBe(true);
  });

  it('rejects reordering an existing permission bit or dropping one without tombstoning vs baseline', async () => {
    const root = createTempWorkspace({ orgs: ['orgs.a', 'orgs.b'] });
    const baseline = {
      orgPermissionBits: { 'orgs.a': 0, 'orgs.b': 1 },
      tombstoned: [],
    };
    writeFileSync(
      path.join(root, PERMISSION_LOCKFILE),
      `${JSON.stringify({ orgPermissionBits: { 'orgs.a': 1, 'orgs.b': 0 }, tombstoned: [] }, null, 2)}\n`,
    );

    const reordered = await run({ root, baselineLockfile: baseline });
    expect(reordered.ok).toBe(false);
    expect(reordered.problems?.some((p) => p.includes('orgs.a'))).toBe(true);

    const rootDropped = createTempWorkspace({ orgs: ['orgs.a'] });
    writeFileSync(
      path.join(rootDropped, PERMISSION_LOCKFILE),
      `${JSON.stringify({ orgPermissionBits: { 'orgs.a': 0 }, tombstoned: [] }, null, 2)}\n`,
    );
    const droppedWithoutTombstone = await run({ root: rootDropped, baselineLockfile: baseline });
    expect(droppedWithoutTombstone.ok).toBe(false);
    expect(droppedWithoutTombstone.problems?.some((p) => p.includes('orgs.b'))).toBe(true);
  });

  it('fails check when a module declares an unallocated permission, then allocates append-only and tombstones removed permissions without shifting bits', async () => {
    const root = createTempWorkspace({
      orgs: ['orgs.members.invite', 'orgs.members.remove'],
      billing: ['billing.manage'],
    });

    const synced1 = await syncPermissions({ root });
    expect(synced1.changed).toBe(true);
    expect((await run({ root })).ok).toBe(true);

    const lock1 = JSON.parse(readFileSync(path.join(root, PERMISSION_LOCKFILE), 'utf8')) as {
      orgPermissionBits: Record<string, number>;
      tombstoned: Array<{ permission: string; bit: number }>;
    };
    expect(lock1).toEqual({
      orgPermissionBits: {
        'orgs.members.invite': 0,
        'orgs.members.remove': 1,
        'billing.manage': 2,
      },
      tombstoned: [],
    });

    // Adding a new permission without syncing fails check
    writeFileSync(
      path.join(root, 'main/modules/orgs/module.ts'),
      readFileSync(path.join(root, 'main/modules/orgs/module.ts'), 'utf8').replace(
        '["orgs.members.invite","orgs.members.remove"]',
        '["orgs.members.invite","orgs.settings.update"]',
      ),
    );
    expect((await run({ root })).ok).toBe(false);

    // Syncing tombstones removed bit 1 and appends new permission at bit 3 (never shifts bit 2!)
    const synced2 = await syncPermissions({ root });
    expect(synced2.changed).toBe(true);
    expect((await run({ root, baselineLockfile: lock1 })).ok).toBe(true);

    const lock2 = JSON.parse(readFileSync(path.join(root, PERMISSION_LOCKFILE), 'utf8')) as {
      orgPermissionBits: Record<string, number>;
      tombstoned: Array<{ permission: string; bit: number }>;
    };
    expect(lock2).toEqual({
      orgPermissionBits: {
        'orgs.members.invite': 0,
        'billing.manage': 2,
        'orgs.settings.update': 3,
      },
      tombstoned: [{ permission: 'orgs.members.remove', bit: 1 }],
    });

    const lookup = createOrgBitLookup(lock2);
    expect(lookup('orgs.members.invite')).toBe(0);
    expect(lookup('billing.manage')).toBe(2);
    expect(lookup('orgs.settings.update')).toBe(3);
    expect(lookup('orgs.members.remove')).toBeUndefined();
    expect(lookup('unknown.perm')).toBeUndefined();
  });

  it('locks SQL migration SHA-256 checksums in bslt.lock.json and refuses edited or deleted migrations', async () => {
    const root = createTempWorkspace({ orgs: ['orgs.members.invite'] });
    const kernelSqlDir = path.join(root, 'main/kernel/db/sql');
    const orgsSqlDir = path.join(root, 'main/modules/orgs/server/migrations');
    mkdirSync(kernelSqlDir, { recursive: true });
    mkdirSync(orgsSqlDir, { recursive: true });
    writeFileSync(path.join(kernelSqlDir, '0001_sys.sql'), 'CREATE TABLE sys_jobs (id uuid);\n');
    writeFileSync(
      path.join(orgsSqlDir, '0001_orgs.sql'),
      'CREATE TABLE orgs_organizations (id uuid);\n',
    );

    const synced = await syncPermissions({ root });
    expect(synced.changed).toBe(true);
    expect(synced.lockfile.migrations).toBeDefined();
    expect(Object.keys(synced.lockfile.migrations ?? {})).toEqual([
      'kernel/0001_sys.sql',
      'orgs/0001_orgs.sql',
    ]);
    expect((await run({ root })).ok).toBe(true);

    // Editing an already-locked SQL file fails both syncPermissions and lockfile gate
    writeFileSync(
      path.join(orgsSqlDir, '0001_orgs.sql'),
      'CREATE TABLE orgs_organizations (id uuid, slug text);\n',
    );
    await expect(syncPermissions({ root })).rejects.toThrow(/orgs\/0001_orgs\.sql/u);
    const checkEdited = await run({ root });
    expect(checkEdited.ok).toBe(false);
    expect(checkEdited.problems?.some((p) => p.includes('orgs/0001_orgs.sql'))).toBe(true);

    // Restoring 0001_orgs.sql and adding a new 0002_orgs_slug.sql appends cleanly
    writeFileSync(
      path.join(orgsSqlDir, '0001_orgs.sql'),
      'CREATE TABLE orgs_organizations (id uuid);\n',
    );
    writeFileSync(
      path.join(orgsSqlDir, '0002_orgs_slug.sql'),
      'ALTER TABLE orgs_organizations ADD COLUMN slug text;\n',
    );
    expect((await run({ root })).ok).toBe(false); // unlocked new migration fails gate until synced
    await syncPermissions({ root });
    expect((await run({ root })).ok).toBe(true);
    expect(
      Object.keys(
        (
          JSON.parse(readFileSync(path.join(root, PERMISSION_LOCKFILE), 'utf8')) as {
            migrations: Record<string, string>;
          }
        ).migrations,
      ),
    ).toEqual(['kernel/0001_sys.sql', 'orgs/0001_orgs.sql', 'orgs/0002_orgs_slug.sql']);
  });
});
