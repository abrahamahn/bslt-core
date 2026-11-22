// main/kernel/ui/src/__tests__/control-borders.test.ts
/**
 * Every control draws its boundary with `--ui-color-border-control` (3:1 against
 * the surface, WCAG 1.4.11). The hairline `--ui-color-border` is for decoration:
 * card edges, dividers, table rules.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const STYLES = path.resolve(__dirname, '../styles');
const SHEETS = ['elements.css', 'components.css', 'layouts.css', 'utilities.css'] as const;

/** The rules of the design system's stylesheets: selector to declarations. */
function rules(): Map<string, string> {
  const found = new Map<string, string>();
  for (const sheet of SHEETS) {
    const css = readFileSync(path.join(STYLES, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const selector = (match[1] ?? '').trim();
      found.set(selector, `${found.get(selector) ?? ''}${match[2] ?? ''}`);
    }
  }
  return found;
}

function borderDeclarations(body: string): string[] {
  return body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => /^border(?:-[a-z-]+)?\s*:/u.test(declaration));
}

/** The selectors whose border is the boundary of something a user operates. */
const CONTROLS = [
  '.btn-secondary',
  '.checkbox-box',
  '.file-input::file-selector-button',
  '.input',
  '.oauth-button',
  '.pagination-button',
  '.payment-method-card__action--default',
  '.payment-method-card__action--remove',
  '.pricing-table__toggle',
  '.radio-circle',
  '.select',
  '.switch',
  '.tenant-usage-override-editor__input',
  '.textarea',
] as const;

const CONTROL_TOKEN = 'var(--ui-color-border-control)';
const HAIRLINE_TOKEN = 'var(--ui-color-border)';

describe('control borders', () => {
  const all = rules();

  it.each(CONTROLS)('%s draws its border with the control token', (selector) => {
    const borders = borderDeclarations(all.get(selector) ?? '');
    expect(borders.some((declaration) => declaration.includes(CONTROL_TOKEN))).toBe(true);
    expect(borders.filter((declaration) => declaration.includes(HAIRLINE_TOKEN))).toEqual([]);
  });

  it('lists every rule that uses the control token as a border', () => {
    const users = [...all]
      .filter(([, body]) =>
        borderDeclarations(body).some((declaration) => declaration.includes(CONTROL_TOKEN)),
      )
      .map(([selector]) => selector)
      .sort();
    expect(users).toEqual([...CONTROLS].sort());
  });

  it('fills the unchecked switch track with the control colour, so the thumb shows on it', () => {
    expect(all.get('.switch')).toMatch(/background:\s*var\(--ui-color-border-control\)/u);
  });

  it('leaves no reference to the token it replaced', () => {
    for (const sheet of [...SHEETS, 'theme.css']) {
      expect(readFileSync(path.join(STYLES, sheet), 'utf8'), sheet).not.toContain(
        '--ui-color-border-strong',
      );
    }
  });
});
