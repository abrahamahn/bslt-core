// main/tools/gates/module-graph.ts
/**
 * `module-graph` gate (restructure plan, sections 6.1, 8.3, 9.1, and 14.3).
 *
 * Enforces:
 * 1. The module `dependsOn` graph is a strict DAG (acyclic).
 * 2. Projection and leaf console modules (`audit`, `analytics`, `notifications`,
 *    `webhooks`, `search`, `devtools`, `admin`, `support`) have zero incoming
 *    `dependsOn` edges.
 * 3. `main/tools/generated/module-graph.json` matches `main/modules/*` manifests.
 * 4. `bslt.config.ts` `installedModules` includes every transitive dependency in
 *    topological order.
 * 5. Cross-module SQL foreign keys in `catalog.snapshot.json` follow `dependsOn`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { DB_CATALOG, loadCatalog } from '../catalog/file';
import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';
import { loadModulesWorkspace, type ParsedModulesWorkspace } from '../sync/modules';

import { fail, pass, type CheckResult } from './types';

export const FORBIDDEN_DEPENDS_ON_TARGETS = new Set([
  'admin',
  'analytics',
  'audit',
  'devtools',
  'notifications',
  'search',
  'support',
  'webhooks',
]);

function detectCycles(workspace: ParsedModulesWorkspace, problems: string[]): void {
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];

  const dfs = (id: string): void => {
    state.set(id, 'visiting');
    stack.push(id);

    const mod = workspace.modules.get(id);
    for (const dep of mod?.dependsOn ?? []) {
      if (!workspace.modules.has(dep)) {
        problems.push(`main/modules/${id}/module.ts: dependsOn references unknown module "${dep}"`);
        continue;
      }
      const depState = state.get(dep);
      if (depState === 'visiting') {
        const cycleStart = stack.indexOf(dep);
        const cycle = [...stack.slice(cycleStart), dep].join(' -> ');
        problems.push(`module dependency cycle detected: ${cycle}`);
      } else if (depState === undefined) {
        dfs(dep);
      }
    }

    stack.pop();
    state.set(id, 'visited');
  };

  for (const id of [...workspace.modules.keys()].sort(compareText)) {
    if (state.get(id) === undefined) {
      dfs(id);
    }
  }
}

function checkProjectionTargets(workspace: ParsedModulesWorkspace, problems: string[]): void {
  for (const mod of workspace.modules.values()) {
    for (const dep of mod.dependsOn) {
      if (FORBIDDEN_DEPENDS_ON_TARGETS.has(dep)) {
        problems.push(
          `main/modules/${mod.id}/module.ts: "${dep}" is a projection/leaf module and may never appear in dependsOn`,
        );
      }
    }
  }
}

function checkGeneratedGraphJson(
  root: string,
  workspace: ParsedModulesWorkspace,
  problems: string[],
): void {
  const graphRel = 'main/tools/generated/module-graph.json';
  const graphPath = path.join(root, graphRel);
  if (!existsSync(graphPath)) {
    problems.push(`${graphRel}: missing file (run \`pnpm bslt sync modules\`)`);
    return;
  }

  let parsed: { modules?: Array<{ id?: string; dependsOn?: string[] }> };
  try {
    parsed = JSON.parse(readFileSync(graphPath, 'utf8')) as {
      modules?: Array<{ id?: string; dependsOn?: string[] }>;
    };
  } catch (error) {
    problems.push(
      `${graphRel}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
    return;
  }

  const expected = [...workspace.modules.values()]
    .sort((a, b) => compareText(a.id, b.id))
    .map((m) => ({ id: m.id, dependsOn: [...m.dependsOn] }));

  const actual = (parsed.modules ?? []).map((m) => ({
    id: m.id ?? '',
    dependsOn: [...(m.dependsOn ?? [])],
  }));

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(
      `${graphRel}: out of sync with main/modules/*/module.ts (run \`pnpm bslt sync modules\`)`,
    );
  }
}

function checkInstalledClosure(workspace: ParsedModulesWorkspace, problems: string[]): void {
  const seen = new Set<string>();
  for (const id of workspace.installedIds) {
    const mod = workspace.modules.get(id);
    if (mod === undefined) continue;
    for (const dep of mod.dependsOn) {
      if (!seen.has(dep)) {
        problems.push(
          `bslt.config.ts: installed module "${id}" depends on "${dep}", which is missing or appears after "${id}" in installedModules`,
        );
      }
    }
    seen.add(id);
  }
}

function normalizeOwnerSource(source: string): string {
  return source.startsWith('legacy:') ? source.slice('legacy:'.length) : source;
}

function checkForeignKeyEdges(
  root: string,
  workspace: ParsedModulesWorkspace,
  problems: string[],
): void {
  const catalogPath = path.join(root, DB_CATALOG.file);
  if (!existsSync(catalogPath)) return;

  const catalog = loadCatalog(root);
  const tableOwner = new Map<string, string>();
  for (const table of catalog.tables) {
    tableOwner.set(table.name, normalizeOwnerSource(table.source));
  }

  for (const table of catalog.tables) {
    const fromOwner = normalizeOwnerSource(table.source);
    const mod = workspace.modules.get(fromOwner);
    // Enforce on native modules that own tables in their manifest
    if (mod === undefined || !mod.tables.includes(table.name)) continue;

    for (const constraint of table.constraints) {
      const match =
        /^(\S+)\s+FOREIGN KEY \([^)]+\) REFERENCES (?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\(/u.exec(
          constraint,
        );
      const fkName = match?.[1];
      const targetTable = match?.[2];
      if (fkName === undefined || targetTable === undefined) continue;
      const targetOwner = tableOwner.get(targetTable);
      if (targetOwner === undefined || targetOwner === 'kernel' || targetOwner === fromOwner) {
        continue;
      }
      if (!mod.dependsOn.includes(targetOwner)) {
        problems.push(
          `table "${table.name}" (module "${fromOwner}") has FK "${fkName}" -> "${targetTable}" (owner "${targetOwner}"), which is not in ${fromOwner}.dependsOn`,
        );
      }
    }
  }
}

export function run(root: string = REPO_ROOT): CheckResult {
  let workspace: ParsedModulesWorkspace;
  try {
    workspace = loadModulesWorkspace(root);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  const problems: string[] = [];
  detectCycles(workspace, problems);
  checkProjectionTargets(workspace, problems);
  checkGeneratedGraphJson(root, workspace, problems);
  checkInstalledClosure(workspace, problems);
  checkForeignKeyEdges(root, workspace, problems);

  if (problems.length === 0) {
    return pass(
      `module graph acyclic (${String(workspace.modules.size)} module(s), ${String(workspace.installedIds.length)} installed)`,
    );
  }
  return fail(`${String(problems.length)} module-graph violation(s)`, problems);
}
