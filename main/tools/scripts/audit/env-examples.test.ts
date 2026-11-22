// main/tools/scripts/audit/env-examples.test.ts
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '../../lib/paths';

import { run } from './env-examples';

const copies: string[] = [];

/** A copy of `config/env` whose production template went through `edit`. */
function envDirWithProduction(edit: (template: string) => string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-env-examples-'));
  copies.push(dir);
  cpSync(PATHS.envDir, dir, { recursive: true });
  const file = path.join(dir, '.env.production.example');
  writeFileSync(file, edit(readFileSync(file, 'utf8')));
  return dir;
}

afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('env-examples', () => {
  it('passes on the committed templates', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(run()).toMatchObject({ ok: true });
  });

  it.each(['DATABASE_URL', 'WORKER_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'LISTEN_DATABASE_URL'])(
    'fails when the production template loses %s',
    (key) => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const dir = envDirWithProduction((template) =>
        template.replace(new RegExp(`^${key}=.*\\n`, 'mu'), ''),
      );

      const result = run(dir);

      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).toContain(`must declare ${key}`);
    },
  );

  it('fails when the production template fills in a role URL', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = envDirWithProduction((template) =>
      template.replace(
        /^LISTEN_DATABASE_URL=$/mu,
        'LISTEN_DATABASE_URL=postgresql://bslt_worker:secret@postgres:5432/abe_prod',
      ),
    );

    const result = run(dir);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('must leave LISTEN_DATABASE_URL blank');
  });
});
