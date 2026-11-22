// main/tools/lib/env-file.test.ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseActiveEnvAssignments } from './env-file';
import { repoPath } from './paths';

describe('parseActiveEnvAssignments', () => {
  it('parses active env assignments while ignoring commented hints', () => {
    const assignments = parseActiveEnvAssignments(
      [
        '# BILLING_PROVIDER=stripe',
        'AUTH_STRATEGIES=local  # starter default',
        'CAPTCHA_ENABLED=false  # options: true | false',
        'CACHE_PROVIDER="local"',
        'not an env assignment',
      ].join('\n'),
    );

    expect(assignments).toEqual([
      expect.objectContaining({ key: 'AUTH_STRATEGIES', line: 2, value: 'local' }),
      expect.objectContaining({ key: 'CAPTCHA_ENABLED', line: 3, value: 'false' }),
      expect.objectContaining({ key: 'CACHE_PROVIDER', line: 4, value: 'local' }),
    ]);
  });

  it('keeps a quoted value whole, including a hash inside the quotes', () => {
    expect(parseActiveEnvAssignments("SECRET='a # b'")).toEqual([
      { key: 'SECRET', line: 1, raw: "SECRET='a # b'", value: 'a # b' },
    ]);
  });

  it('is used by config/playwright.config.ts so inline env comments never poison E2E server boot', () => {
    const playwrightConfig = readFileSync(repoPath('config/playwright.config.ts'), 'utf8');
    expect(playwrightConfig).toContain('parseActiveEnvAssignments');
  });
});
