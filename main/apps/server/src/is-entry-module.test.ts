// main/apps/server/src/is-entry-module.test.ts
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { isEntryModule } from './is-entry-module';

// Used only by the container entries `migrate.ts` and `bootstrap-roles.ts`.
describe('isEntryModule', () => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'bslt server entry 100% '));
  const here = fileURLToPath(import.meta.url);

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('is false without an entry path, or for one that does not exist', () => {
    expect(isEntryModule(import.meta.url, undefined)).toBe(false);
    expect(isEntryModule(import.meta.url, '')).toBe(false);
    expect(isEntryModule(import.meta.url, path.join(sandbox, 'missing.ts'))).toBe(false);
  });

  it('is false for another entry whose path contains this file name', () => {
    expect(isEntryModule(import.meta.url, `${here}.other.ts`)).toBe(false);
    expect(isEntryModule(import.meta.url, path.join(path.dirname(here), 'migrate.ts'))).toBe(false);
  });

  it('is true for the entry path itself and for a symlink to it in a percent-encoded directory', () => {
    expect(isEntryModule(import.meta.url, here)).toBe(true);
    const link = path.join(sandbox, 'entry link.ts');
    symlinkSync(here, link);
    expect(isEntryModule(import.meta.url, link)).toBe(true);
  });
});
