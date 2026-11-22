// main/tools/sync/sync-ts-references.ts

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail, pass, type CheckResult } from '../gates/types';
import { REPO_ROOT as ROOT } from '../lib/paths';

const SCAN_DIRS = ['main/apps', 'main/kernel', 'main/modules', 'main'];
const SPECIFIC_PROJECTS = ['./config/tsconfig.eslint.json', './tests'];

// Projects that have a tsconfig but must NOT be root build references.
// `main/tools`, `main/build-config` and `main/testing` are `noEmit`,
// non-`composite` utility projects (`@bslt/tools`, `@bslt/build-config` and
// `@bslt/testing` are dev tooling, never built); TypeScript project references require `composite: true`, so referencing
// them would break `tsc --build`. Each is type-checked by its package's `type-check`
// script.
const EXCLUDED_PROJECTS = new Set(['./main/build-config', './main/testing', './main/tools']);

interface ProjectReference {
  path: string;
}

function findProjects(root: string, dir: string): string[] {
  const results: string[] = [];
  const fullPath = join(root, dir);

  if (!existsSync(fullPath)) return [];

  const entries = readdirSync(fullPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const projectPath = join(fullPath, entry.name);
      const tsconfigPath = join(projectPath, 'tsconfig.json');

      if (existsSync(tsconfigPath)) {
        results.push(`./${dir}/${entry.name}`);
      }
    }
  }
  return results;
}

/** Syncs the root `tsconfig.json` references; with `check`, only reports drift. */
export function syncTsReferences(
  options: { readonly check?: boolean; readonly root?: string } = {},
): CheckResult {
  const root = options.root ?? ROOT;
  const tsconfigPath = join(root, 'tsconfig.json');
  const isCheck = options.check === true;
  console.log(
    isCheck
      ? '🔎 Checking TypeScript Project References...'
      : '🔄 Syncing TypeScript Project References...',
  );

  // 1. Scan for projects
  const projects: string[] = SPECIFIC_PROJECTS.filter((rel) =>
    existsSync(rel.endsWith('.json') ? join(root, rel) : join(root, rel, 'tsconfig.json')),
  );
  for (const dir of SCAN_DIRS) {
    const found = findProjects(root, dir);
    for (const p of found) {
      if (!projects.includes(p) && !EXCLUDED_PROJECTS.has(p)) {
        projects.push(p);
      }
    }
  }

  projects.sort();

  // 2. Read the current references array directly.
  // The full tsconfig is JSONC with glob paths (e.g. `comms/*/index.ts`) whose
  // `/*`…`*/` sequences defeat naive comment-stripping, so we extract just the
  // `references` block — clean JSON with no comments — instead of parsing the file.
  const rawContent = readFileSync(tsconfigPath, 'utf-8');
  const refsMatch = rawContent.match(/"references"\s*:\s*(\[[\s\S]*?\])/);
  let currentRefs: ProjectReference[] = [];
  if (refsMatch !== null) {
    try {
      currentRefs = JSON.parse(refsMatch[1] ?? '[]') as ProjectReference[];
    } catch (e) {
      console.error('Failed to parse the "references" array in tsconfig.json', e);
      return fail('cannot parse the "references" array in tsconfig.json');
    }
  }

  // 3. Compute desired references
  const newRefs: ProjectReference[] = projects.map((p) => ({ path: p }));

  // Check if changes are needed
  const currentPaths = new Set(currentRefs.map((r) => r.path));
  const newPaths = new Set(newRefs.map((r) => r.path));

  const needsUpdate =
    currentPaths.size !== newPaths.size || [...newPaths].some((p) => !currentPaths.has(p));

  if (needsUpdate && isCheck) {
    const missing = [...newPaths].filter((p) => !currentPaths.has(p));
    const stale = [...currentPaths].filter((p) => !newPaths.has(p));
    console.error('❌ tsconfig.json project references are out of date. Run `pnpm sync:ts`.');
    if (missing.length > 0) console.error(`   Missing: ${missing.join(', ')}`);
    if (stale.length > 0) console.error(`   Stale:   ${stale.join(', ')}`);
    return fail('tsconfig.json project references are out of date; run `pnpm sync:ts`', [
      ...missing.map((p) => `missing: ${p}`),
      ...stale.map((p) => `stale: ${p}`),
    ]);
  }

  if (needsUpdate) {
    console.log(`Found ${projects.length} projects.`);
    // Replace only the `references` block via regex so the surrounding JSONC
    // comments and formatting are preserved (JSON.stringify of the whole file
    // would strip them).
    const refsString = JSON.stringify(newRefs, null, 4)
      .split('\n')
      .map((line, i) => (i === 0 ? line : '    ' + line)) // Indent
      .join('\n');

    const updatedContent = rawContent.replace(
      /"references":\s*\[[\s\S]*?\]/,
      `"references": ${refsString}`,
    );

    writeFileSync(tsconfigPath, updatedContent);
    console.log('✅ Updated references in tsconfig.json');
    return pass(`updated ${String(projects.length)} references in tsconfig.json`);
  }
  console.log('✓ References are already up to date.');
  return pass(`${String(projects.length)} project references are up to date`);
}
