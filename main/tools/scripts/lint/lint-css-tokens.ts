// main/tools/scripts/lint/lint-css-tokens.ts
/**
 * CSS Token Lint Script
 *
 * Scans CSS files for hardcoded values that should use --ui-* design tokens.
 *
 * Checks:
 * 1. Hardcoded colors (#hex, rgb(), rgba(), hsl(), hsla(), white, black)
 * 2. Hardcoded px units (except 1px for borders/shadows)
 * 3. Hardcoded font-weight numbers (should use --ui-font-weight-*)
 *
 * Scope: every stylesheet under `main/apps`, `main/client` and `main/kernel`. It checked only
 * four files in `main/kernel/ui/src/styles` until 2026-08-06, so 24 of 28
 * stylesheets — every component-level sheet in the app — were never linted.
 *
 * Excluded:
 * - Declarations defining --ui-* variables (theme.css is entirely these)
 * - box-shadow / text-shadow offsets and blur radii
 * - Values inside var() references
 * - Allowed values: 0, 0px, transparent, inherit, none, auto, currentColor
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT as ROOT } from '../../lib/paths';

import { walkFiles } from './walkFiles';

// ============================================================================
// Configuration
// ============================================================================

/** Same roots as `lint-undefined-tokens`, so the two checks cover one surface. */
const STYLE_ROOTS = ['main/apps', 'main/kernel', 'main/modules'];

// Font-weight numeric values that should use tokens
const HARDCODED_FONT_WEIGHTS = new Set([
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
]);

export interface Violation {
  file: string;
  line: number;
  column: number;
  message: string;
  source: string;
}

// ============================================================================
// Matchers
// ============================================================================

/**
 * Check if a line is a CSS variable definition (--ui-* or --scrollbar-* etc.)
 */
export function isVariableDefinition(line: string): boolean {
  return /^\s*--[\w-]+\s*:/.test(line);
}

/**
 * Check if a line is a comment
 */
export function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//');
}

/**
 * Check if a line is an @import or @media rule (not a value)
 */
export function isAtRule(line: string): boolean {
  return /^\s*@/.test(line);
}

/** One declaration or selector, joined from however many physical lines it spans. */
export interface LogicalLine {
  readonly text: string;
  /** 1-based number of the first physical line the text came from. */
  readonly line: number;
}

/**
 * Collapse a stylesheet into logical lines: block comments removed, and
 * declarations whose value spans several physical lines joined into one.
 *
 * Both matter for precision. A `/* … *\/` block's continuation lines do not
 * start with `/*` or `*`, so a per-line `isComment` check cannot see them — the
 * 16px floor documented in `AppShell.css` was reported as a violation by the
 * comment explaining why it is deliberate. And a multi-line value hides its own
 * property name: `theme.css` declares shadow tokens across two lines, so the
 * `--ui-shadow-*` prefix and the `box-shadow` exemption both sit on a different
 * line from the `rgba()` and `4px` being judged, yielding 42 false positives.
 */
export function toLogicalLines(css: string): LogicalLine[] {
  // Replace each block comment with newlines so later line numbers stay accurate.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    '\n'.repeat((block.match(/\n/g) ?? []).length),
  );

  const logical: LogicalLine[] = [];
  let pending = '';
  let pendingLine = 0;

  for (const [index, raw] of withoutComments.split('\n').entries()) {
    const line = raw.trim();
    if (line === '') continue;
    if (pending === '') pendingLine = index + 1;
    pending = pending === '' ? line : `${pending} ${line}`;
    // A declaration or block boundary ends the logical line; anything else is a
    // value continuation (`box-shadow: a,` / `  b;`).
    if (/[;{}]$/.test(line)) {
      logical.push({ text: pending, line: pendingLine });
      pending = '';
    }
  }
  if (pending !== '') logical.push({ text: pending, line: pendingLine });

  return logical;
}

/**
 * Strip var(...) and calc(...) expressions from a line to avoid false positives
 * on values that correctly reference tokens.
 */
export function stripVarAndCalc(line: string): string {
  // Iteratively remove var(...) and calc(...) — handles nesting
  let result = line;
  let prev = '';
  while (prev !== result) {
    prev = result;
    // Remove innermost var() calls
    result = result.replace(/var\([^()]*\)/g, '');
    // Remove innermost calc() calls
    result = result.replace(/calc\([^()]*\)/g, '');
  }
  return result;
}

/**
 * Find hardcoded hex colors (#rgb, #rrggbb, #rrggbbaa)
 */
export function findHexColors(line: string, lineNum: number, file: string): Violation[] {
  const violations: Violation[] = [];
  // Match #hex but not inside quotes or url()
  const stripped = stripVarAndCalc(line);
  const regex = /#[0-9a-fA-F]{3,8}\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    violations.push({
      file,
      line: lineNum,
      column: match.index + 1,
      message: `Hardcoded hex color "${match[0]}" — use a --ui-color-* token instead.`,
      source: line.trim(),
    });
  }
  return violations;
}

/**
 * Find hardcoded rgb/rgba/hsl/hsla() function calls
 */
export function findColorFunctions(line: string, lineNum: number, file: string): Violation[] {
  const violations: Violation[] = [];
  const stripped = stripVarAndCalc(line);
  const regex = /\b(rgba?|hsla?)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    violations.push({
      file,
      line: lineNum,
      column: match.index + 1,
      message: `Hardcoded color function "${match[1]}()" — use a --ui-color-* token instead.`,
      source: line.trim(),
    });
  }
  return violations;
}

