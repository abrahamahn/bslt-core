// main/apps/web/src/pages/docsCatalog.test.ts
import { describe, expect, it } from 'vitest';

import {
  DOC_CHAPTERS,
  DOC_GROUP_LABELS,
  DOC_GROUP_ORDER,
  DOC_KERNEL_PACKAGES,
  filterDocChapters,
  filterDocModules,
  getPlatformStats,
  resolveDocChapter,
  resolveDocModule,
} from './docsCatalog';
import { DOCS_REFERENCE } from './docsReference.generated';

describe('docsCatalog', () => {
  it('defines unique chapter ids, absolute /docs paths, and valid group references', () => {
    const ids = new Set<string>();
    const paths = new Set<string>();

    for (const chapter of DOC_CHAPTERS) {
      expect(ids.has(chapter.id)).toBe(false);
      expect(paths.has(chapter.path)).toBe(false);
      ids.add(chapter.id);
      paths.add(chapter.path);

      expect(chapter.path === '/docs' || chapter.path.startsWith('/docs/')).toBe(true);
      expect(DOC_GROUP_ORDER).toContain(chapter.group);
      expect(DOC_GROUP_LABELS[chapter.group].length).toBeGreaterThan(0);
      if (chapter.view === 'guide') {
        expect(chapter.routes.length).toBeGreaterThan(0);
        expect(chapter.sections.length).toBeGreaterThan(0);
      }
    }

    expect(DOC_KERNEL_PACKAGES).toHaveLength(12);
    expect(getPlatformStats()).toHaveLength(6);
    expect(getPlatformStats()[0]?.value).toBe(DOCS_REFERENCE.apiRoutes.length);
  });

  it('resolves chapters and modules by slug and falls back safely for missing or unknown ids', () => {
    expect(resolveDocChapter(undefined).id).toBe('overview');
    expect(resolveDocChapter('').id).toBe('overview');
    expect(resolveDocChapter('nonexistent-chapter').id).toBe('overview');
    expect(resolveDocChapter('api').path).toBe('/docs/api');
    expect(resolveDocChapter('database').path).toBe('/docs/database');
    expect(resolveDocChapter('events').path).toBe('/docs/events');
    expect(resolveDocChapter('workspaces').path).toBe('/docs/workspaces');
    expect(resolveDocChapter('cli').path).toBe('/docs/cli');

    expect(resolveDocModule(undefined)).toBeUndefined();
    expect(resolveDocModule('')).toBeUndefined();
    expect(resolveDocModule('nonexistent-module')).toBeUndefined();
    expect(resolveDocModule('identity')?.id).toBe('identity');
  });

  it('filters chapters and modules across metadata and returns empty on non-matching queries', () => {
    expect(filterDocChapters('')).toHaveLength(DOC_CHAPTERS.length);
    expect(filterDocChapters('   ')).toHaveLength(DOC_CHAPTERS.length);
    expect(filterDocModules('')).toHaveLength(DOCS_REFERENCE.modules.length);

    expect(filterDocChapters('webhooks').some((chapter) => chapter.id === 'workspaces')).toBe(true);
    expect(filterDocChapters('passkey').some((chapter) => chapter.id === 'auth')).toBe(true);
    expect(filterDocChapters('rls').some((chapter) => chapter.id === 'database')).toBe(true);
    expect(filterDocModules('identity').some((mod) => mod.id === 'identity')).toBe(true);

    expect(filterDocChapters('definitely-no-match-xyz')).toEqual([]);
    expect(filterDocModules('definitely-no-match-xyz')).toEqual([]);
  });
});
