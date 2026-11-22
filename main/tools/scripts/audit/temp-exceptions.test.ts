// main/tools/scripts/audit/temp-exceptions.test.ts

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../lib/paths';

import {
  auditTempExceptions,
  findTempMarkers,
  isExpired,
  listTrackedFiles,
} from './temp-exceptions';

describe('findTempMarkers', () => {
  it('captures TEMP(expires: ...) markers with file, line, and date', () => {
    const content = [
      "allow: ['a'], // TEMP(expires: 2026-06-30, owner: refactor-f1)",
      'const clean = 1;',
      '}, // TEMP(shared-* exceptions expire: 2026-08-31, owner: refactor-f1)',
    ].join('\n');

    expect(findTempMarkers(content, 'eslint.config.ts')).toEqual([
      {
        file: 'eslint.config.ts',
        line: 1,
        expiry: '2026-06-30',
        text: "allow: ['a'], // TEMP(expires: 2026-06-30, owner: refactor-f1)",
      },
      {
        file: 'eslint.config.ts',
        line: 3,
        expiry: '2026-08-31',
        text: '}, // TEMP(shared-* exceptions expire: 2026-08-31, owner: refactor-f1)',
      },
    ]);
  });

  it('captures multiple markers on one line and singular "expire:" spelling', () => {
    const markers = findTempMarkers(
      'x; // TEMP(a expires: 2025-01-01) TEMP(b expire: 2025-02-02)',
      'f.ts',
    );
    expect(markers.map((marker) => marker.expiry)).toEqual(['2025-01-01', '2025-02-02']);
  });

  it('ignores TEMP comments without a date and dates outside TEMP markers', () => {
    expect(findTempMarkers('// TEMP: remove later', 'f.ts')).toEqual([]);
    expect(findTempMarkers('// deadline 2026-06-30 for launch', 'f.ts')).toEqual([]);
  });
});

describe('isExpired', () => {
  const marker = { file: 'f.ts', line: 1, expiry: '2026-06-30', text: '' };

  it('is expired the day after the expiry date', () => {
    expect(isExpired(marker, new Date('2026-07-01T00:00:00Z'))).toBe(true);
  });

  it('is not expired on the expiry date itself', () => {
    expect(isExpired(marker, new Date('2026-06-30T12:00:00Z'))).toBe(false);
  });

  it('never treats an unparseable date as expired', () => {
    expect(isExpired({ ...marker, expiry: 'not-a-date' }, new Date('2099-01-01T00:00:00Z'))).toBe(
      false,
    );
  });
});

describe('auditTempExceptions', () => {
  it('the repo has no expired TEMP markers today', () => {
    expect(auditTempExceptions()).toEqual([]);
  });

  /**
   * The audit used to scan its own fixtures. Once 2026-06-30 passed it reported
   * six expired markers, every one a string describing the format rather than
   * an exception anybody had taken — a gate failing on its own test data, which
   * is the kind of red that teaches people to ignore red.
   */
  it('does not scan test files, whose markers are fixtures', () => {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();

    const scanned = listTrackedFiles(root);

    expect(scanned.some((file) => file.endsWith('.test.ts'))).toBe(false);
    expect(scanned.some((file) => file.endsWith('.spec.ts'))).toBe(false);
    // The files that actually carry exceptions are still scanned.
    expect(scanned).toContain('main/build-config/src/eslint.ts');
  });

  /**
   * Rewritten 2026-08-05. This asserted that `eslint.config.ts` still carried
   * markers, which held until the last of thirteen was resolved — four were an
   * expressiveness problem in the boundary config, nine described the
   * architecture and were mislabelled as debt.
   *
   * Running the clock to the year 2999 is what makes the empty result mean
   * something: every marker that exists is expired at that date, so an empty
   * audit is "there are none", not "none have lapsed yet". The `toContain`
   * guards the other way — an empty result must not be able to mean the scan
   * read no files.
   */
  it('finds nothing even in the far future, because no marker remains', () => {
    expect(listTrackedFiles(REPO_ROOT)).toContain('main/build-config/src/eslint.ts');

    expect(auditTempExceptions(new Date('2999-01-01T00:00:00Z'))).toEqual([]);
  });
});
