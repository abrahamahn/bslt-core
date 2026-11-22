// main/tools/gates/ratchets/counters.ts
/**
 * What each syntax ratchet counts, as a function of one file's text. The files
 * a ratchet reads are chosen in `ratchets.ts`.
 *
 * All of them walk the TypeScript syntax tree, so a mention in a comment, a
 * string or a type is never counted.
 */
import ts from 'typescript';

import type { Site } from './ratchet';

function parse(file: string, source: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function collect(
  file: string,
  source: string,
  match: (node: ts.Node, tree: ts.SourceFile) => string | undefined,
): Site[] {
  const tree = parse(file, source);
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    const text = match(node, tree);
    if (text !== undefined) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      sites.push({ file, line: line + 1, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return sites;
}

/** A node's text on one line, cut to a length that fits a report line. */
function excerpt(node: ts.Node, tree: ts.SourceFile): string {
  const [first = '', ...rest] = node.getText(tree).split('\n');
  const line = rest.length === 0 ? first : `${first} ...`;
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

/** True for `() => {}`, `function () {}`, `() => undefined` and `() => void 0`. */
function doesNothing(handler: ts.Expression): boolean {
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return false;
  if (ts.isBlock(handler.body)) return handler.body.statements.length === 0;
  const body = unwrap(handler.body);
  return (ts.isIdentifier(body) && body.text === 'undefined') || ts.isVoidExpression(body);
}

/**
 * Errors dropped without a trace: an empty `catch` block, and a promise
 * rejection handler (`.catch(fn)`, or the second argument of `.then`) whose
 * function does nothing. A handler that logs, rethrows or supplies a value
 * (`.catch(() => '')`) is not counted.
 */
export function swallowedCatches(file: string, source: string): Site[] {
  return collect(file, source, (node, tree) => {
    if (ts.isCatchClause(node)) {
      return node.block.statements.length === 0 ? 'catch {}' : undefined;
    }
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return undefined;
    }
    const method = node.expression.name.text;
    const handler =
      method === 'catch' ? node.arguments[0] : method === 'then' ? node.arguments[1] : undefined;
    if (handler === undefined || !doesNothing(handler)) return undefined;
    return `.${method}(${method === 'then' ? '..., ' : ''}${excerpt(handler, tree)})`;
  });
}

const TIMER_HOSTS = new Set(['globalThis', 'window', 'self', 'global']);

/** Calls of `setInterval`, bare or on the global object. */
export function setIntervalCalls(file: string, source: string): Site[] {
  return collect(file, source, (node, tree) => {
    if (!ts.isCallExpression(node)) return undefined;
    const callee = node.expression;
    const bare = ts.isIdentifier(callee) && callee.text === 'setInterval';
    const onGlobal =
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'setInterval' &&
      ts.isIdentifier(callee.expression) &&
      TIMER_HOSTS.has(callee.expression.text);
    return bare || onGlobal ? excerpt(node, tree) : undefined;
  });
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

/** True for an object literal whose every member sets a CSS custom property (`--name`). */
function setsOnlyCustomProperties(value: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(value) || value.properties.length === 0) return false;
  return value.properties.every(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyNameText(property.name)?.startsWith('--') === true,
  );
}

/**
 * JSX `style` props. A style object that only sets CSS custom properties is
 * the allowed way to hand a runtime value to a stylesheet and is not counted.
 */
export function inlineStyles(file: string, source: string): Site[] {
  return collect(file, source, (node, tree) => {
    if (!ts.isJsxAttribute(node) || node.name.getText(tree) !== 'style') return undefined;
    const value = node.initializer;
    if (value !== undefined && ts.isJsxExpression(value) && value.expression !== undefined) {
      if (setsOnlyCustomProperties(unwrap(value.expression))) return undefined;
    }
    return excerpt(node, tree);
  });
}

/**
 * Calls of `createSchema(fn)`: a schema that is a hand-written parser, which
 * nothing can inspect (plan section 7.4).
 */
export function opaqueSchemas(file: string, source: string): Site[] {
  return collect(file, source, (node, tree) => {
    if (!ts.isCallExpression(node)) return undefined;
    const callee = node.expression;
    return ts.isIdentifier(callee) && callee.text === 'createSchema'
      ? excerpt(node, tree)
      : undefined;
  });
}

/** The functions of the `@bslt/db` builder that start a statement or take SQL text. */
const STATEMENT_BUILDERS = new Set([
  'select',
  'selectCount',
  'selectExists',
  'insert',
  'update',
  'deleteFrom',
  'del',
  'truncate',
  'truncateCascade',
  'raw',
  'rawCondition',
  'fragment',
]);

/** Client methods that take SQL text. */
const SQL_TEXT_METHODS = new Set(['raw', 'unsafe']);

function isBuilderModule(specifier: string): boolean {
  if (specifier === '@bslt/db' || specifier === '@bslt/db/builder') return true;
  return specifier.startsWith('.') && /(?:^|\/)builder(?:\/|$)/u.test(specifier);
}

/** Local names bound to a statement builder by this file's imports. */
function importedBuilders(tree: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!isBuilderModule(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (STATEMENT_BUILDERS.has((element.propertyName ?? element.name).text)) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

/**
 * Places that build or send SQL: a statement started with the `@bslt/db` query
 * builder (`select`, `insert`, `update`, `deleteFrom`, ...), and SQL text handed
 * to a client (`db.raw(text)`, `sql.unsafe(text)`). Conditions (`eq`, `and`) are
 * not counted: they are part of a statement that is.
 */
export function rawSqlSites(file: string, source: string): Site[] {
  let builders: Set<string> | undefined;
  return collect(file, source, (node, tree) => {
    if (!ts.isCallExpression(node)) return undefined;
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
      builders ??= importedBuilders(tree);
      return builders.has(callee.text) ? excerpt(node, tree) : undefined;
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      SQL_TEXT_METHODS.has(callee.name.text) &&
      !(ts.isIdentifier(callee.expression) && callee.expression.text === 'String')
    ) {
      return excerpt(node, tree);
    }
    return undefined;
  });
}
