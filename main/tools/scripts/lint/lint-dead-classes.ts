// main/tools/scripts/lint/lint-dead-classes.ts
/**
 * Dead-class lint.
 *
 * There is no Tailwind in this repo. Every utility class is hand-written in
 * `main/kernel/ui/src/styles/*.css` or in a co-located stylesheet, which means a
 * Tailwind-shaped classname that was never defined is not a style — it is a
 * wish. `className="truncate"` does not truncate. `hover:bg-surface-hover` has
 * no hover state. Nothing errors, nothing warns, and the markup reads as though
 * the intent were satisfied, so the mistake survives review and outlives the
 * person who made it.
 *
 * `lint-responsive.ts` already caught exactly this bug for breakpoint-prefixed
 * classes. That is the same check with an arbitrary restriction: `md:flex` was
 * guarded while `flex-3xl` was not. This script drops the restriction — every
 * class token in markup must resolve to a selector that exists somewhere — and
 * subsumes the responsive variant check, which is now just the subset whose
 * tokens contain a colon.
 *
 * Definitions are collected from selector preludes only (the text before each
 * `{`), never declaration bodies, so a `url(./sprite.png)` is not mistaken for
 * a class named `png`.
 *
 * @module lint/lint-dead-classes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT as ROOT } from '../../lib/paths';

import { walkFiles } from './walkFiles';

/** Markup scanned for class usage. */
const MARKUP_ROOTS = [
  'main/apps/web/src',
  'main/kernel/ui/src',
  'main/kernel/react/src',
  'main/modules',
];

/**
 * Stylesheets scanned for definitions — deliberately wider than the markup
 * roots, because a component may legitimately use a class another package owns.
 */
const STYLE_ROOTS = ['main/apps', 'main/kernel', 'main/modules'];

/** Per-file ceilings for dead classes that predate this lint. */
const DEBT_FILE = path.join(ROOT, 'main/tools/scripts/lint/dead-classes-debt.json');

/**
 * Classes that are real but undiscoverable by static scan, each with the reason
 * it cannot be found. Keep this list short and specific; a growing allowlist
 * means the scan is wrong, not that the exceptions are.
 */
const ALLOWLIST = new Map<string, string>([
  ['theme-dark', 'applied to <html> by public/theme-init.js before React boots'],
  ['theme-light', 'applied to <html> by public/theme-init.js before React boots'],
]);

export interface DeadClass {
  readonly token: string;
  readonly line: number;
}

/**
 * Every class name defined by a stylesheet.
 *
 * @param css - Stylesheet source
 * @returns Defined class names, with CSS escapes resolved (`.sm\:flex` → `sm:flex`)
 * @complexity O(n) in source length
 */
export function parseDefinedClasses(css: string): Set<string> {
  const defined = new Set<string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Split keeping the delimiters, so a segment can be identified by what
  // followed it: `{` means the segment was a selector prelude, `}` means it was
  // a declaration body and must be ignored.
  const segments = withoutComments.split(/([{}])/);
  for (const [i, segment] of segments.entries()) {
    if (segments[i + 1] !== '{') continue;
    for (const match of segment.matchAll(/\.((?:\\3[0-9] ?|\\.|[A-Za-z_-])(?:\\.|[\w-])*)/g)) {
      const selector = match[1];
      if (selector !== undefined) defined.add(unescapeSelector(selector));
    }
  }
  return defined;
}

/** Resolve CSS identifier escapes: hex (`\32 ` → `2`) then literal (`\:` → `:`). */
function unescapeSelector(raw: string): string {
  return raw.replace(/\\3([0-9]) ?/g, '$1').replace(/\\(.)/g, '$1');
}

/** Whether a token extracted from a string literal is plausibly a class name. */
function isClassToken(token: string): boolean {
  return (
    token.length > 0 &&
    !token.includes('${') &&
    !token.includes('//') &&
    /^[A-Za-z0-9][A-Za-z0-9:_./[\]%-]*$/.test(token)
  );
}

/**
 * Find the end of a `{...}` expression, honouring string literals so a brace
 * inside a string cannot close it early.
 */
