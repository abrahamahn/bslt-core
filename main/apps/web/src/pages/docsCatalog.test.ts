// main/apps/web/src/pages/docsCatalog.test.ts
import { describe, expect, it } from 'vitest';

import {
  DOC_CHAPTERS,
  DOC_GROUP_LABELS,
  DOC_GROUP_ORDER,
  filterDocChapters,
  resolveDocChapter,
} from './docsCatalog';

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
      expect(chapter.routes.length).toBeGreaterThan(0);
      expect(chapter.sections.length).toBeGreaterThan(0);
    }
  });

  it('resolves chapters by slug and falls back to overview for unknown or missing slugs', () => {
    expect(resolveDocChapter(undefined).id).toBe('overview');
    expect(resolveDocChapter('').id).toBe('overview');
    expect(resolveDocChapter('nonexistent-chapter').id).toBe('overview');
    expect(resolveDocChapter('workspaces').path).toBe('/docs/workspaces');
    expect(resolveDocChapter('cli').path).toBe('/docs/cli');
  });

  it('filters chapters across titles, keywords, routes, and section copy', () => {
    expect(filterDocChapters('')).toHaveLength(DOC_CHAPTERS.length);
    expect(filterDocChapters('   ')).toHaveLength(DOC_CHAPTERS.length);

    const webhookMatches = filterDocChapters('webhooks');
    expect(webhookMatches.some((chapter) => chapter.id === 'workspaces')).toBe(true);

    const passkeyMatches = filterDocChapters('passkey');
    expect(passkeyMatches.some((chapter) => chapter.id === 'auth')).toBe(true);

    expect(filterDocChapters('definitely-no-match-xyz')).toEqual([]);
  });
});
