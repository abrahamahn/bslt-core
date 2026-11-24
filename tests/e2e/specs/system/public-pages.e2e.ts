// tests/e2e/specs/system/public-pages.e2e.ts
/**
 * Public Pages E2E Tests
 *
 * Verifies that public (unauthenticated) pages render correctly:
 * Home page and UI Library page.
 */

import { expect, test } from '@playwright/test';

import {
  configuredAppName,
  expectAppShell,
  suppressCookieConsent,
} from '#tests/e2e/page-objects/ui';

test.beforeEach(async ({ page }) => {
  await suppressCookieConsent(page);
});

test.describe('Home Page', () => {
  test('renders the landing page', async ({ page }) => {
    await page.goto('/');
    await expectAppShell(page);
    // The page's own title, not the top bar's brand heading that expectAppShell checked.
    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { level: 1, name: configuredAppName(), exact: true }),
    ).toBeVisible();
  });

  test('renders app shell with navigation', async ({ page }) => {
    await page.goto('/');
    const primaryNav = page.getByRole('navigation', { name: /primary/i });
    await expect(primaryNav.getByRole('link', { name: /^Home$/i })).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: /^Changelog$/i })).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: /^Pricing$/i })).toHaveCount(0);
  });

  test('renders the starter-owned changelog page', async ({ page }) => {
    await page.goto('/changelog');
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: /changelog/i }),
    ).toBeVisible();
    await expect(page.getByText('v1.0.0')).toBeVisible();
  });
});

test.describe('UI Library Page', () => {
  test('renders with category buttons', async ({ page }) => {
    await page.goto('/ui-library');
    // UI Library has category tabs (Elements, Components, etc.)
    await expect(page.getByRole('button', { name: /elements/i })).toBeVisible();
  });

  test('shows component count text', async ({ page }) => {
    await page.goto('/ui-library');
    await expect(page.locator('body')).toContainText(/\d+\s+components/i);
  });

  test('category buttons are clickable', async ({ page }) => {
    await page.goto('/ui-library');
    const elementsBtn = page.getByRole('button', { name: /elements/i });
    await expect(elementsBtn).toBeVisible();
    await elementsBtn.scrollIntoViewIfNeeded();
    await elementsBtn.evaluate((el) => {
      (el as HTMLButtonElement).click();
    });
    // After click, the button should still be visible (active state)
    await expect(elementsBtn).toBeVisible();
  });
});

// The /clean demo home + doc viewer only exists while dev tools are enabled
// (always true against the Vite dev server, like /ui-library above).
test.describe('Clean Route', () => {
  test('renders the demo home page', async ({ page }) => {
    await page.goto('/clean');
    await expectAppShell(page);
    // The page's own title, not the top bar's brand heading that expectAppShell checked.
    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { level: 1, name: configuredAppName(), exact: true }),
    ).toBeVisible();
  });

  test('loads a specific doc via query param', async ({ page }) => {
    await page.goto('/clean?doc=readme');
    await expect(page.locator('.markdown-content')).toBeVisible();
  });
});
