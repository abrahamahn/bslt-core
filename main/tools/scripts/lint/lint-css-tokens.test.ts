// main/tools/scripts/lint/lint-css-tokens.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  findColorFunctions,
  findFontWeights,
  findColorKeywords,
  findHexColors,
  findPxUnits,
  findUiSelectorOverrides,
  isAtRule,
  isComment,
  isVariableDefinition,
  lintFile,
  stripVarAndCalc,
  toLogicalLines,
} from './lint-css-tokens';

const AT = 7;
const FILE = 'x.css';

describe('lint-css-tokens', () => {
  describe('findHexColors', () => {
    it('flags a hex colour', () => {
      const [violation] = findHexColors('  color: #ff0000;', AT, FILE);
      expect(violation).toMatchObject({ file: FILE, line: AT });
      expect(violation?.message).toContain('#ff0000');
    });

    it.each(['3-digit #abc', '6-digit #a1b2c3', '8-digit #a1b2c3ff'])('flags %s', (label) => {
      const hex = label.split(' ')[1] ?? '';
      expect(findHexColors(`color: ${hex};`, AT, FILE)).toHaveLength(1);
    });

    it('ignores a line with no colour', () => {
      expect(findHexColors('  display: flex;', AT, FILE)).toEqual([]);
    });
  });

  describe('findColorFunctions', () => {
    it.each(['rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'hsl(1, 2%, 3%)'])('flags %s', (value) => {
      expect(findColorFunctions(`background: ${value};`, AT, FILE)).toHaveLength(1);
    });

    it('ignores a var() reference', () => {
      expect(findColorFunctions('background: var(--ui-color-surface);', AT, FILE)).toEqual([]);
    });
  });

  describe('findColorKeywords', () => {
    it.each(['white', 'black', 'WHITE'])('flags the bare keyword %s', (keyword) => {
      expect(findColorKeywords(`color: ${keyword};`, AT, FILE)).toHaveLength(1);
    });

    it('flags a keyword inside color-mix, the case that motivated the check', () => {
      // `color-mix(… primary 90%, white 10%)` was eight button hover states. In a
      // monochrome dark theme primary *is* near-white, so the hover was a no-op.
      const violations = findColorKeywords(
        'background: color-mix(in srgb, var(--ui-color-primary) 90%, white 10%);',
        AT,
        FILE,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain('--ui-color-bg');
    });

    it('does not flag those words inside longer identifiers', () => {
      expect(findColorKeywords('background: var(--ui-color-blackboard);', AT, FILE)).toEqual([]);
      expect(findColorKeywords('.white-label { color: red; }', AT, FILE)).toEqual([]);
      expect(findColorKeywords('background: whitesmoke;', AT, FILE)).toEqual([]);
    });

    it('ignores a token reference', () => {
      expect(findColorKeywords('color: var(--ui-color-text);', AT, FILE)).toEqual([]);
    });
  });

  describe('findPxUnits', () => {
    it('flags a px length', () => {
      expect(findPxUnits('  padding: 12px;', AT, FILE)).toHaveLength(1);
    });

    it('allows a 1px border, the documented exception', () => {
      expect(findPxUnits('  border: 1px solid var(--ui-color-border);', AT, FILE)).toEqual([]);
    });
  });

  describe('findFontWeights', () => {
    it.each(['400', '500', '600', '700'])('flags the hardcoded weight %s', (weight) => {
      const violations = findFontWeights(`  font-weight: ${weight};`, AT, FILE);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(weight);
    });

    it('reports a 1-based column', () => {
      // `findFontWeights` matches against the var/calc-stripped line, so the column
      // is an offset into that string — assert it is 1-based rather than 0-based.
      expect(findFontWeights('font-weight: 700;', AT, FILE)[0]?.column).toBe(1);
    });

    it('allows a token reference', () => {
      expect(findFontWeights('  font-weight: var(--ui-font-weight-bold);', AT, FILE)).toEqual([]);
    });

    it('ignores lines without the property', () => {
      expect(findFontWeights('  line-height: 700;', AT, FILE)).toEqual([]);
    });
  });

  describe('lintFile', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'css-tokens-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function lint(css: string): ReturnType<typeof lintFile> {
      const file = path.join(dir, `${String(Math.abs(hash(css)))}.css`);
      writeFileSync(file, css);
      return lintFile(file);
    }

    // Stable per-content filename so parallel cases cannot collide.
    function hash(value: string): number {
      let h = 0;
      for (const char of value) h = (h * 31 + char.charCodeAt(0)) | 0;
      return h;
    }

    it('reports the 1-based line number of each violation', () => {
      const violations = lint('.a {\n  color: red;\n  padding: 12px;\n}\n');
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(3);
    });

    it('finds violations on every line, not just the first', () => {
      // Guards the `lines.entries()` iteration: a loop that stops early, or skips
      // lines, still passes a single-violation fixture.
      const violations = lint('.a {\n  color: #fff;\n  padding: 8px;\n  font-weight: 700;\n}\n');
      expect(violations.map((v) => v.line)).toEqual([2, 3, 4]);
    });

    it('skips comments, at-rules and variable definitions', () => {
      const violations = lint(
        ['/* #ffffff */', '@media (min-width: 48rem) {', '  --ui-x: #ffffff;', '}'].join('\n'),
      );
      expect(violations).toEqual([]);
    });

    it('returns nothing for a missing file rather than throwing', () => {
      expect(lintFile(path.join(dir, 'absent.css'))).toEqual([]);
    });
  });

  describe('toLogicalLines', () => {
    it('drops a block comment without shifting later line numbers', () => {
      const logical = toLogicalLines('/* a\n   b\n   c */\n.x {\n  color: red;\n}\n');
      expect(logical.map((l) => l.text)).toEqual(['.x {', 'color: red;', '}']);
      // `.x {` is physically on line 4; the removed comment must not shift it.
      expect(logical[0]?.line).toBe(4);
    });

    it('never reports a value that only appears inside a comment', () => {
      // AppShell.css documents a deliberate 16px floor; the prose explaining it
      // was itself reported as a violation because continuation lines of a block
      // comment start with neither `/*` nor `*`.
      const css =
        '/* 12pt is exactly 16px:\n   an absolute unit on purpose. */\n.x {\n  gap: 1rem;\n}\n';
      expect(toLogicalLines(css).some((l) => l.text.includes('16px'))).toBe(false);
    });

    it('joins a declaration whose value spans lines, keeping its first line', () => {
      const logical = toLogicalLines(
        '.x {\n  box-shadow:\n    0 1px 2px red,\n    0 4px 8px blue;\n}\n',
      );
      const joined = logical.find((l) => l.text.startsWith('box-shadow'));
      expect(joined?.text).toBe('box-shadow: 0 1px 2px red, 0 4px 8px blue;');
      expect(joined?.line).toBe(2);
    });

    it('keeps a multi-line token definition recognisable as one', () => {
      // theme.css declares shadow tokens across two lines. Split, the `--ui-*`
      // prefix sits on a different line from the rgba() being judged — which is
      // how 42 false positives appeared in the token-definition file.
      const css = ':root {\n  --ui-color-shadow:\n    0 1px 2px rgba(16, 24, 40, 0.04);\n}\n';
      const decl = toLogicalLines(css).find((l) => l.text.includes('rgba'));
      expect(decl?.text.startsWith('--ui-color-shadow:')).toBe(true);
      expect(isVariableDefinition(decl?.text ?? '')).toBe(true);
    });
  });

  describe('shadow exemption', () => {
    it('allows offsets and blur radii in a box-shadow', () => {
      expect(findPxUnits('box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);', AT, FILE)).toEqual([]);
      expect(findPxUnits('text-shadow: 0 2px 4px red;', AT, FILE)).toEqual([]);
    });

    it('still flags px on an ordinary declaration', () => {
      expect(findPxUnits('margin: 4px;', AT, FILE)).toHaveLength(1);
    });
  });

  describe('line classifiers', () => {
    it('recognises comments, at-rules and variable definitions', () => {
      expect(isComment('  /* a note */')).toBe(true);
      expect(isAtRule('@media (min-width: 48rem) {')).toBe(true);
      expect(isVariableDefinition('  --ui-color-text: #202124;')).toBe(true);
      expect(isComment('  color: red;')).toBe(false);
    });

    it('strips var() and calc() so their contents are not flagged', () => {
      expect(stripVarAndCalc('margin: calc(100% - 12px);')).not.toContain('12px');
      expect(stripVarAndCalc('color: var(--x, #fff);')).not.toContain('#fff');
    });
  });

  describe('findUiSelectorOverrides', () => {
    it('flags .ui-* class overrides in app and module stylesheets outside main/kernel/ui', () => {
      expect(
        findUiSelectorOverrides(
          '.tasks-page .ui-button {',
          AT,
          'main/modules/tasks/web/TasksPage.css',
        ),
      ).toHaveLength(1);
      expect(
        findUiSelectorOverrides('.ui-card {', AT, 'main/apps/web/src/pages/LandingPage.css'),
      ).toHaveLength(1);
    });

    it('allows .ui-* selectors inside main/kernel/ui stylesheets and ignores var(--ui-*) declarations', () => {
      expect(
        findUiSelectorOverrides('.ui-shell {', AT, 'main/kernel/ui/src/styles/layouts.css'),
      ).toEqual([]);
      expect(
        findUiSelectorOverrides(
          'padding: var(--ui-gap-md);',
          AT,
          'main/modules/tasks/web/TasksPage.css',
        ),
      ).toEqual([]);
    });
  });
});
