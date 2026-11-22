// main/tools/gates/deps-allowlist.ts
/**
 * The runtime dependency allowlist (restructure plan, section 13).
 *
 * The rule the plan ends on: the `dependencies`, `peerDependencies` and
 * `optionalDependencies` of every workspace package are `react`, `react-dom`
 * and workspace packages. Until then `deps-allowlist.json` lists every other
 * runtime dependency that exists today, with what replaces it and the phase it
 * leaves in. The gate fails on:
 *
 * - an addition: a runtime dependency that is not listed, or is listed for
 *   other packages only (`usedBy`);
 * - an overdue entry: `removeBy` is a phase before the current one;
 * - a stale entry: nothing declares it any more, so the pull request that
 *   replaced it must delete its line. The list only shrinks.
 *
 * Only `react` and `react-dom` are `permanent`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../lib/paths';
import { CURRENT_PHASE } from '../lib/phase';
import { workspacePackages, type Manifest } from '../scripts/audit/declared-dependencies';

import { fail, pass, type CheckResult } from './types';

/** Repository-relative path of the allowlist. */
export const ALLOWLIST_FILE = 'main/tools/gates/deps-allowlist.json';

export interface AllowlistEntry {
  /** The npm package. */
  readonly name: string;
  /** What takes its place. */
  readonly replacement: string;
  /** The phase by whose end it is gone, or `permanent`. */
  readonly removeBy: number | 'permanent';
  /** What proves the replacement behaves the same. */
  readonly conformance: string;
  /** The workspace packages that may declare it, sorted. */
  readonly usedBy: readonly string[];
}

const PERMANENT = new Set(['react', 'react-dom']);
const RUNTIME_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
type RuntimeField = (typeof RUNTIME_FIELDS)[number];

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function parseEntry(value: unknown, index: number): AllowlistEntry {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${ALLOWLIST_FILE}: entry ${String(index)} is not an object`);
  }
  const entry = value as Record<string, unknown>;
  const name = entry['name'];
  if (!isText(name)) throw new Error(`${ALLOWLIST_FILE}: entry ${String(index)} has no name`);
  for (const field of ['replacement', 'conformance'] as const) {
    if (!isText(entry[field])) throw new Error(`${ALLOWLIST_FILE}: "${name}" has no ${field}`);
  }
  const removeBy = entry['removeBy'];
  if (removeBy !== 'permanent' && !(Number.isInteger(removeBy) && (removeBy as number) >= 0)) {
    throw new Error(`${ALLOWLIST_FILE}: "${name}" needs removeBy: a phase number or "permanent"`);
  }
  const usedBy = entry['usedBy'];
  if (!Array.isArray(usedBy) || usedBy.length === 0 || !usedBy.every(isText)) {
    throw new Error(`${ALLOWLIST_FILE}: "${name}" needs usedBy: the packages that declare it`);
  }
  return {
    name,
    replacement: entry['replacement'] as string,
    removeBy: removeBy as number | 'permanent',
    conformance: entry['conformance'] as string,
    usedBy: usedBy as string[],
  };
}

/**
 * @throws {Error} When the file is not a list of complete entries with unique names.
 */
export function readAllowlist(root: string = REPO_ROOT): AllowlistEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(path.join(root, ALLOWLIST_FILE), 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${ALLOWLIST_FILE} must hold a list of entries`);
  const entries = parsed.map((value, index) => parseEntry(value, index));
  const seen = new Set<string>();
  for (const { name } of entries) {
    if (seen.has(name)) throw new Error(`${ALLOWLIST_FILE}: "${name}" is listed twice`);
    seen.add(name);
  }
  return entries;
}

interface Declaration {
  /** Repository-relative manifest. */
  readonly manifest: string;
  readonly packageName: string;
  readonly dependency: string;
  readonly field: RuntimeField;
}

interface Declared {
  readonly manifests: number;
  readonly declarations: readonly Declaration[];
}

