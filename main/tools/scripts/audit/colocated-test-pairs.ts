// main/tools/scripts/audit/colocated-test-pairs.ts
/**
 * Colocated Test Pair Audit
 *
 * Enforces colocated test/source pairing for unit tests.
 *
 * Default mode:
 * - Fails on orphan colocated unit tests (test file exists without source peer).
 *
 * Strict mode (`--strict`):
 * - Also fails on source files that require tests but do not have a colocated peer.
 *
 * Exclusions:
 * - Integration/e2e/smoke tests
 * - `__tests__` folders
 * - `index.*`, `types.*`, declaration files
 * - `main/shared/**` for source->test strict checks (shared is validated with broader integration tests)
 * - the files `bslt sync rows` generates (the generator is tested)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT, SOURCE_ROOTS, repoPath } from '../../lib/paths';
import { GENERATED_ROWS_DIRECTORIES } from '../../sync/rows';

/**
 * Files known to have no colocated test, so `--strict` can gate.
 *
 * A list rather than counts: a file either has a peer or it does not. Adding an
 * untested file fails; adding a test lets the entry be dropped. The list only
 * ever shrinks, which is the whole point — the alternative was a check that
 * reported 352 files and gated nothing, so nobody ran it.
 */
const DEBT_FILE = 'main/tools/scripts/audit/test-pairs-debt.json';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
/**
 * Repo-invariant guards, not unit tests. Each one asserts a property of the tree
 * itself — a tsconfig, a migration set, the SQL in the source — so there is no
 * module for it to sit beside. A source peer would have to be invented to satisfy
 * the pairing rule, and it would test nothing.
 *
 * This is the bar for adding an entry: the test has no source peer *by design*.
 * A test that lost its peer to a rename or a deletion does not belong here.
 */
const ORPHAN_TEST_ALLOWLIST = new Set([
  'main/apps/server/src/bootstrap/self-alias.test.ts',
  // Directory-level invariants, not unit tests of a module: they assert a
  // property across a set of files and so have no source peer by construction.
  'main/apps/web/src/app/admin/adminPageHeadings.test.ts',
  'main/apps/web/src/index-html.test.ts',
  'main/apps/web/src/sw.test.ts',
  'main/kernel/db/src/legal-templates.test.ts',
  'main/kernel/db/src/package-exports.test.ts',
  'main/kernel/db/src/rls.unit.test.ts',
  'main/kernel/db/src/schema-coverage.test.ts',
]);

function toPosix(pathValue: string): string {
  return pathValue.replaceAll(sep, '/');
}

function rel(pathValue: string): string {
  return toPosix(relative(REPO_ROOT, pathValue));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'build' ||
      entry.name === 'coverage' ||
      entry.name === '.cache' ||
      entry.name === '.turbo' ||
      entry.name === '.next'
    ) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(fullPath));
    else out.push(fullPath);
  }
  return out;
}

function isTestFile(pathValue: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(pathValue);
}

function isIntegrationStyleTest(pathValue: string): boolean {
  return (
    pathValue.includes('/__tests__/') ||
    pathValue.includes('/e2e/') ||
    pathValue.includes('.integration.test.') ||
    pathValue.includes('integration.test.') ||
    pathValue.includes('.real-db.test.') ||
    pathValue.includes('.e2e.') ||
    pathValue.includes('.smoke.')
  );
}

function sourcePeersForTest(testPath: string): string[] {
  const dir = dirname(testPath);
  const file = basename(testPath);

  let stem = file.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, '');
  stem = stem.replace(/\.integration$/, '').replace(/\.bench$/, '');

  const peers: string[] = [];
  for (const ext of SOURCE_EXTENSIONS) {
    peers.push(join(dir, `${stem}${ext}`));
    peers.push(join(dir, stem, `index${ext}`));
  }
  return peers;
}

function hasSourcePeer(testPath: string): boolean {
  return sourcePeersForTest(testPath).some((candidate) => existsSync(candidate));
}

