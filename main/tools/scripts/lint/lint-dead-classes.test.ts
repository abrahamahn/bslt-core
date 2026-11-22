// main/tools/scripts/lint/lint-dead-classes.test.ts
/**
 * The lint that finds classes which style nothing.
 *
 * Two failure modes matter here and they pull against each other. Missing a
 * dead class lets the original bug through — that is what the lint is for. But
 * a false positive is worse than no lint at all: it makes the gate fail on
 * correct code, and the cheapest way to make a noisy gate quiet is to delete
 * it. So the precision cases below (comparison operands, helper arguments,
 * interpolated tokens) are as load-bearing as the detection cases.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  extractClassTokens,
  findDeadClasses,
  parseDefinedClasses,
  reconcileWithDebt,
} from './lint-dead-classes';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '../../../../');

const tokensOf = (source: string): string[] => extractClassTokens(source).map((t) => t.token);
const deadIn = (source: string, defined: string[]): string[] =>
  findDeadClasses(source, new Set(defined)).map((d) => d.token);

describe('parseDefinedClasses', () => {
  it('reads plain class selectors', () => {
    expect([...parseDefinedClasses('.flex { display: flex; }')]).toEqual(['flex']);
  });

  it('resolves the escapes a responsive variant is written with', () => {
    const css = '@media (min-width: 48rem) { .md\\:flex { display: flex; } }';

    expect(parseDefinedClasses(css).has('md:flex')).toBe(true);
  });

  /** `.\32xl\:flex` — a leading digit has to be written as a hex escape. */
  it('resolves the hex escape on the 2xl breakpoint', () => {
    expect(parseDefinedClasses('.\\32xl\\:grid { display: grid; }').has('2xl:grid')).toBe(true);
  });

  it('reads every class in a compound or descendant selector', () => {
    const defined = parseDefinedClasses('.card.is-open > .card-body:hover { color: red; }');

    expect([...defined].sort()).toEqual(['card', 'card-body', 'is-open']);
  });

  /**
   * The whole reason preludes are parsed instead of the raw text: a declaration
   * value contains dots, and `url(./sprite.png)` must not define a class `png`.
   */
  it('ignores declaration values, so a file path is not mistaken for a class', () => {
    const defined = parseDefinedClasses('.hero { background: url(./sprite.png); margin: 0.5rem; }');

    expect([...defined]).toEqual(['hero']);
  });

  it('ignores commented-out rules', () => {
    expect(parseDefinedClasses('/* .old-name { color: red; } */').size).toBe(0);
  });
});

