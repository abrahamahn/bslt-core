// main/tools/sync/docs.test.ts
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths';

import { GENERATED_REFERENCE_DOCS, GENERATED_WEB_DOCS_REFERENCE, run, syncDocs } from './docs';

const tempDirs: string[] = [];

function createScratchDocsRoot(): string {
  const scratch = mkdtempSync(path.join(tmpdir(), 'bslt-sync-docs-'));
  tempDirs.push(scratch);

  // Copy the committed inputs syncDocs reads so tests stay fast and isolated
  const copyRel = (rel: string): void => {
    const src = path.join(REPO_ROOT, rel);
    const dst = path.join(scratch, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
  };

  copyRel('bslt.config.ts');
  copyRel('config/.prettierrc');
  copyRel('main/tools/snapshots/api-surface.json');
  copyRel('main/tools/snapshots/web-routes.json');
  copyRel('main/kernel/db/catalog.snapshot.json');
  copyRel('main/kernel/server/src/cron/kernel-crons.ts');
  copyRel('main/modules');
  mkdirSync(path.join(scratch, 'docs/reference'), { recursive: true });
  writeFileSync(path.join(scratch, 'docs/reference/openapi.json'), '{}\n', 'utf8');
  writeFileSync(
    path.join(scratch, 'docs/DIRECTION.md'),
    [
      '# Dev Direction',
      '',
      '<!-- bslt:generated status -->',
      'stale',
      '<!-- /bslt:generated -->',
      '',
      'Hand-written prose stays untouched.',
      '',
    ].join('\n'),
    'utf8',
  );
  return scratch;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('bslt sync docs & generated-docs gate', () => {
  it('fails when reference docs are missing, drifted, or an orphan file exists in docs/reference/', async () => {
    const root = createScratchDocsRoot();

    // Missing reference docs -> fails
    const missing = await run({ root });
    expect(missing.ok).toBe(false);
    expect(missing.problems?.length).toBeGreaterThanOrEqual(GENERATED_REFERENCE_DOCS.length);

    // Sync writes all 5 reference docs and updates docs/DIRECTION.md status block
    const synced = await syncDocs({ root });
    expect(synced.changed).toBe(true);
    expect((await run({ root })).ok).toBe(true);

    const direction = readFileSync(path.join(root, 'docs/DIRECTION.md'), 'utf8');
    expect(direction).toContain('Hand-written prose stays untouched.');
    expect(direction).toContain('`identity`');
    expect(direction).toContain('`compliance`');

    // Hand-editing a generated reference doc or web docs reference fails check
    writeFileSync(path.join(root, 'docs/reference/module-dag.md'), '# Tampered\n', 'utf8');
    writeFileSync(path.join(root, GENERATED_WEB_DOCS_REFERENCE), '// tampered\n', 'utf8');
    const drifted = await run({ root });
    expect(drifted.ok).toBe(false);
    expect(drifted.problems).toContain('docs/reference/module-dag.md');
    expect(drifted.problems).toContain(GENERATED_WEB_DOCS_REFERENCE);

    // Sync restores module-dag.md
    await syncDocs({ root });
    expect((await run({ root })).ok).toBe(true);

    // Adding an orphan file in docs/reference/ fails check, and syncDocs removes it
    writeFileSync(path.join(root, 'docs/reference/orphan-notes.md'), '# Orphan\n', 'utf8');
    const withOrphan = await run({ root });
    expect(withOrphan.ok).toBe(false);
    expect(withOrphan.problems?.some((p) => p.includes('orphan-notes.md'))).toBe(true);

    await syncDocs({ root });
    expect((await run({ root })).ok).toBe(true);
  }, 30_000);

  it('attributes every HTTP route, DB table, event, job, cron entry, and web route to a module or kernel', async () => {
    const root = createScratchDocsRoot();
    await syncDocs({ root });

    const apiDoc = readFileSync(path.join(root, 'docs/reference/api.md'), 'utf8');
    const dbDoc = readFileSync(path.join(root, 'docs/reference/database.md'), 'utf8');
    const ejcDoc = readFileSync(path.join(root, 'docs/reference/events-jobs-cron.md'), 'utf8');
    const webDoc = readFileSync(path.join(root, 'docs/reference/web-routes.md'), 'utf8');
    const dagDoc = readFileSync(path.join(root, 'docs/reference/module-dag.md'), 'utf8');
    const webRefTs = readFileSync(path.join(root, GENERATED_WEB_DOCS_REFERENCE), 'utf8');

    expect(apiDoc).toContain('`kernel`');
    expect(apiDoc).toContain('`identity`');
    expect(dbDoc).toContain('`sys_jobs`');
    expect(dbDoc).toContain('`identity_users`');
    expect(ejcDoc).toContain('`sys.outbox.retention`');
    expect(ejcDoc).toContain('`identity.user.registered`');
    expect(webDoc).toContain('`/dashboard`');
    expect(webDoc).toContain('`/terms`');
    expect(dagDoc).toContain('flowchart TD');
    expect(webRefTs).toContain('export const DOCS_REFERENCE');
    expect(webRefTs).toContain('/api/auth/login');
    expect(webRefTs).toContain('identity_users');
    expect(webRefTs).toContain('sys.outbox.retention');
  }, 30_000);
});
