// main/tools/gates/ratchets/unused-exports.ts
/**
 * Exports that no other file imports, found with the TypeScript compiler (the
 * repository has no knip, and the plan's rule is no package without need).
 *
 * One program over the whole tree; every import binding is resolved through
 * barrels to the declaration it names. A declaration exported by a candidate
 * file and named by no import of another file is unused. A re-export is not a
 * use. A namespace import, `export * as`, a dynamic `import()` and an
 * `import('...')` type use every export of their module: this undercounts
 * rather than report an export that is reached through the namespace.
 *
 * Test files count as importers, as they do for knip: an export only a test
 * imports is not reported.
 */
import path from 'node:path';

import ts from 'typescript';

import type { Site } from './ratchet';

export interface UnusedExportsInput {
  /** Absolute repository root; sites are relative to it. */
  readonly root: string;
  /** Absolute paths of every file that may import (sources and tests). */
  readonly files: readonly string[];
  /** True for a repository-relative file whose exports are counted. */
  readonly isCandidate: (file: string) => boolean;
  readonly compilerOptions: ts.CompilerOptions;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

export function findUnusedExports(input: UnusedExportsInput): Site[] {
  const program = ts.createProgram({
    rootNames: [...input.files],
    options: input.compilerOptions,
  });
  const checker = program.getTypeChecker();
  const resolve = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

  const used = new Set<ts.Symbol>();
  const useBinding = (name: ts.Node): void => {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol !== undefined) used.add(resolve(symbol));
  };
  const useModule = (specifier: ts.Node): void => {
    const module = checker.getSymbolAtLocation(specifier);
    if (module === undefined) return;
    for (const symbol of checker.getExportsOfModule(module)) used.add(resolve(symbol));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.name !== undefined) useBinding(clause.name);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamespaceImport(bindings)) useModule(node.moduleSpecifier);
        else for (const element of bindings.elements) useBinding(element.name);
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      // `export * as ns from` hands the whole module on under a name.
      if (
        node.moduleSpecifier !== undefined &&
        node.exportClause !== undefined &&
        ts.isNamespaceExport(node.exportClause)
      ) {
        useModule(node.moduleSpecifier);
      }
      return;
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      useModule(node.argument.literal);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier !== undefined) useModule(specifier);
    }
    ts.forEachChild(node, visit);
  };

  const sources = program
    .getSourceFiles()
    .filter((file) => !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file));
  for (const file of sources) visit(file);

  const sites: Site[] = [];
  for (const file of sources) {
    const name = relative(input.root, file.fileName);
    if (name.startsWith('..') || !input.isCandidate(name)) continue;
    const module = checker.getSymbolAtLocation(file);
    if (module?.exports === undefined) continue;

    const reported = new Set<ts.Symbol>();
    module.exports.forEach((exported, key) => {
      // `export * from` is a table entry of its own, not a declaration.
      if (key === ts.InternalSymbolName.ExportStar) return;
      const target = resolve(exported);
      const declaration = target.declarations?.find((node) => node.getSourceFile() === file);
      // Declared elsewhere: a re-export, which is that file's export to answer for.
      if (declaration === undefined || used.has(target) || reported.has(target)) return;
      reported.add(target);
      const { line } = file.getLineAndCharacterOfPosition(declaration.getStart(file));
      sites.push({ file: name, line: line + 1, text: exported.getName() });
    });
  }
  return sites.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}
