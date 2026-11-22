// main/tools/sync/stories.ts
/**
 * `bslt sync stories`: generates `main/modules/devtools/web/generated/story-index.generated.ts`
 * from `main/kernel/ui/src/index.ts` and `main/modules/devtools/web/catalog.tsx`, failing if any
 * exported `@bslt/ui` component lacks a catalog story or if any story/variant keys collide
 * (plan sections 12.8 and 17.2 Phase 17).
 */

import fs from 'node:fs';
import path from 'node:path';

import { format, resolveConfig } from 'prettier';
import ts from 'typescript';

import { fail, pass, type CheckResult } from '../gates/types';
import { REPO_ROOT } from '../lib/paths';

export const SYNC_STORIES_COMMAND = 'pnpm bslt sync stories';
export const GENERATED_STORIES_FILE =
  'main/modules/devtools/web/generated/story-index.generated.ts';

const UI_INDEX_REL_FILE = 'main/kernel/ui/src/index.ts';
const CATALOG_REL_FILE = 'main/modules/devtools/web/catalog.tsx';

export interface ParsedStoryEntry {
  readonly storyId: string;
  readonly component: string;
  readonly category: string;
  readonly variantNames: readonly string[];
}

function isComponentExportName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/u.test(name) && !/^[A-Z0-9_]+$/u.test(name);
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getPropertyString(obj: ts.ObjectLiteralExpression, propName: string): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : '';
    if (key !== propName) continue;
    const val = unwrapExpression(prop.initializer);
    if (ts.isStringLiteral(val) || ts.isNoSubstitutionTemplateLiteral(val)) {
      return val.text;
    }
  }
  return undefined;
}

function getPropertyArray(
  obj: ts.ObjectLiteralExpression,
  propName: string,
): ts.ArrayLiteralExpression | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : '';
    if (key !== propName) continue;
    const val = unwrapExpression(prop.initializer);
    if (ts.isArrayLiteralExpression(val)) return val;
  }
  return undefined;
}

export function parseUiComponentExports(uiIndexPath: string): string[] {
  if (!fs.existsSync(uiIndexPath)) {
    throw new Error(`Missing UI barrel: ${UI_INDEX_REL_FILE}`);
  }
  const sf = ts.createSourceFile(
    uiIndexPath,
    fs.readFileSync(uiIndexPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const exportedComponents = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt) || stmt.isTypeOnly) continue;
    const clause = stmt.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      if (element.isTypeOnly) continue;
      const exportedName = element.name.text;
      if (isComponentExportName(exportedName)) {
        exportedComponents.add(exportedName);
      }
    }
  }

  return [...exportedComponents].sort((a, b) => a.localeCompare(b));
}

