// main/apps/web/src/__tests__/control-borders.test.ts
/**
 * A control the web app styles itself draws its boundary with
 * `--ui-color-border-control` (3:1, WCAG 1.4.11), like the controls of
 * `@bslt/ui`. The hairline `--ui-color-border` is for decoration.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

/** Stylesheet (relative to `src`) and selector of each control the app styles. */
const CONTROLS = [['app/account/SettingsPage.css', '.settings-preferences__theme-option']] as const;

function ruleBody(sheet: string, selector: string): string {
  const css = readFileSync(path.join(SRC, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if ((match[1] ?? '').trim() === selector) return match[2] ?? '';
  }
  throw new Error(`${sheet} has no rule for ${selector}`);
}

describe('control borders in the web app', () => {
  it.each(CONTROLS)('%s %s draws its border with the control token', (sheet, selector) => {
    const borders = ruleBody(sheet, selector)
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => /^border(?:-[a-z-]+)?\s*:/u.test(declaration));
    expect(borders).toEqual(['border: 1px solid var(--ui-color-border-control)']);
  });
});
