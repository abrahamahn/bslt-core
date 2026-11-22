// main/tools/snapshot/contract-source.ts
/**
 * The schema expressions of the API contracts, read from their source.
 *
 * Reads native module contracts (`main/modules/<id>/contract/endpoints.ts`)
 * declared with `endpoint({...})`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { REPO_ROOT } from '../lib/paths';

import { compareText } from './snapshot-file';

/** The directory of native domain modules. */
export const MODULES_DIR = 'main/modules';

export interface ContractSchemaSource {
  readonly body: string | null;
  readonly query: string | null;
  readonly pathParams: string | null;
  /** Response schema expression by status code, in ascending status order. */
  readonly responses: Readonly<Record<string, string>>;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true);
}

/** `x as const`, `x satisfies T` and `(x)` are `x`. */
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

/** Exported variable initializers `export const <name> = <expr>`, unwrapped. */
function exportedExpressions(file: ts.SourceFile): Map<string, ts.Expression> {
  const expressions = new Map<string, ts.Expression>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      expressions.set(declaration.name.text, unwrap(declaration.initializer));
    }
  }
  return expressions;
}

/** The object literals a file exports as `export const <name> = {...}`, by name. */
function exportedObjects(file: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  for (const [name, value] of exportedExpressions(file)) {
    if (ts.isObjectLiteralExpression(value)) {
      objects.set(name, value);
    }
  }
  return objects;
}

/** The properties of an object literal that have a plain name and a value. */
function properties(object: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const entries = new Map<string, ts.Expression>();
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = propertyName(property.name);
      if (name !== undefined) entries.set(name, property.initializer);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      entries.set(property.name.text, property.name);
    }
  }
  return entries;
}

const printer = ts.createPrinter({ removeComments: true });

/** An expression as one line, however its file is formatted. */
function expressionText(node: ts.Expression, file: ts.SourceFile): string {
  return printer
    .printNode(ts.EmitHint.Expression, node, file)
    .replace(/\s+/gu, ' ')
    .replace(/,\s*([)\]}])/gu, ' $1')
    .replace(/\(\s+/gu, '(')
    .replace(/\s+\)/gu, ')')
    .trim();
}

function slot(
  endpoint: ReadonlyMap<string, ts.Expression>,
  name: string,
  file: ts.SourceFile,
): string | null {
  const value = endpoint.get(name);
  return value === undefined ? null : expressionText(value, file);
}

function moduleParamsSlot(
  endpoint: ReadonlyMap<string, ts.Expression>,
  file: ts.SourceFile,
): string | null {
  const value = endpoint.get('params');
  if (value === undefined) return null;
  const unwrapped = unwrap(value);
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === 'object' &&
    unwrapped.arguments.length === 1 &&
    unwrapped.arguments[0] !== undefined
  ) {
    const firstArg = unwrap(unwrapped.arguments[0]);
    if (ts.isObjectLiteralExpression(firstArg)) {
      return expressionText(firstArg, file);
    }
  }
  return expressionText(unwrapped, file);
}

function readModuleErrorStatuses(moduleDir: string, moduleId: string): Map<string, number> {
  const statuses = new Map<string, number>();
  const errorsPath = path.join(moduleDir, 'contract', 'errors.ts');
  if (!existsSync(errorsPath)) {
    return statuses;
  }
  const file = parse(errorsPath);
  for (const expr of exportedExpressions(file).values()) {
    if (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === 'defineErrors' &&
      expr.arguments.length >= 2 &&
      expr.arguments[1] !== undefined
    ) {
      const mapArg = unwrap(expr.arguments[1]);
      if (ts.isObjectLiteralExpression(mapArg)) {
        for (const [errName, statusNode] of properties(mapArg)) {
          const unwrappedStatus = unwrap(statusNode);
          if (ts.isNumericLiteral(unwrappedStatus)) {
            const code = Number(unwrappedStatus.text);
            statuses.set(errName, code);
            statuses.set(`${moduleId}.${errName}`, code);
          }
        }
      }
    }
  }
  return statuses;
}

