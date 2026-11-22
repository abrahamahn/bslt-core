// main/tools/sync/csp.ts
/**
 * `bslt sync csp`: generates `infra/runtime/caddy/security-headers.generated.caddy`,
 * updates the marked generated header block in `infra/runtime/caddy/Caddyfile`,
 * and writes `main/kernel/web/src/ssr/security-headers.generated.ts` from
 * `bslt.config.ts` and installed modules' `csp` manifests (plan sections 11.3 and 14.2).
 */

import fs from 'node:fs';
import path from 'node:path';

import { mergeModuleCspNeeds, type CspNeeds, type ModuleDefinition } from '@bslt/contract';
import { format, resolveConfig } from 'prettier';
import ts from 'typescript';

import { fail, pass, type CheckResult } from '../gates/types';
import { REPO_ROOT } from '../lib/paths';

export const SYNC_CSP_COMMAND = 'pnpm bslt sync csp';
export const GENERATED_CADDY_SNIPPET_FILE = 'infra/runtime/caddy/security-headers.generated.caddy';
export const GENERATED_SECURITY_HEADERS_TS_FILE =
  'main/kernel/web/src/ssr/security-headers.generated.ts';
export const CADDYFILE_REL_PATH = 'infra/runtime/caddy/Caddyfile';

export const CADDY_GENERATED_START_MARKER = '# @generated-start bslt sync csp';
export const CADDY_GENERATED_END_MARKER = '# @generated-end bslt sync csp';

const BASE_PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(self), usb=()';

const BASE_EDGE_CSP_DIRECTIVES: Readonly<Record<string, string>> = {
  'default-src': "'self'",
  'script-src': "'self' https://js.stripe.com https://challenges.cloudflare.com",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data:",
  'media-src': "'self'",
  'font-src': "'self'",
  'connect-src': "'self' wss: https://api.stripe.com",
  'frame-src': 'https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com',
  'object-src': "'none'",
  'base-uri': "'self'",
  'frame-ancestors': "'self'",
};