describe('extractClassTokens', () => {
  it('reads a quoted attribute', () => {
    expect(tokensOf('<div className="flex gap-2" />')).toEqual(['flex', 'gap-2']);
  });

  it('reads literals inside an expression, including cn()', () => {
    expect(tokensOf('<div className={cn("flex", active && "is-active")} />')).toEqual([
      'flex',
      'is-active',
    ]);
  });

  it('reads className-suffixed props such as valueClassName', () => {
    expect(tokensOf('<Stat valueClassName="text-danger" />')).toEqual(['text-danger']);
  });

  it('reads across a multi-line expression', () => {
    const source = ['<div', '  className={cn(', '    "flex",', '    "gap-2",', '  )}', '/>'].join(
      '\n',
    );

    expect(tokensOf(source)).toEqual(['flex', 'gap-2']);
  });

  it('reports the line each token appears on, not the line of the attribute', () => {
    const source = ['<div', '  className={cn(', '    "flex",', '    "gap-2",', '  )}', '/>'].join(
      '\n',
    );

    expect(extractClassTokens(source)).toEqual([
      { token: 'flex', line: 3 },
      { token: 'gap-2', line: 4 },
    ]);
  });

  /** `size === 'lg'` tests a prop. It does not apply a class called `lg`. */
  it('ignores comparison operands', () => {
    expect(tokensOf('<div className={size === "lg" ? "p-4" : "p-2"} />')).toEqual(['p-4', 'p-2']);
  });

  /**
   * `getSeverityClass('critical')` passes a severity and returns a class. The
   * argument is not a class, and reporting it as one made the first version of
   * this lint fire on correct admin code.
   */
  it('ignores arguments to helpers that are not class composers', () => {
    expect(tokensOf('<Stat valueClassName={getSeverityClass("critical")} />')).toEqual([]);
  });

  it('still reads the arguments of cn, clsx and classNames', () => {
    expect(tokensOf('<div className={clsx("flex")} />')).toEqual(['flex']);
    expect(tokensOf('<div className={classNames("grid")} />')).toEqual(['grid']);
  });

  it('ignores interpolated tokens it cannot resolve', () => {
    expect(tokensOf('<div className={`badge badge--${tone}`} />')).toEqual(['badge']);
  });

  it('reads nothing from an expression with no literals', () => {
    expect(tokensOf('<div className={styles.card} />')).toEqual([]);
  });

  /**
   * A doc comment quoting the classes it replaced is prose, not markup. Reading
   * it made the lint fire on the very file documenting the fix.
   */
  it('ignores className written inside a block comment', () => {
    const source = [
      '/**',
      ' * Was: className="text-2xl text-red-600"',
      ' */',
      '<div className="flex" />',
    ].join('\n');

    expect(tokensOf(source)).toEqual(['flex']);
  });

  it('keeps line numbers accurate after a comment is blanked', () => {
    const source = [
      '/* className="dead-one"',
      '   spans two lines */',
      '<div className="flex" />',
    ].join('\n');

    expect(extractClassTokens(source)).toEqual([{ token: 'flex', line: 3 }]);
  });

  /** A brace inside a string must not be read as the end of the expression. */
  it('is not confused by braces inside a string literal', () => {
    expect(tokensOf('<div className={cn("flex", "{weird}")} />')).toContain('flex');
  });
});

describe('extractClassTokens — class strings assigned to a variable', () => {
  /**
   * The recall gap. This ternary never appears inside a `className=` attribute,
   * so the first version of the scan could not see it — while the six classes
   * in one real instance of this shape styled nothing and the widget merely
   * looked colour-coded.
   */
  it('reads a ternary assigned to a *Class variable', () => {
    const source = "const colorClass = ok ? 'text-success' : 'text-danger';";

    expect(tokensOf(source)).toEqual(['text-success', 'text-danger']);
  });

  it('reads a class map assigned to a *Classes variable', () => {
    const source = [
      'const toneClasses = {',
      "  danger: 'text-danger',",
      "  ok: 'text-success',",
      '};',
    ].join('\n');

    expect(tokensOf(source)).toEqual(['text-danger', 'text-success']);
  });

  it('does not run past the end of the statement', () => {
    const source = ["const badgeClass = 'flex';", "const unrelated = 'some prose here';"].join(
      '\n',
    );

    expect(tokensOf(source)).toEqual(['flex']);
  });

  /** `===` is a comparison, not an assignment. */
  it('ignores an equality test against a *Class variable', () => {
    expect(tokensOf("if (colorClass === 'whatever') {}")).toEqual([]);
  });

  /**
   * A comparison operand need not be a string literal, and `undefined` is a
   * perfectly class-shaped word. This exact line — the optional-className
   * idiom — put a dead class named `undefined` into the debt file.
   *
   * `settings-section` is absent for a different and deliberate reason: it is
   * fused to the `${` that follows it, and a token spanning an interpolation
   * cannot be resolved, so it is ignored rather than guessed at.
   */
  it('ignores an identifier compared against, not just a string literal', () => {
    const source =
      "const sectionClassName = `settings-section${className !== undefined ? ` ${className}` : ''}`;";

    expect(tokensOf(source)).toEqual([]);
  });

  it('still reads a class out of the branch of such a comparison', () => {
    const source = "const rowClassName = `row${flag !== undefined ? ' row--flagged' : ''}`;";

    expect(tokensOf(source)).toEqual(['row--flagged']);
  });
});

