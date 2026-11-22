// tests/e2e/specs/system/ui-catalog-stories.e2e.ts
/**
 * UI Catalog Story Screenshots (plan section 12.8)
 *
 * Iterates over every generated `@bslt/ui` story in `STORY_INDEX` via
 * `/ui-library?story=<storyId>` and captures deterministic preview screenshots
 * in both `light` and `dark` themes.
 */

import { STORY_INDEX } from '@bslt/devtools/web';
import { THEME_STORAGE_KEYS } from '@bslt/ui';
import { expect, test } from '@playwright/test';

import { ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

test.describe('UI catalog story screenshots (light & dark themes)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`renders and captures every @bslt/ui story in ${theme} theme`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);

      await ensureLoggedOut(page);
      await suppressCookieConsent(page);
      await page.addInitScript(
        ({ storageKey, mode }) => {
          window.localStorage.setItem(storageKey, JSON.stringify(mode));
          document.documentElement.setAttribute('data-theme', mode);
        },
        { storageKey: THEME_STORAGE_KEYS.mode, mode: theme },
      );

      for (const entry of STORY_INDEX) {
        await page.goto(`/ui-library?story=${encodeURIComponent(entry.storyId)}`);
        const storyRegion = page.locator(`[data-story-id="${entry.storyId}"]`);
        await expect(storyRegion).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: entry.component })).toBeVisible();

        const screenshot = await storyRegion.screenshot({ animations: 'disabled' });
        expect(screenshot.byteLength).toBeGreaterThan(0);
        await testInfo.attach(`${entry.storyId}-${theme}.png`, {
          body: screenshot,
          contentType: 'image/png',
        });
      }
    });
  }
});
