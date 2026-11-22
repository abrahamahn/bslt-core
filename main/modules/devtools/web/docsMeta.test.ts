// main/modules/devtools/web/docsMeta.test.ts
import { describe, expect, it } from 'vitest';

import { docCategories, docsMeta, loadDocContent } from './docsMeta';

describe('docsMeta', () => {
  it('REJECTS unknown doc keys in loadDocContent', async () => {
    await expect(loadDocContent('nonexistent-key-xyz')).rejects.toThrow('Unknown doc key');
    await expect(loadDocContent('')).rejects.toThrow('Unknown doc key');
  });

  it('REJECTS non-kebab-case doc keys or blank labels/categories', () => {
    expect(Object.keys(docsMeta).length).toBeGreaterThan(0);
    for (const [key, meta] of Object.entries(docsMeta)) {
      expect(key).toMatch(/^[a-z0-9-]+$/);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.category).toMatch(/^[a-z][a-z-]*$/);
    }
    const topLevelDocsEntries = Object.entries(docsMeta).filter(
      ([key, meta]) => meta.category === 'docs' && key !== 'readme',
    );
    for (const [key] of topLevelDocsEntries) {
      expect(key.startsWith('docs-')).toBe(true);
    }
  });

  it('discovers root readme and ordered categories', () => {
    expect(docsMeta['readme']).toEqual({ label: 'Readme', category: 'root' });
    const categoryKeys = docCategories.map((c) => c.key);
    expect(categoryKeys).toContain('root');
    expect(categoryKeys).toContain('dev');
  });

  it('evaluates cleanly under Node ESM where import.meta.env is undefined', async () => {
    const { execFileSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const docsMetaPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      './docsMeta.ts',
    );
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(docsMetaPath)}); console.log(Object.keys(m.docsMeta).length);`,
      ],
      { encoding: 'utf8' },
    ).trim();
    expect(out).toBe('0');
  });
});
