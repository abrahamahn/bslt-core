// main/tools/scripts/audit/i18n-completeness.ts
/**
 * en-US translation completeness & key-usage audit (plan section 12.7).
 *
 * Enforces:
 * 1. Only `en-US` is advertised in `LOCALES` and present under `main/apps/web/src/i18n/locales/`.
 * 2. Every entry in `en-US.ts` and `main/modules/<id>/i18n/en-US.json` is non-empty,
 *    and module message keys carry their `<id>.` prefix.
 * 3. Every literal `t('...')` call in production `.ts`/`.tsx` files under
 *    `main/apps/web/src` and `main/modules/<id>/web` resolves to a defined `en-US` key.
 */

import fs from 'node:fs';
import path from 'node:path';

import { SUPPORTED_LOCALES as LOCALES } from '@bslt/contract';
import ts from 'typescript';

import { enUS } from '../../../apps/web/src/i18n/locales/en-US';
import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

type TranslationMap = Readonly<Record<string, string>>;

export interface AuditWorkspaceI18nOptions {
  readonly root: string;
  readonly locales: readonly string[];
  readonly enUsTranslations: TranslationMap;
}

function isProductionSourceFile(fileName: string): boolean {
  if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) return false;
  if (fileName.endsWith('.d.ts')) return false;
  return !fileName.includes('.test.') && !fileName.includes('.spec.');
}

function walkProductionSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      results.push(...walkProductionSourceFiles(full));
    } else if (isProductionSourceFile(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function extractLiteralTranslationKeys(filePath: string): Array<{ key: string; line: number }> {
  const source = fs.readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const found: Array<{ key: string; line: number }> = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't'
    ) {
      const firstArg = node.arguments[0];
      if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(firstArg.getStart(sourceFile));
        found.push({ key: firstArg.text, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

export function auditWorkspaceI18n(options: AuditWorkspaceI18nOptions): CheckResult {
  const { root, locales, enUsTranslations } = options;
  const enUsKeys = Object.keys(enUsTranslations);

  if (enUsKeys.length === 0) {
    return fail('en-US translation map is empty; cannot audit i18n key usage');
  }

  const problems: string[] = [];

  if (locales.length !== 1 || locales[0] !== 'en-US') {
    problems.push(`LOCALES must equal ["en-US"], got [${locales.join(', ')}]`);
  }

  const localesDir = path.join(root, 'main/apps/web/src/i18n/locales');
  if (fs.existsSync(localesDir)) {
    for (const entry of fs.readdirSync(localesDir)) {
      if (entry !== 'en-US.ts') {
        problems.push(`unexpected non-en-US locale file main/apps/web/src/i18n/locales/${entry}`);
      }
    }
  }

  for (const key of enUsKeys) {
    if ((enUsTranslations[key] ?? '').trim() === '') {
      problems.push(`en-US: empty value for "${key}"`);
    }
  }

  const webSrcDir = path.join(root, 'main/apps/web/src');
  let checkedCalls = 0;
  for (const file of walkProductionSourceFiles(webSrcDir)) {
    const rel = path.relative(root, file).replace(/\\/gu, '/');
    for (const { key, line } of extractLiteralTranslationKeys(file)) {
      checkedCalls++;
      if (!Object.hasOwn(enUsTranslations, key)) {
        problems.push(`${rel}:${String(line)}: missing en-US key "${key}"`);
      }
    }
  }

  const modulesRoot = path.join(root, 'main/modules');
  let moduleCount = 0;
  if (fs.existsSync(modulesRoot)) {
    for (const entry of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const moduleId = entry.name;
      const jsonPath = path.join(modulesRoot, moduleId, 'i18n/en-US.json');
      let moduleMessages: Record<string, unknown> = {};
      if (fs.existsSync(jsonPath)) {
        moduleCount++;
        moduleMessages = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
        const expectedPrefix = `${moduleId}.`;
        for (const [key, value] of Object.entries(moduleMessages)) {
          if (!key.startsWith(expectedPrefix)) {
            problems.push(
              `main/modules/${moduleId}/i18n/en-US.json: key "${key}" must start with "${expectedPrefix}"`,
            );
          }
          if (typeof value !== 'string' || value.trim() === '') {
            problems.push(`main/modules/${moduleId}/i18n/en-US.json: empty value for "${key}"`);
          }
        }
      }

      const moduleWebDir = path.join(modulesRoot, moduleId, 'web');
      for (const file of walkProductionSourceFiles(moduleWebDir)) {
        const rel = path.relative(root, file).replace(/\\/gu, '/');
        for (const { key, line } of extractLiteralTranslationKeys(file)) {
          checkedCalls++;
          if (!Object.hasOwn(moduleMessages, key)) {
            problems.push(
              `${rel}:${String(line)}: missing key "${key}" in main/modules/${moduleId}/i18n/en-US.json`,
            );
          }
        }
      }
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`i18n-completeness: ${problem}`);
    }
    return fail(`${String(problems.length)} i18n problem(s)`);
  }

  return pass(
    `en-US only: ${String(enUsKeys.length)} app keys, ${String(moduleCount)} module bundles, ${String(checkedCalls)} t() call sites verified`,
  );
}

export function run(): Promise<CheckResult> {
  return Promise.resolve(
    auditWorkspaceI18n({
      root: REPO_ROOT,
      locales: LOCALES,
      enUsTranslations: enUS,
    }),
  );
}
