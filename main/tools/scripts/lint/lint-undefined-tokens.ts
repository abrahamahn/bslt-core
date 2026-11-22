// main/tools/scripts/lint/lint-undefined-tokens.ts
/**
 * Undefined custom-property lint.
 *
 * A `var(--x)` naming a token nothing defines is not a fallback to something
 * sensible — CSS drops the whole declaration. The rule still parses, the
 * stylesheet still loads, and the property simply never applies. It is the
 * dead-class bug one level down, and it fails the same way: silently, and
 * looking like a design choice.
 *
 * It is not hypothetical. `MediaStudioPage.css` spent its life asking for
 * `--ui-gap-1` … `-5`, a numeric spacing scale this system does not have (its
 * steps are named xs/sm/md/lg/xl), so all 23 of those declarations were
 * dropped and the page had no gaps at all. `--ui-color-surface-hover` and
 * `--ui-color-subtle` left three interactive controls with no hover feedback,
 * and `--ui-color-text-on-primary` left text on a primary background with no
 * colour of its own.
 *
 * `var(--x, fallback)` is exempt. That is the deliberate pattern for a token a
 * component sets at runtime (`--skeleton-width`, `--progress-value`): the
 * fallback is what the stylesheet does when the component has not spoken yet.
 * A token set from a TSX inline style or emitted by the theme builder counts
 * as defined for the same reason.
 *
 * @module lint/lint-undefined-tokens
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT as ROOT } from '../../lib/paths';

import { walkFiles } from './walkFiles';

/** Stylesheets checked, and scanned for definitions. */
const STYLE_ROOTS = ['main/apps', 'main/kernel', 'main/modules'];

/**
 * Sources that can define a token without declaring it in CSS: the theme
 * builder emits them, and components set them as inline style properties.
 */
const RUNTIME_ROOTS = ['main/apps', 'main/kernel', 'main/modules'];

/** One `var()` reference that resolves to nothing. */
export interface UndefinedToken {
  readonly token: string;
  readonly line: number;
}

/** Strip comments so a commented-out reference cannot fail the gate. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Every custom property a stylesheet declares.
 *
 * @param css - Stylesheet source
 * @returns Declared property names, including the leading `--`
 * @complexity O(n) in source length
 */
export function parseDefinedTokens(css: string): Set<string> {
  const defined = new Set<string>();
  for (const match of withoutComments(css).matchAll(/(--[\w-]+)\s*:/g)) {
    const token = match[1];
    if (token !== undefined) defined.add(token);
  }
  return defined;
}

/**
 * Custom properties a TS/TSX source sets, rather than a stylesheet declaring.
 *
 * Covers both shapes that occur here: the theme builder's
 * `tokens['--ui-gap-md'] = …` and a component's inline
 * `{ ['--skeleton-width']: … }`. Both are quoted names, which is what makes
 * them findable at all.
 *
 * @param source - TS or TSX source
 * @returns Property names set at runtime
 * @complexity O(n) in source length
 */
export function parseRuntimeTokens(source: string): Set<string> {
  const defined = new Set<string>();
  for (const match of source.matchAll(/['"`](--[\w-]+)['"`]/g)) {
    const token = match[1];
    if (token !== undefined) defined.add(token);
  }
  return defined;
}

/**
 * Every `var()` in a stylesheet that names a token nothing defines.
 *
 * A reference carrying a fallback is skipped: `var(--x, 1rem)` is a complete
 * instruction whether or not `--x` exists.
 *
 * @param css - Stylesheet source
 * @param defined - Every token defined anywhere
 * @returns The unresolvable references, in source order
 * @complexity O(n) in source length
 */
export function findUndefinedTokens(css: string, defined: ReadonlySet<string>): UndefinedToken[] {
  const source = withoutComments(css);
  const found: UndefinedToken[] = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    const token = match[1];
    if (token === undefined || match[2] === ',') continue;
    if (defined.has(token)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    const key = `${token}:${String(line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ token, line });
  }
  return found;
}

/** Collect every token defined by a stylesheet or set from a component. */
function readDefinedTokens(): Set<string> {
  const defined = new Set<string>();
  for (const root of STYLE_ROOTS) {
    for (const file of walkFiles(path.join(ROOT, root), ['.css'])) {
      for (const token of parseDefinedTokens(readFileSync(file, 'utf8'))) defined.add(token);
    }
  }
  for (const root of RUNTIME_ROOTS) {
    for (const file of walkFiles(path.join(ROOT, root), ['.ts', '.tsx'])) {
      for (const token of parseRuntimeTokens(readFileSync(file, 'utf8'))) defined.add(token);
    }
  }
  return defined;
}

/** Fails when a stylesheet references a token nothing defines. */
export function run(): CheckResult {
  console.log('Linting for custom properties that resolve to nothing...\n');

  const defined = readDefinedTokens();
  if (defined.size === 0) {
    console.error('Parsed zero token definitions — the scan is broken, not the CSS. Aborting.');
    return fail('parsed zero token definitions');
  }

  const files = STYLE_ROOTS.flatMap((root) => walkFiles(path.join(ROOT, root), ['.css']));
  let violations = 0;

  for (const file of files) {
    const undefinedTokens = findUndefinedTokens(readFileSync(file, 'utf8'), defined);
    if (undefinedTokens.length === 0) continue;

    const relative = path.relative(ROOT, file);
    for (const { token, line } of undefinedTokens) {
      console.error(
        `${relative}:${String(line)}\n    "${token}" is defined nowhere, so this declaration is dropped.`,
      );
      violations += 1;
    }
    console.error('');
  }

  if (violations > 0) {
    console.error(
      `Found ${String(violations)} reference(s) to undefined custom properties. Use a token that exists, define it, or give the reference a fallback.`,
    );
    return fail(`${String(violations)} reference(s) to undefined custom properties`);
  }

  console.log(`No undefined custom properties in ${String(files.length)} stylesheets.`);
  return pass(`no undefined custom properties in ${String(files.length)} stylesheets`);
}
