// main/tools/lib/paths.ts
/**
 * The single repository-paths module (restructure plan, section 14.1).
 *
 * Every tool that reads or writes the tree resolves it from here, so a move
 * changes one line instead of a depth-relative `path.resolve(__dirname, '../../..')`
 * in each script. `REPO_ROOT` is the only depth-relative root in the tools.
 *
 * It uses `__dirname`, not `import.meta.url`: it is also loaded by
 * `config/playwright.config.ts`, which Playwright compiles to CommonJS, and by
 * tsx and Vitest, which both provide `__dirname`.
 */
import path from 'node:path';

/** Absolute path of the repository root (the directory holding `pnpm-workspace.yaml`). */
export const REPO_ROOT: string = path.resolve(__dirname, '../../..');

/** Absolute path of a repository-relative location. */
export function repoPath(...segments: readonly string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

/** Repository-relative path with forward slashes. */
export function toRepoRelative(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

/** Package source trees, repository-relative, in the order the audits walk them. */
export const SOURCE_ROOTS = ['main/apps', 'main/kernel', 'main/modules'] as const;

/** File-name suffix of the real-database suites (`pnpm test:real-db`). */
export const REAL_DB_TEST_SUFFIX = '.real-db.test.ts';

/** Absolute paths of the locations the tools read and write. */
export const PATHS = {
  root: REPO_ROOT,
  bsltConfig: repoPath('bslt.config.ts'),
  rootPackageJson: repoPath('package.json'),
  workspaceYaml: repoPath('pnpm-workspace.yaml'),
  tsconfig: repoPath('tsconfig.json'),
  main: repoPath('main'),
  apps: repoPath('main/apps'),
  kernel: repoPath('main/kernel'),
  modules: repoPath('main/modules'),
  tools: repoPath('main/tools'),
  serverApp: repoPath('main/apps/server'),
  webApp: repoPath('main/apps/web'),
  webPublic: repoPath('main/apps/web/public'),
  config: repoPath('config'),
  envDir: repoPath('config/env'),
  docs: repoPath('docs'),
  infra: repoPath('infra'),
  webDockerfile: repoPath('infra/docker/Dockerfile.web'),
  caddyfile: repoPath('infra/runtime/caddy/Caddyfile'),
  workflows: repoPath('.github/workflows'),
  ciWorkflow: repoPath('.github/workflows/ci.yml'),
  tests: repoPath('tests'),
  testsPackageJson: repoPath('tests/package.json'),
  integrationTests: repoPath('tests/integration'),
  integrationApi: repoPath('tests/integration/api'),
  e2e: repoPath('tests/e2e'),
  e2eSpecs: repoPath('tests/e2e/specs'),
  e2eGlobalSetup: repoPath('tests/e2e/globalSetup.ts'),
  e2eGlobalTeardown: repoPath('tests/e2e/globalTeardown.ts'),
} as const;