function unwrapExpression(node: ts.Expression): ts.Expression {
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

function propKeyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function parseInstalledModuleIds(root: string): readonly string[] {
  const configPath = path.join(root, 'bslt.config.ts');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing bslt.config.ts at repository root');
  }
  const sourceFile = ts.createSourceFile(
    configPath,
    fs.readFileSync(configPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );

  const importVarToModuleId = new Map<string, string>();
  const installedIds: string[] = [];

  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      const spec = stmt.moduleSpecifier.text;
      const modMatch = /^@[a-z0-9-]+\/([a-z0-9-]+)\/module$/u.exec(spec);
      if (modMatch?.[1] !== undefined) {
        for (const el of stmt.importClause.namedBindings.elements) {
          importVarToModuleId.set(el.name.text, modMatch[1]);
        }
      }
    }

    if (ts.isExportAssignment(stmt)) {
      const expr = unwrapExpression(stmt.expression);
      if (ts.isCallExpression(expr) && expr.arguments.length >= 1) {
        const arg0 = expr.arguments[0];
        if (arg0 !== undefined && ts.isObjectLiteralExpression(unwrapExpression(arg0))) {
          const obj = unwrapExpression(arg0) as ts.ObjectLiteralExpression;
          for (const prop of obj.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              propKeyName(prop.name) === 'installedModules' &&
              ts.isArrayLiteralExpression(unwrapExpression(prop.initializer))
            ) {
              const arr = unwrapExpression(prop.initializer) as ts.ArrayLiteralExpression;
              for (const el of arr.elements) {
                if (ts.isIdentifier(el)) {
                  const id = importVarToModuleId.get(el.text);
                  if (id !== undefined) {
                    installedIds.push(id);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return installedIds;
}

function parseModuleCspFromAst(
  root: string,
  moduleId: string,
): { readonly csp: CspNeeds | undefined; readonly relPath: string } {
  const relPath = `main/modules/${moduleId}/module.ts`;
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing module manifest for "${moduleId}" at ${relPath}`);
  }

  const sourceFile = ts.createSourceFile(
    fullPath,
    fs.readFileSync(fullPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );

  let foundCsp: Record<string, readonly string[]> | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineModule' &&
      node.arguments.length >= 1
    ) {
      const arg0 = node.arguments[0];
      if (arg0 !== undefined && ts.isObjectLiteralExpression(unwrapExpression(arg0))) {
        const obj = unwrapExpression(arg0) as ts.ObjectLiteralExpression;
        for (const prop of obj.properties) {
          if (ts.isPropertyAssignment(prop) && propKeyName(prop.name) === 'csp') {
            const init = unwrapExpression(prop.initializer);
            if (!ts.isObjectLiteralExpression(init)) {
              throw new Error(`${relPath}: module "${moduleId}" csp must be an object literal`);
            }
            const parsedCsp: Record<string, readonly string[]> = {};
            for (const dirProp of init.properties) {
              if (!ts.isPropertyAssignment(dirProp)) continue;
              const directive = propKeyName(dirProp.name);
              if (directive === null) continue;
              const arrExpr = unwrapExpression(dirProp.initializer);
              if (!ts.isArrayLiteralExpression(arrExpr)) {
                throw new Error(
                  `${relPath}: module "${moduleId}" csp["${directive}"] must be an array literal`,
                );
              }
              const values: string[] = [];
              for (const item of arrExpr.elements) {
                const unwrapped = unwrapExpression(item);
                if (!ts.isStringLiteralLike(unwrapped)) {
                  throw new Error(
                    `${relPath}: module "${moduleId}" csp["${directive}"] entries must be string literals`,
                  );
                }
                values.push(unwrapped.text);
              }
              parsedCsp[directive] = values;
            }
            foundCsp = parsedCsp;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    csp: foundCsp as CspNeeds | undefined,
    relPath,
  };
}

function assertNoUnsafeScriptExecution(directives: Readonly<Record<string, string>>): void {
  const governing = directives['script-src'] !== undefined ? 'script-src' : 'default-src';
  const sources = directives[governing] ?? '';
  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'"] as const) {
    if (sources.includes(forbidden)) {
      throw new Error(
        `Generated CSP ${governing} must never contain ${forbidden} (found "${sources}")`,
      );
    }
  }
}

export function buildMergedEdgeCsp(root: string = REPO_ROOT): {
  readonly edgeCsp: string;
  readonly permissionsPolicy: string;
  readonly contributingModules: readonly string[];
} {
  const installedIds = parseInstalledModuleIds(root);
  const syntheticModules: ModuleDefinition[] = [];
  const contributingModules: string[] = [];

  for (const id of installedIds) {
    const { csp, relPath } = parseModuleCspFromAst(root, id);
    if (csp !== undefined) {
      contributingModules.push(relPath);
    }
    syntheticModules.push({
      id,
      summary: id,
      status: 'stable',
      dependsOn: [],
      ...(csp !== undefined ? { csp } : {}),
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
  }

  const merged = mergeModuleCspNeeds(BASE_EDGE_CSP_DIRECTIVES, syntheticModules);
  assertNoUnsafeScriptExecution(merged);

  const edgeCsp = Object.entries(merged)
    .map(([directive, value]) => `${directive} ${value};`)
    .join(' ');

  return {
    edgeCsp,
    permissionsPolicy: BASE_PERMISSIONS_POLICY,
    contributingModules,
  };
}

function renderCaddyHeaderBlock(
  edgeCsp: string,
  permissionsPolicy: string,
  contributingModules: readonly string[],
  indent: string,
): string {
  const provenance = [
    `${indent}# <- bslt.config.ts#installedModules`,
    ...contributingModules.map((rel) => `${indent}# <- ${rel}#csp`),
  ];

  return [
    ...provenance,
    `${indent}header {`,
    `${indent}\tStrict-Transport-Security "max-age=31536000; includeSubDomains; preload"`,
    `${indent}\tX-Frame-Options "SAMEORIGIN"`,
    `${indent}\tX-Content-Type-Options "nosniff"`,
    `${indent}\tX-XSS-Protection "1; mode=block"`,
    `${indent}\tReferrer-Policy "strict-origin-when-cross-origin"`,
    `${indent}\tContent-Security-Policy "${edgeCsp}"`,
    `${indent}\tPermissions-Policy "${permissionsPolicy}"`,
    `${indent}\t-Server`,
    `${indent}}`,
  ].join('\n');
}

function renderStandaloneCaddySnippet(
  edgeCsp: string,
  permissionsPolicy: string,
  contributingModules: readonly string[],
): string {
  return [
    `# ${GENERATED_CADDY_SNIPPET_FILE}`,
    '# @generated by bslt sync csp from bslt.config.ts and module csp manifests. Do not edit.',
    renderCaddyHeaderBlock(edgeCsp, permissionsPolicy, contributingModules, ''),
    '',
  ].join('\n');
}

function updateCaddyfileWithGeneratedBlock(
  caddyfileContent: string,
  edgeCsp: string,
  permissionsPolicy: string,
  contributingModules: readonly string[],
): string {
  const startIdx = caddyfileContent.indexOf(CADDY_GENERATED_START_MARKER);
  const endIdx = caddyfileContent.indexOf(CADDY_GENERATED_END_MARKER);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    throw new Error(
      `${CADDYFILE_REL_PATH} is missing "${CADDY_GENERATED_START_MARKER}" / "${CADDY_GENERATED_END_MARKER}" markers`,
    );
  }

  const lineStart = caddyfileContent.lastIndexOf('\n', startIdx) + 1;
  const indent = caddyfileContent.slice(lineStart, startIdx);
  const endMarkerEnd = endIdx + CADDY_GENERATED_END_MARKER.length;

  const replacement = [
    `${indent}${CADDY_GENERATED_START_MARKER}`,
    renderCaddyHeaderBlock(edgeCsp, permissionsPolicy, contributingModules, indent),
    `${indent}${CADDY_GENERATED_END_MARKER}`,
  ].join('\n');

  return `${caddyfileContent.slice(0, lineStart)}${replacement}${caddyfileContent.slice(endMarkerEnd)}`;
}

async function renderSecurityHeadersTs(
  edgeCsp: string,
  permissionsPolicy: string,
  contributingModules: readonly string[],
): Promise<string> {
  const lines = [
    `// ${GENERATED_SECURITY_HEADERS_TS_FILE}`,
    '// @generated by bslt sync csp from bslt.config.ts and module csp manifests. Do not edit.',
    '',
    '// <- bslt.config.ts#installedModules',
    ...contributingModules.map((rel) => `// <- ${rel}#csp`),
    `export const GENERATED_EDGE_CSP = ${JSON.stringify(edgeCsp)};`,
    '',
    '// <- main/tools/sync/csp.ts#BASE_PERMISSIONS_POLICY',
    `export const GENERATED_PERMISSIONS_POLICY = ${JSON.stringify(permissionsPolicy)};`,
    '',
  ];

  const prettierConfig =
    (await resolveConfig(path.join(REPO_ROOT, 'config/.prettierrc'), {
      config: path.join(REPO_ROOT, 'config/.prettierrc'),
    })) ?? {};

  return format(lines.join('\n'), {
    ...prettierConfig,
    parser: 'typescript',
  });
}

export async function syncCsp(
  options: { readonly root?: string } = {},
): Promise<{ readonly changed: boolean; readonly stale: readonly string[] }> {
  const root = options.root ?? REPO_ROOT;
  const { edgeCsp, permissionsPolicy, contributingModules } = buildMergedEdgeCsp(root);

  const caddyfilePath = path.join(root, CADDYFILE_REL_PATH);
  if (!fs.existsSync(caddyfilePath)) {
    throw new Error(`Missing ${CADDYFILE_REL_PATH}`);
  }

  const expectedSnippet = renderStandaloneCaddySnippet(
    edgeCsp,
    permissionsPolicy,
    contributingModules,
  );
  const existingCaddyfile = fs.readFileSync(caddyfilePath, 'utf8');
  const expectedCaddyfile = updateCaddyfileWithGeneratedBlock(
    existingCaddyfile,
    edgeCsp,
    permissionsPolicy,
    contributingModules,
  );
  const expectedTs = await renderSecurityHeadersTs(edgeCsp, permissionsPolicy, contributingModules);

  const targets: ReadonlyArray<{ readonly rel: string; readonly expected: string }> = [
    { rel: GENERATED_CADDY_SNIPPET_FILE, expected: expectedSnippet },
    { rel: CADDYFILE_REL_PATH, expected: expectedCaddyfile },
    { rel: GENERATED_SECURITY_HEADERS_TS_FILE, expected: expectedTs },
  ];

  const stale: string[] = [];
  for (const target of targets) {
    const full = path.join(root, target.rel);
    const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    if (current !== target.expected) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, target.expected, 'utf8');
      stale.push(target.rel);
    }
  }

  return { changed: stale.length > 0, stale };
}

export async function run(options: { readonly root?: string } = {}): Promise<CheckResult> {
  const root = options.root ?? REPO_ROOT;
  try {
    const { edgeCsp, permissionsPolicy, contributingModules } = buildMergedEdgeCsp(root);

    const caddyfilePath = path.join(root, CADDYFILE_REL_PATH);
    if (!fs.existsSync(caddyfilePath)) {
      return fail(`${CADDYFILE_REL_PATH} is missing`);
    }

    const expectedSnippet = renderStandaloneCaddySnippet(
      edgeCsp,
      permissionsPolicy,
      contributingModules,
    );
    const existingCaddyfile = fs.readFileSync(caddyfilePath, 'utf8');
    const expectedCaddyfile = updateCaddyfileWithGeneratedBlock(
      existingCaddyfile,
      edgeCsp,
      permissionsPolicy,
      contributingModules,
    );
    const expectedTs = await renderSecurityHeadersTs(
      edgeCsp,
      permissionsPolicy,
      contributingModules,
    );

    const targets: ReadonlyArray<{ readonly rel: string; readonly expected: string }> = [
      { rel: GENERATED_CADDY_SNIPPET_FILE, expected: expectedSnippet },
      { rel: CADDYFILE_REL_PATH, expected: expectedCaddyfile },
      { rel: GENERATED_SECURITY_HEADERS_TS_FILE, expected: expectedTs },
    ];

    const problems: string[] = [];
    for (const target of targets) {
      const full = path.join(root, target.rel);
      if (!fs.existsSync(full)) {
        problems.push(`${target.rel} is missing; run \`${SYNC_CSP_COMMAND}\``);
        continue;
      }
      const actual = fs.readFileSync(full, 'utf8');
      if (actual !== target.expected) {
        problems.push(`${target.rel} is out of date; run \`${SYNC_CSP_COMMAND}\``);
      }
    }

    if (problems.length > 0) {
      return fail(
        `${String(problems.length)} generated CSP file(s) out of date; run \`${SYNC_CSP_COMMAND}\``,
        problems,
      );
    }

    return pass(
      `generated CSP and Permissions-Policy match bslt.config.ts (${String(contributingModules.length)} module csp contributor(s))`,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
