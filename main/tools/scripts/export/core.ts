// main/tools/scripts/export/core.ts
/**
 * `bslt export core [--out <dir>] [--no-install] [--verify]`: deterministic
 * exporter for the public MIT `bslt-core` repository (`abrahamahn/bslt-core`,
 * Owner Decision D14).
 *
 * Exports Minimal Core (`main/kernel/*`, `main/apps/*`, `main/tools/*`,
 * `main/testing/*`, `main/build-config/*`, `main/modules/{identity,compliance,audit,devtools}`,
 * `config/*`, `infra/*`, `.github/*`, Core-only `tests/*`), rewrites
 * `bslt.config.ts`, `bslt.lock.json`, and `catalog.snapshot.json` to the Minimal
 * Core closure, preserves `.git` and `LICENSE` in the target checkout, and
 * optionally runs `pnpm install`, surface/doc syncs, and full `bslt gate merge`
 * verification inside the exported repository.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { DB_CATALOG, loadCatalog, serializeCatalog } from '../../catalog/file';
import {
  CORE_DEV_ONLY_MODULE_IDS,
  CORE_INSTALLED_MODULE_IDS,
  CORE_MODULE_IDS,
} from '../../gates/optional-module-isolation';
import { REPO_ROOT } from '../../lib/paths';
import { CADDYFILE_REL_PATH, syncCsp } from '../../sync/csp';
import { syncModules } from '../../sync/modules';
import {
  PERMISSION_LOCKFILE,
  syncPermissions,
  type PermissionLockfile,
} from '../../sync/permissions';
import { syncRows } from '../../sync/rows';
import { syncHeaders } from '../../sync/sync-file-headers';
import { syncTsReferences } from '../../sync/sync-ts-references';

const DEFAULT_CORE_OUT_DIR = path.resolve(REPO_ROOT, '../bslt-core');

export const EXPORT_CORE_USAGE = [
  'Usage:',
  '  pnpm bslt export core [--out <dir>] [--no-install] [--verify]',
].join('\n');

export interface ExportCoreOptions {
  readonly sourceRoot?: string;
  readonly outDir: string;
  readonly install?: boolean | undefined;
  readonly verify?: boolean | undefined;
}

export interface ExportCoreResult {
  readonly outDir: string;
  readonly filesExported: number;
  readonly coreModules: readonly string[];
  readonly devOnlyModules: readonly string[];
}

export function parseExportCoreArgs(argv: readonly string[]): ExportCoreOptions {
  let outDir = DEFAULT_CORE_OUT_DIR;
  let install = true;
  let verify = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--no-install') {
      install = false;
    } else if (arg === '--verify') {
      verify = true;
    } else if (arg === '--out') {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('-')) {
        throw new Error('bslt export core: --out requires a target directory path');
      }
      outDir = path.resolve(val);
      i += 1;
    } else if (arg.startsWith('--out=')) {
      const val = arg.slice('--out='.length).trim();
      if (val === '') {
        throw new Error('bslt export core: --out requires a target directory path');
      }
      outDir = path.resolve(val);
    } else {
      throw new Error(`bslt export core: unknown option "${arg}"`);
    }
  }

  return { outDir, install, verify };
}

function listGitSourceFiles(sourceRoot: string): string[] {
  const stdout = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: sourceRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return Array.from(
    new Set(
      stdout
        .split('\0')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    ),
  );
}

const CORE_API_INTEGRATION_TEST_FILES: ReadonlySet<string> = new Set<string>([
  'tests/integration/api/account-lifecycle.real-db.test.ts',
  'tests/integration/api/api-keys.integration.test.ts',
  'tests/integration/api/api-keys.real-db.test.ts',
  'tests/integration/api/audit-security.real-db.test.ts',
  'tests/integration/api/audit.integration.test.ts',
  'tests/integration/api/auth.integration.test.ts',
  'tests/integration/api/auth.real-db.test.ts',
  'tests/integration/api/backend-infra.integration.test.ts',
  'tests/integration/api/captcha.integration.test.ts',
  'tests/integration/api/consent-export-legal.integration.test.ts',
  'tests/integration/api/consent-export.real-db.test.ts',
  'tests/integration/api/data-hygiene.integration.test.ts',
  'tests/integration/api/health.integration.test.ts',
  'tests/integration/api/i18n-locale.integration.test.ts',
  'tests/integration/api/job-lifecycle.integration.test.ts',
  'tests/integration/api/jwt.integration.test.ts',
  'tests/integration/api/login-failure.integration.test.ts',
  'tests/integration/api/operational-quality.integration.test.ts',
  'tests/integration/api/pagination.integration.test.ts',
  'tests/integration/api/platform-errors.integration.test.ts',
  'tests/integration/api/rate-limit-ip-policy.integration.test.ts',
  'tests/integration/api/realtime.integration.test.ts',
  'tests/integration/api/realtime.real-db.test.ts',
  'tests/integration/api/sessions.integration.test.ts',
  'tests/integration/api/sessions.real-db.test.ts',
  'tests/integration/api/signup-consent.real-db.test.ts',
  'tests/integration/api/tos.integration.test.ts',
  'tests/integration/api/tos.real-db.test.ts',
  'tests/integration/api/tracing-flow.integration.test.ts',
  'tests/integration/api/user-management.integration.test.ts',
  'tests/integration/api/webauthn-passkeys.real-db.test.ts',
  'tests/integration/api/webauthn.integration.test.ts',
  'tests/integration/api/websocket-auth.integration.test.ts',
]);

const OPTIONAL_E2E_SPEC_FILES: ReadonlySet<string> = new Set<string>([
  'tests/e2e/specs/account/account.e2e.ts',
  'tests/e2e/specs/admin/admin-jobs.e2e.ts',
  'tests/e2e/specs/admin/admin.e2e.ts',
  'tests/e2e/specs/admin/impersonation.e2e.ts',
  'tests/e2e/specs/auth/auth-pages.e2e.ts',
  'tests/e2e/specs/auth/auth.e2e.ts',
  'tests/e2e/specs/billing/billing.e2e.ts',
  'tests/e2e/specs/media/media.e2e.ts',
  'tests/e2e/specs/notifications/notifications.e2e.ts',
  'tests/e2e/specs/system/api-routes.e2e.ts',
  'tests/e2e/specs/system/browser-smoke-capture.e2e.ts',
  'tests/e2e/specs/system/public-pages.e2e.ts',
]);

function shouldIncludeTrackedFileInCore(relPath: string): boolean {
  // Target LICENSE is preserved or generated separately
  if (relPath === 'LICENSE') {
    return false;
  }

  // Never export non-Core optional modules
  if (relPath.startsWith('main/modules/')) {
    const modId = relPath.slice('main/modules/'.length).split('/')[0] ?? '';
    return CORE_MODULE_IDS.has(modId);
  }

  if (relPath.startsWith('tests/integration/api/')) {
    return CORE_API_INTEGRATION_TEST_FILES.has(relPath);
  }

  if (relPath.startsWith('tests/e2e/')) {
    if (relPath.startsWith('tests/e2e/reports/')) return false;
    return !OPTIONAL_E2E_SPEC_FILES.has(relPath);
  }

  if (
    relPath.startsWith('tests/integration/web/') ||
    relPath === 'tests/integration/database/postgres-smoke.test.ts' ||
    relPath === 'tests/integration/database/baseline-hand-clean.real-db.test.ts'
  ) {
    return false;
  }

  // Omit private session worklogs
  if (relPath.startsWith('docs/log/')) {
    return false;
  }

  return true;
}

function stageGitWorkingTreeIfValidRepo(dir: string): void {
  if (!existsSync(path.join(dir, '.git'))) return;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', '-A'], {
      cwd: dir,
      stdio: 'ignore',
    });
  } catch {
    // Synthetic .git fixture in unit tests — ignore
  }
}

function cleanTargetDirectoryPreservingGitAndLicense(outDir: string): void {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
    return;
  }
  for (const entry of readdirSync(outDir)) {
    if (entry === '.git' || entry === 'LICENSE') continue;
    rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }
}

function emitMinimalCoreBsltConfig(): string {
  return [
    '// bslt.config.ts',
    "import { auditModule } from '@bslt/audit/module';",
    "import { complianceModule } from '@bslt/compliance/module';",
    "import { defineConfig } from '@bslt/contract';",
    "import { devtoolsModule } from '@bslt/devtools/module';",
    "import { identityModule } from '@bslt/identity/module';",
    '',
    'export default defineConfig({',
    "  name: 'BSLT',",
    '  installedModules: [identityModule, complianceModule, auditModule] as const,',
    '  devOnly: [devtoolsModule],',
    "  locales: ['en-US', 'ko-KR'],",
    '  brand: {',
    "    accent: 'oklch(0.62 0.19 264)',",
    "    logo: '/brand/logo.svg',",
    '  },',
    '});',
    '',
  ].join('\n');
}

function emitMinimalCoreReadme(): string {
  return [
    '# BSLT Core (`foundation-v1`)',
    '',
    'Self-owned TypeScript SaaS & platform foundation (React 19 + Vite 8 + owned `node:http` router + PostgreSQL 17 with forced Row-Level Security).',
    '',
    '- **Zero third-party runtime npm dependencies** outside `react` and `react-dom`.',
    '- **12 Kernel Packages (`main/kernel/*`):** `@bslt/schema`, `@bslt/contract`, `@bslt/protocols` (`pg`, `jwt`, `totp`, `cbor`, `cose`, `webpush`, `otlp`), `@bslt/db`, `@bslt/server-system`, `@bslt/realtime`, `@bslt/storage`, `@bslt/comms`, `@bslt/client-engine`, `@bslt/react`, `@bslt/ui`, `@bslt/web-platform`.',
    '- **Minimal Core Vertical Modules (`main/modules/*`):**',
    '  - `@bslt/identity` — Email/password, magic link, OAuth, WebAuthn passkeys, TOTP/SMS MFA, sessions, devices, personal API keys, admin user management.',
    '  - `@bslt/compliance` — Terms/Privacy versioning, cookie consent sync, GDPR data export, account deletion lifecycle.',
    '  - `@bslt/audit` — Partitioned append-only `audit_log` + security metrics.',
    '  - `@bslt/devtools` (`devOnly`) — Live API route explorer (`/developer/api-routes`) and interactive `@bslt/ui` component catalog (`/ui-library`).',
    '',
    '## One-Click Quickstart',
    '',
    'Requires **Node.js 24**, **pnpm 10.26.2**, and **PostgreSQL 17** (or Docker).',
    '',
    '```bash',
    'git clone https://github.com/abrahamahn/bslt-core.git my-app',
    'cd my-app',
    'pnpm install',
    'pnpm quickstart',
    '```',
    '',
    '`pnpm quickstart` (`bslt init`) walks you through naming your app, migrating your `@scope`, picking optional feature modules, generating local 32-byte secrets in `config/env/.env.local`, and optionally starting PostgreSQL.',
    '',
    'Non-interactive one-liner:',
    '',
    '```bash',
    'pnpm quickstart -- --name "Acme Cloud" --domain acme.com --scope @acme --with-postgres --yes',
    'pnpm dev',
    '```',
    '',
    '## Installing Optional Feature Modules',
    '',
    'Optional vertical modules (`orgs`, `entitlements`, `billing`, `flags`, `tasks`, `support`, `status`, `search`, `analytics`, `notifications`, `files`, `moderation`, `webhooks`, `admin`) plug directly into `main/modules/<id>` and `bslt.config.ts` with automatic DAG dependency resolution and SHA-256 verification:',
    '',
    '```bash',
    '# List installed and available modules',
    'pnpm bslt module list --catalog /path/to/modules.catalog.json',
    '',
    '# Add modules (automatically installs transitive dependencies in topological order)',
    'pnpm bslt module add billing tasks --catalog /path/to/modules.catalog.json',
    '',
    '# Or fetch from a private HTTPS catalog using BSLT_MODULE_TOKEN',
    'BSLT_MODULE_TOKEN="<token>" pnpm bslt module add billing --catalog https://releases.example.com/modules.catalog.json',
    '',
    '# Scaffold your own custom full-stack vertical module',
    'pnpm bslt module new notes',
    '```',
    '',
    '## Verification & Quality Gates',
    '',
    '```bash',
    'pnpm build                                  # Build all workspace packages & prerender public SSR pages',
    'pnpm bslt gate merge --concurrency=2        # Run all 50 static, contract, snapshot, lint, type-check & unit gates',
    'pnpm test:real-db                           # Run real PostgreSQL 17 + forced RLS isolation suites',
    '```',
    '',
    '## License',
    '',
    'MIT — see [LICENSE](./LICENSE).',
    '',
  ].join('\n');
}

function emitMitLicenseFallback(): string {
  return [
    'MIT License',
    '',
    'Copyright (c) 2026 BSLT Contributors',
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
    '',
  ].join('\n');
}

export async function exportCoreRepository(options: ExportCoreOptions): Promise<ExportCoreResult> {
  const sourceRoot = path.resolve(options.sourceRoot ?? REPO_ROOT);
  const outDir = path.resolve(options.outDir);

  if (outDir === sourceRoot || outDir.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(
      `Cannot export bslt-core into the source repository itself ("${outDir}"). Choose an external --out directory.`,
    );
  }

  const tracked = listGitSourceFiles(sourceRoot).filter(shouldIncludeTrackedFileInCore);
  cleanTargetDirectoryPreservingGitAndLicense(outDir);

  for (const relPath of tracked) {
    const srcAbs = path.join(sourceRoot, relPath);
    if (!existsSync(srcAbs)) continue;
    const dstAbs = path.join(outDir, relPath);
    mkdirSync(path.dirname(dstAbs), { recursive: true });
    copyFileSync(srcAbs, dstAbs);
  }

  // Ensure root package.json in exported Core also carries any working-tree script additions (e.g. quickstart)
  copyFileSync(path.join(sourceRoot, 'package.json'), path.join(outDir, 'package.json'));
  // Copy new untracked/modified tool files from sourceRoot/main/tools & app composition roots so export reflects live sourceRoot
  const copyLiveTree = (relDir: string): void => {
    const absSrcDir = path.join(sourceRoot, relDir);
    if (!existsSync(absSrcDir)) return;
    const walk = (currRel: string): void => {
      for (const entry of readdirSync(path.join(sourceRoot, currRel), { withFileTypes: true })) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === '.turbo' ||
          entry.name === '.cache' ||
          entry.name.startsWith('.eslintcache') ||
          entry.name.endsWith('.tsbuildinfo')
        ) {
          continue;
        }
        const childRel = `${currRel}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(childRel);
        } else if (entry.isFile()) {
          const dst = path.join(outDir, childRel);
          mkdirSync(path.dirname(dst), { recursive: true });
          copyFileSync(path.join(sourceRoot, childRel), dst);
        }
      }
    };
    walk(relDir);
  };
  copyLiveTree('main/tools');
  copyLiveTree('main/apps/server/src');
  copyLiveTree('main/apps/web/src');

  if (!existsSync(path.join(outDir, 'LICENSE'))) {
    writeFileSync(path.join(outDir, 'LICENSE'), emitMitLicenseFallback(), 'utf8');
  }

  writeFileSync(path.join(outDir, 'bslt.config.ts'), emitMinimalCoreBsltConfig(), 'utf8');
  writeFileSync(path.join(outDir, 'README.md'), emitMinimalCoreReadme(), 'utf8');
  mkdirSync(path.join(outDir, 'docs/log'), { recursive: true });
  writeFileSync(
    path.join(outDir, 'docs/log/README.md'),
    [
      '# Development Log',
      '',
      'Engineering changelogs for the BSLT Core foundation.',
      '',
      '[Back to main docs](../../README.md)',
      '',
    ].join('\n'),
    'utf8',
  );

  // Filter bslt.lock.json to Core sources
  const allowedMigrationSources = new Set<string>(['kernel', ...CORE_MODULE_IDS]);
  const sourceLock = JSON.parse(
    readFileSync(path.join(sourceRoot, PERMISSION_LOCKFILE), 'utf8'),
  ) as PermissionLockfile;
  const coreMigrations: Record<string, string> = {};
  for (const [migKey, sha] of Object.entries(sourceLock.migrations ?? {})) {
    const owner = migKey.split('/')[0] ?? '';
    if (allowedMigrationSources.has(owner)) {
      coreMigrations[migKey] = sha;
    }
  }
  const coreLock: PermissionLockfile = {
    orgPermissionBits: {},
    tombstoned: [],
    migrations: coreMigrations,
  };
  writeFileSync(
    path.join(outDir, PERMISSION_LOCKFILE),
    `${JSON.stringify(coreLock, null, 2)}\n`,
    'utf8',
  );

  // Filter catalog.snapshot.json to Core sources
  const fullCatalog = loadCatalog(sourceRoot);
  const coreCatalog = {
    ...fullCatalog,
    sources: fullCatalog.sources.filter((s) => allowedMigrationSources.has(s.id)),
    types: fullCatalog.types.filter((t) => allowedMigrationSources.has(t.source)),
    sequences: fullCatalog.sequences.filter((s) => allowedMigrationSources.has(s.source)),
    functions: fullCatalog.functions.filter((f) => allowedMigrationSources.has(f.source)),
    tables: fullCatalog.tables.filter((t) => allowedMigrationSources.has(t.source)),
    views: fullCatalog.views.filter((v) => allowedMigrationSources.has(v.source)),
  };
  writeFileSync(path.join(outDir, DB_CATALOG.file), serializeCatalog(coreCatalog), 'utf8');

  // Remove any generated per-module RLS tests in tests/integration/database/generated before syncRows regenerates rls.real-db.test.ts
  const genRlsDir = path.join(outDir, 'tests/integration/database/generated');
  if (existsSync(genRlsDir)) {
    rmSync(genRlsDir, { recursive: true, force: true });
  }

  await syncPermissions({ root: outDir });
  await syncRows({ root: outDir });
  await syncModules({ root: outDir });
  syncTsReferences({ root: outDir });
  if (existsSync(path.join(outDir, CADDYFILE_REL_PATH))) {
    await syncCsp({ root: outDir });
  }
  syncHeaders({ root: outDir, quiet: true });
  stageGitWorkingTreeIfValidRepo(outDir);

  const env = {
    ...process.env,
    TURBO_CONCURRENCY: '2',
    NODE_OPTIONS: '--max-old-space-size=4096',
  };

  if (options.install !== false) {
    execFileSync('pnpm', ['install', '--no-frozen-lockfile'], {
      cwd: outDir,
      stdio: 'inherit',
      env,
    });
    execFileSync('pnpm', ['bslt', 'snapshot', 'api'], {
      cwd: outDir,
      stdio: 'inherit',
      env,
    });
    execFileSync('pnpm', ['bslt', 'snapshot', 'web-routes'], {
      cwd: outDir,
      stdio: 'inherit',
      env,
    });
    execFileSync('pnpm', ['bslt', 'sync', 'openapi'], {
      cwd: outDir,
      stdio: 'inherit',
      env,
    });
    execFileSync('pnpm', ['bslt', 'sync', 'docs'], {
      cwd: outDir,
      stdio: 'inherit',
      env,
    });
    execFileSync('pnpm', ['format'], { cwd: outDir, stdio: 'inherit', env });
    stageGitWorkingTreeIfValidRepo(outDir);
  }

  if (options.verify === true) {
    execFileSync('pnpm', ['build'], { cwd: outDir, stdio: 'inherit', env });
    execFileSync('pnpm', ['bslt', 'gate', 'merge', '--concurrency=2'], {
      cwd: outDir,
      stdio: 'inherit',
      env,
    });
  }

  return {
    outDir,
    filesExported: tracked.length,
    coreModules: [...CORE_INSTALLED_MODULE_IDS],
    devOnlyModules: [...CORE_DEV_ONLY_MODULE_IDS],
  };
}

export async function runExportCoreCli(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(EXPORT_CORE_USAGE);
    return 0;
  }
  const parsed = parseExportCoreArgs(argv);
  const res = await exportCoreRepository(parsed);
  console.log(
    `Exported Minimal Core (${res.coreModules.join(', ')} + devOnly ${res.devOnlyModules.join(', ')}) to ${res.outDir}.`,
  );
  return 0;
}
