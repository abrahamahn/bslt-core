// main/tools/lib/phase.test.ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { repoPath } from './paths';
import { CURRENT_PHASE } from './phase';

describe('CURRENT_PHASE', () => {
  it('is a phase of the plan (0 to 20)', () => {
    expect(Number.isInteger(CURRENT_PHASE)).toBe(true);
    expect(CURRENT_PHASE).toBeGreaterThanOrEqual(0);
    expect(CURRENT_PHASE).toBeLessThanOrEqual(20);
  });

  it('is the phase the restructure README reports as current, in one heading', () => {
    const readme = readFileSync(repoPath('docs/architecture/restructure/README.md'), 'utf8');
    const current = [...readme.matchAll(/^## Current status: Phase (\d+)\b/gmu)].map((match) =>
      Number(match[1]),
    );
    expect(current).toEqual([CURRENT_PHASE]);
  });
});
