// main/tools/scripts/git-environment.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitEnvironment } from './git-environment';

describe('Git repository environment isolation', () => {
  it('keeps authentication and normal environment settings while removing repository overrides', () => {
    const env = {
      ...process.env,
      GIT_DIR: '/source/.git',
      GIT_WORK_TREE: '/source',
      GIT_INDEX_FILE: '/source/index',
      GIT_SSH_COMMAND: 'ssh -i release-key',
      GH_TOKEN: 'test-only',
      NODE_ENV: 'test',
    };
    const isolated = gitEnvironment(env);
    expect(isolated['GIT_DIR']).toBeUndefined();
    expect(isolated['GIT_WORK_TREE']).toBeUndefined();
    expect(isolated['GIT_INDEX_FILE']).toBeUndefined();
    expect(isolated['GIT_SSH_COMMAND']).toBe(env.GIT_SSH_COMMAND);
    expect(isolated['GH_TOKEN']).toBe(env.GH_TOKEN);
    expect(env.GIT_DIR).toBe('/source/.git');
  });

  it('initializes a foreign bare repository without changing the caller repository', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'bslt-git-env-'));
    try {
      const source = path.join(root, 'source');
      const target = path.join(root, 'destination.git');
      const clean = gitEnvironment();
      execFileSync('git', ['init', '-q', source], { env: clean });
      const hookEnv = { ...process.env, GIT_DIR: path.join(source, '.git'), GIT_WORK_TREE: source };
      execFileSync('git', ['init', '-q', '--bare', target], { env: gitEnvironment(hookEnv) });
      expect(
        execFileSync('git', ['config', '--get', 'core.bare'], {
          cwd: source,
          env: clean,
          encoding: 'utf8',
        }).trim(),
      ).toBe('false');
      expect(
        execFileSync('git', ['config', '--get', 'core.bare'], {
          cwd: target,
          env: clean,
          encoding: 'utf8',
        }).trim(),
      ).toBe('true');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
