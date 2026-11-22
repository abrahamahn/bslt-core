// main/tools/scripts/lint/lint-responsive.ts
/**
 * Responsive Standards Lint Script
 *
 * Enforces the device-optimization architecture documented in
 * docs/architecture/responsive.md:
 *
 * 1. CSS width media queries must use a width declared in
 *    main/kernel/ui/src/theme/breakpoints.ts — either the canonical scale
 *    (BREAKPOINTS) or a derived reference width (REFERENCE_WIDTHS).
 *    px/em width queries and undeclared rem values are violations.
 *
 *    REFERENCE_WIDTHS exists because not every width in a media query is a
 *    layout breakpoint. The root font-size ramp opens where `3.2vw` crosses
 *    `1rem`; that width is dictated by the coefficient, and snapping it to the
 *    nearest breakpoint would re-tune the curve rather than tidy it. Declaring
 *    it centrally keeps the number named and reviewed — an undeclared width
 *    still fails, so this is a narrower rule, not an escape hatch.
 * 2. Responsive-prefixed utility classes (`sm:` `md:` `lg:` `xl:` `2xl:`)
 *    used in TSX/TS markup must be defined in
 *    main/kernel/ui/src/styles/utilities.css — otherwise they silently do
 *    nothing (there is no Tailwind in this repo).
 *
 * Non-width media features (pointer, hover, prefers-*, orientation, height,
 * resolution) and @container queries are not restricted.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { BREAKPOINTS, REFERENCE_WIDTHS } from '../../../kernel/ui/src/theme/breakpoints';
import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT as ROOT } from '../../lib/paths';

// ============================================================================
// Configuration
// ============================================================================

/** Strip the `rem` suffix and any trailing zeros, so `48.0` matches `48`. */
function remValue(value: string): string {
  return value.replace(/rem$/, '').replace(/\.0+$/, '');
}

/** Canonical width breakpoints in rem, derived from the shared scale. */
const CANONICAL_REM = new Set(Object.values(BREAKPOINTS).map(remValue));

/** Derived widths that are declared but are not layout breakpoints. */
const REFERENCE_REM = new Set(Object.values(REFERENCE_WIDTHS).map(remValue));

/** Every rem width a stylesheet may use. */
const ALLOWED_REM = new Set([...CANONICAL_REM, ...REFERENCE_REM]);

/** Human-readable list of allowed values for violation messages. */
const CANONICAL_LIST = [...ALLOWED_REM].join(' | ');

/** Directories scanned for stylesheets and markup. */
const SCAN_ROOTS = [
  'main/apps/web/src',
  'main/kernel/ui/src',
  'main/kernel/react/src',
  'main/modules',
];

const UTILITIES_CSS = path.join(ROOT, 'main/kernel/ui/src/styles/utilities.css');

export interface Violation {
  file: string;
  line: number;
  message: string;
  source: string;
}

// ============================================================================
// File walking
// ============================================================================

function walk(dir: string, extensions: readonly string[], results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, extensions, results);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ============================================================================
// Check 1: canonical width media queries in CSS
// ============================================================================

export function checkCssBreakpoints(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const relativePath = path.relative(ROOT, filePath);
  const lines = readFileSync(filePath, 'utf-8').split('\n');

  for (const [index, line] of lines.entries()) {
    if (!/@media/.test(line)) continue;

    const widthFeatures = line.matchAll(/\((?:min|max)-width:\s*([\d.]+)(px|em|rem)\)/g);
    for (const match of widthFeatures) {
      const [feature, value, unit] = match;
      if (feature === undefined || value === undefined || unit === undefined) continue;
      if (unit !== 'rem') {
        violations.push({
          file: relativePath,
          line: index + 1,
          message: `Width media query uses ${unit} ("${feature}") — use a canonical rem breakpoint (${CANONICAL_LIST} rem).`,
          source: line.trim(),
        });
      } else if (!ALLOWED_REM.has(remValue(value))) {
        violations.push({
          file: relativePath,
          line: index + 1,
          message: `Undeclared width breakpoint "${feature}" — use a canonical value (${CANONICAL_LIST} rem) from breakpoints.ts, or declare it in REFERENCE_WIDTHS if it is a derived width rather than a layout breakpoint.`,
          source: line.trim(),
        });
      }
    }
  }
  return violations;
}

// ============================================================================
// Check 2: responsive-prefixed classes must exist in utilities.css
// ============================================================================

/** Parse the set of defined `bp:utility` classes from utilities.css. */
export function readDefinedVariants(): Set<string> {
  const css = readFileSync(UTILITIES_CSS, 'utf-8');
  const defined = new Set<string>();
  // Selectors are written as .sm\:flex … and .\32xl\:flex (escaped leading digit).
  const selectorRegex = /\.(?:\\32xl|sm|md|lg|xl)\\:([a-z0-9-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = selectorRegex.exec(css)) !== null) {
    const prefix = match[0].startsWith('.\\32xl')
      ? '2xl'
      : match[0].slice(1, match[0].indexOf('\\'));
    defined.add(`${prefix}:${match[1]}`);
  }
  return defined;
}

export function checkMarkupVariants(filePath: string, defined: Set<string>): Violation[] {
  const violations: Violation[] = [];
  const relativePath = path.relative(ROOT, filePath);
  const lines = readFileSync(filePath, 'utf-8').split('\n');

  // Class tokens inside string/template literals, e.g. "flex md:flex-row".
  const tokenRegex = /(?<=["'`\s])(sm|md|lg|xl|2xl):([a-z0-9[\]().,_%\\-]+)/g;

  for (const [index, line] of lines.entries()) {
    // Only inspect lines that look like class attributes to avoid false
    // positives on ordinary strings (URLs, ids, prose).
    if (!/className|\bclass:|classes|\bcn\(/.test(line)) continue;

    for (const match of line.matchAll(tokenRegex)) {
      const token = `${match[1]}:${match[2]}`;
      if (!defined.has(token)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          message: `Responsive class "${token}" is not defined in utilities.css — it renders as a no-op. Add the variant there or use a co-located CSS rule with a canonical breakpoint.`,
          source: line.trim(),
        });
      }
    }
  }
  return violations;
}

// ============================================================================
// Main
// ============================================================================

export function run(): CheckResult {
  console.log('Linting responsive standards (breakpoints + utility variants)...\n');

  const cssFiles: string[] = [];
  const markupFiles: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = path.join(ROOT, root);
    walk(absRoot, ['.css'], cssFiles);
    walk(absRoot, ['.tsx'], markupFiles);
  }

  const defined = readDefinedVariants();
  if (defined.size === 0) {
    console.error('Could not parse responsive variants from utilities.css — aborting.');
    return fail('parsed no responsive variants from utilities.css');
  }

  let violations: Violation[] = [];
  for (const file of cssFiles) {
    violations = [...violations, ...checkCssBreakpoints(file)];
  }
  for (const file of markupFiles) {
    violations = [...violations, ...checkMarkupVariants(file, defined)];
  }

  if (violations.length === 0) {
    console.log(
      `No violations in ${cssFiles.length} stylesheets and ${markupFiles.length} components. All clear!`,
    );
    return pass(
      `${String(cssFiles.length)} stylesheets and ${String(markupFiles.length)} components follow the responsive standards`,
    );
  }

  console.error(`Found ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.message}`);
    console.error(`    > ${v.source}\n`);
  }
  return fail(`${String(violations.length)} responsive violation(s)`);
}
