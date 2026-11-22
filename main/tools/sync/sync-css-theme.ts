// main/tools/sync/sync-css-theme.ts
/**
 * Build theme.css from TypeScript theme source files
 *
 * This script generates CSS custom properties from the theme source files.
 * All values come from the source files - no hardcoded values here.
 */
import { createHash, randomUUID } from 'crypto';
import { promises as fsPromises, watch as fsWatch } from 'node:fs';
import { join } from 'node:path';

import { format } from 'prettier';

import bsltConfig from '../../../bslt.config';
import { generateThemeCss } from '../../kernel/ui/src/theme/buildThemeCss';
import { repoPath } from '../lib/paths';

const themeCssPath = repoPath('main/kernel/ui/src/styles/theme.css');
const cacheDir = repoPath('main/node_modules/.cache');
const themeHashPath = join(cacheDir, 'theme-css.hash');

let isQuiet = false;
function log(message: string): void {
  if (!isQuiet) console.log(message);
}

const themeSourceFiles = [
  repoPath('bslt.config.ts'),
  repoPath('main/kernel/ui/src/theme/brand.ts'),
  repoPath('main/kernel/ui/src/theme/breakpoints.ts'),
  repoPath('main/kernel/ui/src/theme/colors.ts'),
  repoPath('main/kernel/ui/src/theme/motion.ts'),
  repoPath('main/kernel/ui/src/theme/radius.ts'),
  repoPath('main/kernel/ui/src/theme/spacing.ts'),
  repoPath('main/kernel/ui/src/theme/typography.ts'),
  repoPath('main/kernel/ui/src/theme/buildThemeCss.ts'),
];

async function computeInputHash(paths: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const filePath of paths) {
    const content = await fsPromises.readFile(filePath, 'utf8');
    hash.update(filePath);
    hash.update(content);
  }
  return hash.digest('hex');
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = await fsPromises.open(tempPath, 'wx', 0o600);
  try {
    await fd.writeFile(content, 'utf8');
  } finally {
    await fd.close();
  }
  await fsPromises.rename(tempPath, filePath);
}

async function build(): Promise<void> {
  const inputHash = await computeInputHash(themeSourceFiles);
  await fsPromises.mkdir(cacheDir, { recursive: true });

  const existingHash = await fsPromises.readFile(themeHashPath, 'utf8').catch((): null => null);
  // Use readFile instead of stat to avoid TOCTOU race condition
  const existingCss = await fsPromises
    .readFile(themeCssPath, 'utf8')
    .then(() => true)
    .catch(() => false);

  if (existingCss && existingHash?.trim() === inputHash) {
    log('Theme CSS is up to date; skipping rebuild.');
    return;
  }

  const css = generateThemeCss({ brandAccent: bsltConfig.brand?.accent });
  const formatted = await format(css, { parser: 'css' });
  await writeFileAtomic(themeCssPath, formatted);
  await writeFileAtomic(themeHashPath, inputHash);

  log(`Generated theme CSS at ${themeCssPath}`);
}

function watch(): void {
  log('Watching theme source files...\n');

  let timeout: NodeJS.Timeout | null = null;
  const debounce = (): void => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      build().catch((err: unknown) => {
        console.error('Failed to build theme.css', err);
      });
    }, 100);
  };

  for (const filePath of themeSourceFiles) {
    fsWatch(filePath, () => {
      debounce();
    });
  }

  build().catch((err: unknown) => {
    console.error('Failed to build theme.css', err);
  });
}

/** Builds `theme.css` from the theme sources once, or keeps rebuilding with `watch`. */
export async function syncTheme(
  options: { readonly watch?: boolean; readonly quiet?: boolean } = {},
): Promise<void> {
  isQuiet = options.quiet === true;
  if (options.watch === true) {
    watch();
    return;
  }
  await build();
}
