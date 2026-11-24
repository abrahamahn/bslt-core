// main/tools/scripts/dev/doctor.test.ts
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from './doctor';

const tempDirs: string[] = [];

function createDoctorFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-doctor-'));
  tempDirs.push(root);

  const sql = '-- 0001_sys.sql\nSELECT 1;\n';
  mkdirSync(path.join(root, 'main/kernel/db/sql'), { recursive: true });
  mkdirSync(path.join(root, 'config/env'), { recursive: true });

  writeFileSync(
    path.join(root, 'bslt.config.ts'),
    "export default defineConfig({ name: 'Acme', installedModules: [] });\n",
  );
  writeFileSync(path.join(root, 'main/kernel/db/sql/0001_sys.sql'), sql);
  writeFileSync(
    path.join(root, 'bslt.lock.json'),
    JSON.stringify({
      migrations: {
        'kernel/0001_sys.sql': createHash('sha256').update(sql).digest('hex'),
      },
    }),
  );
  writeFileSync(
    path.join(root, 'config/env/.env.local'),
    [
      'NODE_ENV=development',
      `JWT_SECRET=${'a'.repeat(64)}`,
      `COOKIE_SECRET=${'b'.repeat(64)}`,
      'POSTGRES_HOST=127.0.0.1',
      'POSTGRES_PORT=5432',
    ].join('\n'),
  );

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('bslt doctor', () => {
  it('passes all checks on a healthy workspace fixture', async () => {
    const root = createDoctorFixture();
    const report = await runDoctor({
      root,
      nodeVersion: 'v24.10.0',
      env: {},
      checkTcp: async () => true,
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('fails on unsupported Node version, migration checksum drift, weak prod secrets, and unpaired OAuth', async () => {
    const root = createDoctorFixture();
    writeFileSync(path.join(root, 'main/kernel/db/sql/0001_sys.sql'), '-- tampered\n');

    const report = await runDoctor({
      root,
      nodeVersion: 'v20.11.0',
      env: {
        NODE_ENV: 'production',
        JWT_SECRET: 'dev-secret-change-in-production-32chars!',
        GOOGLE_CLIENT_ID: 'google-client-only',
        GOOGLE_CLIENT_SECRET: '',
      },
      checkTcp: async () => false,
    });

    expect(report.ok).toBe(false);
    const byId = new Map(report.checks.map((c) => [c.id, c]));
    expect(byId.get('node-version')?.status).toBe('fail');
    expect(byId.get('lockfile-migrations')?.status).toBe('fail');
    expect(byId.get('auth-secrets')?.status).toBe('fail');
    expect(byId.get('oauth-config')?.status).toBe('fail');
    expect(byId.get('postgres-tcp')?.status).toBe('warn');
  });
});