describe('findDeadClasses', () => {
  it('reports a class no stylesheet defines', () => {
    expect(deadIn('<div className="flex truncate" />', ['flex'])).toEqual(['truncate']);
  });

  it('says nothing when every class exists', () => {
    expect(deadIn('<div className="flex truncate" />', ['flex', 'truncate'])).toEqual([]);
  });

  /**
   * The bug that motivated the lint. There is no variant system in this repo,
   * so a `hover:` prefix is dead even when its base class exists — which is
   * precisely why it reads as working code.
   */
  it('reports a state-variant class whose base class does exist', () => {
    expect(deadIn('<div className="hover:bg-surface" />', ['bg-surface'])).toEqual([
      'hover:bg-surface',
    ]);
  });

  it('reports Tailwind arbitrary-value syntax, which nothing here implements', () => {
    expect(deadIn('<div className="max-w-[12rem]" />', ['max-w-md'])).toEqual(['max-w-[12rem]']);
  });

  it('allowlists classes applied outside React, with a stated reason', () => {
    expect(deadIn('<html className="theme-dark" />', [])).toEqual([]);
  });
});

describe('reconcileWithDebt', () => {
  const found = (entries: [string, number][]): Map<string, number> => new Map(entries);

  it('says nothing when a file matches its recorded ceiling exactly', () => {
    expect(reconcileWithDebt(found([['a.tsx', 3]]), { 'a.tsx': 3 })).toEqual([]);
  });

  it('flags a file that gained dead classes', () => {
    const [verdict] = reconcileWithDebt(found([['a.tsx', 4]]), { 'a.tsx': 3 });

    expect(verdict).toMatchObject({ file: 'a.tsx', found: 4, allowed: 3, regressed: true });
  });

  /** A file with no recorded debt gets a ceiling of zero, not a free pass. */
  it('flags any dead class in a file the debt file does not mention', () => {
    const [verdict] = reconcileWithDebt(found([['new.tsx', 1]]), {});

    expect(verdict).toMatchObject({ file: 'new.tsx', allowed: 0, regressed: true });
  });

  /**
   * The ratchet. Without reporting improvements the ceiling never comes down,
   * and a file could silently reacquire every class someone just removed.
   */
  it('reports a file that improved so the ceiling can be lowered', () => {
    const [verdict] = reconcileWithDebt(found([['a.tsx', 1]]), { 'a.tsx': 3 });

    expect(verdict).toMatchObject({ file: 'a.tsx', found: 1, allowed: 3, improved: true });
  });

  it('treats a fully fixed file as an improvement, not as absent', () => {
    const [verdict] = reconcileWithDebt(found([]), { 'a.tsx': 2 });

    expect(verdict).toMatchObject({ file: 'a.tsx', found: 0, allowed: 2, improved: true });
  });

  it('never reports the same file as both regressed and improved', () => {
    for (const verdict of reconcileWithDebt(found([['a.tsx', 5]]), { 'a.tsx': 2, 'b.tsx': 9 })) {
      expect(verdict.regressed && verdict.improved).toBe(false);
    }
  });
});

describe('the repo itself', () => {
  /**
   * Guards the lint against the stylesheet being renamed or restructured out
   * from under it: a scan that silently defines nothing would pass every file.
   */
  it('parses a substantial set of classes from the shipped utilities', () => {
    const css = readFileSync(
      path.join(REPO_ROOT, 'main/kernel/ui/src/styles/utilities.css'),
      'utf8',
    );

    const defined = parseDefinedClasses(css);

    expect(defined.size).toBeGreaterThan(200);
    expect(defined.has('flex')).toBe(true);
    expect(defined.has('md:flex-row')).toBe(true);
  });
});
