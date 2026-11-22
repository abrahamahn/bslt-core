// main/modules/devtools/web/catalog.test.tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryRouter } from '@bslt/react/router';

import {
  componentCatalog,
  getAllCategories,
  getComponentsByCategory,
  getTotalComponentCount,
} from './catalog';
import { STORY_INDEX } from './generated/story-index.generated';

describe('devtools UI catalog', () => {
  afterEach(() => {
    cleanup();
  });

  it('RETURNS empty array for unknown categories and rejects duplicate/blank component demo IDs', () => {
    expect(getComponentsByCategory('nonexistent-category')).toEqual([]);
    expect(getTotalComponentCount()).toBe(STORY_INDEX.length);

    for (const [key, entry] of Object.entries(componentCatalog)) {
      expect(entry.id).toBe(key);
      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(entry.variants.length).toBeGreaterThan(0);
      const variantNames = entry.variants.map((v) => v.name);
      expect(new Set(variantNames).size).toBe(variantNames.length);
    }
  });

  it('exposes elements, components, layouts, and theme categories and renders every catalog story cleanly', () => {
    const categories = getAllCategories();
    expect(categories).toContain('elements');
    expect(categories).toContain('components');
    expect(categories).toContain('layouts');
    expect(categories).toContain('theme');

    for (const entry of STORY_INDEX) {
      const demo = componentCatalog[entry.storyId];
      expect(demo, `missing catalog entry for ${entry.storyId}`).toBeDefined();
      for (const variant of demo?.variants ?? []) {
        const { unmount } = render(<MemoryRouter>{variant.render()}</MemoryRouter>);
        unmount();
      }
    }
  });
});
