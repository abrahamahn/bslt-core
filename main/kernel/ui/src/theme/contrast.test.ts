// main/kernel/ui/src/theme/contrast.test.ts
/**
 * The contrast gate (restructure plan, section 12): every colour pair the
 * tokens render together, in every theme, against WCAG 2.1 AA. 4.5:1 for text
 * (1.4.3), 3:1 for the parts of a control and for the focus ring (1.4.11).
 */
import { describe, expect, it } from 'vitest';

import {
  AA_TEXT,
  AA_UI,
  THEME_NAMES,
  auditContrast,
  contrastPairs,
  contrastRatio,
  focusRingColors,
  themeTokens,
  unclassifiedColorTokens,
} from './contrast';

describe('contrastRatio', () => {
  it('returns 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0a0a0a', '#fafafa')).toBeCloseTo(contrastRatio('#fafafa', '#0a0a0a'), 5);
  });

  it('refuses a value that is not a six-digit hex colour', () => {
    expect(() => contrastRatio('rgb(0 0 0 / 50%)', '#ffffff')).toThrow(/rgb\(0 0 0 \/ 50%\)/u);
  });
});

describe('themeTokens', () => {
  it('covers light, dark and both high-contrast themes', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark', 'light-high-contrast', 'dark-high-contrast']);
  });

  it('lays the high-contrast overrides over the base theme', () => {
    expect(themeTokens('light')['--ui-color-text']).toBe('#0a0a0a');
    expect(themeTokens('light-high-contrast')['--ui-color-text']).toBe('#000000');
    expect(themeTokens('dark-high-contrast')['--ui-color-text']).toBe('#ffffff');
    // A token high contrast does not override keeps the base theme's value.
    expect(themeTokens('dark-high-contrast')['--ui-color-hover']).toBe(
      themeTokens('dark')['--ui-color-hover'],
    );
  });
});

describe('focusRingColors', () => {
  it('reads the rings of a box-shadow, innermost first', () => {
    expect(focusRingColors('0 0 0 2px #ffffff, 0 0 0 4px #0a0a0a')).toEqual(['#ffffff', '#0a0a0a']);
    expect(focusRingColors('0 0 0 3px #000000')).toEqual(['#000000']);
  });
});

describe('contrastPairs', () => {
  const pairs = contrastPairs(themeTokens('light'));
  const has = (foreground: string, background: string, minimum: number): boolean =>
    pairs.some(
      (pair) =>
        pair.foreground === foreground &&
        pair.background === background &&
        pair.minimum === minimum,
    );

  it('holds text on every surface it is set on, at 4.5:1', () => {
    for (const surface of ['bg', 'surface', 'hover', 'active']) {
      expect(has('--ui-color-text', `--ui-color-${surface}`, AA_TEXT)).toBe(true);
      expect(has('--ui-color-text-muted', `--ui-color-${surface}`, AA_TEXT)).toBe(true);
    }
  });

  it('holds the label of every filled control, at 4.5:1', () => {
    for (const fill of ['primary', 'danger', 'success', 'warning', 'muted', 'surface-strong']) {
      expect(has('--ui-color-text-inverse', `--ui-color-${fill}`, AA_TEXT)).toBe(true);
    }
  });

  it('holds alert text and badge ink on their own fills, including live/premium/locked hooks and brand on-colour', () => {
    expect(has('--ui-alert-danger-text', '--ui-alert-danger-bg', AA_TEXT)).toBe(true);
    expect(has('--ui-color-warning', '--ui-badge-warning-bg', AA_TEXT)).toBe(true);
    expect(has('--ui-color-live', '--ui-badge-live-bg', AA_TEXT)).toBe(true);
    expect(has('--ui-color-premium', '--ui-badge-premium-bg', AA_TEXT)).toBe(true);
    expect(has('--ui-color-locked', '--ui-badge-locked-bg', AA_TEXT)).toBe(true);
    expect(has('--ui-color-on-brand', '--ui-color-brand', AA_TEXT)).toBe(true);
    expect(has('--ui-color-primary', '--ui-color-primary-muted', AA_TEXT)).toBe(true);
  });

  it('holds the control border on every surface a control sits on, at 3:1', () => {
    for (const surface of ['bg', 'surface', 'hover']) {
      expect(has('--ui-color-border-control', `--ui-color-${surface}`, AA_UI)).toBe(true);
    }
  });

  it('holds the switch thumb on both tracks, at 3:1', () => {
    expect(has('--ui-color-control-thumb', '--ui-color-primary', AA_UI)).toBe(true);
    expect(has('--ui-color-control-thumb', '--ui-color-border-control', AA_UI)).toBe(true);
  });

  it('holds the focus ring against the page, a raised surface and its own inner ring', () => {
    const ring = pairs.filter((pair) => pair.foreground === '--ui-focus');
    expect(ring.map((pair) => pair.background)).toEqual([
      '--ui-color-bg',
      '--ui-color-surface',
      '--ui-color-hover',
      '--ui-focus (inner ring)',
    ]);
    expect(ring.every((pair) => pair.minimum === AA_UI)).toBe(true);
  });

  it('pairs an on-colour token with the colour it is named after', () => {
    const withOnColor = contrastPairs({
      ...themeTokens('light'),
      '--ui-color-accent-500': '#1d4ed8',
      '--ui-color-on-accent-500': '#ffffff',
    });
    expect(
      withOnColor.some(
        (pair) =>
          pair.foreground === '--ui-color-on-accent-500' &&
          pair.background === '--ui-color-accent-500' &&
          pair.minimum === AA_TEXT,
      ),
    ).toBe(true);
  });
});

describe('auditContrast', () => {
  it('reports a pair below its minimum, with the measured ratio', () => {
    const tokens = { ...themeTokens('light'), '--ui-color-text-muted': '#bbbbbb' };
    expect(auditContrast(tokens)).toContain(
      'muted text on the page: --ui-color-text-muted (#bbbbbb) on --ui-color-bg (#ffffff) is 1.92:1, below 4.5:1',
    );
  });

  it('reports a control border that fades into its surface', () => {
    const tokens = { ...themeTokens('dark'), '--ui-color-border-control': '#1f1f22' };
    expect(auditContrast(tokens).some((line) => line.includes('--ui-color-border-control'))).toBe(
      true,
    );
  });
});

describe.each(THEME_NAMES)('the %s theme', (name) => {
  const tokens = themeTokens(name);

  it('defines --ui-color-border-control', () => {
    expect(tokens['--ui-color-border-control']).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it('meets WCAG AA for every pair: 4.5:1 for text, 3:1 for controls and the focus ring', () => {
    expect(auditContrast(tokens)).toEqual([]);
  });

  it('classifies every colour token: in a pair, or named as decoration', () => {
    expect(unclassifiedColorTokens(tokens)).toEqual([]);
  });
});

describe('the decorative hairline', () => {
  it.each(['light', 'dark'] as const)(
    'stays lighter than the control border in the %s theme',
    (name) => {
      // `--ui-color-border` is decoration (card edges, dividers), deliberately
      // under 3:1. A control never uses it: see `control-borders.test.ts`.
      const tokens = themeTokens(name);
      const page = tokens['--ui-color-bg'] ?? '';
      expect(contrastRatio(tokens['--ui-color-border'] ?? '', page)).toBeLessThan(AA_UI);
      expect(contrastRatio(tokens['--ui-color-border-control'] ?? '', page)).toBeGreaterThanOrEqual(
        AA_UI,
      );
    },
  );
});
