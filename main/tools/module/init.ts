// main/tools/module/init.ts
/**
 * `bslt init` / `pnpm quickstart`: one-click developer onboarding wizard and
 * non-interactive project initializer (Owner Decision D14).
 *
 * Composes:
 * 1. Optional module installation (`addModules` with transitive DAG resolution)
 * 2. Safe local `.env.local` creation with 32-byte CSPRNG secrets (never
 *    overwriting existing `.env.local` unless `--force-env` is passed)
 * 3. Product identity (`bslt.config.ts` `name` + starter rename patches)
 * 4. Optional workspace `@scope` migration (`planScopeRename` + `applyScopeRenamePlan`)
 * 5. Optional Docker Postgres startup + role bootstrap + migrations (`--with-postgres`)
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { REPO_ROOT } from '../lib/paths';
import { createStarterRenamePlan, PACKAGE_SCOPE_PATTERN } from '../scripts/starter/rename';
import {
  applyScopeRenamePlan,
  DEFAULT_FROM_SCOPE,
  planScopeRename,
} from '../scripts/starter/scope-rename';

import { addModules, listModules } from './manage';

const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

type QuickstartPreset = 'core' | 'solo-saas' | 'b2b-saas' | 'ai-saas';

const QUICKSTART_PRESETS: Readonly<Record<QuickstartPreset, readonly string[]>> = Object.freeze({
  core: [],
  'solo-saas': [
    'orgs',
    'entitlements',
    'billing',
    'flags',
    'notifications',
    'files',
    'support',
    'analytics',
  ],
  'b2b-saas': [
    'orgs',
    'entitlements',
    'billing',
    'flags',
    'tasks',
    'projects',
    'growth',
    'support',
    'status',
    'search',
    'analytics',
    'notifications',
    'files',
    'moderation',
    'webhooks',
    'admin',
  ],
  'ai-saas': [
    'orgs',
    'entitlements',
    'billing',
    'flags',
    'projects',
    'ai',
    'growth',
    'support',
    'status',
    'analytics',
    'notifications',
    'files',
    'webhooks',
    'admin',
  ],
});

function parsePreset(value: string): QuickstartPreset {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'core' ||
    normalized === 'solo-saas' ||
    normalized === 'b2b-saas' ||
    normalized === 'ai-saas'
  ) {
    return normalized;
  }
  throw new Error(
    `bslt init: unknown preset "${value}". Expected one of: core, solo-saas, b2b-saas, ai-saas.`,
  );
}

export const QUICKSTART_USAGE = [
  'Usage:',
  '  pnpm quickstart',
  '  pnpm bslt init [--name <name>] [--slug <slug>] [--domain <domain>] [--scope <@scope>]',
  '                 [--preset <core|solo-saas|b2b-saas|ai-saas>] [--modules <id1,id2|none|all>]',
  '                 [--catalog <dir|file|url>] [--with-postgres] [--force-env] [--skip-env]',
  '                 [--no-install] [--dry-run] [--yes]',
].join('\n');

export interface QuickstartOptions {
  readonly root?: string;
  readonly appName?: string | undefined;
  readonly slug?: string | undefined;
  readonly domain?: string | undefined;
  readonly scope?: string | undefined;
  readonly preset?: QuickstartPreset | undefined;
  readonly modules?: readonly string[] | undefined;
  readonly catalog?: string | undefined;
  readonly withPostgres?: boolean | undefined;
  readonly forceEnv?: boolean | undefined;
  readonly skipEnv?: boolean | undefined;
  readonly install?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly yes?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  readonly promptFn?: ((question: string) => Promise<string>) | undefined;
}

export interface QuickstartResult {
  readonly appName: string;
  readonly slug: string;
  readonly addedModules: readonly string[];
  readonly envFileWritten: boolean;
  readonly scopeMigratedTo: string | null;
  readonly dryRun: boolean;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-+/gu, '-');
}

function validateOptionalScope(scope: string | undefined): string | undefined {
  if (scope === undefined) return undefined;
  const trimmed = scope.trim().toLowerCase();
  if (trimmed === '' || trimmed === DEFAULT_FROM_SCOPE) return undefined;
  if (!PACKAGE_SCOPE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid package scope "${scope}". Expected format like "@acme".`);
  }
  return trimmed;
}

function validateOptionalDomain(domain: string | undefined): string | undefined {
  if (domain === undefined) return undefined;
  const trimmed = domain.trim().toLowerCase();
  if (trimmed === '') return undefined;
  if (trimmed.includes('://') || trimmed.includes('/') || !DOMAIN_PATTERN.test(trimmed)) {
    throw new Error(`Invalid domain "${domain}". Use a bare domain like "acme.com".`);
  }
  return trimmed;
}

function parseModulesCsv(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return [];
  return trimmed
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '' && part !== 'none');
}

export function parseQuickstartArgs(argv: readonly string[]): QuickstartOptions {
  let appName: string | undefined;
  let slug: string | undefined;
  let domain: string | undefined;
  let scope: string | undefined;
  let preset: QuickstartPreset | undefined;
  let modules: string[] | undefined;
  let catalog: string | undefined;
  let withPostgres = false;
  let forceEnv = false;
  let skipEnv = false;
  let install = true;
  let dryRun = false;
  let yes = false;

  const takeValue = (index: number, flag: string): { value: string; next: number } => {
    const arg = argv[index] ?? '';
    if (arg === flag) {
      const nextVal = argv[index + 1];
      if (nextVal === undefined || nextVal.startsWith('--')) {
        throw new Error(`bslt init: ${flag} requires a value`);
      }
      return { value: nextVal, next: index + 1 };
    }
    const inlineVal = arg.slice(`${flag}=`.length);
    if (inlineVal === '') {
      throw new Error(`bslt init: ${flag} requires a value`);
    }
    return { value: inlineVal, next: index };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--with-postgres') withPostgres = true;
    else if (arg === '--force-env') forceEnv = true;
    else if (arg === '--skip-env') skipEnv = true;
    else if (arg === '--no-install') install = false;
    else if (arg === '--name' || arg.startsWith('--name=')) {
      const parsed = takeValue(i, '--name');
      appName = parsed.value;
      i = parsed.next;
    } else if (arg === '--slug' || arg.startsWith('--slug=')) {
      const parsed = takeValue(i, '--slug');
      slug = parsed.value;
      i = parsed.next;
    } else if (arg === '--domain' || arg.startsWith('--domain=')) {
      const parsed = takeValue(i, '--domain');
      domain = parsed.value;
      i = parsed.next;
    } else if (arg === '--scope' || arg.startsWith('--scope=')) {
      const parsed = takeValue(i, '--scope');
      scope = parsed.value;
      i = parsed.next;
    } else if (arg === '--preset' || arg.startsWith('--preset=')) {
      const parsed = takeValue(i, '--preset');
      preset = parsePreset(parsed.value);
      i = parsed.next;
    } else if (arg === '--modules' || arg.startsWith('--modules=')) {
      const parsed = takeValue(i, '--modules');
      modules =
        parsed.value.trim().toLowerCase() === 'all' ? ['all'] : parseModulesCsv(parsed.value);
      i = parsed.next;
    } else if (arg === '--catalog' || arg.startsWith('--catalog=')) {
      const parsed = takeValue(i, '--catalog');
      catalog = parsed.value;
      i = parsed.next;
    } else {
      throw new Error(`bslt init: unknown option "${arg}"`);
    }
  }

  return {
    appName,
    slug,
    domain,
    scope,
    preset,
    modules,
    catalog,
    withPostgres,
    forceEnv,
    skipEnv,
    install,
    dryRun,
    yes,
  };
}

function readCurrentConfigAppName(root: string): string {
  const cfgPath = path.join(root, 'bslt.config.ts');
  if (!existsSync(cfgPath)) return 'BSLT';
  const match = /\bname:\s*['"]([^'"]+)['"]/u.exec(readFileSync(cfgPath, 'utf8'));
  return match?.[1] ?? 'BSLT';
}

function applyProductRenamePatches(
  root: string,
  appName: string,
  slug: string,
  domain: string | undefined,
  packageScope: string | undefined,
): void {
  const cfgPath = path.join(root, 'bslt.config.ts');
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf8');
    const updated = raw.replace(
      /(\bname:\s*)(?:'[^'\n]*'|"[^"\n]*")/u,
      `$1'${appName.replace(/'/gu, "\\'")}'`,
    );
    writeFileSync(cfgPath, updated, 'utf8');
  }

  // Apply existing starter rename patches gracefully for every target file present in the checkout
  const plan = createStarterRenamePlan({
    appName,
    slug,
    domain,
    packageScope,
    apply: true,
  });
  for (const patch of plan.patches) {
    const abs = path.join(root, patch.path);
    if (!existsSync(abs)) continue;
    try {
      const next = patch.apply(readFileSync(abs, 'utf8'), plan.options);
      writeFileSync(abs, next, 'utf8');
    } catch {
      // Optional deployment docs/templates omitted in custom forks are skipped cleanly
    }
  }
}

function upsertEnvKey(lines: string[], key: string, value: string): void {
  const prefix = `${key}=`;
  const idx = lines.findIndex((line) => line.startsWith(prefix));
  if (idx >= 0) {
    lines[idx] = `${prefix}${value}`;
  } else {
    lines.push(`${prefix}${value}`);
  }
}

function writeLocalEnvIfAbsent(
  root: string,
  appName: string,
  slug: string,
  forceEnv: boolean,
  options: { readonly includeBillingMock?: boolean } = {},
): boolean {
  const envDir = path.join(root, 'config/env');
  const envLocalPath = path.join(envDir, '.env.local');
  if (existsSync(envLocalPath) && !forceEnv) {
    return false;
  }

  mkdirSync(envDir, { recursive: true });
  const examplePath = path.join(envDir, '.env.local.example');
  const baseText = existsSync(examplePath)
    ? readFileSync(examplePath, 'utf8')
    : [
        'NODE_ENV=development',
        'HOST=0.0.0.0',
        'PORT=8080',
        'APP_PORT=5173',
        'API_PORT=8080',
        'VITE_API_URL=http://localhost:8080',
        'POSTGRES_HOST=localhost',
        'POSTGRES_PORT=5432',
        'POSTGRES_USER=postgres',
        'POSTGRES_PASSWORD=postgres',
        'EMAIL_PROVIDER=console',
        'STORAGE_PROVIDER=local',
        '',
      ].join('\n');

  const lines = baseText.replace(/\r\n/gu, '\n').split('\n');
  const dbName = `${slug.replaceAll('-', '_')}_dev`;
  upsertEnvKey(lines, 'VITE_APP_NAME', appName);
  upsertEnvKey(lines, 'POSTGRES_DB', dbName);
  upsertEnvKey(lines, 'AUTH_STRATEGIES', 'local,magic,webauthn');
  if (options.includeBillingMock === true) {
    upsertEnvKey(lines, 'BILLING_PROVIDER', 'mock');
  }
  upsertEnvKey(lines, 'JWT_SECRET', randomBytes(32).toString('hex'));
  upsertEnvKey(lines, 'COOKIE_SECRET', randomBytes(32).toString('hex'));
  upsertEnvKey(lines, 'OAUTH_TOKEN_ENCRYPTION_KEY', randomBytes(32).toString('hex'));

  const normalized = `${lines.join('\n').replace(/\n+$/u, '')}\n`;
  writeFileSync(envLocalPath, normalized, { encoding: 'utf8', mode: 0o600 });
  return true;
}

export async function runQuickstart(options: QuickstartOptions = {}): Promise<QuickstartResult> {
  const root = options.root ?? REPO_ROOT;
  const dryRun = options.dryRun === true;
  const runInstall = options.install !== false;
  const shouldPrompt =
    options.yes !== true &&
    (options.interactive === true ||
      (options.interactive === undefined &&
        process.stdin.isTTY &&
        options.appName === undefined &&
        options.preset === undefined &&
        options.modules === undefined));

  let appName = options.appName;
  let domain = options.domain;
  let scope = options.scope;
  let requestedModules =
    options.modules !== undefined
      ? [...options.modules]
      : options.preset !== undefined
        ? [...QUICKSTART_PRESETS[options.preset]]
        : undefined;

  if (shouldPrompt) {
    const defaultName = readCurrentConfigAppName(root);
    const listing = await listModules({ root, catalog: options.catalog });
    const rl =
      options.promptFn === undefined
        ? createInterface({ input: process.stdin, output: process.stdout })
        : null;
    const ask = async (q: string): Promise<string> => {
      if (options.promptFn !== undefined) return options.promptFn(q);
      if (rl !== null) return rl.question(q);
      return '';
    };

    try {
      const nameAns = (await ask(`App name [${defaultName}]: `)).trim();
      appName = nameAns !== '' ? nameAns : defaultName;

      const domainAns = (await ask('Production domain (optional, e.g. acme.com): ')).trim();
      domain = domainAns !== '' ? domainAns : undefined;

      const scopeAns = (await ask('Workspace npm scope [@bslt]: ')).trim();
      scope = scopeAns !== '' && scopeAns !== '@bslt' ? scopeAns : undefined;

      if (listing.available.length > 0) {
        console.log('\nAvailable optional modules:');
        listing.available.forEach((mod, i) => {
          const deps = mod.dependsOn.length > 0 ? ` (requires: ${mod.dependsOn.join(', ')})` : '';
          console.log(`  [${String(i + 1)}] ${mod.id.padEnd(15)} - ${mod.summary}${deps}`);
        });
        const modAns = (
          await ask(
            'Optional modules to install (comma-separated IDs/numbers, "all", or Enter for none): ',
          )
        ).trim();
        if (modAns.toLowerCase() === 'all') {
          requestedModules = listing.available.map((m) => m.id);
        } else if (modAns !== '') {
          requestedModules = modAns
            .split(',')
            .map((token) => token.trim())
            .filter((token) => token !== '')
            .map((token) => {
              const num = Number(token);
              if (Number.isInteger(num) && num >= 1 && num <= listing.available.length) {
                return listing.available[num - 1]?.id ?? token;
              }
              return token.toLowerCase();
            });
        } else {
          requestedModules = [];
        }
      }
    } finally {
      rl?.close();
    }
  }

  const finalAppName = (appName ?? readCurrentConfigAppName(root)).trim();
  if (finalAppName === '') {
    throw new Error('App name cannot be empty.');
  }
  const finalSlug = (options.slug ?? toSlug(finalAppName)).trim().toLowerCase();
  if (finalSlug === '') {
    throw new Error(`Unable to derive valid kebab-case slug from "${finalAppName}".`);
  }
  const validatedDomain = validateOptionalDomain(domain);
  const validatedScope = validateOptionalScope(scope);

  // Resolve "all" if passed via --modules all, or narrow --preset targets to available catalog entries
  if (requestedModules?.length === 1 && requestedModules[0] === 'all') {
    const listing = await listModules({ root, catalog: options.catalog });
    requestedModules = listing.available.map((m) => m.id);
  } else if (
    options.preset !== undefined &&
    options.modules === undefined &&
    requestedModules !== undefined &&
    requestedModules.length > 0
  ) {
    const listing = await listModules({ root, catalog: options.catalog });
    const availableIds = new Set(listing.available.map((m) => m.id));
    requestedModules = requestedModules.filter((id) => availableIds.has(id));
  }

  let addedModules: readonly string[] = [];
  if (requestedModules !== undefined && requestedModules.length > 0) {
    const addRes = await addModules({
      root,
      targets: requestedModules,
      catalog: options.catalog,
      dryRun,
      install: false,
    });
    addedModules = addRes.addedIds;
  }

  if (dryRun) {
    return {
      appName: finalAppName,
      slug: finalSlug,
      addedModules,
      envFileWritten: false,
      scopeMigratedTo: validatedScope ?? null,
      dryRun: true,
    };
  }

  if (options.appName !== undefined || shouldPrompt) {
    applyProductRenamePatches(root, finalAppName, finalSlug, validatedDomain, validatedScope);
  }

  let scopeMigratedTo: string | null = null;
  if (validatedScope !== undefined) {
    const scopePlan = planScopeRename({
      fromScope: DEFAULT_FROM_SCOPE,
      toScope: validatedScope,
      apply: true,
      root,
    });
    applyScopeRenamePlan(scopePlan, root);
    scopeMigratedTo = validatedScope;
  }

  const includeBillingMock =
    addedModules.includes('billing') ||
    options.preset === 'solo-saas' ||
    options.preset === 'b2b-saas' ||
    existsSync(path.join(root, 'main/modules/billing/module.ts'));

  const envFileWritten =
    options.skipEnv === true
      ? false
      : writeLocalEnvIfAbsent(root, finalAppName, finalSlug, options.forceEnv === true, {
          includeBillingMock,
        });

  if (runInstall && (addedModules.length > 0 || scopeMigratedTo !== null)) {
    execFileSync('pnpm', ['install'], { cwd: root, stdio: 'inherit' });
  }

  if (options.withPostgres === true) {
    execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        'config/env/.env.local',
        '-f',
        'infra/docker/development/docker-compose.dev.yml',
        'up',
        '-d',
        'postgres',
      ],
      { cwd: root, stdio: 'inherit' },
    );
    execFileSync('pnpm', ['db:bootstrap:roles'], { cwd: root, stdio: 'inherit' });
    execFileSync('pnpm', ['db:migrate'], { cwd: root, stdio: 'inherit' });
  }

  return {
    appName: finalAppName,
    slug: finalSlug,
    addedModules,
    envFileWritten,
    scopeMigratedTo,
    dryRun: false,
  };
}

export async function runQuickstartCli(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(QUICKSTART_USAGE);
    return 0;
  }
  const parsed = parseQuickstartArgs(argv);
  const res = await runQuickstart(parsed);

  if (res.dryRun) {
    console.log(`[dry-run] App: ${res.appName} (${res.slug})`);
    if (res.addedModules.length > 0) {
      console.log(`[dry-run] Modules to install: ${res.addedModules.join(' -> ')}`);
    }
    if (res.scopeMigratedTo !== null) {
      console.log(`[dry-run] Scope migration: @bslt -> ${res.scopeMigratedTo}`);
    }
    return 0;
  }

  console.log(`\nQuickstart complete for "${res.appName}" (${res.slug}):`);
  if (res.addedModules.length > 0) {
    console.log(`  - Installed optional modules: ${res.addedModules.join(', ')}`);
  }
  if (res.scopeMigratedTo !== null) {
    console.log(`  - Migrated workspace scope to ${res.scopeMigratedTo}/*`);
  }
  console.log(
    res.envFileWritten
      ? '  - Generated config/env/.env.local with fresh 32-byte secrets'
      : '  - Kept existing config/env/.env.local untouched',
  );
  console.log('\nNext step:\n  pnpm dev\n');
  return 0;
}