function shouldRequireColocatedTest(sourcePath: string): boolean {
  const normalized = toPosix(sourcePath);
  const base = basename(sourcePath);
  const ext = extname(sourcePath);

  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  if (base.endsWith('.d.ts')) return false;
  if (isTestFile(normalized)) return false;
  if (isIntegrationStyleTest(normalized)) return false;
  if (base === 'index.ts' || base === 'index.tsx' || base === 'index.js' || base === 'index.jsx')
    return false;
  if (base === 'types.ts' || base === 'types.tsx' || base === 'types.js' || base === 'types.jsx')
    return false;
  if (base.includes('.stories.')) return false;
  if (base.includes('.config.')) return false;

  // Written by `bslt sync rows` or `bslt sync modules`: generated constants,
  // types and install lists. Their generators are tested in main/tools/sync/*.test.ts.
  const relativePath = rel(sourcePath);
  if (GENERATED_ROWS_DIRECTORIES.some((directory) => relativePath.startsWith(`${directory}/`)))
    return false;
  if (/^main\/apps\/[^/]+\/src\/generated\//u.test(relativePath)) return false;
  if (/^main\/modules\/[^/]+\/server\/generated\//u.test(relativePath)) return false;
  if (relativePath === 'main/kernel/ui/src/icons.generated.ts') return false;
  if (relativePath === 'main/kernel/web/src/ssr/security-headers.generated.ts') return false;
  if (relativePath === 'main/modules/devtools/web/generated/story-index.generated.ts') return false;

  return true;
}

function hasTestPeer(sourcePath: string): boolean {
  const dir = dirname(sourcePath);
  const base = basename(sourcePath, extname(sourcePath));
  const candidates = [
    join(dir, `${base}.test.ts`),
    join(dir, `${base}.test.tsx`),
    join(dir, `${base}.test.js`),
    join(dir, `${base}.test.jsx`),
    join(dir, `${base}.spec.ts`),
    join(dir, `${base}.spec.tsx`),
    join(dir, `${base}.spec.js`),
    join(dir, `${base}.spec.jsx`),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

/** Read the recorded debt; a missing file means no file may lack a test. */
function readDebt(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(repoPath(DEBT_FILE), 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

export interface TestPairsOptions {
  /** Also fail on source files with no colocated test that are not in the debt list. */
  readonly strict?: boolean;
  /** With `strict`: record the current missing tests as the debt list. */
  readonly update?: boolean;
}

export function run(options: TestPairsOptions = {}): CheckResult {
  const strict = options.strict === true;
  const roots = SOURCE_ROOTS.map((root) => repoPath(root)).filter((root) => existsSync(root));

  const files = roots.flatMap((root) => walk(root));
  const normalizedFiles = files.map((pathValue) => toPosix(pathValue));

  const orphanTests = normalizedFiles
    .filter((pathValue) => isTestFile(pathValue))
    .filter((pathValue) => !isIntegrationStyleTest(pathValue))
    .filter((pathValue) => !hasSourcePeer(pathValue))
    .filter((pathValue) => !ORPHAN_TEST_ALLOWLIST.has(rel(pathValue)))
    .map((pathValue) => rel(pathValue))
    .sort();

  const missingTests = strict
    ? normalizedFiles
        .filter((pathValue) => shouldRequireColocatedTest(pathValue))
        .filter((pathValue) => !hasTestPeer(pathValue))
        .map((pathValue) => rel(pathValue))
        .sort()
    : [];

  const debt = readDebt();
  const regressions = missingTests.filter((file) => !debt.has(file));
  const fixed = [...debt].filter((file) => !missingTests.includes(file)).sort();

  if (strict && options.update === true) {
    writeFileSync(repoPath(DEBT_FILE), `${JSON.stringify(missingTests, null, 2)}\n`);
    console.log(`Recorded ${String(missingTests.length)} file(s) in ${DEBT_FILE}.`);
    return pass(`recorded ${String(missingTests.length)} file(s) in the test-pair debt`);
  }

  // Never silent about what is carried: a gate that says "passed" while 352
  // files have no test teaches precisely the wrong thing.
  if (strict && missingTests.length > 0) {
    console.log(
      `Carrying ${String(missingTests.length)} file(s) with no colocated test — see ${DEBT_FILE}.`,
    );
  }
  if (fixed.length > 0) {
    console.log(`\n${String(fixed.length)} file(s) gained a test. Lower the ceiling:`);
    for (const file of fixed) console.log(`  ${file}`);
    console.log('Run `pnpm bslt gate run test-pairs --update` to record it.');
  }

  if (orphanTests.length === 0 && regressions.length === 0) {
    console.log('Colocated test pair audit passed.');
    return pass(`${String(files.length)} files: no orphan tests and no new untested sources`);
  }

  if (orphanTests.length > 0) {
    console.error('Orphan unit tests (no colocated source peer):');
    for (const pathValue of orphanTests) console.error(`- ${pathValue}`);
  }

  if (regressions.length > 0) {
    console.error('Source files missing colocated tests (strict mode):');
    for (const pathValue of regressions) console.error(`- ${pathValue}`);
  }

  return fail(
    `${String(orphanTests.length)} orphan test(s), ${String(regressions.length)} new untested source(s)`,
  );
}