/** Every runtime dependency a manifest declares that is not a workspace package. */
function runtimeDeclarations(root: string): Declared {
  const packages = workspacePackages(root);
  const workspace = new Set(packages.map((pkg) => pkg.name));
  const rootManifest = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as Manifest;
  const manifests = [
    { file: 'package.json', manifest: rootManifest },
    ...packages.map((pkg) => ({ file: `${pkg.dir}/package.json`, manifest: pkg.manifest })),
  ];
  const declarations = manifests.flatMap(({ file, manifest }) =>
    RUNTIME_FIELDS.flatMap((field) =>
      Object.keys(manifest[field] ?? {})
        .filter((dependency) => !workspace.has(dependency))
        .map((dependency) => ({
          manifest: file,
          packageName: manifest.name ?? file,
          dependency,
          field,
        })),
    ),
  );
  return { manifests: manifests.length, declarations };
}

function problemsOf(
  entries: readonly AllowlistEntry[],
  declarations: readonly Declaration[],
  currentPhase: number,
): string[] {
  const problems: string[] = [];
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  for (const { manifest, packageName, dependency, field } of declarations) {
    const where = `${manifest}: ${packageName} declares "${dependency}" under ${field}`;
    const entry = byName.get(dependency);
    if (entry === undefined) {
      problems.push(
        `${where}, and it is not on the allowlist. No new runtime packages (plan section 13): ` +
          'own the code, or reach the service over HTTP behind an owned port.',
      );
    } else if (
      !entry.usedBy.includes(packageName) &&
      !(entry.removeBy === 'permanent' && manifest.startsWith('main/modules/'))
    ) {
      problems.push(
        `${where}, and the allowlist has it only for ${entry.usedBy.join(', ')}. ` +
          'A dependency that is being removed does not spread.',
      );
    }
  }

  for (const entry of entries) {
    const declaredBy = new Set(
      declarations
        .filter((declaration) => declaration.dependency === entry.name)
        .map((declaration) => declaration.packageName),
    );
    if (declaredBy.size === 0) {
      problems.push(
        `${ALLOWLIST_FILE}: "${entry.name}" is declared by no package: delete its entry.`,
      );
      continue;
    }
    for (const user of entry.usedBy) {
      if (!declaredBy.has(user)) {
        problems.push(
          `${ALLOWLIST_FILE}: "${entry.name}" lists ${user} in usedBy, which does not declare it: remove it from usedBy.`,
        );
      }
    }
    if (entry.removeBy === 'permanent') {
      if (!PERMANENT.has(entry.name)) {
        problems.push(
          `${ALLOWLIST_FILE}: "${entry.name}" is marked permanent; only react and react-dom are (plan section 13).`,
        );
      }
    } else if (entry.removeBy < currentPhase) {
      problems.push(
        `${ALLOWLIST_FILE}: "${entry.name}" was to be removed by Phase ${String(entry.removeBy)} ` +
          `and the current phase is ${String(currentPhase)}. Replacement: ${entry.replacement}.`,
      );
    }
  }
  return problems;
}

/** One line per difference between the manifests and the allowlist. */
export function auditDepsAllowlist(
  root: string = REPO_ROOT,
  currentPhase: number = CURRENT_PHASE,
): string[] {
  return problemsOf(readAllowlist(root), runtimeDeclarations(root).declarations, currentPhase);
}

export function run(root: string = REPO_ROOT, currentPhase: number = CURRENT_PHASE): CheckResult {
  const entries = readAllowlist(root);
  const { manifests, declarations } = runtimeDeclarations(root);
  const problems = problemsOf(entries, declarations, currentPhase);
  const dependencies = new Set(declarations.map((declaration) => declaration.dependency)).size;
  if (problems.length > 0) {
    return fail(
      `${String(problems.length)} difference(s) between the package manifests and ${ALLOWLIST_FILE}`,
      problems,
    );
  }
  return pass(
    `${String(dependencies)} runtime dependencies in ${String(manifests)} manifests, ` +
      `all on the allowlist (phase ${String(currentPhase)})`,
  );
}
