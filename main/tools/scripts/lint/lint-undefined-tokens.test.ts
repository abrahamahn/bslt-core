// main/tools/scripts/lint/lint-undefined-tokens.test.ts
/**
 * The undefined custom-property lint.
 *
 * The load-bearing tests here are the ones about `var(--x, fallback)`. A gate
 * that flagged those would be unusable — every component-owned token is written
 * that way on purpose — and the pressure to silence it would be to weaken the
 * whole check. So the fallback cases are pinned as tightly as the failures.
 */

import { describe, expect, it } from 'vitest';

import {
  findUndefinedTokens,
  parseDefinedTokens,
  parseRuntimeTokens,
} from './lint-undefined-tokens';

/** Tokens reported as unresolvable in `css`, given `defined`. */
function undefinedIn(css: string, defined: string[]): string[] {
  return findUndefinedTokens(css, new Set(defined)).map((u) => u.token);
}

describe('parseDefinedTokens', () => {
  it('reads a declaration', () => {
    expect([...parseDefinedTokens(':root { --ui-gap-md: 0.75rem; }')]).toEqual(['--ui-gap-md']);
  });

  it('reads a declaration whose value is itself a var()', () => {
    const defined = parseDefinedTokens(':root { --a: var(--b); }');

    expect(defined.has('--a')).toBe(true);
    // `--b` is referenced here, not declared.
    expect(defined.has('--b')).toBe(false);
  });

  it('ignores a commented-out declaration', () => {
    expect([...parseDefinedTokens('/* --ui-old: 1rem; */ :root { --ui-new: 1rem; }')]).toEqual([
      '--ui-new',
    ]);
  });
});

describe('parseRuntimeTokens', () => {
  /** The theme builder emits tokens no stylesheet declares. */
  it('reads a token the theme builder assigns', () => {
    expect(parseRuntimeTokens("tokens['--ui-gap-md'] = spacing.md;").has('--ui-gap-md')).toBe(true);
  });

  /** A component sets these per-instance from props. */
  it('reads a token set as an inline style property', () => {
    const source = "const vars = { ['--skeleton-width']: width };";

    expect(parseRuntimeTokens(source).has('--skeleton-width')).toBe(true);
  });
});

describe('findUndefinedTokens', () => {
  it('reports a reference to a token nothing defines', () => {
    expect(undefinedIn('.a { gap: var(--ui-gap-3); }', ['--ui-gap-md'])).toEqual(['--ui-gap-3']);
  });

  it('says nothing when the token exists', () => {
    expect(undefinedIn('.a { gap: var(--ui-gap-md); }', ['--ui-gap-md'])).toEqual([]);
  });

  /**
   * The exemption that makes the gate liveable: a component-owned token is
   * meant to be absent until the component sets it, and the fallback is what
   * the stylesheet does in the meantime.
   */
  it('accepts an undefined token that carries a fallback', () => {
    expect(undefinedIn('.a { width: var(--skeleton-width, 100%); }', [])).toEqual([]);
  });

  it('accepts a fallback written with whitespace before the comma', () => {
    expect(undefinedIn('.a { width: var( --skeleton-width , 100% ); }', [])).toEqual([]);
  });

  it('still reports the same token where it is used without a fallback', () => {
    const css = '.a { width: var(--x, 100%); }\n.b { height: var(--x); }';

    expect(undefinedIn(css, [])).toEqual(['--x']);
  });

  it('reports the line the reference is on, so the fix is findable', () => {
    const css = '.a {\n  color: red;\n}\n.b {\n  gap: var(--nope);\n}';

    expect(findUndefinedTokens(css, new Set())[0]?.line).toBe(5);
  });

  it('ignores a reference inside a comment', () => {
    expect(
      undefinedIn('/* was var(--ui-gap-3) */ .a { gap: var(--ui-gap-md); }', ['--ui-gap-md']),
    ).toEqual([]);
  });

  it('does not mistake a declaration for a reference', () => {
    expect(undefinedIn(':root { --ui-brand: #fff; }', [])).toEqual([]);
  });

  /** The regression that motivated the lint. */
  it('catches a scale that does not exist while its siblings do', () => {
    const css = '.a { gap: var(--ui-gap-3); padding: var(--ui-gap-md); }';

    expect(undefinedIn(css, ['--ui-gap-xs', '--ui-gap-sm', '--ui-gap-md'])).toEqual(['--ui-gap-3']);
  });
});
