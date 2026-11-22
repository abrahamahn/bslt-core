// main/kernel/db/src/migrate/entry.test.ts
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ENTRY = path.join(__dirname, 'entry.ts');
const TSX = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

/** Run the entry as a process, the way the image's `migrate` one-shot does. */
function runEntry(env: Record<string, string>): {
  status: number | null;
  stderr: string;
} {
  const result = spawnSync(TSX, ['--conditions=source', ENTRY], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...env },
    timeout: 60_000,
  });
  return { status: result.status, stderr: result.stderr };
}

describe('the migrate entry of the image', () => {
  it('is not offered by the package exports: it is run by path, never imported', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { exports: Record<string, { default: string }> };

    const targets = Object.values(manifest.exports).map((target) => target.default);
    expect(targets.some((target) => target.includes('entry'))).toBe(false);
    expect(targets).toContain('./dist/migrate/index.js');
  });

  it('runs when started as a process, and exits 1 with the reason when it cannot migrate', () => {
    // Production without the owner connection: refused before any connection is opened.
    const result = runEntry({ NODE_ENV: 'production' });

    expect(result.stderr).toContain(
      'Migration failed: MIGRATION_DATABASE_URL is required in production',
    );
    expect(result.status).toBe(1);
  }, 90_000);
});
