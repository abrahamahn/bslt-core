// main/tools/sync/modules.ts
/**
 * `bslt sync modules`: generates static install lists, package dependencies,
 * TypeScript project references, ESLint's module dependency graph, and module
 * README reference blocks from `bslt.config.ts` and `main/modules/*`
 * (restructure plan, sections 6.5 and 14.2).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { KNOWN_OPTIONAL_MODULE_IDS } from '../gates/optional-module-isolation';
import { fail, pass, type CheckResult } from '../gates/types';
import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';

export const SYNC_MODULES_COMMAND = 'pnpm bslt sync modules';

export const GENERATED_MODULES_DIRECTORIES = [
  'main/apps/server/src/generated',
  'main/apps/web/src/generated',
  'main/tools/generated',
] as const;

const SERVER_GENERATED_MODULES = 'main/apps/server/src/generated/modules.ts';
const WEB_GENERATED_MODULES = 'main/apps/web/src/generated/modules.ts';
const WEB_GENERATED_PUBLIC_MODULES = 'main/apps/web/src/generated/public-modules.ts';
const MODULE_GRAPH_JSON = 'main/tools/generated/module-graph.json';
const README_START_MARKER = '<!-- bslt:generated reference -->';
const README_END_MARKER = '<!-- /bslt:generated -->';

export interface ParsedEndpointSummary {
  readonly key: string;
  readonly method: string;
  readonly path: string;
  readonly auth: string;
  readonly summary: string;
}

interface ParsedEventSummary {
  readonly key: string;
  readonly name: string;
  readonly webhook: boolean;
}

export interface ParsedModuleInfo {
  readonly id: string;
  readonly manifestExport: string;
  readonly serverExport: string;
  readonly webExport: string | null;
  readonly publicRoutesExport: string | null;
  readonly summary: string;
  readonly status: string;
  readonly dependsOn: readonly string[];
  readonly tables: readonly string[];
  readonly web: boolean;
  readonly endpoints: readonly ParsedEndpointSummary[];
  readonly eventsObjectIdent: string | null;
  readonly events: readonly ParsedEventSummary[];
  readonly eventKeys: readonly string[];
  readonly jobKeys: readonly string[];
}

export interface ParsedModulesWorkspace {
  readonly installedIds: readonly string[];
  readonly devOnlyIds: readonly string[];
  readonly modules: ReadonlyMap<string, ParsedModuleInfo>;
}

function parseSourceFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
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

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function objectProperties(obj: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const map = new Map<string, ts.Expression>();
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = propertyName(prop.name);
      if (key !== undefined) map.set(key, prop.initializer);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      map.set(prop.name.text, prop.name);
    }
  }
  return map;
}

function collectModuleSpecifierImports(file: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const match = /^@bslt\/([a-z][a-z0-9-]*)\/module$/u.exec(stmt.moduleSpecifier.text);
    if (match?.[1] === undefined) continue;
    const moduleId = match[1];
    const bindings = stmt.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        map.set(element.name.text, moduleId);
      }
    }
  }
  return map;
}

function findExportedCallName(
  file: ts.SourceFile,
  calleeName: string,
): {
  readonly exportName: string;
  readonly arg: ts.ObjectLiteralExpression;
} | null {
  for (const stmt of file.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue;
      const init = unwrap(decl.initializer);
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === calleeName &&
        init.arguments[0] !== undefined
      ) {
        const arg = unwrap(init.arguments[0]);
        if (ts.isObjectLiteralExpression(arg)) {
          return { exportName: decl.name.text, arg };
        }
      }
    }
  }
  return null;
}

function describeAuthNode(node: ts.Expression | undefined): string {
  if (node === undefined) return 'unknown';
  const unwrapped = unwrap(node);
  if (ts.isStringLiteral(unwrapped)) return unwrapped.text;
  if (ts.isObjectLiteralExpression(unwrapped)) {
    const props = objectProperties(unwrapped);
    const orgNode = props.get('org');
    if (orgNode !== undefined && ts.isStringLiteral(unwrap(orgNode))) {
      return `org:${(unwrap(orgNode) as ts.StringLiteral).text}`;
    }
    const webhookNode = props.get('webhook');
    if (webhookNode !== undefined && ts.isStringLiteral(unwrap(webhookNode))) {
      return `webhook:${(unwrap(webhookNode) as ts.StringLiteral).text}`;
    }
  }
  return 'custom';
}

function parseEndpointsFromObject(obj: ts.ObjectLiteralExpression): ParsedEndpointSummary[] {
  const endpoints: ParsedEndpointSummary[] = [];
  for (const [key, expr] of objectProperties(obj)) {
    const unwrapped = unwrap(expr);
    if (
      ts.isCallExpression(unwrapped) &&
      ts.isIdentifier(unwrapped.expression) &&
      unwrapped.expression.text === 'endpoint' &&
      unwrapped.arguments[0] !== undefined
    ) {
      const arg = unwrap(unwrapped.arguments[0]);
      if (ts.isObjectLiteralExpression(arg)) {
        const fields = objectProperties(arg);
        const methodNode = fields.get('method');
        const pathNode = fields.get('path');
        const summaryNode = fields.get('summary');
        endpoints.push({
          key,
          method:
            methodNode !== undefined && ts.isStringLiteral(unwrap(methodNode))
              ? (unwrap(methodNode) as ts.StringLiteral).text
              : 'GET',
          path:
            pathNode !== undefined && ts.isStringLiteral(unwrap(pathNode))
              ? (unwrap(pathNode) as ts.StringLiteral).text
              : '',
          auth: describeAuthNode(fields.get('auth')),
          summary:
            summaryNode !== undefined && ts.isStringLiteral(unwrap(summaryNode))
              ? (unwrap(summaryNode) as ts.StringLiteral).text
              : '',
        });
      }
    }
  }
  return endpoints;
}

function parseModuleEndpoints(
  moduleDir: string,
  endpointsField: ts.Expression | undefined,
): ParsedEndpointSummary[] {
  if (endpointsField === undefined) return [];
  const unwrapped = unwrap(endpointsField);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return parseEndpointsFromObject(unwrapped);
  }
  const endpointsFile = path.join(moduleDir, 'contract/endpoints.ts');
  if (!existsSync(endpointsFile)) return [];
  const sf = parseSourceFile(endpointsFile);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue;
      if (ts.isIdentifier(unwrapped) && decl.name.text !== unwrapped.text) continue;
      const obj = unwrap(decl.initializer);
      if (ts.isObjectLiteralExpression(obj)) {
        return parseEndpointsFromObject(obj);
      }
    }
  }
  return [];
}

function parseEventsFromObject(obj: ts.ObjectLiteralExpression): ParsedEventSummary[] {
  const events: ParsedEventSummary[] = [];
  for (const [key, expr] of objectProperties(obj)) {
    const unwrapped = unwrap(expr);
    if (
      ts.isCallExpression(unwrapped) &&
      ts.isIdentifier(unwrapped.expression) &&
      unwrapped.expression.text === 'event'
    ) {
      const nameArg = unwrapped.arguments[0] !== undefined ? unwrap(unwrapped.arguments[0]) : null;
      const metaArg = unwrapped.arguments[2] !== undefined ? unwrap(unwrapped.arguments[2]) : null;
      const name = nameArg !== null && ts.isStringLiteral(nameArg) ? nameArg.text : '';
      let webhook = false;
      if (metaArg !== null && ts.isObjectLiteralExpression(metaArg)) {
        const webhookNode = objectProperties(metaArg).get('webhook');
        webhook =
          webhookNode !== undefined && unwrap(webhookNode).kind === ts.SyntaxKind.TrueKeyword;
      }
      events.push({ key, name, webhook });
    } else if (ts.isObjectLiteralExpression(unwrapped)) {
      const fields = objectProperties(unwrapped);
      const nameNode = fields.get('name');
      const webhookNode = fields.get('webhook');
      events.push({
        key,
        name:
          nameNode !== undefined && ts.isStringLiteral(unwrap(nameNode))
            ? (unwrap(nameNode) as ts.StringLiteral).text
            : '',
        webhook:
          webhookNode !== undefined && unwrap(webhookNode).kind === ts.SyntaxKind.TrueKeyword,
      });
    } else {
      events.push({ key, name: '', webhook: false });
    }
  }
  return events;
}

function parseModuleEvents(
  moduleDir: string,
  eventsField: ts.Expression | undefined,
): { readonly ident: string | null; readonly events: readonly ParsedEventSummary[] } {
  if (eventsField === undefined) return { ident: null, events: [] };
  const unwrapped = unwrap(eventsField);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return { ident: null, events: parseEventsFromObject(unwrapped) };
  }
  const ident = ts.isIdentifier(unwrapped) ? unwrapped.text : null;
  for (const candidateRel of ['contract/events.ts', 'contract/index.ts']) {
    const candidatePath = path.join(moduleDir, candidateRel);
    if (!existsSync(candidatePath)) continue;
    const sf = parseSourceFile(candidatePath);
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue;
        if (ident !== null && decl.name.text !== ident) continue;
        const obj = unwrap(decl.initializer);
        if (ts.isObjectLiteralExpression(obj)) {
          return { ident, events: parseEventsFromObject(obj) };
        }
      }
    }
  }
  return { ident, events: [] };
}

function parseObjectKeys(
  moduleDir: string,
  subFile: string,
  expr: ts.Expression | undefined,
): string[] {
  if (expr === undefined) return [];
  const unwrapped = unwrap(expr);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return [...objectProperties(unwrapped).keys()];
  }
  const filePath = path.join(moduleDir, subFile);
  if (!existsSync(filePath)) return [];
  const sf = parseSourceFile(filePath);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue;
      if (ts.isIdentifier(unwrapped) && decl.name.text !== unwrapped.text) continue;
      const obj = unwrap(decl.initializer);
      if (ts.isObjectLiteralExpression(obj)) {
        return [...objectProperties(obj).keys()];
      }
    }
  }
  return [];
}

function parseModuleInfo(root: string, moduleId: string): ParsedModuleInfo {
  const moduleDir = path.join(root, 'main/modules', moduleId);
  const manifestPath = path.join(moduleDir, 'module.ts');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing module manifest: main/modules/${moduleId}/module.ts`);
  }
  const sf = parseSourceFile(manifestPath);
  const importedModules = collectModuleSpecifierImports(sf);
  const found = findExportedCallName(sf, 'defineModule');
  if (found === null) {
    throw new Error(
      `main/modules/${moduleId}/module.ts must export const <name> = defineModule({...})`,
    );
  }

  const props = objectProperties(found.arg);
  const idNode = props.get('id');
  const declaredId =
    idNode !== undefined && ts.isStringLiteral(unwrap(idNode))
      ? (unwrap(idNode) as ts.StringLiteral).text
      : '';
  if (declaredId !== moduleId) {
    throw new Error(
      `main/modules/${moduleId}/module.ts declares id "${declaredId}", expected "${moduleId}"`,
    );
  }

  const summaryNode = props.get('summary');
  const summary =
    summaryNode !== undefined && ts.isStringLiteral(unwrap(summaryNode))
      ? (unwrap(summaryNode) as ts.StringLiteral).text
      : '';

  const statusNode = props.get('status');
  const status =
    statusNode !== undefined && ts.isStringLiteral(unwrap(statusNode))
      ? (unwrap(statusNode) as ts.StringLiteral).text
      : 'stable';

  const dependsOn: string[] = [];
  const dependsNode = props.get('dependsOn');
  if (dependsNode !== undefined && ts.isArrayLiteralExpression(unwrap(dependsNode))) {
    for (const el of (unwrap(dependsNode) as ts.ArrayLiteralExpression).elements) {
      const target = unwrap(el);
      if (!ts.isIdentifier(target)) {
        throw new Error(
          `main/modules/${moduleId}/module.ts: dependsOn entries must be imported module identifiers`,
        );
      }
      const depId = importedModules.get(target.text);
      if (depId === undefined) {
        throw new Error(
          `main/modules/${moduleId}/module.ts: dependsOn identifier "${target.text}" must be imported from "@bslt/<id>/module"`,
        );
      }
      dependsOn.push(depId);
    }
  }

  const tables: string[] = [];
  const tablesNode = props.get('tables');
  if (tablesNode !== undefined && ts.isArrayLiteralExpression(unwrap(tablesNode))) {
    for (const el of (unwrap(tablesNode) as ts.ArrayLiteralExpression).elements) {
      const target = unwrap(el);
      if (ts.isStringLiteral(target)) {
        tables.push(target.text);
      }
    }
  }

  const webNode = props.get('web');
  const hasWeb = !(webNode !== undefined && unwrap(webNode).kind === ts.SyntaxKind.FalseKeyword);

  const serverIndexPath = path.join(moduleDir, 'server/index.ts');
  let serverExport = `${moduleId}Server`;
  if (existsSync(serverIndexPath)) {
    const serverFound = findExportedCallName(parseSourceFile(serverIndexPath), 'implementServer');
    if (serverFound !== null) {
      serverExport = serverFound.exportName;
    }
  }

  let webExport: string | null = null;
  let publicRoutesExport: string | null = null;
  if (hasWeb) {
    webExport = `${moduleId}Web`;
    const webIndexPath = path.join(moduleDir, 'web/index.ts');
    if (existsSync(webIndexPath)) {
      const webFound = findExportedCallName(parseSourceFile(webIndexPath), 'implementWeb');
      if (webFound !== null) {
        webExport = webFound.exportName;
      }
    }
    for (const ext of ['ts', 'tsx']) {
      const prPath = path.join(moduleDir, `web/public-routes.${ext}`);
      if (!existsSync(prPath)) continue;
      const prSf = parseSourceFile(prPath);
      for (const stmt of prSf.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text.endsWith('PublicRoutes')) {
            publicRoutesExport = decl.name.text;
          }
        }
      }
      if (publicRoutesExport === null) {
        publicRoutesExport = `${moduleId}PublicRoutes`;
      }
      break;
    }
  }

  const parsedEvents = parseModuleEvents(moduleDir, props.get('events'));

  return {
    id: moduleId,
    manifestExport: found.exportName,
    serverExport,
    webExport,
    publicRoutesExport,
    summary,
    status,
    dependsOn,
    tables,
    web: hasWeb,
    endpoints: parseModuleEndpoints(moduleDir, props.get('endpoints')),
    eventsObjectIdent: parsedEvents.ident,
    events: parsedEvents.events,
    eventKeys: parsedEvents.events.map((ev) => ev.key),
    jobKeys: parseObjectKeys(moduleDir, 'contract/jobs.ts', props.get('jobs')),
  };
}

function parseModuleIdList(
  listExpr: ts.Expression | undefined,
  importedModules: ReadonlyMap<string, string>,
  fieldName: string,
): string[] {
  if (listExpr === undefined) return [];
  const unwrapped = unwrap(listExpr);
  if (!ts.isArrayLiteralExpression(unwrapped)) {
    throw new Error(`bslt.config.ts: "${fieldName}" must be an array literal`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const el of unwrapped.elements) {
    const target = unwrap(el);
    if (!ts.isIdentifier(target)) {
      throw new Error(`bslt.config.ts: "${fieldName}" entries must be imported module identifiers`);
    }
    const moduleId = importedModules.get(target.text);
    if (moduleId === undefined) {
      throw new Error(
        `bslt.config.ts: "${target.text}" in "${fieldName}" must be imported from "@bslt/<id>/module"`,
      );
    }
    if (seen.has(moduleId)) {
      throw new Error(`bslt.config.ts: duplicate module "${moduleId}" in "${fieldName}"`);
    }
    seen.add(moduleId);
    ids.push(moduleId);
  }
  return ids;
}

export function loadModulesWorkspace(root: string = REPO_ROOT): ParsedModulesWorkspace {
  const configPath = path.join(root, 'bslt.config.ts');
  if (!existsSync(configPath)) {
    throw new Error('Missing root bslt.config.ts');
  }
  const configSf = parseSourceFile(configPath);
  const importedModules = collectModuleSpecifierImports(configSf);

  let configObj: ts.ObjectLiteralExpression | null = null;
  for (const stmt of configSf.statements) {
    if (!ts.isExportAssignment(stmt) || stmt.isExportEquals === true) continue;
    const expr = unwrap(stmt.expression);
    if (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === 'defineConfig' &&
      expr.arguments[0] !== undefined
    ) {
      const arg = unwrap(expr.arguments[0]);
      if (ts.isObjectLiteralExpression(arg)) {
        configObj = arg;
      }
    }
  }
  if (configObj === null) {
    throw new Error('bslt.config.ts must contain `export default defineConfig({...})`');
  }

  const configProps = objectProperties(configObj);
  const installedIds = parseModuleIdList(
    configProps.get('installedModules'),
    importedModules,
    'installedModules',
  );
  const devOnlyIds = parseModuleIdList(configProps.get('devOnly'), importedModules, 'devOnly');

  const modulesDir = path.join(root, 'main/modules');
  const discoveredIds = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareText)
    : [];

  const modules = new Map<string, ParsedModuleInfo>();
  for (const id of discoveredIds) {
    modules.set(id, parseModuleInfo(root, id));
  }

  for (const id of [...installedIds, ...devOnlyIds]) {
    if (!modules.has(id)) {
      throw new Error(
        `bslt.config.ts references module "${id}", which does not exist under main/modules/${id}`,
      );
    }
  }

  return { installedIds, devOnlyIds, modules };
}

function validateInstalledOrder(workspace: ParsedModulesWorkspace): void {
  const seen = new Set<string>();
  for (const id of [...workspace.installedIds, ...workspace.devOnlyIds]) {
    if (seen.has(id)) {
      throw new Error(`bslt.config.ts: duplicate module entry "${id}"`);
    }
    const mod = workspace.modules.get(id);
    if (mod === undefined) continue;
    for (const dep of mod.dependsOn) {
      if (!seen.has(dep)) {
        throw new Error(
          `bslt.config.ts: module "${id}" lists "${dep}" in dependsOn, so "${dep}" must appear before "${id}" in installedModules`,
        );
      }
    }
    seen.add(id);
  }
}

function getModuleOrThrow(workspace: ParsedModulesWorkspace, id: string): ParsedModuleInfo {
  const info = workspace.modules.get(id);
  if (info === undefined) {
    throw new Error(`bslt.config.ts: installed module "${id}" is missing from main/modules/${id}`);
  }
  return info;
}

function emitServerGeneratedModules(workspace: ParsedModulesWorkspace): string {
  const imports: string[] = [];
  const manifestTypes: string[] = [];
  const manifests: string[] = [];
  const servers: string[] = [];
  const devManifestTypes: string[] = [];
  const devManifests: string[] = [];
  const devServers: string[] = [];
  const installedSet = new Set(workspace.installedIds);
  const hasOrgs = installedSet.has('orgs');

  const allEntries = [
    ...workspace.installedIds.map((id, index) => ({
      id,
      listName: 'installedModules',
      index,
      info: getModuleOrThrow(workspace, id),
    })),
    ...workspace.devOnlyIds.map((id, index) => ({
      id,
      listName: 'devOnly',
      index,
      info: getModuleOrThrow(workspace, id),
    })),
  ].sort((a, b) => compareText(a.id, b.id));

  for (const { id, listName, index, info } of allEntries) {
    imports.push(
      `import { ${info.manifestExport} } from '@bslt/${id}/module'; // <- bslt.config.ts#${listName}[${String(index)}]`,
    );
    const serverNamed =
      id === 'orgs' && hasOrgs ? `${info.serverExport}, resolveActingOrg` : info.serverExport;
    imports.push(
      `import { ${serverNamed} } from '@bslt/${id}/server'; // <- bslt.config.ts#${listName}[${String(index)}]`,
    );
  }

  workspace.installedIds.forEach((id, index) => {
    const info = getModuleOrThrow(workspace, id);
    manifestTypes.push(
      `  typeof ${info.manifestExport}, // <- bslt.config.ts#installedModules[${String(index)}]`,
    );
    manifests.push(
      `  ${info.manifestExport}, // <- bslt.config.ts#installedModules[${String(index)}]`,
    );
    servers.push(`  ${info.serverExport}, // <- bslt.config.ts#installedModules[${String(index)}]`);
  });

  workspace.devOnlyIds.forEach((id, index) => {
    const info = getModuleOrThrow(workspace, id);
    devManifestTypes.push(
      `  typeof ${info.manifestExport}, // <- bslt.config.ts#devOnly[${String(index)}]`,
    );
    devManifests.push(`  ${info.manifestExport}, // <- bslt.config.ts#devOnly[${String(index)}]`);
    devServers.push(`  ${info.serverExport}, // <- bslt.config.ts#devOnly[${String(index)}]`);
  });

  const orgsBindingLines = hasOrgs
    ? ['export { resolveActingOrg };']
    : [
        'export function resolveActingOrg(',
        '  _db: unknown,',
        '  _tenantId: string,',
        '  _userId: string,',
        '): Promise<{ readonly orgId: string; readonly permissions: bigint } | null> {',
        '  return Promise.resolve(null);',
        '}',
      ];

  return [
    `// ${SERVER_GENERATED_MODULES}`,
    `// @generated by \`${SYNC_MODULES_COMMAND}\` from bslt.config.ts. Do not edit.`,
    ...imports,
    '',
    `import type { ServerImpls } from '@bslt/server-system/module';`,
    '',
    'export const installedModules: readonly [',
    ...manifestTypes,
    '] = [',
    ...manifests,
    '];',
    '',
    'export const installedServerModules: ServerImpls<typeof installedModules> = [',
    ...servers,
    '] as const satisfies ServerImpls<typeof installedModules>;',
    '',
    'export const devOnlyModules: readonly [',
    ...devManifestTypes,
    '] = [',
    ...devManifests,
    '];',
    '',
    'export const devOnlyServerModules: ServerImpls<typeof devOnlyModules> = [',
    ...devServers,
    '] as const satisfies ServerImpls<typeof devOnlyModules>;',
    '',
    ...orgsBindingLines,
    '',
  ].join('\n');
}

function emitWebGeneratedPublicModules(workspace: ParsedModulesWorkspace): string {
  const publicEntries = workspace.installedIds
    .map((id, index) => ({
      id,
      index,
      info: getModuleOrThrow(workspace, id),
    }))
    .filter(
      (
        entry,
      ): entry is {
        readonly id: string;
        readonly index: number;
        readonly info: ParsedModuleInfo & { readonly publicRoutesExport: string };
      } => entry.info.publicRoutesExport !== null,
    );

  const sortedForImports = [...publicEntries].sort((a, b) => compareText(a.id, b.id));
  const imports: string[] = [];
  for (const { id, index, info } of sortedForImports) {
    imports.push(
      `import { ${info.manifestExport} } from '@bslt/${id}/module'; // <- bslt.config.ts#installedModules[${String(index)}]`,
      `import { ${info.publicRoutesExport} } from '@bslt/${id}/web'; // <- bslt.config.ts#installedModules[${String(index)}]`,
    );
  }

  const manifests = publicEntries.map(
    ({ index, info }) =>
      `  ${info.manifestExport}, // <- bslt.config.ts#installedModules[${String(index)}]`,
  );
  const routeSpreads = publicEntries.map(
    ({ index, info }) =>
      `  ...widenPublicRoutes(${info.publicRoutesExport}), // <- bslt.config.ts#installedModules[${String(index)}]`,
  );
  const helperLines =
    publicEntries.length > 0
      ? [
          'function widenPublicRoutes<TSdk>(',
          '  routes: readonly PublicRoute<unknown, TSdk>[],',
          '): readonly PublicRoute<unknown>[] {',
          '  return routes as readonly PublicRoute<unknown>[];',
          '}',
          '',
        ]
      : [];

  return [
    `// ${WEB_GENERATED_PUBLIC_MODULES}`,
    `// @generated by \`${SYNC_MODULES_COMMAND}\` from bslt.config.ts. Do not edit.`,
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    `import type { PublicRoute } from '@bslt/web-platform';`,
    '',
    ...helperLines,
    'export const installedPublicSsrModules = [',
    ...manifests,
    '] as const;',
    '',
    'export const installedPublicSsrRoutes: readonly PublicRoute<unknown>[] = [',
    ...routeSpreads,
    '];',
    '',
  ].join('\n');
}

function emitWebGeneratedModules(workspace: ParsedModulesWorkspace): string {
  const imports: string[] = [];
  const typeImports: string[] = [];
  const manifestTypes: string[] = [];
  const manifests: string[] = [];
  const webs: string[] = [];
  const devManifestTypes: string[] = [];
  const devManifests: string[] = [];
  const devWebs: string[] = [];

  const installedSet = new Set(workspace.installedIds);
  const hasAdmin = installedSet.has('admin') && workspace.modules.get('admin')?.web === true;
  const hasAnalytics =
    installedSet.has('analytics') && workspace.modules.get('analytics')?.web === true;
  const hasBilling = installedSet.has('billing') && workspace.modules.get('billing')?.web === true;
  const hasFiles = installedSet.has('files') && workspace.modules.get('files')?.web === true;
  const hasNotifications =
    installedSet.has('notifications') && workspace.modules.get('notifications')?.web === true;
  const hasOrgs = installedSet.has('orgs') && workspace.modules.get('orgs')?.web === true;

  const allEntries = [
    ...workspace.installedIds.map((id, index) => ({
      id,
      listName: 'installedModules',
      index,
      info: getModuleOrThrow(workspace, id),
    })),
    ...workspace.devOnlyIds.map((id, index) => ({
      id,
      listName: 'devOnly',
      index,
      info: getModuleOrThrow(workspace, id),
    })),
  ].sort((a, b) => compareText(a.id, b.id));

  for (const { id, listName, index, info } of allEntries) {
    imports.push(
      `import { ${info.manifestExport} } from '@bslt/${id}/module'; // <- bslt.config.ts#${listName}[${String(index)}]`,
    );
    if (info.web && info.webExport !== null) {
      const extraSpecifiers: string[] = [info.webExport];
      if (id === 'admin' && hasAdmin) {
        extraSpecifiers.push(
          'healthStatusTone',
          'ImpersonationBanner as OptionalImpersonationBanner',
          'useAdminHealth as useOptionalAdminHealth',
          'useAdminMetrics as useOptionalAdminMetrics',
          'useJobsList as useOptionalJobsList',
          'useQueueStats as useOptionalQueueStats',
        );
      } else if (id === 'analytics' && hasAnalytics) {
        extraSpecifiers.push('AnalyticsTracker as OptionalAnalyticsTracker');
      } else if (id === 'billing' && hasBilling) {
        extraSpecifiers.push('useAdminPlans as useOptionalAdminPlans');
      } else if (id === 'files' && hasFiles) {
        extraSpecifiers.push(
          'AvatarUpload as OptionalAvatarUpload',
          'useMyAvatar as useOptionalMyAvatar',
        );
      } else if (id === 'notifications' && hasNotifications) {
        extraSpecifiers.push(
          'NotificationBell',
          'NotificationDropdown',
          'NotificationPreferencesForm as OptionalNotificationPreferencesForm',
          'useNotifications',
        );
      } else if (id === 'orgs' && hasOrgs) {
        extraSpecifiers.push(
          'OrgSwitcher as OptionalOrgSwitcher',
          'useAdminOrgs as useOptionalAdminOrgs',
        );
      }
      extraSpecifiers.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en-US'));
      imports.push(
        `import { ${extraSpecifiers.join(', ')} } from '@bslt/${id}/web'; // <- bslt.config.ts#${listName}[${String(index)}]`,
      );
    }
  }

  if (hasNotifications) {
    imports.push(`import { createElement, useCallback, useState } from 'react';`);
  }

  if (hasAdmin) {
    typeImports.push(`import type { SignalTone } from '@bslt/admin/web';`);
  }
  if (hasNotifications) {
    typeImports.push(`import type { NotificationItem } from '@bslt/notifications/contract';`);
  }
  typeImports.push(`import type { WebImpls } from '@bslt/web-platform';`);
  if (hasNotifications) {
    typeImports.push(`import type { ReactElement } from 'react';`);
  }

  workspace.installedIds.forEach((id, index) => {
    const info = getModuleOrThrow(workspace, id);
    manifestTypes.push(
      `  typeof ${info.manifestExport}, // <- bslt.config.ts#installedModules[${String(index)}]`,
    );
    manifests.push(
      `  ${info.manifestExport}, // <- bslt.config.ts#installedModules[${String(index)}]`,
    );
    const webExpr = info.web && info.webExport !== null ? info.webExport : 'null';
    webs.push(`  ${webExpr}, // <- bslt.config.ts#installedModules[${String(index)}]`);
  });

  workspace.devOnlyIds.forEach((id, index) => {
    const info = getModuleOrThrow(workspace, id);
    devManifestTypes.push(
      `  typeof ${info.manifestExport}, // <- bslt.config.ts#devOnly[${String(index)}]`,
    );
    devManifests.push(`  ${info.manifestExport}, // <- bslt.config.ts#devOnly[${String(index)}]`);
    const webExpr = info.web && info.webExport !== null ? info.webExport : 'null';
    devWebs.push(`  ${webExpr}, // <- bslt.config.ts#devOnly[${String(index)}]`);
  });

  const optionalLines: string[] = [
    `export const hasAdminModule: boolean = ${String(hasAdmin)};`,
    `export const hasBillingModule: boolean = ${String(hasBilling)};`,
    `export const hasFilesModule: boolean = ${String(hasFiles)};`,
    `export const hasNotificationsModule: boolean = ${String(hasNotifications)};`,
    `export const hasOrgsModule: boolean = ${String(hasOrgs)};`,
    '',
  ];

  if (hasAdmin) {
    optionalLines.push(
      'export {',
      '  healthStatusTone,',
      '  OptionalImpersonationBanner,',
      '  useOptionalAdminHealth,',
      '  useOptionalAdminMetrics,',
      '  useOptionalJobsList,',
      '  useOptionalQueueStats,',
      '};',
      'export type { SignalTone };',
      '',
    );
  } else {
    optionalLines.push(
      "export type SignalTone = 'success' | 'warning' | 'danger' | 'info';",
      '',
      'export function healthStatusTone(status: string | undefined): SignalTone {',
      "  if (status === 'healthy') return 'success';",
      "  if (status === 'degraded') return 'warning';",
      "  if (status === 'down') return 'danger';",
      "  return 'info';",
      '}',
      '',
      'export function OptionalImpersonationBanner(): null {',
      '  return null;',
      '}',
      '',
      'export function useOptionalAdminHealth(): {',
      '  readonly data:',
      '    | {',
      '        readonly status: string;',
      '        readonly services: Readonly<Record<string, string>>;',
      '      }',
      '    | undefined;',
      '  readonly isLoading: boolean;',
      '  readonly isError: boolean;',
      '  readonly error: Error | null;',
      '  readonly refetch: () => Promise<void>;',
      '} {',
      '  return {',
      '    data: undefined,',
      '    isLoading: false,',
      '    isError: false,',
      '    error: null,',
      '    refetch: () => Promise.resolve(),',
      '  };',
      '}',
      '',
      'export function useOptionalAdminMetrics(): {',
      '  readonly data:',
      '    | {',
      '        readonly metrics?: {',
      '          readonly totalRequests: number;',
      '          readonly avgResponseTime: number;',
      '          readonly errorRate: number;',
      '          readonly activeConnections: number;',
      '          readonly requestsPerSecond: number;',
      '          readonly p95ResponseTime: number;',
      '          readonly p99ResponseTime: number;',
      '        };',
      '        readonly queue?: { readonly pending: number; readonly failed: number } | null;',
      '      }',
      '    | undefined;',
      '  readonly isLoading: boolean;',
      '  readonly isError: boolean;',
      '  readonly error: Error | null;',
      '  readonly refetch: () => Promise<void>;',
      '} {',
      '  return {',
      '    data: undefined,',
      '    isLoading: false,',
      '    isError: false,',
      '    error: null,',
      '    refetch: () => Promise.resolve(),',
      '  };',
      '}',
      '',
      'export function useOptionalQueueStats(): {',
      '  readonly data:',
      '    | {',
      '        readonly pending: number;',
      '        readonly failed: number;',
      '        readonly deadLetter: number;',
      '        readonly failureRate: number;',
      '      }',
      '    | undefined;',
      '  readonly isLoading: boolean;',
      '  readonly isError: boolean;',
      '  readonly error: Error | null;',
      '  readonly refetch: () => Promise<void>;',
      '} {',
      '  return {',
      '    data: undefined,',
      '    isLoading: false,',
      '    isError: false,',
      '    error: null,',
      '    refetch: () => Promise.resolve(),',
      '  };',
      '}',
      '',
      'export function useOptionalJobsList(_options?: {',
      '  readonly pagination?: { readonly limit?: number };',
      '}): {',
      '  readonly data: undefined;',
      '  readonly isLoading: boolean;',
      '  readonly isError: boolean;',
      '  readonly error: Error | null;',
      '  readonly refetch: () => Promise<void>;',
      '} {',
      '  return {',
      '    data: undefined,',
      '    isLoading: false,',
      '    isError: false,',
      '    error: null,',
      '    refetch: () => Promise.resolve(),',
      '  };',
      '}',
      '',
    );
  }

  if (hasAnalytics) {
    optionalLines.push('export { OptionalAnalyticsTracker };', '');
  } else {
    optionalLines.push(
      'export function OptionalAnalyticsTracker(_props: { readonly canTrack: () => boolean }): null {',
      '  return null;',
      '}',
      '',
    );
  }

  if (hasBilling) {
    optionalLines.push('export { useOptionalAdminPlans };', '');
  } else {
    optionalLines.push(
      'export function useOptionalAdminPlans(): {',
      '  readonly plans: readonly { readonly isActive: boolean }[];',
      '  readonly isLoading: boolean;',
      '  readonly error: Error | null;',
      '  readonly refresh: () => Promise<void>;',
      '} {',
      '  return {',
      '    plans: [],',
      '    isLoading: false,',
      '    error: null,',
      '    refresh: () => Promise.resolve(),',
      '  };',
      '}',
      '',
    );
  }

  if (hasFiles) {
    optionalLines.push('export { OptionalAvatarUpload, useOptionalMyAvatar };', '');
  } else {
    optionalLines.push(
      'export function OptionalAvatarUpload(_props: {',
      '  readonly userName: string;',
      '  readonly onSuccess?: () => void;',
      '}): null {',
      '  return null;',
      '}',
      '',
      'export function useOptionalMyAvatar(_options?: { readonly enabled?: boolean }): {',
      '  readonly avatarUrl: string | null;',
      '  readonly fileId: string | null;',
      '  readonly isLoading: boolean;',
      '  readonly error: Error | null;',
      '  readonly refetch: () => void;',
      '} {',
      '  return {',
      '    avatarUrl: null,',
      '    fileId: null,',
      '    isLoading: false,',
      '    error: null,',
      '    refetch: () => {},',
      '  };',
      '}',
      '',
    );
  }

  if (hasOrgs) {
    optionalLines.push('export { OptionalOrgSwitcher, useOptionalAdminOrgs };', '');
  } else {
    optionalLines.push(
      'export function OptionalOrgSwitcher(): null {',
      '  return null;',
      '}',
      '',
      'export function useOptionalAdminOrgs(): {',
      '  readonly tenants: readonly { readonly isActive: boolean }[];',
      '  readonly total: number;',
      '  readonly isLoading: boolean;',
      '  readonly error: string | null;',
      '  readonly refresh: () => Promise<void>;',
      '} {',
      '  return {',
      '    tenants: [],',
      '    total: 0,',
      '    isLoading: false,',
      '    error: null,',
      '    refresh: () => Promise.resolve(),',
      '  };',
      '}',
      '',
    );
  }

  optionalLines.push(
    'export interface OptionalHeaderNotificationsProps {',
    '  readonly enabled: boolean;',
    '  readonly userId: string | undefined;',
    '  readonly subscribeRealtime: (',
    '    key: `record:${string}:${string}`,',
    '    onInvalidate: () => void,',
    '  ) => () => void;',
    '  readonly onResolveRoute: (',
    '    data: Readonly<Record<string, unknown>> | null | undefined,',
    '  ) => string | null;',
    '  readonly onNavigate: (to: string) => void;',
    '}',
    '',
  );

  if (hasNotifications) {
    optionalLines.push(
      'export { OptionalNotificationPreferencesForm };',
      '',
      'export function OptionalHeaderNotifications({',
      '  enabled,',
      '  userId,',
      '  subscribeRealtime,',
      '  onResolveRoute,',
      '  onNavigate,',
      '}: OptionalHeaderNotificationsProps): ReactElement {',
      '  const [open, setOpen] = useState(false);',
      '  const notifications = useNotifications({',
      '    enabled,',
      '    limit: 10,',
      '    userId,',
      '    subscribeRealtime,',
      '  });',
      '  const handleClick = useCallback(',
      '    (notification: NotificationItem): void => {',
      '      const route = onResolveRoute(notification.data);',
      '      setOpen(false);',
      '      if (route !== null) {',
      '        onNavigate(route);',
      '      }',
      '    },',
      '    [onNavigate, onResolveRoute],',
      '  );',
      '  return createElement(',
      "    'div',",
      "    { className: 'relative' },",
      '    createElement(NotificationBell, {',
      '      unreadCount: notifications.unreadCount,',
      '      isOpen: open,',
      '      onToggle: () => {',
      '        setOpen((prev) => !prev);',
      '      },',
      '    }),',
      '    open',
      '      ? createElement(NotificationDropdown, {',
      '          notifications: notifications.notifications,',
      '          isLoading: notifications.isLoading,',
      '          onMarkAsRead: notifications.markAsRead,',
      '          onMarkAllAsRead: notifications.markAllAsRead,',
      '          onDelete: notifications.deleteNotification,',
      '          onClose: () => {',
      '            setOpen(false);',
      '          },',
      '          onNotificationClick: handleClick,',
      '        })',
      '      : null,',
      '  );',
      '}',
      '',
    );
  } else {
    optionalLines.push(
      'export function OptionalNotificationPreferencesForm(): null {',
      '  return null;',
      '}',
      '',
      'export function OptionalHeaderNotifications(_props: OptionalHeaderNotificationsProps): null {',
      '  return null;',
      '}',
      '',
    );
  }

  return [
    `// ${WEB_GENERATED_MODULES}`,
    `// @generated by \`${SYNC_MODULES_COMMAND}\` from bslt.config.ts. Do not edit.`,
    ...imports,
    '',
    ...typeImports,
    '',
    'export const installedModules: readonly [',
    ...manifestTypes,
    '] = [',
    ...manifests,
    '];',
    '',
    'export const installedWebModules: WebImpls<typeof installedModules> = [',
    ...webs,
    '] as const satisfies WebImpls<typeof installedModules>;',
    '',
    'export const devOnlyModules: readonly [',
    ...devManifestTypes,
    '] = [',
    ...devManifests,
    '];',
    '',
    'export const devOnlyWebModules: WebImpls<typeof devOnlyModules> = [',
    ...devWebs,
    '] as const satisfies WebImpls<typeof devOnlyModules>;',
    '',
    ...optionalLines,
  ].join('\n');
}

function emitModuleGraphJson(workspace: ParsedModulesWorkspace): string {
  const entries = [...workspace.modules.values()]
    .sort((a, b) => compareText(a.id, b.id))
    .map((mod) => ({
      id: mod.id,
      dependsOn: [...mod.dependsOn],
    }));

  return JSON.stringify(
    {
      $comment: `@generated by \`${SYNC_MODULES_COMMAND}\` from bslt.config.ts and main/modules/*/module.ts. Do not edit.`,
      modules: entries,
    },
    null,
    2,
  );
}

function updateAppPackageJson(
  existingContent: string,
  installedIds: readonly string[],
  knownModuleIds: ReadonlySet<string>,
): string {
  const parsed = JSON.parse(existingContent) as Record<string, unknown>;
  const currentDeps = (parsed['dependencies'] ?? {}) as Record<string, string>;
  const nextDeps: Record<string, string> = {};
  const installedSet = new Set(installedIds);

  for (const [pkg, version] of Object.entries(currentDeps)) {
    const match = /^@bslt\/([a-z][a-z0-9-]*)$/u.exec(pkg);
    const modId = match?.[1];
    if (modId !== undefined && knownModuleIds.has(modId) && !installedSet.has(modId)) {
      continue;
    }
    nextDeps[pkg] = version;
  }

  for (const id of installedIds) {
    nextDeps[`@bslt/${id}`] = 'workspace:*';
  }

  const sortedDeps: Record<string, string> = {};
  for (const key of Object.keys(nextDeps).sort(compareText)) {
    const val = nextDeps[key];
    if (val !== undefined) sortedDeps[key] = val;
  }

  parsed['dependencies'] = sortedDeps;
  return JSON.stringify(parsed, null, 2);
}

function updateRootPackageJson(
  existingContent: string,
  referencedIds: readonly string[],
  knownModuleIds: ReadonlySet<string>,
): string {
  const parsed = JSON.parse(existingContent) as Record<string, unknown>;
  const scripts = parsed['scripts'];
  if (typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)) {
    const mutableScripts = scripts as Record<string, unknown>;
    const postbuild = mutableScripts['postbuild'];
    if (typeof postbuild === 'string') {
      const moduleDistPattern = /(?:\bmain\/modules\/[a-z][a-z0-9-]*\/dist(?:\s+|$))+/u;
      if (moduleDistPattern.test(postbuild)) {
        const replacement = referencedIds.map((id) => `main/modules/${id}/dist`).join(' ');
        mutableScripts['postbuild'] = postbuild.replace(
          moduleDistPattern,
          (matched) => `${replacement}${matched.endsWith(' ') ? ' ' : ''}`,
        );
      }
    }
  }

  const currentDevDeps = (parsed['devDependencies'] ?? {}) as Record<string, string>;
  const nextDevDeps: Record<string, string> = {};
  const referencedSet = new Set(referencedIds);

  for (const [pkg, version] of Object.entries(currentDevDeps)) {
    const match = /^@bslt\/([a-z][a-z0-9-]*)$/u.exec(pkg);
    const modId = match?.[1];
    if (modId !== undefined && knownModuleIds.has(modId) && !referencedSet.has(modId)) {
      continue;
    }
    nextDevDeps[pkg] = version;
  }

  nextDevDeps['@bslt/contract'] = 'workspace:*';
  for (const id of referencedIds) {
    nextDevDeps[`@bslt/${id}`] = 'workspace:*';
  }

  const sortedDevDeps: Record<string, string> = {};
  for (const key of Object.keys(nextDevDeps).sort(compareText)) {
    const val = nextDevDeps[key];
    if (val !== undefined) sortedDevDeps[key] = val;
  }

  parsed['devDependencies'] = sortedDevDeps;
  return JSON.stringify(parsed, null, 2);
}

function updateTestsPackageJson(
  existingContent: string,
  referencedIds: readonly string[],
  knownModuleIds: ReadonlySet<string>,
): string {
  const parsed = JSON.parse(existingContent) as Record<string, unknown>;
  const currentDevDeps = (parsed['devDependencies'] ?? {}) as Record<string, string>;
  const nextDevDeps: Record<string, string> = {};
  const referencedSet = new Set(referencedIds);

  for (const [pkg, version] of Object.entries(currentDevDeps)) {
    const match = /^@bslt\/([a-z][a-z0-9-]*)$/u.exec(pkg);
    const modId = match?.[1];
    if (modId !== undefined && knownModuleIds.has(modId) && !referencedSet.has(modId)) {
      continue;
    }
    nextDevDeps[pkg] = version;
  }

  const sortedDevDeps: Record<string, string> = {};
  for (const key of Object.keys(nextDevDeps).sort(compareText)) {
    const val = nextDevDeps[key];
    if (val !== undefined) sortedDevDeps[key] = val;
  }

  parsed['devDependencies'] = sortedDevDeps;
  return JSON.stringify(parsed, null, 2);
}

function updateDockerfileModuleCopies(
  existingContent: string,
  installedIds: readonly string[],
): string {
  const copyPattern =
    /^(?:COPY main\/modules\/[a-z][a-z0-9-]*\/package\.json main\/modules\/[a-z][a-z0-9-]*\/\r?\n)+/mu;
  if (!copyPattern.test(existingContent)) return existingContent;
  const replacement = `${[...installedIds]
    .sort(compareText)
    .map((id) => `COPY main/modules/${id}/package.json main/modules/${id}/`)
    .join('\n')}\n`;
  return existingContent.replace(copyPattern, replacement);
}

function updateAppTsconfigJson(existingContent: string, installedIds: readonly string[]): string {
  const parsed = JSON.parse(existingContent) as Record<string, unknown>;
  const existingRefs = Array.isArray(parsed['references'])
    ? (parsed['references'] as Array<{ path?: string }>)
    : [];

  const preservedRefs = existingRefs.filter(
    (entry) => typeof entry.path === 'string' && !entry.path.startsWith('../../modules/'),
  );
  const moduleRefs = [...installedIds]
    .sort(compareText)
    .map((id) => ({ path: `../../modules/${id}` }));

  parsed['references'] = [...preservedRefs, ...moduleRefs];
  return JSON.stringify(parsed, null, 2);
}

function renderModuleReferenceBlock(mod: ParsedModuleInfo): string {
  const depsText =
    mod.dependsOn.length === 0 ? '_None_' : mod.dependsOn.map((d) => `\`@bslt/${d}\``).join(', ');
  const tablesText =
    mod.tables.length === 0 ? '_None_' : mod.tables.map((t) => `\`${t}\``).join(', ');
  const eventsText =
    mod.events.length === 0
      ? '_None_'
      : mod.events
          .map((ev) => {
            const label = ev.name !== '' ? ev.name : ev.key;
            return ev.webhook ? `\`${label}\` (webhook)` : `\`${label}\``;
          })
          .join(', ');
  const jobsText =
    mod.jobKeys.length === 0 ? '_None_' : mod.jobKeys.map((j) => `\`${j}\``).join(', ');

  const lines: string[] = [
    README_START_MARKER,
    `<!-- @generated by \`${SYNC_MODULES_COMMAND}\` from main/modules/${mod.id}/module.ts. Do not edit inside this block. -->`,
    '',
    '## Module Reference',
    '',
    `- **ID:** \`${mod.id}\``,
    `- **Status:** \`${mod.status}\``,
    `- **Summary:** ${mod.summary}`,
    `- **Dependencies:** ${depsText}`,
    `- **Web Binding:** ${mod.web ? 'yes' : 'no (`web: false`)'}`,
    `- **Owned Tables:** ${tablesText}`,
    `- **Published Events:** ${eventsText}`,
    `- **Jobs:** ${jobsText}`,
    '',
    '### Endpoints',
    '',
  ];

  if (mod.endpoints.length === 0) {
    lines.push('_No HTTP endpoints declared._');
  } else {
    lines.push('| Key | Method | Path | Auth | Summary |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const ep of mod.endpoints) {
      lines.push(
        `| \`${ep.key}\` | \`${ep.method}\` | \`${ep.path}\` | \`${ep.auth}\` | ${ep.summary} |`,
      );
    }
  }

  lines.push('', README_END_MARKER);
  return lines.join('\n');
}

