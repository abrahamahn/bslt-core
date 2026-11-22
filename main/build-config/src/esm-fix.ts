// main/build-config/src/esm-fix.ts
/**
 * The ESM extension fixer every package build runs after `tsc`.
 *
 * TypeScript emits relative specifiers as written under `moduleResolution:
 * bundler`, so `./foo` stays extensionless and Node cannot load it. This rewrites
 * each relative specifier in the emitted `.js` files to `./foo.js` or
 * `./foo/index.js`, whichever exists. Package specifiers (`@bslt/db`) and subpath
 * imports (`#...`) are left alone: Node resolves those through `exports` and
 * `imports`.
 *
 * Run it through the `bslt-esm-fix` bin (`bin/esm-fix.ts`): `bslt-esm-fix dist`.
 */
import fs from 'node:fs';
import path from 'node:path';

const importFromRegex = /(from\s+['"])(\.?\.?\/[^'"?]+)(['"])/g;
const sideEffectImportRegex = /(import\s+['"])(\.?\.?\/[^'"?]+)(['"])/g;
const dynamicImportRegex = /(import\(\s*['"])(\.?\.?\/[^'"?]+)(['"]\s*\))/g;

function hasExtension(specifier: string): boolean {
  const lastSegment = specifier.split('/').pop() ?? '';
  return /\.[a-zA-Z0-9]+$/.test(lastSegment);
}

export function normalizeSpecifier(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier;
  }
  const baseDir = path.dirname(fromFile);
  if (hasExtension(specifier)) {
    const fileCandidate = path.resolve(baseDir, specifier);
    if (fs.existsSync(fileCandidate)) {
      return specifier;
    }
    const jsCandidate = path.resolve(baseDir, `${specifier}.js`);
    if (fs.existsSync(jsCandidate)) {
      return `${specifier}.js`;
    }
    if (specifier.endsWith('.js')) {
      const withoutExt = specifier.slice(0, -3);
      const indexCandidate = path.resolve(baseDir, withoutExt, 'index.js');
      if (fs.existsSync(indexCandidate)) {
        return `${withoutExt}/index.js`;
      }
    }
    return specifier;
  }

  const jsCandidate = path.resolve(baseDir, `${specifier}.js`);
  if (fs.existsSync(jsCandidate)) {
    return `${specifier}.js`;
  }
  const indexCandidate = path.resolve(baseDir, specifier, 'index.js');
  if (fs.existsSync(indexCandidate)) {
    return `${specifier}/index.js`;
  }
  return `${specifier}.js`;
}

function rewriteFile(filePath: string): void {
  const original = fs.readFileSync(filePath, 'utf8');
  let updated = original;

  updated = updated.replace(
    importFromRegex,
    (_match: string, p1: string, p2: string, p3: string) => {
      return `${p1}${normalizeSpecifier(filePath, p2)}${p3}`;
    },
  );

  updated = updated.replace(
    sideEffectImportRegex,
    (_match: string, p1: string, p2: string, p3: string) => {
      return `${p1}${normalizeSpecifier(filePath, p2)}${p3}`;
    },
  );

  updated = updated.replace(
    dynamicImportRegex,
    (_match: string, p1: string, p2: string, p3: string) => {
      return `${p1}${normalizeSpecifier(filePath, p2)}${p3}`;
    },
  );

  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
  }
}

function walk(dir: string): void {
  if (!fs.existsSync(dir)) {
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      rewriteFile(entryPath);
    }
  }
}

/**
 * Rewrites the relative imports of every `.js` file under each directory
 * (relative to `cwd`; `dist` when none is given). A missing directory is skipped.
 */
export function fixEsmExtensions(
  directories: readonly string[],
  cwd: string = process.cwd(),
): void {
  const targets = directories.length === 0 ? ['dist'] : directories;
  for (const directory of targets) {
    walk(path.resolve(cwd, directory));
  }
}
