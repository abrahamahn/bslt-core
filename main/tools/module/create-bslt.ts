// main/tools/module/create-bslt.ts
/**
 * `bslt create` / `pnpm create`: zero-dependency project bootstrapper (`create-bslt`).
 *
 * Scaffolds a fresh, personalized BSLT SaaS project into a new target directory:
 * 1. Copies the starter tree cleanly (excluding `.git`, `node_modules`, `dist`, caches, local `.env*`).
 * 2. Runs `runQuickstart` inside the new directory (name, slug, domain, `@scope`, preset/modules, CSPRNG `.env.local`).
 * 3. Optionally initializes a fresh git repository (`git init -b main`) unless `--no-git` is passed.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../lib/paths';

import { parseQuickstartArgs, runQuickstart, type QuickstartOptions } from './init';

const CREATE_BSLT_USAGE = [
  'Usage:',
  '  pnpm bslt create <target-dir> [options]',
  '',
  'Options:',
  '  --name <name>                                  Product name (default: directory basename)',
  '  --slug <slug>                                  URL/DB slug',
  '  --domain <domain>                              Primary production domain (e.g. acme.com)',
  '  --scope <@scope>                               Migrate @bslt/* workspace scope (e.g. @acme)',
  '  --preset <core|solo-saas|b2b-saas|ai-saas>     Curated module preset',
  '  --modules <id1,id2|none|all>                   Explicit optional modules to install',
  '  --catalog <dir|file|url>                       Optional module catalog source',
  '  --force                                        Allow scaffolding into an existing empty directory',
  '  --no-git                                       Skip `git init -b main`',
  '  --no-install                                   Skip `pnpm install`',
  '  --dry-run                                      Validate and print plan without creating files',
  '  --yes                                          Accept defaults without prompting',
].join('\n');

const EXCLUDED_TOP_LEVEL = new Set([
  '.git',
  'node_modules',
  '.turbo',
  '.tmp',
  'coverage',
  '.cache',
]);

const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', '.turbo', '.cache', 'coverage']);

const EXCLUDED_LOCAL_ENV_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
]);

interface CreateBsltOptions extends Omit<QuickstartOptions, 'root'> {
  readonly sourceRoot?: string;
  readonly targetDir: string;
  readonly force?: boolean | undefined;
  readonly initGit?: boolean | undefined;
}

interface CreateBsltResult {
  readonly targetDir: string;
  readonly appName: string;
  readonly slug: string;
  readonly addedModules: readonly string[];
  readonly envFileWritten: boolean;
  readonly scopeMigratedTo: string | null;
  readonly gitInitialized: boolean;
  readonly dryRun: boolean;
}

function titleFromDirName(targetDir: string): string {
  const base = path.basename(path.resolve(targetDir));
  const cleaned = base
    .replace(/[^a-zA-Z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return cleaned.length > 0 ? cleaned : 'My SaaS';
}

export function parseCreateBsltArgs(argv: readonly string[]): CreateBsltOptions {
  let targetDir: string | undefined;
  let force = false;
  let initGit = true;
  const quickstartArgv: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--no-git') {
      initGit = false;
      continue;
    }
    if (arg === '--git') {
      initGit = true;
      continue;
    }
    if (!arg.startsWith('-') && targetDir === undefined) {
      const prev = i > 0 ? argv[i - 1] : undefined;
      const isValueForFlag =
        prev === '--name' ||
        prev === '--slug' ||
        prev === '--domain' ||
        prev === '--scope' ||
        prev === '--preset' ||
        prev === '--modules' ||
        prev === '--catalog';
      if (!isValueForFlag) {
        targetDir = arg;
        continue;
      }
    }
    quickstartArgv.push(arg);
  }

  if (targetDir === undefined || targetDir.trim().length === 0) {
    throw new Error('bslt create requires a <target-dir> path (e.g. bslt create ./my-saas)');
  }

  const parsedQuickstart = parseQuickstartArgs(quickstartArgv);
  return {
    ...parsedQuickstart,
    targetDir,
    force,
    initGit,
  };
}

function assertSafeTargetDir(sourceRoot: string, targetDir: string, force: boolean): void {
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedTarget = path.resolve(targetDir);

  if (resolvedTarget === resolvedSource) {
    throw new Error('bslt create: target directory cannot be the same as the source repository');
  }
  const relFromSource = path.relative(resolvedSource, resolvedTarget);
  if (
    relFromSource.length > 0 &&
    !relFromSource.startsWith('..') &&
    !path.isAbsolute(relFromSource)
  ) {
    throw new Error(
      'bslt create: target directory must be outside the source repository to avoid recursive copy',
    );
  }

  if (existsSync(resolvedTarget)) {
    const entries = readdirSync(resolvedTarget);
    if (entries.length > 0) {
      throw new Error(
        `bslt create: target directory "${targetDir}" already exists and is not empty`,
      );
    }
    if (!force) {
      throw new Error(
        `bslt create: target directory "${targetDir}" already exists (pass --force to use an empty directory)`,
      );
    }
  }
}

function shouldCopyEntry(sourceRoot: string, srcPath: string): boolean {
  const rel = path.relative(sourceRoot, srcPath);
  if (rel === '') return true;
  const parts = rel.split(path.sep);
  const top = parts[0] ?? '';
  if (EXCLUDED_TOP_LEVEL.has(top)) return false;
  for (const segment of parts) {
    if (EXCLUDED_DIR_NAMES.has(segment)) return false;
  }
  const baseName = parts[parts.length - 1] ?? '';
  if (parts[0] === 'config' && parts[1] === 'env' && EXCLUDED_LOCAL_ENV_FILES.has(baseName)) {
    return false;
  }
  if (parts.length === 1 && EXCLUDED_LOCAL_ENV_FILES.has(baseName)) {
    return false;
  }
  return true;
}

export async function runCreateBslt(options: CreateBsltOptions): Promise<CreateBsltResult> {
  const sourceRoot = path.resolve(options.sourceRoot ?? REPO_ROOT);
  const resolvedTarget = path.resolve(options.targetDir);
  const appName = options.appName ?? titleFromDirName(resolvedTarget);

  assertSafeTargetDir(sourceRoot, resolvedTarget, options.force === true);

  if (options.dryRun === true) {
    const quickstartPlan = await runQuickstart({
      ...options,
      root: sourceRoot,
      appName,
      dryRun: true,
      install: false,
      yes: true,
    });
    return {
      targetDir: resolvedTarget,
      appName: quickstartPlan.appName,
      slug: quickstartPlan.slug,
      addedModules: quickstartPlan.addedModules,
      envFileWritten: false,
      scopeMigratedTo: quickstartPlan.scopeMigratedTo,
      gitInitialized: false,
      dryRun: true,
    };
  }

  mkdirSync(resolvedTarget, { recursive: true });
  cpSync(sourceRoot, resolvedTarget, {
    recursive: true,
    dereference: false,
    filter: (src) => shouldCopyEntry(sourceRoot, src),
  });

  const quickstartResult = await runQuickstart({
    ...options,
    root: resolvedTarget,
    appName,
    yes: options.yes ?? true,
    interactive: options.interactive ?? false,
    install: options.install ?? false,
  });

  let gitInitialized = false;
  if (options.initGit !== false) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: resolvedTarget, stdio: 'ignore' });
    gitInitialized = true;
  }

  return {
    targetDir: resolvedTarget,
    appName: quickstartResult.appName,
    slug: quickstartResult.slug,
    addedModules: quickstartResult.addedModules,
    envFileWritten: quickstartResult.envFileWritten,
    scopeMigratedTo: quickstartResult.scopeMigratedTo,
    gitInitialized,
    dryRun: false,
  };
}

export async function runCreateBsltCli(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(CREATE_BSLT_USAGE);
    return 0;
  }
  const parsed = parseCreateBsltArgs(argv);
  const res = await runCreateBslt(parsed);

  if (res.dryRun) {
    console.log(`[dry-run] Target: ${res.targetDir}`);
    console.log(`[dry-run] App: ${res.appName} (${res.slug})`);
    if (res.scopeMigratedTo !== null) {
      console.log(`[dry-run] Scope migration: @bslt -> ${res.scopeMigratedTo}`);
    }
    return 0;
  }

  const displayDir = path.relative(process.cwd(), res.targetDir) || res.targetDir;
  console.log(`\nCreated "${res.appName}" in ${displayDir}:`);
  if (res.addedModules.length > 0) {
    console.log(`  - Installed modules: ${res.addedModules.join(', ')}`);
  }
  if (res.scopeMigratedTo !== null) {
    console.log(`  - Migrated workspace scope to ${res.scopeMigratedTo}/*`);
  }
  if (res.envFileWritten) {
    console.log('  - Generated config/env/.env.local with fresh CSPRNG secrets');
  }
  if (res.gitInitialized) {
    console.log('  - Initialized fresh git repository (branch: main)');
  }
  console.log('\nNext steps:');
  console.log(`  cd ${displayDir}`);
  console.log('  pnpm install');
  console.log('  pnpm dev');
  console.log(
    '\nDeploy in under 5 minutes with infra/deploy/{fly,railway,render} or docs/deploy/providers/README.md\n',
  );
  return 0;
}
