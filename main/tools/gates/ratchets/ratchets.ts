// main/tools/gates/ratchets/ratchets.ts
/**
 * The ratchets of the merge lane (restructure plan, section 14.3) and the files
 * each one reads. What a ratchet counts in a file is in `counters.ts`; the
 * budget and the comparison are in `ratchet.ts`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { changeSetOfRepository, readGit } from '../../lib/merge-base';
import { SOURCE_ROOTS } from '../../lib/paths';
import { GENERATED_MODULES_DIRECTORIES } from '../../sync/modules';
import { GENERATED_ROWS_DIRECTORIES } from '../../sync/rows';

import {
  inlineStyles,
  opaqueSchemas,
  rawSqlSites,
  setIntervalCalls,
  swallowedCatches,
} from './counters';
import { runRatchet, type Ratchet, type Site } from './ratchet';
import { findUnusedExports } from './unused-exports';

import type { CheckResult, GateContext } from '../types';

/** Directories that hold no production code. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '__mocks__',
  'tests',
  'testing',
]);

const SOURCE_FILE = /\.tsx?$/u;
const NOT_PRODUCTION = /\.d\.ts$|\.(?:test|spec|e2e)\.tsx?$/u;

function walk(root: string, directory: string, skipped: ReadonlySet<string>, out: string[]): void {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return;
  const entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const child = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !skipped.has(entry.name)) walk(root, child, skipped, out);
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      out.push(child);
    }
  }
}

const productionFilesByRoot = new Map<string, readonly string[]>();

/**
 * Repository-relative TypeScript sources of the package trees, sorted: no test
 * file, no test helper directory, no build output, no declaration file.
 */
export function productionFiles(root: string): readonly string[] {
  let files = productionFilesByRoot.get(root);
  if (files === undefined) {
    const found: string[] = [];
    for (const sourceRoot of SOURCE_ROOTS) walk(root, sourceRoot, SKIPPED_DIRECTORIES, found);
    files = found.filter((file) => !NOT_PRODUCTION.test(file)).sort();
    productionFilesByRoot.set(root, files);
  }
  return files;
}

const textByFile = new Map<string, string>();

function read(root: string, file: string): string {
  const absolute = path.join(root, file);
  let text = textByFile.get(absolute);
  if (text === undefined) {
    text = readFileSync(absolute, 'utf8');
    textByFile.set(absolute, text);
  }
  return text;
}

interface SyntaxRatchet {
  readonly id: string;
  readonly noun: string;
  readonly fix: string;
  /** Text a file must contain to hold a site: files without it are not parsed. */
  readonly hint: RegExp;
  readonly reads: (file: string) => boolean;
  readonly sites: (file: string, source: string) => Site[];
}

function syntaxRatchet(definition: SyntaxRatchet): Ratchet {
  return {
    id: definition.id,
    noun: definition.noun,
    fix: definition.fix,
    count: (root) =>
      productionFiles(root)
        .filter((file) => definition.reads(file))
        .flatMap((file) => {
          const source = read(root, file);
          return definition.hint.test(source) ? definition.sites(file, source) : [];
        }),
  };
}

const within = (file: string, ...directories: readonly string[]): boolean =>
  directories.some((directory) => file.startsWith(`${directory}/`));

/**
 * Where SQL is meant to be written: the repositories, the builder they use,
 * and the migration runner, which applies SQL files and keeps its own record.
 */
const SQL_HOMES = [
  'main/kernel/db/src/repositories',
  'main/kernel/db/src/builder',
  'main/kernel/db/src/migrate',
] as const;
const MODULE_REPOSITORY_FILE = /^main\/modules\/[^/]+\/server\/repository\.ts$/u;
const SERVER_CODE = [
  'main/kernel/db',
  'main/kernel/server',
  'main/kernel/storage',
  'main/kernel/comms',
  'main/kernel/realtime',
  'main/apps/server',
] as const;
const MODULE_SERVER_DIR = /^main\/modules\/[^/]+\/server\//u;
const MODULE_GENERATED_DIR = /^main\/modules\/[^/]+\/server\/generated\//u;
const CONFIG_FILE = /\.config\.ts$/u;
const DESIGN_SYSTEM = 'main/kernel/ui';
const SCHEMA_LIBRARY = 'main/kernel/schema';

/** The compiler options of the repository, for one program over every package. */
function repositoryCompilerOptions(root: string): ts.CompilerOptions {
  const tsconfig = path.join(root, 'tsconfig.json');
  const config = ts.readConfigFile(tsconfig, (file) => ts.sys.readFile(file));
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {}, tsconfig);
  return { ...parsed.options, jsx: parsed.options.jsx ?? ts.JsxEmit.ReactJSX, noEmit: true };
}