function updateModuleReadme(
  existingContent: string,
  mod: ParsedModuleInfo,
  relPath: string,
): string {
  const startIdx = existingContent.indexOf(README_START_MARKER);
  const endIdx = existingContent.indexOf(README_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `${relPath}: missing \`${README_START_MARKER}\` ... \`${README_END_MARKER}\` markers`,
    );
  }
  const before = existingContent.slice(0, startIdx);
  const after = existingContent.slice(endIdx + README_END_MARKER.length);
  return `${before}${renderModuleReferenceBlock(mod)}${after}`;
}

async function formatFiles(
  files: ReadonlyMap<string, string>,
  root: string,
): Promise<Map<string, string>> {
  const prettier = await import('prettier');
  const configPath = path.join(root, 'config/.prettierrc');
  const config = existsSync(configPath)
    ? await prettier.resolveConfig(path.join(root, 'bslt.config.ts'), { config: configPath })
    : null;
  const formatted = new Map<string, string>();
  for (const [relPath, content] of files) {
    if (!/\.(?:ts|tsx|json|md)$/u.test(relPath)) {
      formatted.set(relPath, content);
      continue;
    }
    formatted.set(
      relPath,
      await prettier.format(content, { ...(config ?? {}), filepath: path.join(root, relPath) }),
    );
  }
  return formatted;
}

function existingGeneratedFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dirRel: string): void => {
    const abs = path.join(root, dirRel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = `${dirRel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else found.push(child);
    }
  };
  for (const dirRel of GENERATED_MODULES_DIRECTORIES) walk(dirRel);
  return found.sort(compareText);
}

export interface SyncModulesOptions {
  readonly check?: boolean;
  readonly root?: string;
}

export interface SyncModulesResult {
  readonly stale: readonly string[];
  readonly orphans: readonly string[];
  readonly total: number;
}

export function emitModulesFiles(root: string = REPO_ROOT): Map<string, string> {
  const workspace = loadModulesWorkspace(root);
  validateInstalledOrder(workspace);

  const files = new Map<string, string>();
  const knownModuleIds = new Set<string>([
    ...KNOWN_OPTIONAL_MODULE_IDS,
    ...workspace.modules.keys(),
  ]);

  files.set(SERVER_GENERATED_MODULES, emitServerGeneratedModules(workspace));
  files.set(WEB_GENERATED_MODULES, emitWebGeneratedModules(workspace));
  files.set(WEB_GENERATED_PUBLIC_MODULES, emitWebGeneratedPublicModules(workspace));
  files.set(MODULE_GRAPH_JSON, emitModuleGraphJson(workspace));

  const referencedIds = [...new Set([...workspace.installedIds, ...workspace.devOnlyIds])];

  for (const appPkgRel of ['main/apps/server/package.json', 'main/apps/web/package.json']) {
    const abs = path.join(root, appPkgRel);
    if (existsSync(abs)) {
      files.set(
        appPkgRel,
        updateAppPackageJson(readFileSync(abs, 'utf8'), referencedIds, knownModuleIds),
      );
    }
  }

  const rootPkgRel = 'package.json';
  const rootPkgAbs = path.join(root, rootPkgRel);
  if (existsSync(rootPkgAbs)) {
    files.set(
      rootPkgRel,
      updateRootPackageJson(readFileSync(rootPkgAbs, 'utf8'), referencedIds, knownModuleIds),
    );
  }

  const testsPkgRel = 'tests/package.json';
  const testsPkgAbs = path.join(root, testsPkgRel);
  if (existsSync(testsPkgAbs)) {
    files.set(
      testsPkgRel,
      updateTestsPackageJson(readFileSync(testsPkgAbs, 'utf8'), referencedIds, knownModuleIds),
    );
  }

  for (const dockerfileRel of ['infra/docker/Dockerfile', 'infra/docker/Dockerfile.web']) {
    const abs = path.join(root, dockerfileRel);
    if (existsSync(abs)) {
      files.set(
        dockerfileRel,
        updateDockerfileModuleCopies(readFileSync(abs, 'utf8'), referencedIds),
      );
    }
  }

  for (const appTsRel of ['main/apps/server/tsconfig.json', 'main/apps/web/tsconfig.json']) {
    const abs = path.join(root, appTsRel);
    if (existsSync(abs)) {
      files.set(appTsRel, updateAppTsconfigJson(readFileSync(abs, 'utf8'), referencedIds));
    }
  }

  for (const mod of workspace.modules.values()) {
    const readmeRel = `main/modules/${mod.id}/README.md`;
    const abs = path.join(root, readmeRel);
    if (!existsSync(abs)) {
      throw new Error(`Missing module README: ${readmeRel}`);
    }
    files.set(readmeRel, updateModuleReadme(readFileSync(abs, 'utf8'), mod, readmeRel));
  }

  return files;
}

export async function syncModules(options: SyncModulesOptions = {}): Promise<SyncModulesResult> {
  const root = options.root ?? REPO_ROOT;
  const files = await formatFiles(emitModulesFiles(root), root);
  const stale: string[] = [];

  for (const [relPath, content] of files) {
    const abs = path.join(root, relPath);
    if (existsSync(abs) && readFileSync(abs, 'utf8') === content) continue;
    stale.push(relPath);
    if (options.check !== true) {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }

  const ownedPureGenerated = new Set<string>([
    SERVER_GENERATED_MODULES,
    WEB_GENERATED_MODULES,
    WEB_GENERATED_PUBLIC_MODULES,
    MODULE_GRAPH_JSON,
  ]);
  const orphans = existingGeneratedFiles(root).filter(
    (relPath) => !ownedPureGenerated.has(relPath),
  );
  if (options.check !== true) {
    for (const orphan of orphans) rmSync(path.join(root, orphan));
  }

  return { stale: stale.sort(compareText), orphans, total: files.size };
}

export async function run(options: { readonly root?: string } = {}): Promise<CheckResult> {
  try {
    const { stale, orphans, total } = await syncModules({ ...options, check: true });
    if (stale.length === 0 && orphans.length === 0) {
      return pass(`${String(total)} module composition files synced with bslt.config.ts`);
    }
    return fail('module composition files are out of sync with bslt.config.ts', [
      ...stale.map((file) => `${file}: not what \`${SYNC_MODULES_COMMAND}\` generates`),
      ...orphans.map(
        (file) => `${file}: in a generated directory, but no command produces it (delete it)`,
      ),
      `Run \`${SYNC_MODULES_COMMAND}\` and commit the result.`,
    ]);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
