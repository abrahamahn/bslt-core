// main/tools/scripts/lint/lint-responsive.test.ts
/**
 * The responsive-standards lint.
 *
 * The interesting case is `REFERENCE_WIDTHS`. It exists because not every width
 * in a media query is a layout breakpoint — the root font-size ramp opens where
 * `3.2vw` crosses `1rem`, a width dictated by the coefficient rather than
 * chosen from a scale. The risk in allowing such widths is that the mechanism
 * becomes a general escape hatch, so the load-bearing test here is the one
 * asserting an *undeclared* off-scale width still fails.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REFERENCE_WIDTHS } from '../../../kernel/ui/src/theme/breakpoints';

import { checkCssBreakpoints, readDefinedVariants, checkMarkupVariants } from './lint-responsive';

/** Write `css` to a scratch file and return the violations it produces. */
function messagesFor(css: string): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'responsive-lint-'));
  const file = path.join(dir, 'scratch.css');
  writeFileSync(file, css);
  return checkCssBreakpoints(file).map((violation) => violation.message);
}

describe('checkCssBreakpoints', () => {
  it('accepts a canonical rem breakpoint', () => {
    expect(messagesFor('@media (max-width: 48rem) { .a { color: red; } }')).toEqual([]);
  });

  it('accepts every value in the canonical scale', () => {
    for (const rem of [30, 48, 64, 80, 96]) {
      expect(messagesFor(`@media (min-width: ${String(rem)}rem) { .a { color: red; } }`)).toEqual(
        [],
      );
    }
  });

  it('rejects a px width query', () => {
    const [message] = messagesFor('@media (max-width: 500px) { .a { color: red; } }');

    expect(message).toContain('uses px');
  });

  it('rejects an em width query', () => {
    expect(messagesFor('@media (max-width: 30em) { .a { color: red; } }')).toHaveLength(1);
  });

  it('ignores non-width media features', () => {
    expect(messagesFor('@media (prefers-color-scheme: dark) { .a { color: red; } }')).toEqual([]);
    expect(messagesFor('@media (pointer: coarse) { .a { color: red; } }')).toEqual([]);
  });

  it('treats a trailing-zero value as its canonical equivalent', () => {
    expect(messagesFor('@media (max-width: 48.0rem) { .a { color: red; } }')).toEqual([]);
  });

  describe('declared reference widths', () => {
    /**
     * The root font-size ramp. Snapping this to the nearest breakpoint would
     * re-tune the curve it belongs to rather than tidy it, so it is declared
     * centrally instead.
     */
    it('accepts a width declared in REFERENCE_WIDTHS', () => {
      const css = `@media (max-width: ${REFERENCE_WIDTHS.rootRamp}) { html { font-size: 1rem; } }`;

      expect(messagesFor(css)).toEqual([]);
    });

    /**
     * The whole point. If any off-scale rem value passed, this would be a
     * suppression mechanism rather than a narrower rule — and the next person
     * would reach for it instead of thinking.
     */
    it('still rejects an off-scale width that nothing declares', () => {
      const [message] = messagesFor('@media (max-width: 27.3rem) { .a { color: red; } }');

      expect(message).toContain('Undeclared width breakpoint');
    });

    it('rejects the reference width written in px, which is not the same rule', () => {
      // 500px only equals the reference for a reader on the default root size;
      // the rem form tracks their actual font preference.
      const [message] = messagesFor('@media (max-width: 500px) { html { font-size: 1rem; } }');

      expect(message).toContain('uses px');
    });

    it('names REFERENCE_WIDTHS in the failure, so the fix is discoverable', () => {
      const [message] = messagesFor('@media (max-width: 27.3rem) { .a { color: red; } }');

      expect(message).toContain('REFERENCE_WIDTHS');
    });
  });
});

describe('checkMarkupVariants', () => {
  const defined = readDefinedVariants();

  /** Guards against the stylesheet moving out from under the parser. */
  it('parses the shipped responsive variants', () => {
    expect(defined.size).toBeGreaterThan(50);
    expect(defined.has('md:flex-row')).toBe(true);
  });

  function markupMessages(tsx: string): string[] {
    const dir = mkdtempSync(path.join(tmpdir(), 'responsive-lint-'));
    const file = path.join(dir, 'Scratch.tsx');
    writeFileSync(file, tsx);
    return checkMarkupVariants(file, defined).map((violation) => violation.message);
  }

  it('accepts a defined responsive variant', () => {
    expect(markupMessages('<div className="flex md:flex-row" />')).toEqual([]);
  });

  it('rejects a responsive variant no stylesheet defines', () => {
    const [message] = markupMessages('<div className="md:grid-cols-9" />');

    expect(message).toContain('md:grid-cols-9');
  });
});