export function parseCatalogStories(catalogPath: string): ParsedStoryEntry[] {
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Missing component catalog: ${CATALOG_REL_FILE}`);
  }
  const sf = ts.createSourceFile(
    catalogPath,
    fs.readFileSync(catalogPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );

  let catalogObj: ts.ObjectLiteralExpression | undefined;
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (!isExported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === 'componentCatalog' &&
        decl.initializer !== undefined
      ) {
        const init = unwrapExpression(decl.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          catalogObj = init;
        }
      }
    }
  }

  if (catalogObj === undefined) {
    throw new Error(`${CATALOG_REL_FILE}: missing exported object literal componentCatalog`);
  }

  const seenStoryIds = new Set<string>();
  const seenComponentNames = new Set<string>();
  const entries: ParsedStoryEntry[] = [];

  for (const prop of catalogObj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      throw new Error(
        `${CATALOG_REL_FILE}: every componentCatalog entry must be a direct property assignment`,
      );
    }
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : '';
    const storyObj = unwrapExpression(prop.initializer);
    if (!ts.isObjectLiteralExpression(storyObj)) {
      throw new Error(`${CATALOG_REL_FILE}: story "${key}" must be an object literal`);
    }

    const id = getPropertyString(storyObj, 'id');
    const name = getPropertyString(storyObj, 'name');
    const category = getPropertyString(storyObj, 'category');
    const variantsArr = getPropertyArray(storyObj, 'variants');

    if (id === undefined || id !== key) {
      throw new Error(
        `${CATALOG_REL_FILE}: story "${key}" must declare id: '${key}' (got ${JSON.stringify(id)})`,
      );
    }
    if (seenStoryIds.has(id)) {
      throw new Error(`${CATALOG_REL_FILE}: duplicate story id "${id}"`);
    }
    seenStoryIds.add(id);

    if (name === undefined || name.trim().length === 0) {
      throw new Error(`${CATALOG_REL_FILE}: story "${key}" must declare a non-empty name`);
    }
    if (seenComponentNames.has(name)) {
      throw new Error(`${CATALOG_REL_FILE}: duplicate story component name "${name}"`);
    }
    seenComponentNames.add(name);

    if (category === undefined || category.trim().length === 0) {
      throw new Error(`${CATALOG_REL_FILE}: story "${key}" must declare a category`);
    }
    if (variantsArr === undefined || variantsArr.elements.length === 0) {
      throw new Error(`${CATALOG_REL_FILE}: story "${key}" must declare at least one variant`);
    }

    const variantNames: string[] = [];
    const seenVariants = new Set<string>();
    for (const element of variantsArr.elements) {
      const variantObj = unwrapExpression(element);
      if (!ts.isObjectLiteralExpression(variantObj)) {
        throw new Error(
          `${CATALOG_REL_FILE}: every variant in story "${key}" must be an object literal`,
        );
      }
      const variantName = getPropertyString(variantObj, 'name');
      if (variantName === undefined || variantName.trim().length === 0) {
        throw new Error(
          `${CATALOG_REL_FILE}: every variant in story "${key}" must have a string name`,
        );
      }
      if (seenVariants.has(variantName)) {
        throw new Error(
          `${CATALOG_REL_FILE}: story "${key}" has duplicate variant name "${variantName}"`,
        );
      }
      seenVariants.add(variantName);
      variantNames.push(variantName);
    }

    entries.push({
      storyId: id,
      component: name,
      category,
      variantNames,
    });
  }

  return entries.sort((a, b) => a.component.localeCompare(b.component));
}

export async function renderStoryIndexGeneratedTs(root: string = REPO_ROOT): Promise<{
  readonly code: string;
  readonly count: number;
}> {
  const uiExports = parseUiComponentExports(path.join(root, UI_INDEX_REL_FILE));
  const stories = parseCatalogStories(path.join(root, CATALOG_REL_FILE));

  const storyByComponent = new Map<string, ParsedStoryEntry>();
  for (const story of stories) {
    storyByComponent.set(story.component, story);
  }

  const missing = uiExports.filter((exportName) => !storyByComponent.has(exportName));
  if (missing.length > 0) {
    throw new Error(
      `${CATALOG_REL_FILE}: missing story for ${String(missing.length)} @bslt/ui component export(s): ${missing.join(', ')}`,
    );
  }

  const matchedStories = uiExports.map((component) => {
    const story = storyByComponent.get(component);
    if (story === undefined) {
      throw new Error(`Unreachable: missing story for ${component}`);
    }
    return story;
  });

  const lines: string[] = [
    `// ${GENERATED_STORIES_FILE}`,
    `// @generated by bslt sync stories from ${UI_INDEX_REL_FILE} and ${CATALOG_REL_FILE}. Do not edit.`,
    '',
    'export interface StoryIndexEntry {',
    '  readonly storyId: string;',
    '  readonly component: string;',
    '  readonly category: string;',
    '  readonly variantNames: readonly string[];',
    '}',
    '',
    'export const STORY_INDEX: readonly StoryIndexEntry[] = [',
    ...matchedStories.map(
      (entry) =>
        `  { storyId: ${JSON.stringify(entry.storyId)}, component: ${JSON.stringify(entry.component)}, category: ${JSON.stringify(entry.category)}, variantNames: [${entry.variantNames.map((v) => JSON.stringify(v)).join(', ')}] },`,
    ),
    '];',
    '',
  ];

  const prettierCfg =
    (await resolveConfig(path.join(REPO_ROOT, 'config/.prettierrc'), {
      config: path.join(REPO_ROOT, 'config/.prettierrc'),
    })) ?? {};
  const code = await format(lines.join('\n'), {
    ...prettierCfg,
    parser: 'typescript',
  });

  return { code, count: matchedStories.length };
}

export async function syncStories(options?: {
  readonly root?: string;
}): Promise<{ readonly changed: boolean; readonly count: number }> {
  const root = options?.root ?? REPO_ROOT;
  const { code, count } = await renderStoryIndexGeneratedTs(root);
  const outPath = path.join(root, GENERATED_STORIES_FILE);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  if (existing === code) {
    return { changed: false, count };
  }
  fs.writeFileSync(outPath, code, 'utf8');
  return { changed: true, count };
}

export async function run(options?: { readonly root?: string }): Promise<CheckResult> {
  const root = options?.root ?? REPO_ROOT;
  try {
    const { code, count } = await renderStoryIndexGeneratedTs(root);
    const outPath = path.join(root, GENERATED_STORIES_FILE);
    if (!fs.existsSync(outPath)) {
      return fail(`missing ${GENERATED_STORIES_FILE} (run ${SYNC_STORIES_COMMAND})`);
    }
    const existing = fs.readFileSync(outPath, 'utf8');
    if (existing !== code) {
      return fail(`${GENERATED_STORIES_FILE} is out of date (run ${SYNC_STORIES_COMMAND})`);
    }
    return pass(`${GENERATED_STORIES_FILE} covers all ${String(count)} @bslt/ui component exports`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
