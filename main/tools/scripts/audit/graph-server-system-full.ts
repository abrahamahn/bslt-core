// main/tools/scripts/audit/graph-server-system-full.ts
/**
 * Server System — Full Dependency Graph (with shared package connections)
 *
 * Uses the package tsconfig, whose `customConditions: ["source"]` resolves
 * @bslt/* imports to their TypeScript source files instead of compiled dist/.
 * This makes cross-package dependency edges visible in the graph.
 *
 * Exclude strategy:
 *   - Test files are excluded as usual.
 *   - shared/src internals deeper than the top-level folder barrels are excluded
 *     so shared modules appear as clean leaf nodes (e.g. shared/src/infra/index.ts)
 *     rather than exploding into hundreds of nodes.
 *
 * Output: .tmp/graphs/server-system/system-full.svg
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { repoPath } from '../../lib/paths';

const ROOT = repoPath('main', 'kernel', 'server');
const SRC = join(ROOT, 'src');
const OUT = repoPath('.tmp', 'graphs', 'server-system');
const TSCONFIG = join(ROOT, 'tsconfig.json');

export function run(): void {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  // Exclude test files and shared internals beyond the per-package barrel.
  // Pattern breakdown:
  //   (__tests__|\.test\.|\.spec\.)  — test artifacts
  //   /shared/src/[^/]+/[^/]+/      — anything 2+ levels deep inside shared/src/<pkg>/
  //     allows: shared/src/infra/index.ts    (the barrel — shown as leaf)
  //     blocks:  shared/src/infra/errors/    (internals — not expanded)
  const EXCLUDE = String.raw`(__tests__|\.test\.|\.spec\.|/shared/src/[^/]+/[^/]+/)`;

  const outFile = join(OUT, 'system-full.svg');
  const cmd = [
    'npx madge',
    `"${SRC}"`,
    `--ts-config "${TSCONFIG}"`,
    '--extensions ts',
    `--exclude "${EXCLUDE}"`,
    `--image "${outFile}"`,
  ].join(' ');

  console.log('\n> system-full (with shared package connections)');
  execSync(cmd, { stdio: 'inherit' });
  console.log(`\nGraph written to: ${outFile}`);
}
