// main/kernel/ui/src/theme/buildThemeCss.test.ts
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, getFileInfo } from 'prettier';
import { describe, expect, it } from 'vitest';

import { generateThemeCss } from './buildThemeCss';

const themeDir = dirname(fileURLToPath(import.meta.url));
const themeCssPath = resolve(themeDir, '../styles/theme.css');
const repoRoot = resolve(themeDir, '../../../../..');
const prettierIgnorePath = resolve(repoRoot, '.prettierignore');

describe('generateThemeCss', () => {
  it('includes layered root tokens, reduced-motion collapse, z/elevation, brand scale, display type, and media aspect tokens', () => {
    const css = generateThemeCss();

    expect(css).toContain('@layer ui.tokens');
    expect(css).toContain(':root {');
    expect(css).toContain('--ui-color-primary:');
    expect(css).toContain('--ui-color-brand-50:');
    expect(css).toContain('--ui-color-brand-950:');
    expect(css).toContain('--ui-color-brand:');
    expect(css).toContain('--ui-color-on-brand:');
    expect(css).toContain('--ui-z-modal:');
    expect(css).toContain('--ui-z-toast:');
    expect(css).toContain('--ui-elevation-md:');
    expect(css).toContain('--ui-font-size-2xl:');
    expect(css).toContain('--ui-font-size-display:');
    expect(css).toContain('--ui-aspect-video:');
    expect(css).toContain('--ui-color-live:');
    expect(css).toContain('--ui-color-premium:');
    expect(css).toContain('--ui-color-locked:');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('emits every font-weight token consumed by the stylesheets', () => {
    const css = generateThemeCss();

    for (const weight of ['regular', 'medium', 'semibold', 'bold']) {
      expect(css).toContain(`--ui-font-weight-${weight}:`);
    }
  });

  it('stays in sync with the committed theme.css (run `pnpm build:theme` if this fails)', async () => {
    // Mirror sync-css-theme.ts formatting exactly so the comparison is byte-faithful.
    const generated = await format(generateThemeCss(), { parser: 'css' });
    const committed = await readFile(themeCssPath, 'utf8');

    expect(generated).toBe(committed);
  });

  // Reformatting theme.css breaks the byte comparison above, and no tool repairs it:
  // sync-css-theme.ts rebuilds only when its TypeScript sources change, so
  // `pnpm build:theme` reports "up to date" while the output is wrong — git is the only
  // way back. The ignore list must therefore sit where prettier looks WITHOUT being told
  // (repo-root .prettierignore), so even a bare `prettier --write .` skips the file.
  it('is covered by the ignore file at prettier’s default lookup location', async () => {
    const { ignored } = await getFileInfo(themeCssPath, { ignorePath: prettierIgnorePath });

    expect(ignored).toBe(true);
  });

  // …and the default lookup only happens if no caller opts out of it: `--ignore-path`
  // REPLACES the default list, and prettier treats a missing ignore file as "no rules"
  // (exit 0, nothing ignored) — so one stale flag silently un-ignores theme.css again.
  it('has no prettier invocation that overrides the default ignore-path', async () => {
    const rootPackageJson = await readFile(resolve(repoRoot, 'package.json'), 'utf8');

    const overrides = rootPackageJson
      .split('\n')
      .filter((line) => line.includes('prettier') && line.includes('--ignore-path'));

    expect(overrides).toEqual([]);
  });
});
