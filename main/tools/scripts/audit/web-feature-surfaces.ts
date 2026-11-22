// main/tools/scripts/audit/web-feature-surfaces.ts
/**
 * Keeps web feature API access on package-level client surfaces.
 *
 * Feature-local api/services directories are easy to turn into pass-through
 * wrappers around @bslt/api. The auth service is the one intentional exception
 * because it owns client-side auth workflow and state.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

import { toRepoRelative, walkFiles } from './file-utils';

interface Violation {
  readonly filePath: string;
  readonly message: string;
}

const WEB_FEATURES_ROOT = path.join(REPO_ROOT, 'main/apps/web/src/features');
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.turbo']);
const FEATURE_PRIVATE_SURFACE_PATTERN = /[/\\]features[/\\]([^/\\]+)[/\\](api|services)[/\\]/u;

function violationForFile(filePath: string): Violation | undefined {
  const match = FEATURE_PRIVATE_SURFACE_PATTERN.exec(filePath);
  if (match === null) return undefined;

  const [, featureName, surface] = match;
  if (featureName === 'auth' && surface === 'services') return undefined;

  return {
    filePath: toRepoRelative(REPO_ROOT, filePath),
    message: `Move ${featureName}/${surface} access to @bslt/api, @bslt/react, or a feature hook with real workflow behavior.`,
  };
}

export function run(): CheckResult {
  if (!existsSync(WEB_FEATURES_ROOT)) {
    console.log('Web feature surface audit passed (features directory dissolved).');
    return pass('web features directory dissolved into modules and app');
  }
  const violations = walkFiles(WEB_FEATURES_ROOT, () => true, IGNORED_DIRS).flatMap((filePath) => {
    const violation = violationForFile(filePath);
    return violation === undefined ? [] : [violation];
  });

  if (violations.length === 0) {
    console.log('Web feature surface audit passed.');
    return pass('web features expose only their public surfaces');
  }

  console.error('Web feature surface audit failed:');
  for (const violation of violations) {
    console.error(`- ${violation.filePath}: ${violation.message}`);
  }

  return fail(`${String(violations.length)} web feature surface violation(s)`);
}