/** Everything that may import a package export: the packages, the tools, the tests, and bslt.config.ts. */
function importingFiles(root: string): string[] {
  const found: string[] = [];
  const skipped = new Set(['node_modules', 'dist', 'build', 'coverage']);
  for (const directory of ['main', 'tests']) walk(root, directory, skipped, found);
  const rootConfig = 'bslt.config.ts';
  if (existsSync(path.join(root, rootConfig))) found.push(rootConfig);
  return found.filter((file) => !file.endsWith('.d.ts')).map((file) => path.join(root, file));
}

const unusedExports: Ratchet = {
  id: 'unused-exports',
  noun: 'exports that no other file imports',
  fix: 'Import it where it is needed, drop the `export`, or delete the code.',
  count: (root) => {
    // Package sources only: a config file's default export is read by its tool.
    // Not the files `bslt sync rows` writes: every table gets the same names,
    // and nobody can drop an export from a generated file.
    const candidates = new Set(
      productionFiles(root).filter(
        (file) =>
          (file.includes('/src/') ||
            (file.startsWith('main/modules/') && !CONFIG_FILE.test(file))) &&
          !within(file, ...GENERATED_ROWS_DIRECTORIES, ...GENERATED_MODULES_DIRECTORIES) &&
          !MODULE_GENERATED_DIR.test(file),
      ),
    );
    return findUnusedExports({
      root,
      files: importingFiles(root),
      isCandidate: (file) => candidates.has(file),
      compilerOptions: repositoryCompilerOptions(root),
    });
  },
};

export const RATCHETS: readonly Ratchet[] = [
  syntaxRatchet({
    id: 'swallowed-catch',
    noun: 'swallowed errors (empty catch blocks and rejection handlers that do nothing)',
    fix: 'Handle the error, log it, or let it reach the caller; a side effect belongs in an event subscriber (plan section 8).',
    hint: /catch|then/u,
    reads: () => true,
    sites: swallowedCatches,
  }),
  syntaxRatchet({
    id: 'raw-sql-outside-repos',
    noun: 'SQL statements built outside main/kernel/db/src/repositories or main/modules/*/server/repository.ts',
    fix: 'Add a repository method and call it.',
    hint: /builder|@bslt\/db|\.raw\(|\.unsafe\(/u,
    reads: (file) => !within(file, ...SQL_HOMES) && !MODULE_REPOSITORY_FILE.test(file),
    sites: rawSqlSites,
  }),
  syntaxRatchet({
    id: 'setinterval',
    noun: 'setInterval calls in server code',
    fix: 'Register a cron job or a queued job instead of a per-process timer (plan section 8.4).',
    hint: /setInterval/u,
    reads: (file) => within(file, ...SERVER_CODE) || MODULE_SERVER_DIR.test(file),
    sites: setIntervalCalls,
  }),
  syntaxRatchet({
    id: 'inline-style',
    noun: 'inline style props outside @bslt/ui',
    fix: 'Use a class or a @bslt/ui component; a runtime value goes in a style object that only sets CSS custom properties (plan section 12).',
    hint: /style=/u,
    reads: (file) => file.endsWith('.tsx') && !within(file, DESIGN_SYSTEM),
    sites: inlineStyles,
  }),
  syntaxRatchet({
    id: 'opaque-schema',
    noun: 'createSchema(fn) parsers, which nothing can inspect',
    fix: 'Build the schema from the combinators of @bslt/schema (plan section 7.4).',
    hint: /createSchema/u,
    reads: (file) => !within(file, SCHEMA_LIBRARY),
    sites: opaqueSchemas,
  }),
  unusedExports,
];

export function findRatchet(id: string): Ratchet | undefined {
  return RATCHETS.find((ratchet) => ratchet.id === id);
}

/**
 * The files changed on this branch and in the working tree, for the message of
 * a ratchet that rose. Empty when git cannot say (no merge base, no repository).
 */
function changedFiles(): string[] {
  const files = new Set<string>();
  try {
    for (const file of changeSetOfRepository().files) files.add(file);
  } catch {
    // No merge base to compare with: the working tree alone is still worth listing.
  }
  const uncommitted = [
    readGit(['diff', '--name-only', 'HEAD']),
    readGit(['ls-files', '--others', '--exclude-standard']),
  ];
  for (const output of uncommitted) {
    for (const file of (output ?? '').split('\n')) if (file !== '') files.add(file);
  }
  return [...files];
}

/** The gate of one ratchet. */
export function run(id: string, ctx: GateContext): CheckResult {
  const ratchet = findRatchet(id);
  if (ratchet === undefined) throw new Error(`no ratchet "${id}"`);
  return runRatchet(ratchet, ctx, changedFiles);
}
