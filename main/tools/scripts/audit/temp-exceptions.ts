// main/tools/scripts/audit/temp-exceptions.ts
/**
 * Fails when a `TEMP(... expires: YYYY-MM-DD ...)` exception marker is past
 * its expiry date.
 *
 * TEMP markers document deliberate, time-boxed rule exceptions (boundary
 * allowances in eslint.config.ts and similar). This audit keeps them honest:
 * once the date passes, the owner must either fix the underlying violation or
 * consciously re-date the marker with a justification.
 *
 * Scans all git-tracked source/config files, excluding generated output and the
 * two places a marker is quoted rather than claimed: `docs/` (prose) and test
 * files (fixtures). A time-boxed exception belongs where the exception itself
 * lives — a config or a source file — and those are still scanned in full.
 *
 * Without the test exclusion the audit fails on its own fixtures, which is what
 * happened once 2026-06-30 passed: six "expired" markers, every one of them a
 * string describing the format rather than an exception anybody had taken.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

/**
 * Matches `TEMP(expires: YYYY-MM-DD)` and `TEMP(shared-* exceptions expire: YYYY-MM-DD)`.
 *
 * The example dates are placeholders on purpose: a real one here would make
 * this module a marker in its own scan the day it passed.
 */
const MARKER_PATTERN = /TEMP\([^)]*expires?:\s*(\d{4}-\d{2}-\d{2})/giu;
const SCANNED_EXTENSIONS = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml)$/u;
const EXCLUDED_PATHS = /^docs\/|(?:^|\/)(?:node_modules|dist|build|coverage)\//u;
/** A marker inside a test is a fixture describing the format, not an exception taken. */
const FIXTURE_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

export interface TempMarker {
  file: string;
  line: number;
  expiry: string;
  text: string;
}

/** Extract every dated TEMP marker from a file's content. */
export function findTempMarkers(content: string, file: string): TempMarker[] {
  return content.split(/\r?\n/).flatMap((lineText, index) =>
    [...lineText.matchAll(MARKER_PATTERN)].map((match) => ({
      file,
      line: index + 1,
      expiry: match[1] ?? '',
      text: lineText.trim(),
    })),
  );
}

/** A marker is expired when its date is strictly before the start of `today` (UTC). */
export function isExpired(marker: TempMarker, today: Date): boolean {
  const expiry = new Date(`${marker.expiry}T23:59:59.999Z`);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() < today.getTime();
}

export function listTrackedFiles(root: string): string[] {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return output
    .split('\n')
    .filter(
      (file) =>
        file !== '' &&
        SCANNED_EXTENSIONS.test(file) &&
        !EXCLUDED_PATHS.test(file) &&
        !FIXTURE_FILE.test(file),
    );
}

/** Tracked files can be deleted-but-uncommitted in the working tree; skip those. */
function readIfPresent(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function auditTempExceptions(today: Date = new Date()): TempMarker[] {
  const root = REPO_ROOT;
  return listTrackedFiles(root)
    .flatMap((file) => findTempMarkers(readIfPresent(resolve(root, file)), file))
    .filter((marker) => isExpired(marker, today));
}

export function run(): CheckResult {
  const expired = auditTempExceptions();
  if (expired.length === 0) {
    return pass('no expired TEMP markers');
  }

  console.error(`${String(expired.length)} expired TEMP exception(s):`);
  for (const marker of expired) {
    console.error(`  ${marker.file}:${String(marker.line)} [expired ${marker.expiry}]`);
    console.error(`    ${marker.text}`);
  }
  console.error('Fix the underlying violation or re-date the marker with a justification.');
  return fail(`${String(expired.length)} expired TEMP exception(s)`);
}
