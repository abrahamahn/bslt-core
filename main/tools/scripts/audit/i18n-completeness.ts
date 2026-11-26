// main/tools/scripts/audit/i18n-completeness.ts
/**
 * Multi-locale translation completeness, parity & key-usage audit.
 *
 * Enforces:
 * 1. `LOCALES` includes `'en-US'` as the canonical default with no duplicates,
 *    and `main/apps/web/src/i18n/locales/` contains `<locale>.ts` for each
 *    supported locale (and no undeclared locale files).
 * 2. Every entry in `en-US.ts`, secondary locale app maps (`ko-KR.ts`, ...), and
 *    `main/modules/<id>/i18n/<locale>.json` is non-empty, carries its `<id>.`
 *    prefix in module bundles, and preserves 100% key and `{placeholder}` parity
 *    across all supported locales.
 * 3. Every literal `t('...')` call in production `.ts`/`.tsx` files under
 *    `main/apps/web/src` and `main/modules/<id>/web` resolves to a defined key.
 */

import fs from 'node:fs';
import path from 'node:path';

import { SUPPORTED_LOCALES as LOCALES } from '@bslt/contract';
import ts from 'typescript';

import { enUS } from '../../../apps/web/src/i18n/locales/en-US';
import { koKR } from '../../../apps/web/src/i18n/locales/ko-KR';
import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

type TranslationMap = Readonly<Record<string, string>>;

export interface AuditWorkspaceI18nOptions {
  readonly root: string;
  readonly locales: readonly string[];
  readonly enUsTranslations: TranslationMap;
  readonly localeTranslations?: Readonly<Record<string, TranslationMap>>;
}

function isProductionSourceFile(fileName: string): boolean {
  if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) return false;
  if (fileName.endsWith('.d.ts')) return false;
  return !fileName.includes('.test.') && !fileName.includes('.spec.');
}

function extractPlaceholders(template: string): string {
  return [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/gu)]
    .map((m) => m[1] ?? '')
    .sort()
    .join(',');
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

function auditSecondaryMap(
  label: string,
  base: Readonly<Record<string, string>>,
  target: Readonly<Record<string, unknown>>,
  problems: string[],
): void {
  for (const [key, baseVal] of Object.entries(base)) {
    if (!Object.hasOwn(target, key)) {
      problems.push(`${label}: missing key "${key}"`);
      continue;
    }
    const val = target[key];
    if (typeof val !== 'string' || val.trim() === '') {
      problems.push(`${label}: empty value for "${key}"`);
      continue;
    }
    const baseTokens = extractPlaceholders(baseVal);
    const targetTokens = extractPlaceholders(val);
    if (baseTokens !== targetTokens) {
      problems.push(
        `${label}: placeholder mismatch for "${key}" (expected {${baseTokens}}, got {${targetTokens}})`,
      );
    }
  }
  for (const key of Object.keys(target)) {
    if (!Object.hasOwn(base, key)) {
      problems.push(`${label}: extra key "${key}" not present in en-US`);
    }
  }
}

export function auditWorkspaceI18n(options: AuditWorkspaceI18nOptions): CheckResult {
  const { root, locales, enUsTranslations, localeTranslations } = options;
  const enUsKeys = Object.keys(enUsTranslations);

  if (enUsKeys.length === 0) {
    return fail('en-US translation map is empty; cannot audit i18n key usage');
  }

  const problems: string[] = [];

  if (locales.length === 0 || locales[0] !== 'en-US') {
    problems.push(`LOCALES must start with "en-US", got [${locales.join(', ')}]`);
  }
  if (new Set(locales).size !== locales.length) {
    problems.push(`LOCALES contains duplicate entries: [${locales.join(', ')}]`);
  }

  const expectedLocaleFiles = new Set(locales.map((loc) => `${loc}.ts`));
  const localesDir = path.join(root, 'main/apps/web/src/i18n/locales');
  if (fs.existsSync(localesDir)) {
    const presentFiles = new Set<string>();
    for (const entry of fs.readdirSync(localesDir)) {
      if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
      presentFiles.add(entry);
      if (!expectedLocaleFiles.has(entry)) {
        problems.push(`unexpected locale file main/apps/web/src/i18n/locales/${entry}`);
      }
    }
    for (const expected of expectedLocaleFiles) {
      if (!presentFiles.has(expected)) {
        problems.push(`missing locale file main/apps/web/src/i18n/locales/${expected}`);
      }
    }
  }

  for (const key of enUsKeys) {
    if ((enUsTranslations[key] ?? '').trim() === '') {
      problems.push(`en-US: empty value for "${key}"`);
    }
  }

  const secondaryLocales = locales.filter((loc) => loc !== 'en-US');
  for (const loc of secondaryLocales) {
    const secondaryMap = localeTranslations?.[loc];
    if (secondaryMap === undefined) {
      problems.push(`missing app translation map for advertised locale "${loc}"`);
    } else {
      auditSecondaryMap(`app/${loc}`, enUsTranslations, secondaryMap, problems);
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
      const moduleMessages: Record<string, string> = {};
      if (fs.existsSync(jsonPath)) {
        moduleCount++;
        const rawEn = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
        const expectedPrefix = `${moduleId}.`;
        for (const [key, value] of Object.entries(rawEn)) {
          if (!key.startsWith(expectedPrefix)) {
            problems.push(
              `main/modules/${moduleId}/i18n/en-US.json: key "${key}" must start with "${expectedPrefix}"`,
            );
          }
          if (typeof value !== 'string' || value.trim() === '') {
            problems.push(`main/modules/${moduleId}/i18n/en-US.json: empty value for "${key}"`);
          } else {
            moduleMessages[key] = value;
          }
        }

        for (const loc of secondaryLocales) {
          const locPath = path.join(modulesRoot, moduleId, `i18n/${loc}.json`);
          if (!fs.existsSync(locPath)) {
            problems.push(
              `main/modules/${moduleId}/i18n/${loc}.json: missing translation bundle for locale "${loc}"`,
            );
            continue;
          }
          const rawLoc = JSON.parse(fs.readFileSync(locPath, 'utf8')) as Record<string, unknown>;
          auditSecondaryMap(
            `main/modules/${moduleId}/i18n/${loc}.json`,
            moduleMessages,
            rawLoc,
            problems,
          );
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
    `${locales.join(', ')}: ${String(enUsKeys.length)} app keys, ${String(moduleCount)} module bundles, ${String(checkedCalls)} t() call sites verified`,
  );
}

export function run(): Promise<CheckResult> {
  return Promise.resolve(
    auditWorkspaceI18n({
      root: REPO_ROOT,
      locales: LOCALES,
      enUsTranslations: enUS,
      localeTranslations: {
        'en-US': enUS,
        'ko-KR': koKR,
      },
    }),
  );
}