function endOfExpression(source: string, openIndex: number): number {
  let depth = 0;
  let quote = '';
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== '') {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/**
 * Every class token the markup applies, with the line it appears on.
 *
 * Only `className`-shaped attributes are read (including `contentClassName` and
 * friends), and only string literals inside them — an expression like
 * `className={styles.card}` names no class this script can check.
 *
 * @param source - TSX source
 * @returns Tokens in source order, deduplicated per line
 * @complexity O(n) in source length
 */
export function extractClassTokens(source: string): DeadClass[] {
  const found: DeadClass[] = [];
  const seen = new Set<string>();
  source = withoutBlockComments(source);

  for (const attr of source.matchAll(
    /\b[A-Za-z]*(?:[cC]lassName|[cC]lasses|[cC]lass)\s*=(?!=)\s*/g,
  )) {
    const valueStart = attr.index + attr[0].length;
    const scope = valueRegionAt(source, valueStart);
    if (scope === undefined) continue;

    for (const literal of classLiteralsOf(scope).matchAll(/(['"`])([^'"`]*)\1/g)) {
      const offset = valueStart + (literal.index ?? 0);
      const line = countLines(source, offset);
      for (const token of (literal[2] ?? '').split(/\s+/)) {
        if (!isClassToken(token)) continue;
        const key = `${token}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ token, line });
      }
    }
  }
  return found;
}

/**
 * The text that holds a class value, starting at `start`.
 *
 * Three shapes reach this, and all three carry classes:
 *
 *  - `className="flex"` — a quoted JSX attribute
 *  - `className={cn(...)}` / `const TONE = {...}` — a braced expression
 *  - `const colorClass = ok ? 'text-success' : 'text-danger'` — a bare
 *    expression assigned to a variable, which never appears inside a
 *    `className=` attribute and so was invisible to the first version of this
 *    scan. Six dead classes were sitting in one such ternary, styling nothing
 *    while the widget looked colour-coded.
 *
 * @returns The region, or undefined when the value is not one this can read
 */
function valueRegionAt(source: string, start: number): string | undefined {
  if (source[start] === '{') return source.slice(start, endOfExpression(source, start));

  const quoted = /^(['"])[\s\S]*?\1/.exec(source.slice(start));
  if (quoted !== null) return quoted[0];

  // A bare expression runs to the end of its statement. Stop at the first
  // top-level `;` or `,`, so a class map's entries are read one at a time and
  // an unterminated match cannot swallow the rest of the file.
  let depth = 0;
  let quote = '';
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== '') {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{' || char === '(' || char === '[') depth += 1;
    else if (char === '}' || char === ')' || char === ']') {
      if (depth === 0) return source.slice(start, i);
      depth -= 1;
    } else if ((char === ';' || char === ',') && depth === 0) return source.slice(start, i);
    else if (char === '\n' && depth === 0 && source.slice(start, i).trim().length > 0) {
      // Prettier keeps a bare assignment on one line unless it is bracketed,
      // so a newline at depth zero ends it.
      return source.slice(start, i);
    }
  }
  return source.slice(start);
}

/**
 * Blank out block comments, keeping every character position.
 *
 * A doc comment that quotes the bug it fixed — `className="text-2xl
 * text-red-600"` — is prose about dead classes, not an application of them.
 * Reading it as markup makes the lint fire on the very file that documents the
 * fix, which is the most confusing possible false positive.
 */
function withoutBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** Class-composing helpers whose string arguments really are class names. */
const CLASS_COMPOSERS = /^(?:cn|clsx|classNames)$/;

/**
 * Blank out the string literals in a `className` expression that name something
 * other than a class, so they are not reported as missing styles:
 *
 *  - comparison operands — `size === 'lg'` tests a prop, it does not apply `lg`
 *  - arguments to helpers that are not class composers — `getSeverityClass('critical')`
 *    passes a severity and returns the class; `cn('flex', ...)` passes classes
 */
function classLiteralsOf(scope: string): string {
  // Blanked to spaces rather than removed: reported line numbers are derived
  // from offsets into this string, so it has to stay the same length.
  const blank = (text: string): string => ' '.repeat(text.length);

  const withoutComparisons = scope
    .replace(/[!=]==?\s*(['"`])[^'"`]*\1/g, blank)
    // The operand can also be a bare identifier, and `undefined` is a
    // perfectly class-shaped word: `sectionClassName = \`s${c !== undefined …`
    // reported a dead class named `undefined`.
    .replace(/[!=]==?\s*[A-Za-z_$][\w$]*/g, blank);
  // Innermost calls first; one pass reaches every literal, since a literal can
  // only ever sit inside a call with no further calls between it and the paren.
  return withoutComparisons.replace(
    /\b([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g,
    (whole, name: string) => (CLASS_COMPOSERS.test(name) ? whole : blank(whole)),
  );
}

/** 1-indexed line number of a character offset. */
function countLines(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/**
 * Class tokens the markup uses that no stylesheet defines.
 *
 * @param source - TSX source
 * @param defined - Every class name defined anywhere
 * @returns The dead ones, in source order
 * @complexity O(n) in source length
 */
export function findDeadClasses(source: string, defined: ReadonlySet<string>): DeadClass[] {
  return extractClassTokens(source).filter(
    ({ token }) => !defined.has(token) && !ALLOWLIST.has(token),
  );
}

/** Collect every class defined by every stylesheet under the style roots. */
function readDefinedClasses(): Set<string> {
  const defined = new Set<string>();
  for (const root of STYLE_ROOTS) {
    for (const file of walkFiles(path.join(ROOT, root), ['.css'])) {
      for (const name of parseDefinedClasses(readFileSync(file, 'utf8'))) defined.add(name);
    }
  }
  return defined;
}

/** Per-file counts of dead classes that predate this lint. */
export type Debt = Readonly<Record<string, number>>;

/** What the gate should do about one file's findings. */
export interface FileVerdict {
  readonly file: string;
  readonly found: number;
  readonly allowed: number;
  /** Above the recorded debt — new breakage, and the reason to fail. */
  readonly regressed: boolean;
  /** Below the recorded debt — fixed, and the baseline should be lowered. */
  readonly improved: boolean;
}

/**
 * Compare findings against recorded debt.
 *
 * The debt file exists so the gate can be switched on today rather than after
 * every surface is clean — 339 pre-existing dead classes would otherwise mean
 * either a broken build or no gate at all, and "no gate" is how they
 * accumulated. A file's recorded count is a ceiling that only moves down.
 *
 * @param found - Dead-class counts by repo-relative path, omitting clean files
 * @param debt - Recorded per-file ceilings
 * @returns One verdict per file that is either over or under its ceiling
 * @complexity O(n) in files
 */
export function reconcileWithDebt(found: ReadonlyMap<string, number>, debt: Debt): FileVerdict[] {
  const verdicts: FileVerdict[] = [];
  const paths = new Set([...found.keys(), ...Object.keys(debt)]);

  for (const file of [...paths].sort()) {
    const count = found.get(file) ?? 0;
    const allowed = debt[file] ?? 0;
    if (count === allowed) continue;
    verdicts.push({
      file,
      found: count,
      allowed,
      regressed: count > allowed,
      improved: count < allowed,
    });
  }
  return verdicts;
}

/** Read the recorded debt, treating a missing file as "no debt allowed". */
function readDebt(): Debt {
  try {
    return JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as Debt;
  } catch {
    return {};
  }
}

/**
 * Fails when markup gains a class that styles nothing. `update` records the
 * current counts as the new debt ceiling (`bslt gate run dead-classes --update`).
 */
export function run(options: { readonly update?: boolean } = {}): CheckResult {
  console.log('Linting for class names that style nothing...\n');

  const defined = readDefinedClasses();
  if (defined.size === 0) {
    console.error('Parsed zero class definitions — the scan is broken, not the markup. Aborting.');
    return fail('parsed zero class definitions');
  }

  const files = MARKUP_ROOTS.flatMap((root) => walkFiles(path.join(ROOT, root), ['.tsx'])).filter(
    (file) => !file.endsWith('.test.tsx') && !file.endsWith('.stories.tsx'),
  );

  const found = new Map<string, number>();
  const detail = new Map<string, string[]>();
  for (const file of files) {
    const dead = findDeadClasses(readFileSync(file, 'utf8'), defined);
    if (dead.length === 0) continue;
    const relative = path.relative(ROOT, file);
    found.set(relative, dead.length);
    detail.set(
      relative,
      dead.map(({ token, line }) => `  ${relative}:${line}\n    "${token}" is defined nowhere.`),
    );
  }

  const debt = readDebt();
  const verdicts = reconcileWithDebt(found, debt);
  const regressions = verdicts.filter((v) => v.regressed);
  const improvements = verdicts.filter((v) => v.improved);
  const remaining = [...found.values()].reduce((sum, n) => sum + n, 0);

  for (const { file, found: count, allowed } of regressions) {
    console.error(`${file} — ${String(count)} dead class(es), ${String(allowed)} allowed:`);
    for (const line of detail.get(file) ?? []) console.error(line);
    console.error('');
  }

  // Never silent about the debt that is being carried: a gate that reports
  // "clear" while 300 classes style nothing teaches the wrong thing.
  if (remaining > 0) {
    console.log(
      `Carrying ${String(remaining)} known dead class(es) across ${String(found.size)} file(s) — see ${path.relative(ROOT, DEBT_FILE)}.`,
    );
  }

  if (improvements.length > 0) {
    console.log(`\n${String(improvements.length)} file(s) improved. Lower the ceiling:`);
    for (const { file, found: count } of improvements) {
      console.log(`  ${file}: ${String(count)}`);
    }
    console.log('Run `pnpm bslt gate run dead-classes --update` to record it.');
  }

  if (options.update === true) {
    const next = Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(DEBT_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nRecorded ${String(found.size)} file(s) in ${path.relative(ROOT, DEBT_FILE)}.`);
    return pass(`recorded ${String(found.size)} file(s) in the dead-class debt`);
  }

  if (regressions.length > 0) {
    console.error(
      `Found ${String(regressions.length)} file(s) with new dead classes. Define the class, use one that exists, or delete it.`,
    );
    return fail(`${String(regressions.length)} file(s) with new dead classes`);
  }

  console.log(`\nNo new dead classes in ${String(files.length)} components.`);
  return pass(`no new dead classes in ${String(files.length)} components`);
}
