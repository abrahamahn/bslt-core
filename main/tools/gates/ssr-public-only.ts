// main/tools/gates/ssr-public-only.ts
/**
 * `ssr-public-only` gate (restructure plan §11.3 and §14.3).
 *
 * Enforces that:
 * 1. Every `sdk.<moduleId>.<endpointName>` call in `PublicRoute` files targets an
 *    endpoint with `auth: 'public'` and `cache.public` defined;
 * 2. No `PublicRoute` path matches a non-public (`auth !== 'public'`, `protected: true`,
 *    or `shell !== 'public'`) web route;
 * 3. Neither `serve.ts` nor any `PublicRoute` file reads/forwards cookies,
 *    authorization headers, or `credentials: 'include'`;
 * 4. `entry-public.tsx` stays lean (never imports `AuthService`, `createAuthService`,
 *    `AppShell`, or `ConsoleShell`).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { REPO_ROOT } from '../lib/paths';

import { fail, pass, type CheckResult } from './types';

interface ContractEndpointMeta {
  readonly auth: string | null;
  readonly hasPublicCache: boolean;
}

interface DeclaredWebRouteMeta {
  readonly path: string;
  readonly shell: string | null;
  readonly auth: string | null;
  readonly isProtected: boolean;
  readonly source: string;
}

const FORBIDDEN_PUBLIC_ENTRY_SYMBOLS: ReadonlySet<string> = new Set([
  'AppShell',
  'AuthService',
  'ConsoleShell',
  'IdentityAuthProvider',
  'createAuthService',
]);

function getPropertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function parseSourceFile(filePath: string, content: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function extractObjectPropertyInitializer(
  obj: ts.ObjectLiteralExpression,
  propName: string,
): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && getPropertyNameText(prop.name) === propName) {
      return prop.initializer;
    }
  }
  return undefined;
}

function collectModuleEndpoints(root: string): Map<string, Map<string, ContractEndpointMeta>> {
  const result = new Map<string, Map<string, ContractEndpointMeta>>();
  const modulesDir = path.join(root, 'main/modules');
  if (!existsSync(modulesDir)) return result;

  for (const dirent of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const moduleId = dirent.name;
    const endpointsFile = path.join(modulesDir, moduleId, 'contract/endpoints.ts');
    if (!existsSync(endpointsFile)) continue;

    const content = readFileSync(endpointsFile, 'utf8');
    const sf = parseSourceFile(endpointsFile, content);
    const endpoints = new Map<string, ContractEndpointMeta>();

    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'endpoint' &&
        node.initializer.arguments.length > 0
      ) {
        const epName = getPropertyNameText(node.name);
        const firstArg = node.initializer.arguments[0];
        if (epName !== null && firstArg !== undefined && ts.isObjectLiteralExpression(firstArg)) {
          const authInit = extractObjectPropertyInitializer(firstArg, 'auth');
          const auth =
            authInit !== undefined && ts.isStringLiteral(authInit) ? authInit.text : 'non-public';
          const cacheInit = extractObjectPropertyInitializer(firstArg, 'cache');
          const hasPublicCache =
            cacheInit !== undefined &&
            ts.isObjectLiteralExpression(cacheInit) &&
            extractObjectPropertyInitializer(cacheInit, 'public') !== undefined;
          endpoints.set(epName, { auth, hasPublicCache });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    result.set(moduleId, endpoints);
  }

  return result;
}

function normalizeWebPath(rawPath: string, slot: string | null): string {
  if (rawPath === '') return '/';
  if (slot === 'admin' && !rawPath.startsWith('/admin')) {
    return `/admin/${rawPath.replace(/^\/+/u, '')}`;
  }
  const prefixed = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return prefixed.length > 1 ? prefixed.replace(/\/+$/u, '') : prefixed;
}

function collectDeclaredWebRoutes(root: string): DeclaredWebRouteMeta[] {
  const routes: DeclaredWebRouteMeta[] = [];
  const modulesDir = path.join(root, 'main/modules');

  if (existsSync(modulesDir)) {
    for (const dirent of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const rel = `main/modules/${dirent.name}/web/index.ts`;
      const abs = path.join(root, rel);
      if (!existsSync(abs)) continue;
      const sf = parseSourceFile(abs, readFileSync(abs, 'utf8'));

      const visit = (node: ts.Node): void => {
        if (
          ts.isPropertyAssignment(node) &&
          getPropertyNameText(node.name) === 'routes' &&
          ts.isArrayLiteralExpression(node.initializer)
        ) {
          for (const el of node.initializer.elements) {
            if (!ts.isObjectLiteralExpression(el)) continue;
            const pathInit = extractObjectPropertyInitializer(el, 'path');
            const shellInit = extractObjectPropertyInitializer(el, 'shell');
            const authInit = extractObjectPropertyInitializer(el, 'auth');
            if (pathInit !== undefined && ts.isStringLiteral(pathInit)) {
              routes.push({
                path: normalizeWebPath(pathInit.text, null),
                shell:
                  shellInit !== undefined && ts.isStringLiteral(shellInit) ? shellInit.text : null,
                auth: authInit !== undefined && ts.isStringLiteral(authInit) ? authInit.text : null,
                isProtected: false,
                source: rel,
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }

  const appRoutesRel = 'main/apps/web/src/app/routes.tsx';
  const appRoutesAbs = path.join(root, appRoutesRel);
  if (existsSync(appRoutesAbs)) {
    const sf = parseSourceFile(appRoutesAbs, readFileSync(appRoutesAbs, 'utf8'));
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const slotInit = extractObjectPropertyInitializer(node, 'slot');
        const shellInit = extractObjectPropertyInitializer(node, 'shell');
        const pathInit = extractObjectPropertyInitializer(node, 'path');
        const indexInit = extractObjectPropertyInitializer(node, 'index');
        const protectedInit = extractObjectPropertyInitializer(node, 'protected');

        if (shellInit !== undefined && ts.isStringLiteral(shellInit)) {
          const slot =
            slotInit !== undefined && ts.isStringLiteral(slotInit) ? slotInit.text : null;
          const resolvedPath =
            indexInit?.kind === ts.SyntaxKind.TrueKeyword
              ? '/'
              : pathInit !== undefined && ts.isStringLiteral(pathInit)
                ? normalizeWebPath(pathInit.text, slot)
                : null;
          if (resolvedPath !== null && resolvedPath !== '/*') {
            routes.push({
              path: resolvedPath,
              shell: shellInit.text,
              auth: protectedInit?.kind === ts.SyntaxKind.TrueKeyword ? 'user' : 'public',
              isProtected: protectedInit?.kind === ts.SyntaxKind.TrueKeyword,
              source: appRoutesRel,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return routes;
}

function collectPublicRouteFiles(root: string): string[] {
  const files: string[] = [];
  const modulesDir = path.join(root, 'main/modules');
  if (existsSync(modulesDir)) {
    for (const dirent of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      for (const ext of ['ts', 'tsx']) {
        const rel = `main/modules/${dirent.name}/web/public-routes.${ext}`;
        if (existsSync(path.join(root, rel))) {
          files.push(rel);
        }
      }
    }
  }

  const webSsrDir = path.join(root, 'main/apps/web/src/ssr');
  if (existsSync(webSsrDir)) {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx')
        ) {
          files.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(webSsrDir);
  }

  return files.sort();
}

function checkNoCookiesOrCredentialsInclude(
  relPath: string,
  sf: ts.SourceFile,
  problems: string[],
): void {
  const visit = (node: ts.Node): void => {
    // Detect req.headers.cookie / req.headers.authorization
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'headers'
    ) {
      const headerName = node.name.text.toLowerCase();
      if (headerName === 'cookie' || headerName === 'authorization') {
        problems.push(
          `${relPath}: SSR code accesses request header "${node.name.text}" (cookies/sessions must never reach public SSR)`,
        );
      }
    }
    // Detect req.headers['cookie'] / req.headers['authorization']
    if (
      ts.isElementAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'headers' &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      const headerName = node.argumentExpression.text.toLowerCase();
      if (headerName === 'cookie' || headerName === 'authorization') {
        problems.push(
          `${relPath}: SSR code accesses request header "${node.argumentExpression.text}" (cookies/sessions must never reach public SSR)`,
        );
      }
    }
    // Detect credentials: 'include' or headers: { cookie: ..., authorization: ... }
    if (ts.isPropertyAssignment(node)) {
      const propName = getPropertyNameText(node.name)?.toLowerCase() ?? '';
      if (
        propName === 'credentials' &&
        ts.isStringLiteral(node.initializer) &&
        node.initializer.text === 'include'
      ) {
        problems.push(
          `${relPath}: sets credentials: "include" in public SSR code (must use credentials: "omit")`,
        );
      }
      if (propName === 'cookie' || propName === 'authorization') {
        problems.push(`${relPath}: constructs "${propName}" header inside public SSR code`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function checkPublicRouteFile(
  relPath: string,
  sf: ts.SourceFile,
  endpointsByModule: ReadonlyMap<string, ReadonlyMap<string, ContractEndpointMeta>>,
  declaredWebRoutes: readonly DeclaredWebRouteMeta[],
  problems: string[],
): number {
  let definedCount = 0;

  const visit = (node: ts.Node): void => {
    // Check definePublicRoute({ path: '/...', ... })
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'definePublicRoute' &&
      node.arguments.length > 0
    ) {
      definedCount += 1;
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isObjectLiteralExpression(arg)) {
        const pathInit = extractObjectPropertyInitializer(arg, 'path');
        if (pathInit !== undefined && ts.isStringLiteral(pathInit)) {
          const publicPath = normalizeWebPath(pathInit.text, null);
          for (const webRoute of declaredWebRoutes) {
            if (webRoute.path !== publicPath) continue;
            if (
              webRoute.isProtected ||
              (webRoute.auth !== null && webRoute.auth !== 'public') ||
              (webRoute.shell !== null && webRoute.shell !== 'public')
            ) {
              problems.push(
                `${relPath}: PublicRoute "${publicPath}" collides with non-public WebRoute in ${webRoute.source} (shell="${String(webRoute.shell)}", auth="${String(webRoute.auth)}", protected=${String(webRoute.isProtected)})`,
              );
            }
          }
        }
      }
    }

    // Check sdk.<moduleId>.<endpointName>(...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === 'sdk'
    ) {
      const moduleId = node.expression.expression.name.text;
      const endpointName = node.expression.name.text;
      const modEndpoints = endpointsByModule.get(moduleId);
      const epMeta = modEndpoints?.get(endpointName);
      if (epMeta === undefined) {
        problems.push(
          `${relPath}: AnonymousSdk call "sdk.${moduleId}.${endpointName}()" does not resolve to a declared module contract endpoint`,
        );
      } else {
        if (epMeta.auth !== 'public') {
          problems.push(
            `${relPath}: AnonymousSdk call "sdk.${moduleId}.${endpointName}()" targets an endpoint with auth="${String(epMeta.auth)}" (must be auth: "public")`,
          );
        }
        if (!epMeta.hasPublicCache) {
          problems.push(
            `${relPath}: AnonymousSdk call "sdk.${moduleId}.${endpointName}()" targets an endpoint without cache.public`,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  checkNoCookiesOrCredentialsInclude(relPath, sf, problems);
  return definedCount;
}

function checkLeanEntryPublic(relPath: string, sf: ts.SourceFile, problems: string[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings !== undefined) {
      const named = node.importClause.namedBindings;
      if (ts.isNamedImports(named)) {
        for (const spec of named.elements) {
          const importedName = (spec.propertyName ?? spec.name).text;
          if (FORBIDDEN_PUBLIC_ENTRY_SYMBOLS.has(importedName)) {
            problems.push(
              `${relPath}: lean public client entry must not import "${importedName}" (no auth restore or logged-in shells on public entry)`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  checkNoCookiesOrCredentialsInclude(relPath, sf, problems);
}

export function auditSsrPublicOnly(root: string = REPO_ROOT): string[] {
  const problems: string[] = [];
  const endpointsByModule = collectModuleEndpoints(root);
  const declaredWebRoutes = collectDeclaredWebRoutes(root);
  const publicRouteFiles = collectPublicRouteFiles(root);

  const entryPublicRel = 'main/apps/web/src/entry-public.tsx';
  const entryPublicAbs = path.join(root, entryPublicRel);
  if (!existsSync(entryPublicAbs)) {
    problems.push(`Missing lean public client entry: ${entryPublicRel}`);
  } else {
    const sf = parseSourceFile(entryPublicAbs, readFileSync(entryPublicAbs, 'utf8'));
    checkLeanEntryPublic(entryPublicRel, sf, problems);
  }

  const serveRel = 'main/apps/web/src/server/serve.ts';
  const serveAbs = path.join(root, serveRel);
  if (!existsSync(serveAbs)) {
    problems.push(`Missing PROCESS_ROLE=web SSR server entry: ${serveRel}`);
  } else {
    const sf = parseSourceFile(serveAbs, readFileSync(serveAbs, 'utf8'));
    checkNoCookiesOrCredentialsInclude(serveRel, sf, problems);
  }

  if (publicRouteFiles.length === 0) {
    problems.push(
      'No PublicRoute consumer files found under main/modules/*/web or main/apps/web/src/ssr',
    );
    return problems;
  }

  let totalPublicRoutes = 0;
  for (const relPath of publicRouteFiles) {
    const sf = parseSourceFile(
      path.join(root, relPath),
      readFileSync(path.join(root, relPath), 'utf8'),
    );
    totalPublicRoutes += checkPublicRouteFile(
      relPath,
      sf,
      endpointsByModule,
      declaredWebRoutes,
      problems,
    );
  }

  if (totalPublicRoutes === 0) {
    problems.push('No definePublicRoute(...) declarations found across public-routes files');
  }

  return problems;
}

export function run(root: string = REPO_ROOT): CheckResult {
  const problems = auditSsrPublicOnly(root);
  if (problems.length > 0) {
    return fail(`${String(problems.length)} public SSR isolation violation(s)`, problems);
  }
  const files = collectPublicRouteFiles(root);
  return pass(
    `all ${String(files.length)} PublicRoute module(s), entry-public.tsx, and serve.ts obey AnonymousSdk public-only isolation`,
  );
}
