// main/tools/sync/permissions.ts
/**
 * `bslt sync permissions` & `lockfile` gate (restructure plan §10.4, §14.2, §14.3).
 *
 * Allocates organization permission bit positions append-only in `bslt.lock.json`
 * across all installed and devOnly modules in `bslt.config.ts`. Removed permissions
 * move to `tombstoned` and their bit positions are never reused, so stored
 * `orgs_roles.permissions` BIGINT bitmasks never shift across module changes.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  createOrgBitLookup,
  validatePermissionLockfile,
  type PermissionLockfile,
} from '@bslt/contract';
import ts from 'typescript';

import { fail, pass, type CheckResult } from '../gates/types';
import { REPO_ROOT } from '../lib/paths';

export { createOrgBitLookup, validatePermissionLockfile, type PermissionLockfile };

export const PERMISSION_LOCKFILE = 'bslt.lock.json';
export const SYNC_PERMISSIONS_COMMAND = 'pnpm bslt sync permissions';

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectDeclaredPermissionsFromModuleFile(manifestPath: string): string[] {
  const sf = ts.createSourceFile(
    manifestPath,
    readFileSync(manifestPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const permissions: string[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (decl.initializer === undefined) continue;
      const init = unwrap(decl.initializer);
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === 'defineModule' &&
        init.arguments[0] !== undefined
      ) {
        const arg = unwrap(init.arguments[0]);
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key =
            ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : '';
          if (key === 'permissions') {
            const val = unwrap(prop.initializer);
            if (ts.isArrayLiteralExpression(val)) {
              for (const el of val.elements) {
                const unwrappedEl = unwrap(el);
                if (ts.isStringLiteral(unwrappedEl)) {
                  permissions.push(unwrappedEl.text);
                }
              }
            }
          }
        }
      }
    }
  }

  return permissions;
}

function collectOrderedModuleIds(root: string): string[] {
  const configPath = path.join(root, 'bslt.config.ts');
  const modulesDir = path.join(root, 'main/modules');
  if (!existsSync(modulesDir)) return [];

  const allOnDisk = readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(modulesDir, e.name, 'module.ts')))
    .map((e) => e.name)
    .sort();

  if (!existsSync(configPath)) {
    return allOnDisk;
  }

  const sf = ts.createSourceFile(
    configPath,
    readFileSync(configPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const importIdentToId = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const match = /^@bslt\/([a-z0-9]+)\/module$/u.exec(stmt.moduleSpecifier.text);
    if (match?.[1] === undefined) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        importIdentToId.set(el.name.text, match[1]);
      }
    }
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const key = ts.isIdentifier(node.name) ? node.name.text : '';
      if (key === 'installedModules' || key === 'devOnly') {
        const arr = unwrap(node.initializer);
        if (ts.isArrayLiteralExpression(arr)) {
          for (const el of arr.elements) {
            const ident = unwrap(el);
            if (ts.isIdentifier(ident)) {
              const id = importIdentToId.get(ident.text);
              if (id !== undefined && !seen.has(id)) {
                seen.add(id);
                ordered.push(id);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const id of allOnDisk) {
    if (!seen.has(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

export function collectWorkspacePermissions(root: string = REPO_ROOT): string[] {
  const orderedIds = collectOrderedModuleIds(root);
  const declared: string[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    const manifestPath = path.join(root, 'main/modules', id, 'module.ts');
    if (!existsSync(manifestPath)) continue;
    for (const perm of collectDeclaredPermissionsFromModuleFile(manifestPath)) {
      if (!seen.has(perm)) {
        seen.add(perm);
        declared.push(perm);
      }
    }
  }
  return declared;
}

function readRawLockfile(absPath: string): PermissionLockfile {
  const parsed = JSON.parse(readFileSync(absPath, 'utf8')) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['orgPermissionBits'] !== 'object' ||
    (parsed as Record<string, unknown>)['orgPermissionBits'] === null ||
    Array.isArray((parsed as Record<string, unknown>)['orgPermissionBits']) ||
    !Array.isArray((parsed as Record<string, unknown>)['tombstoned'])
  ) {
    throw new Error(`${PERMISSION_LOCKFILE}: expected { orgPermissionBits, tombstoned } object`);
  }
  return parsed as PermissionLockfile;
}

function readGitHeadLockfile(root: string): PermissionLockfile | undefined {
  const res = spawnSync('git', ['show', `HEAD:${PERMISSION_LOCKFILE}`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (res.status !== 0 || res.stdout.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(res.stdout) as PermissionLockfile;
  } catch {
    return undefined;
  }
}

const MIGRATION_FILE_RE = /^\d{4}_[a-z0-9_]+\.sql$/u;

function sha256NormalizedSql(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/gu, '\n')).digest('hex');
}

function collectWorkspaceMigrations(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const scanDir = (sourceId: string, absDir: string): void => {
    if (!existsSync(absDir)) return;
    const entries = readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && MIGRATION_FILE_RE.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const fileName of entries) {
      const sql = readFileSync(path.join(absDir, fileName), 'utf8');
      out[`${sourceId}/${fileName}`] = sha256NormalizedSql(sql);
    }
  };

  scanDir('kernel', path.join(root, 'main/kernel/db/sql'));
  const modulesDir = path.join(root, 'main/modules');
  if (existsSync(modulesDir)) {
    const moduleIds = readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const modId of moduleIds) {
      scanDir(modId, path.join(modulesDir, modId, 'server/migrations'));
    }
  }
  return out;
}

function serializeLockfile(lockfile: PermissionLockfile): string {
  const sortedActiveEntries = Object.entries(lockfile.orgPermissionBits).sort(
    ([, bitA], [, bitB]) => bitA - bitB,
  );
  const sortedTombstoned = [...lockfile.tombstoned].sort((a, b) => a.bit - b.bit);
  const sortedMigrationEntries =
    lockfile.migrations !== undefined
      ? Object.entries(lockfile.migrations).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      : undefined;
  const canonical: PermissionLockfile = {
    orgPermissionBits: Object.fromEntries(sortedActiveEntries),
    tombstoned: sortedTombstoned,
    ...(sortedMigrationEntries !== undefined
      ? { migrations: Object.fromEntries(sortedMigrationEntries) }
      : {}),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

function compareAgainstBaseline(
  current: PermissionLockfile,
  baseline: PermissionLockfile,
): string[] {
  const problems: string[] = [];
  const currentTombstoned = new Map(current.tombstoned.map((t) => [t.permission, t.bit]));

  for (const [perm, prevBit] of Object.entries(baseline.orgPermissionBits)) {
    const activeBit = current.orgPermissionBits[perm];
    if (activeBit !== undefined) {
      if (activeBit !== prevBit) {
        problems.push(
          `${PERMISSION_LOCKFILE}: permission "${perm}" bit moved from ${String(prevBit)} to ${String(activeBit)} (append-only; reordering forbidden)`,
        );
      }
      continue;
    }
    const tombBit = currentTombstoned.get(perm);
    if (tombBit === undefined) {
      problems.push(
        `${PERMISSION_LOCKFILE}: removed permission "${perm}" (bit ${String(prevBit)}) must be recorded in tombstoned`,
      );
    } else if (tombBit !== prevBit) {
      problems.push(
        `${PERMISSION_LOCKFILE}: tombstoned permission "${perm}" changed bit from ${String(prevBit)} to ${String(tombBit)}`,
      );
    }
  }

  for (const prevTomb of baseline.tombstoned) {
    const tombBit = currentTombstoned.get(prevTomb.permission);
    if (tombBit !== prevTomb.bit) {
      problems.push(
        `${PERMISSION_LOCKFILE}: tombstoned entry "${prevTomb.permission}" (bit ${String(prevTomb.bit)}) must never be removed or altered`,
      );
    }
  }

  if (baseline.migrations !== undefined) {
    for (const [migKey, prevSha] of Object.entries(baseline.migrations)) {
      const currSha = current.migrations?.[migKey];
      if (currSha === undefined) {
        problems.push(
          `${PERMISSION_LOCKFILE}: locked migration "${migKey}" cannot be removed (migrations are append-only)`,
        );
      } else if (currSha !== prevSha) {
        problems.push(
          `${PERMISSION_LOCKFILE}: locked migration "${migKey}" checksum changed from ${prevSha} to ${currSha} (append-only)`,
        );
      }
    }
  }

  return problems;
}

export async function syncPermissions(
  options: {
    readonly root?: string;
  } = {},
): Promise<{ readonly changed: boolean; readonly lockfile: PermissionLockfile }> {
  const root = options.root ?? REPO_ROOT;
  const absPath = path.join(root, PERMISSION_LOCKFILE);
  const existing: PermissionLockfile = existsSync(absPath)
    ? readRawLockfile(absPath)
    : { orgPermissionBits: {}, tombstoned: [] };

  const validationProblems = validatePermissionLockfile(existing);
  if (validationProblems.length > 0) {
    throw new Error(validationProblems.join('\n'));
  }

  const declared = collectWorkspacePermissions(root);
  const declaredSet = new Set(declared);
  const tombstonedByPerm = new Map(existing.tombstoned.map((t) => [t.permission, t.bit]));

  for (const perm of declared) {
    if (tombstonedByPerm.has(perm)) {
      throw new Error(
        `${PERMISSION_LOCKFILE}: permission "${perm}" was previously tombstoned (bit ${String(tombstonedByPerm.get(perm))}) and cannot be reused`,
      );
    }
  }

  const nextActive: Record<string, number> = {};
  const nextTombstoned = [...existing.tombstoned];
  let maxBit = -1;

  for (const entry of existing.tombstoned) {
    if (entry.bit > maxBit) maxBit = entry.bit;
  }
  for (const [perm, bit] of Object.entries(existing.orgPermissionBits)) {
    if (bit > maxBit) maxBit = bit;
    if (declaredSet.has(perm)) {
      nextActive[perm] = bit;
    } else {
      nextTombstoned.push({ permission: perm, bit });
    }
  }

  for (const perm of declared) {
    if (nextActive[perm] === undefined) {
      maxBit += 1;
      nextActive[perm] = maxBit;
    }
  }

  const diskMigrations = collectWorkspaceMigrations(root);
  const existingMigrations = existing.migrations ?? {};
  for (const [migKey, lockedSha] of Object.entries(existingMigrations)) {
    const diskSha = diskMigrations[migKey];
    if (diskSha === undefined) {
      throw new Error(
        `${PERMISSION_LOCKFILE}: locked migration "${migKey}" was deleted on disk (migrations are append-only)`,
      );
    }
    if (diskSha !== lockedSha) {
      throw new Error(
        `${PERMISSION_LOCKFILE}: locked migration "${migKey}" was edited on disk (${lockedSha} -> ${diskSha}); add a new numbered migration instead`,
      );
    }
  }
  const hasMigrations = existing.migrations !== undefined || Object.keys(diskMigrations).length > 0;
  const nextMigrations: Record<string, string> = {
    ...existingMigrations,
    ...diskMigrations,
  };

  const updated: PermissionLockfile = {
    orgPermissionBits: nextActive,
    tombstoned: nextTombstoned,
    ...(hasMigrations ? { migrations: nextMigrations } : {}),
  };
  const postProblems = validatePermissionLockfile(updated);
  if (postProblems.length > 0) {
    throw new Error(postProblems.join('\n'));
  }

  const serialized = serializeLockfile(updated);
  const prevText = existsSync(absPath) ? readFileSync(absPath, 'utf8') : '';
  const changed = prevText !== serialized;
  if (changed) {
    writeFileSync(absPath, serialized);
  }
  return { changed, lockfile: updated };
}

export async function run(
  options: {
    readonly root?: string;
    readonly baselineLockfile?: PermissionLockfile;
  } = {},
): Promise<CheckResult> {
  const root = options.root ?? REPO_ROOT;
  const absPath = path.join(root, PERMISSION_LOCKFILE);
  if (!existsSync(absPath)) {
    return fail(`${PERMISSION_LOCKFILE} is missing`, [
      `${PERMISSION_LOCKFILE}: missing permission lockfile (run \`${SYNC_PERMISSIONS_COMMAND}\`)`,
    ]);
  }

  let current: PermissionLockfile;
  try {
    current = readRawLockfile(absPath);
  } catch (err) {
    return fail(`${PERMISSION_LOCKFILE} is malformed`, [
      err instanceof Error ? err.message : String(err),
    ]);
  }

  const problems = validatePermissionLockfile(current);
  const baseline = options.baselineLockfile ?? readGitHeadLockfile(root);
  if (baseline !== undefined) {
    problems.push(...compareAgainstBaseline(current, baseline));
  }

  const declared = collectWorkspacePermissions(root);
  const declaredSet = new Set(declared);
  const tombstonedSet = new Set(current.tombstoned.map((t) => t.permission));

  for (const perm of declared) {
    if (tombstonedSet.has(perm)) {
      problems.push(`${PERMISSION_LOCKFILE}: declared permission "${perm}" is tombstoned`);
    } else if (current.orgPermissionBits[perm] === undefined) {
      problems.push(
        `${PERMISSION_LOCKFILE}: module permission "${perm}" has no allocated bit (run \`${SYNC_PERMISSIONS_COMMAND}\`)`,
      );
    }
  }

  for (const activePerm of Object.keys(current.orgPermissionBits)) {
    if (!declaredSet.has(activePerm)) {
      problems.push(
        `${PERMISSION_LOCKFILE}: permission "${activePerm}" is no longer declared by any module and must be tombstoned (run \`${SYNC_PERMISSIONS_COMMAND}\`)`,
      );
    }
  }

  const diskMigrations = collectWorkspaceMigrations(root);
  const lockedMigrations = current.migrations ?? {};
  for (const [migKey, diskSha] of Object.entries(diskMigrations)) {
    const lockedSha = lockedMigrations[migKey];
    if (lockedSha === undefined) {
      problems.push(
        `${PERMISSION_LOCKFILE}: migration "${migKey}" has no locked SHA-256 checksum (run \`${SYNC_PERMISSIONS_COMMAND}\`)`,
      );
    } else if (lockedSha !== diskSha) {
      problems.push(
        `${PERMISSION_LOCKFILE}: migration "${migKey}" was edited after locking (expected ${lockedSha}, found ${diskSha})`,
      );
    }
  }
  for (const migKey of Object.keys(lockedMigrations)) {
    if (diskMigrations[migKey] === undefined) {
      problems.push(
        `${PERMISSION_LOCKFILE}: locked migration "${migKey}" is missing on disk (migrations are append-only)`,
      );
    }
  }

  const expectedText = serializeLockfile(current);
  if (readFileSync(absPath, 'utf8') !== expectedText) {
    problems.push(
      `${PERMISSION_LOCKFILE}: not in canonical sorted order (run \`${SYNC_PERMISSIONS_COMMAND}\`)`,
    );
  }

  if (problems.length > 0) {
    return fail(`${PERMISSION_LOCKFILE} failed validation`, problems);
  }

  const activeCount = Object.keys(current.orgPermissionBits).length;
  const tombCount = current.tombstoned.length;
  const migCount = Object.keys(lockedMigrations).length;
  return pass(
    `${String(activeCount)} org permission bit(s) (${String(tombCount)} tombstoned) and ${String(migCount)} migration checksum(s) locked in ${PERMISSION_LOCKFILE}`,
  );
}