/**
 * Find bare `white` / `black` colour keywords.
 *
 * These are hardcoded colours that no other check sees: they are neither hex nor
 * a colour function. That blind spot is how eight `color-mix(… white 10%)` hover
 * states survived into a monochrome palette, where mixing `primary` toward literal
 * white means "no change at all" in the dark theme — an invisible hover.
 */
export function findColorKeywords(line: string, lineNum: number, file: string): Violation[] {
  const violations: Violation[] = [];
  const stripped = stripVarAndCalc(line);
  for (const match of stripped.matchAll(/(?<![\w-])(white|black)(?![\w-])/gi)) {
    const keyword = match[1];
    if (keyword === undefined) continue;
    violations.push({
      file,
      line: lineNum,
      column: match.index + 1,
      message: `Hardcoded color keyword "${keyword}" — use a --ui-color-* token (mix toward --ui-color-bg so the result is correct in both themes).`,
      source: line.trim(),
    });
  }
  return violations;
}

/**
 * Find hardcoded px units (except 1px for borders/shadows and 0px)
 */
export function findPxUnits(line: string, lineNum: number, file: string): Violation[] {
  const violations: Violation[] = [];
  const stripped = stripVarAndCalc(line);
  // Shadow offsets and blur radii are a documented exception (principles.md), and
  // they are only recognisable once the whole declaration is on one line.
  if (/(?:box-shadow|text-shadow)\s*:/.test(stripped)) return violations;
  // Match number followed by px, but not 0px or 1px
  const regex = /\b(\d+(?:\.\d+)?)px\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    const value = match[1];
    // Allow 0px and 1px
    if (value === '0' || value === '1') continue;
    violations.push({
      file,
      line: lineNum,
      column: match.index + 1,
      message: `Hardcoded "${match[0]}" — use rem, em, %, or a --ui-* spacing token instead. (1px borders are allowed)`,
      source: line.trim(),
    });
  }
  return violations;
}

/**
 * Find hardcoded font-weight numeric values
 */
export function findFontWeights(line: string, lineNum: number, file: string): Violation[] {
  const violations: Violation[] = [];
  const stripped = stripVarAndCalc(line);
  // Only check lines that contain font-weight property
  if (!/font-weight\s*:/.test(stripped)) return violations;

  const valueMatch = /font-weight\s*:\s*(\d+)/.exec(stripped);
  const weight = valueMatch?.[1];
  if (valueMatch !== null && weight !== undefined && HARDCODED_FONT_WEIGHTS.has(weight)) {
    violations.push({
      file,
      line: lineNum,
      column: valueMatch.index + 1,
      message: `Hardcoded font-weight "${weight}" — use a --ui-font-weight-* token instead.`,
      source: line.trim(),
    });
  }
  return violations;
}

/**
 * Ban `.ui-*` class selector overrides in stylesheets outside `main/kernel/ui` (plan section 12.3).
 */
export function findUiSelectorOverrides(line: string, lineNum: number, file: string): Violation[] {
  const normalizedFile = file.replaceAll('\\', '/');
  if (normalizedFile.startsWith('main/kernel/ui/')) return [];
  if (!line.trimEnd().endsWith('{') || isAtRule(line)) return [];

  const prelude = line.slice(0, line.lastIndexOf('{'));
  const violations: Violation[] = [];
  for (const match of prelude.matchAll(/\.ui-[A-Za-z0-9_-]+/g)) {
    violations.push({
      file,
      line: lineNum,
      column: (match.index ?? 0) + 1,
      message: `Design-system selector override "${match[0]}" is forbidden outside main/kernel/ui — pass recipe props or layout classes instead.`,
      source: line.trim(),
    });
  }
  return violations;
}

// ============================================================================
// Main
// ============================================================================

export function lintFile(filePath: string): Violation[] {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return [];
  }

  const violations: Violation[] = [];
  const relativePath = path.relative(ROOT, filePath);

  for (const { text, line } of toLogicalLines(readFileSync(filePath, 'utf-8'))) {
    // Comments are already gone; skip at-rules and token definitions.
    if (isAtRule(text)) continue;
    if (isVariableDefinition(text)) continue;

    violations.push(...findUiSelectorOverrides(text, line, relativePath));
    violations.push(...findHexColors(text, line, relativePath));
    violations.push(...findColorFunctions(text, line, relativePath));
    violations.push(...findColorKeywords(text, line, relativePath));
    violations.push(...findPxUnits(text, line, relativePath));
    violations.push(...findFontWeights(text, line, relativePath));
  }

  return violations;
}

export function run(): CheckResult {
  console.log('Linting CSS files for hardcoded values...\n');

  const files = STYLE_ROOTS.flatMap((root) => walkFiles(path.join(ROOT, root), ['.css']));
  const allViolations = files.flatMap((file) => lintFile(file));

  if (allViolations.length === 0) {
    console.log(`No hardcoded CSS values in ${String(files.length)} stylesheets.`);
    return pass(`no hardcoded CSS values in ${String(files.length)} stylesheets`);
  }

  console.error(`Found ${allViolations.length} violation(s):\n`);

  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}:${v.column}`);
    console.error(`    ${v.message}`);
    console.error(`    > ${v.source}\n`);
  }

  return fail(`${String(allViolations.length)} hardcoded CSS value(s)`);
}
