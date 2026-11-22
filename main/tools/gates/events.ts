// main/tools/gates/events.ts
/**
 * `events` gate (restructure plan, sections 8.5 and 14.3).
 *
 * Verifies for every module in `main/modules/<id>/`:
 * 1. Every `EventDef` declared in `module.ts` (`events`) has a statically found
 *    `.publish(<tx>, <module>Events.<key>, ...)` call in `main/modules/<id>/server/`
 *    non-test TypeScript sources.
 * 2. Every `webhook: true` event appears in the generated reference block of
 *    `main/modules/<id>/README.md`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';
import { loadModulesWorkspace, type ParsedModuleInfo } from '../sync/modules';

import { fail, pass, type CheckResult } from './types';

const README_START_MARKER = '<!-- bslt:generated reference -->';
const README_END_MARKER = '<!-- /bslt:generated -->';

function isTestFile(relPath: string): boolean {
  return (
    relPath.endsWith('.test.ts') ||
    relPath.endsWith('.test.tsx') ||
    relPath.endsWith('.spec.ts') ||
    relPath.endsWith('.spec.tsx') ||
    relPath.endsWith('.real-db.test.ts') ||
    relPath.includes('/__tests__/')
  );
}

function walkServerSourceFiles(absDir: string, prefix = ''): string[] {
  if (!existsSync(absDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'coverage' ||
      entry.name === '.turbo' ||
      entry.name === '.cache' ||
      entry.name === 'generated' ||
      entry.name === 'migrations'
    ) {
      continue;
    }
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkServerSourceFiles(full, rel));
    } else if (entry.isFile() && rel.endsWith('.ts') && !isTestFile(rel)) {
      results.push(full);
    }
  }
  return results.sort(compareText);
}

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

function isOwnedImportSource(specifier: string, moduleId: string): boolean {
  if (specifier.startsWith('.')) return true;
  if (specifier === `@bslt/${moduleId}` || specifier.startsWith(`@bslt/${moduleId}/`)) return true;
  return false;
}

function collectAllowedEventContainers(
  sf: ts.SourceFile,
  mod: ParsedModuleInfo,
): {
  readonly eventObjectIdents: ReadonlySet<string>;
  readonly manifestIdents: ReadonlySet<string>;
} {
  const eventObjectIdents = new Set<string>();
  const manifestIdents = new Set<string>();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      if (!isOwnedImportSource(spec, mod.id)) continue;
      const bindings = stmt.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const importedName = (el.propertyName ?? el.name).text;
          const localName = el.name.text;
          if (mod.eventsObjectIdent !== null && importedName === mod.eventsObjectIdent) {
            eventObjectIdents.add(localName);
          }
          if (importedName === mod.manifestExport) {
            manifestIdents.add(localName);
          }
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        if (mod.eventsObjectIdent !== null && decl.name.text === mod.eventsObjectIdent) {
          eventObjectIdents.add(decl.name.text);
        }
      }
    }
  }

  return { eventObjectIdents, manifestIdents };
}

function findPublishedEventKeysInServer(root: string, mod: ParsedModuleInfo): Set<string> {
  const published = new Set<string>();
  const serverDir = path.join(root, 'main/modules', mod.id, 'server');
  const files = walkServerSourceFiles(serverDir);

  for (const absFile of files) {
    const sf = ts.createSourceFile(
      absFile,
      readFileSync(absFile, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    const { eventObjectIdents, manifestIdents } = collectAllowedEventContainers(sf, mod);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'publish' &&
        node.arguments.length >= 2 &&
        node.arguments[1] !== undefined
      ) {
        const eventArg = unwrap(node.arguments[1]);
        if (ts.isPropertyAccessExpression(eventArg)) {
          const key = eventArg.name.text;
          const base = unwrap(eventArg.expression);
          if (ts.isIdentifier(base) && eventObjectIdents.has(base.text)) {
            published.add(key);
          } else if (
            ts.isPropertyAccessExpression(base) &&
            base.name.text === 'events' &&
            ts.isIdentifier(unwrap(base.expression)) &&
            manifestIdents.has((unwrap(base.expression) as ts.Identifier).text)
          ) {
            published.add(key);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return published;
}

function extractGeneratedReadmeBlock(readmePath: string): string | null {
  if (!existsSync(readmePath)) return null;
  const text = readFileSync(readmePath, 'utf8');
  const start = text.indexOf(README_START_MARKER);
  const end = text.indexOf(README_END_MARKER);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + README_END_MARKER.length);
}

export function run(root: string = REPO_ROOT): CheckResult {
  const modulesDir = path.join(root, 'main/modules');
  if (!existsSync(modulesDir)) {
    return pass('no native modules directory yet');
  }

  const workspace = loadModulesWorkspace(root);
  const problems: string[] = [];
  let totalEvents = 0;
  let totalWebhookEvents = 0;

  const sortedModules = [...workspace.modules.values()].sort((a, b) => compareText(a.id, b.id));
  for (const mod of sortedModules) {
    if (mod.events.length === 0) continue;

    const publishedKeys = findPublishedEventKeysInServer(root, mod);
    const readmeRel = `main/modules/${mod.id}/README.md`;
    const generatedReadme = extractGeneratedReadmeBlock(path.join(root, readmeRel));

    for (const ev of mod.events) {
      totalEvents += 1;
      if (ev.name === '' || !ev.name.startsWith(`${mod.id}.`)) {
        problems.push(
          `main/modules/${mod.id}: event "${ev.key}" must have name starting with "${mod.id}." (got "${ev.name}")`,
        );
      }

      if (!publishedKeys.has(ev.key)) {
        const expectedRef =
          mod.eventsObjectIdent !== null
            ? `${mod.eventsObjectIdent}.${ev.key}`
            : `${mod.manifestExport}.events.${ev.key}`;
        problems.push(
          `main/modules/${mod.id}: event "${ev.key}" (${ev.name || 'unnamed'}) has no .publish(<tx>, ${expectedRef}, ...) call in main/modules/${mod.id}/server/`,
        );
      }

      if (ev.webhook) {
        totalWebhookEvents += 1;
        const expectedToken = `\`${ev.name}\` (webhook)`;
        if (generatedReadme === null || !generatedReadme.includes(expectedToken)) {
          problems.push(
            `${readmeRel}: webhook event "${ev.name}" is missing from generated reference docs (run \`pnpm bslt sync modules\`)`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    return fail(`${String(problems.length)} events gate violation(s)`, problems);
  }

  return pass(
    `${String(totalEvents)} declared event(s) (${String(totalWebhookEvents)} webhook) verified across ${String(sortedModules.length)} module(s)`,
  );
}