function readModuleEndpointSource(
  fields: ReadonlyMap<string, ts.Expression>,
  file: ts.SourceFile,
  id: string,
  errorStatuses: ReadonlyMap<string, number>,
): ContractSchemaSource {
  const responseExpr = fields.get('response');
  if (responseExpr === undefined) {
    throw new Error(`${id}: missing \`response\` schema in ${file.fileName}`);
  }
  const statusNode = fields.get('status');
  const successStatus =
    statusNode !== undefined && ts.isNumericLiteral(unwrap(statusNode))
      ? (unwrap(statusNode) as ts.NumericLiteral).text
      : '200';

  const body = slot(fields, 'body', file);
  const query = slot(fields, 'query', file);
  const pathParams = moduleParamsSlot(fields, file);

  const rawResponses = new Map<string, string>();
  rawResponses.set(successStatus, expressionText(responseExpr, file));

  if ((body !== null && body !== 'emptyBodySchema') || query !== null) {
    rawResponses.set('400', 'errorResponseSchema');
  }

  const rawAuth = fields.get('auth');
  const authNode = rawAuth === undefined ? undefined : unwrap(rawAuth);
  const isPublic =
    authNode !== undefined && ts.isStringLiteral(authNode) && authNode.text === 'public';
  const isWebhook =
    authNode !== undefined &&
    ts.isObjectLiteralExpression(authNode) &&
    properties(authNode).has('webhook');
  const isAdmin =
    authNode !== undefined && ts.isStringLiteral(authNode) && authNode.text === 'admin';
  const isModerator =
    authNode !== undefined && ts.isStringLiteral(authNode) && authNode.text === 'moderator';
  const isOrg =
    authNode !== undefined &&
    ts.isObjectLiteralExpression(authNode) &&
    properties(authNode).has('org');

  if (!isPublic && !isWebhook) {
    rawResponses.set('401', 'errorResponseSchema');
  }

  const rawRequires = fields.get('requires');
  const requiresNode = rawRequires === undefined ? undefined : unwrap(rawRequires);
  const hasRequires =
    requiresNode !== undefined &&
    ts.isArrayLiteralExpression(requiresNode) &&
    requiresNode.elements.length > 0;

  if (isAdmin || isModerator || isOrg || hasRequires) {
    rawResponses.set('403', 'errorResponseSchema');
  }

  const rawErrors = fields.get('errors');
  const errorsNode = rawErrors === undefined ? undefined : unwrap(rawErrors);
  if (errorsNode !== undefined && ts.isArrayLiteralExpression(errorsNode)) {
    for (const element of errorsNode.elements) {
      const unwrappedElement = unwrap(element);
      if (ts.isStringLiteral(unwrappedElement)) {
        const status = errorStatuses.get(unwrappedElement.text);
        if (status !== undefined) {
          rawResponses.set(String(status), 'errorResponseSchema');
        }
      } else if (
        ts.isPropertyAccessExpression(unwrappedElement) &&
        ts.isIdentifier(unwrappedElement.name)
      ) {
        const status = errorStatuses.get(unwrappedElement.name.text);
        if (status !== undefined) {
          rawResponses.set(String(status), 'errorResponseSchema');
        }
      }
    }
  }

  const responses: Record<string, string> = {};
  for (const [status, exprText] of [...rawResponses].sort(([a], [b]) => compareText(a, b))) {
    responses[status] = exprText;
  }

  return {
    body,
    query,
    pathParams,
    responses,
  };
}

/**
 * The schema expressions of every native module endpoint,
 * keyed `<moduleId>.<endpoint>` and sorted by that key.
 */
export function readContractSources(root: string = REPO_ROOT): Map<string, ContractSchemaSource> {
  const modulesRoot = path.join(root, MODULES_DIR);
  if (!existsSync(modulesRoot)) {
    return new Map();
  }

  const results: Array<[string, ContractSchemaSource]> = [];
  const moduleDirs = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const moduleId of moduleDirs) {
    const moduleDir = path.join(modulesRoot, moduleId);
    const endpointsPath = path.join(moduleDir, 'contract', 'endpoints.ts');
    if (!existsSync(endpointsPath)) {
      continue;
    }

    const errorStatuses = readModuleErrorStatuses(moduleDir, moduleId);
    const file = parse(endpointsPath);
    const objects = exportedObjects(file);
    for (const endpointsObj of objects.values()) {
      for (const [key, rawEndpoint] of properties(endpointsObj)) {
        const id = `${moduleId}.${key}`;
        const unwrapped = unwrap(rawEndpoint);
        if (
          !ts.isCallExpression(unwrapped) ||
          !ts.isIdentifier(unwrapped.expression) ||
          unwrapped.expression.text !== 'endpoint' ||
          unwrapped.arguments[0] === undefined
        ) {
          throw new Error(`${id}: expected \`endpoint({...})\` call in ${file.fileName}`);
        }
        const arg = unwrap(unwrapped.arguments[0]);
        if (!ts.isObjectLiteralExpression(arg)) {
          throw new Error(
            `${id}: \`endpoint(...)\` argument is not an object literal in ${file.fileName}`,
          );
        }
        results.push([id, readModuleEndpointSource(properties(arg), file, id, errorStatuses)]);
      }
    }
  }

  return new Map(results.sort(([a], [b]) => compareText(a, b)));
}
