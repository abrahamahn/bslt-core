// main/tools/lib/paths.test.ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PATHS,
  REAL_DB_TEST_SUFFIX,
  REPO_ROOT,
  SOURCE_ROOTS,
  repoPath,
  toRepoRelative,
} from './paths';

describe('REPO_ROOT', () => {
  it('is the workspace root, whatever the working directory', () => {
    expect(existsSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      name?: string;
    };
    expect(pkg.name).toBe('@bslt/root');
  });
});

describe('PATHS', () => {
  it.each(Object.entries(PATHS))('%s points at something that exists (%s)', (_name, target) => {
    expect(path.isAbsolute(target)).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('names the directories the tools read', () => {
    expect(toRepoRelative(PATHS.workflows)).toBe('.github/workflows');
    expect(toRepoRelative(PATHS.envDir)).toBe('config/env');
    expect(toRepoRelative(PATHS.integrationApi)).toBe('tests/integration/api');
    expect(statSync(PATHS.workflows).isDirectory()).toBe(true);
  });
});

describe('SOURCE_ROOTS', () => {
  it('lists the package source trees, repo-relative', () => {
    expect(SOURCE_ROOTS).toEqual(['main/apps', 'main/kernel', 'main/modules']);
    for (const root of SOURCE_ROOTS) expect(existsSync(repoPath(root))).toBe(true);
  });
});

describe('repoPath and toRepoRelative', () => {
  it('round-trip with forward slashes', () => {
    const file = repoPath('main', 'tools', 'lib', 'paths.ts');
    expect(file).toBe(path.join(REPO_ROOT, 'main/tools/lib/paths.ts'));
    expect(toRepoRelative(file)).toBe('main/tools/lib/paths.ts');
  });
});

describe('REAL_DB_TEST_SUFFIX', () => {
  it('is the suffix the real-DB suites carry', () => {
    expect(REAL_DB_TEST_SUFFIX).toBe('.real-db.test.ts');
  });
});
