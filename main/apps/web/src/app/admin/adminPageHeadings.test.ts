// main/apps/web/src/app/admin/adminPageHeadings.test.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PAGES_DIR = __dirname;
const MODULES_DIR = path.resolve(__dirname, '../../../../../modules');

interface PageTarget {
  readonly label: string;
  readonly fullPath: string;
}

function pageFiles(): PageTarget[] {
  const appAdminPages = readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('Page.tsx') && !f.endsWith('.test.tsx'))
    .map((f): PageTarget => ({ label: f, fullPath: path.join(PAGES_DIR, f) }));

  const modulePages: PageTarget[] = existsSync(MODULES_DIR)
    ? readdirSync(MODULES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) => {
          const webDir = path.join(MODULES_DIR, d.name, 'web');
          if (!existsSync(webDir)) return [];
          return readdirSync(webDir)
            .filter((f) => f.endsWith('Page.tsx') && !f.endsWith('.test.tsx'))
            .map((f): PageTarget => ({
              label: `modules/${d.name}/web/${f}`,
              fullPath: path.join(webDir, f),
            }));
        })
    : [];

  return [...appAdminPages, ...modulePages].sort((a, b) => a.label.localeCompare(b.label));
}

describe('admin page headings', () => {
  it('finds the admin and module pages, so an empty pass is impossible', () => {
    expect(pageFiles().length).toBeGreaterThan(10);
  });

  it.each(pageFiles().map((p) => [p.label, p.fullPath] as const))(
    '%s renders an h1',
    (_label, fullPath) => {
      const source = readFileSync(fullPath, 'utf8');
      if (!/<Heading\b/.test(source)) return;
      expect(source).toMatch(/<Heading[^>]*\bas="h1"/);
    },
  );
});
