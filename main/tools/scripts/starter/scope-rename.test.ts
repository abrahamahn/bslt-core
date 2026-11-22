// main/tools/scripts/starter/scope-rename.test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyScopeRenamePlan,
  parseScopeRenameArgs,
  planScopeRename,
  renameScopeToken,
} from './scope-rename';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function writeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'scope-rename-'));
  tempRoots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return root;
}

function read(root: string, relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8');
}

describe('renameScopeToken — anchoring', () => {
  it('rewrites the scope only where it is a package prefix', () => {
    expect(renameScopeToken("from '@bslt/shared/core'", '@bslt', '@acme')).toBe(
      "from '@acme/shared/core'",
    );
    expect(renameScopeToken('"@bslt/core": "workspace:*"', '@bslt', '@acme')).toBe(
      '"@acme/core": "workspace:*"',
    );
    expect(renameScopeToken('--filter=@bslt/web', '@bslt', '@acme')).toBe('--filter=@acme/web');
    // Escaped slash inside a regex literal (e.g. an eslint boundary matcher).
    expect(renameScopeToken('/^@bslt\\/shared$/', '@bslt', '@acme')).toBe('/^@acme\\/shared$/');
  });

  it('leaves incidental "bslt" (product copy, URLs, cache keys) untouched', () => {
    expect(renameScopeToken('Welcome to BSLT', '@bslt', '@acme')).toBe('Welcome to BSLT');
    expect(renameScopeToken('github.com/abrahamahn/bslt-main', '@bslt', '@acme')).toBe(
      'github.com/abrahamahn/bslt-main',
    );
    expect(renameScopeToken('localStorage key bslt-device-id', '@bslt', '@acme')).toBe(
      'localStorage key bslt-device-id',
    );
    // A bare "@bslt" with no path delimiter is not a package reference.
    expect(renameScopeToken('the @bslt scope', '@bslt', '@acme')).toBe('the @bslt scope');
  });

  it('is idempotent', () => {
    const once = renameScopeToken("'@bslt/db/schema'", '@bslt', '@acme');
    expect(renameScopeToken(once, '@bslt', '@acme')).toBe(once);
    expect(once).toBe("'@acme/db/schema'");
  });
});

describe('planScopeRename / applyScopeRenamePlan', () => {
  const fixture = {
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'turbo.json': '{ "pipeline": {} }\n',
    'package.json': JSON.stringify(
      { name: 'root', scripts: { build: 'turbo run build --filter=@bslt/web' } },
      null,
      2,
    ),
    'packages/core/package.json': JSON.stringify(
      { name: '@bslt/core', dependencies: { '@bslt/shared': 'workspace:*' } },
      null,
      2,
    ),
    'packages/core/src/index.ts': "import { x } from '@bslt/shared/util';\nexport const y = x;\n",
    'tsconfig.json': JSON.stringify(
      { compilerOptions: { paths: { '@bslt/shared': ['packages/shared/src'] } } },
      null,
      2,
    ),
    // A doc + a URL that must survive untouched.
    'README.md': 'BSLT clone. See github.com/abrahamahn/bslt-main. Uses `@bslt/core`.\n',
    // Must be skipped even though it contains the token.
    'pnpm-lock.yaml': "'@bslt/core@workspace:*': {}\n",
    // Must be skipped: generated / vendored.
    'node_modules/dep/index.ts': "import '@bslt/core';\n",
  };

  it('plans edits across every scope-bearing surface and skips lockfile + node_modules', () => {
    const root = writeFixture(fixture);
    const plan = planScopeRename({ fromScope: '@bslt', toScope: '@acme', apply: false, root });

    const paths = plan.edits.map((e) => e.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('packages/core/package.json');
    expect(paths).toContain('packages/core/src/index.ts');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('README.md'); // the `@bslt/core` mention, not the URL
    expect(paths).not.toContain('pnpm-lock.yaml');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    // README has exactly one `@bslt/` token (the URL's "bslt-main" is not matched).
    expect(plan.edits.find((e) => e.path === 'README.md')?.occurrences).toBe(1);
  });

  it('applies the migration across all surfaces and preserves incidental bslt', () => {
    const root = writeFixture(fixture);
    const plan = planScopeRename({ fromScope: '@bslt', toScope: '@acme', apply: true, root });
    const result = applyScopeRenamePlan(plan, root);

    expect(result.filesPatched).toContain('packages/core/package.json');
    expect(read(root, 'packages/core/package.json')).toContain('"@acme/core"');
    expect(read(root, 'packages/core/package.json')).toContain('"@acme/shared"');
    expect(read(root, 'packages/core/src/index.ts')).toBe(
      "import { x } from '@acme/shared/util';\nexport const y = x;\n",
    );
    expect(read(root, 'tsconfig.json')).toContain('"@acme/shared"');
    expect(read(root, 'package.json')).toContain('--filter=@acme/web');

    // README: the package mention renamed, the URL + product name intact.
    const readme = read(root, 'README.md');
    expect(readme).toContain('`@acme/core`');
    expect(readme).toContain('github.com/abrahamahn/bslt-main');
    expect(readme).toContain('BSLT clone');

    // Skipped files are byte-for-byte unchanged.
    expect(read(root, 'pnpm-lock.yaml')).toBe(fixture['pnpm-lock.yaml']);
    expect(read(root, 'node_modules/dep/index.ts')).toBe(fixture['node_modules/dep/index.ts']);
  });

  it('is a no-op on a second apply (idempotent end to end)', () => {
    const root = writeFixture(fixture);
    applyScopeRenamePlan(
      planScopeRename({ fromScope: '@bslt', toScope: '@acme', apply: true, root }),
      root,
    );
    const second = applyScopeRenamePlan(
      planScopeRename({ fromScope: '@bslt', toScope: '@acme', apply: true, root }),
      root,
    );
    expect(second.filesPatched).toEqual([]);
  });
});

describe('parseScopeRenameArgs', () => {
  it('parses the target scope and flags', () => {
    expect(parseScopeRenameArgs(['@acme'])).toEqual({
      fromScope: '@bslt',
      toScope: '@acme',
      apply: false,
    });
    expect(parseScopeRenameArgs(['@acme', '--apply'])).toEqual({
      fromScope: '@bslt',
      toScope: '@acme',
      apply: true,
    });
    expect(parseScopeRenameArgs(['@acme', '--from', '@bslt'])).toEqual({
      fromScope: '@bslt',
      toScope: '@acme',
      apply: false,
    });
  });

  it('rejects a missing target, duplicate targets, and unknown flags', () => {
    expect(() => parseScopeRenameArgs([])).toThrow(/target scope/i);
    expect(() => parseScopeRenameArgs(['@a', '@b'])).toThrow(/one target/i);
    expect(() => parseScopeRenameArgs(['@acme', '--nope'])).toThrow(/unknown/i);
  });

  it('rejects an invalid scope at plan time', () => {
    const root = writeFixture({ 'x.ts': '' });
    expect(() =>
      planScopeRename({ fromScope: '@bslt', toScope: 'acme', apply: false, root }),
    ).toThrow(/scope/i);
    expect(() =>
      planScopeRename({ fromScope: '@bslt', toScope: '@bslt', apply: false, root }),
    ).toThrow(/differ/i);
  });
});
