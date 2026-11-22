// tests/e2e/specs/account/settings.e2e.ts
/**
 * Settings Page E2E Tests
 *
 * Verifies settings page behavior when unauthenticated.
 * The settings route is protected and redirects unauthenticated users to login.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  expectAppShell,
  expectPathOrRedirect,
  suppressCookieConsent,
} from '#tests/e2e/page-objects/ui';

async function waitForUnauthenticatedSettingsState(page: Page): Promise<void> {
  const loginHeading = page.getByRole('heading', { name: /welcome back/i });
  const errorState = page.getByText(/session expired|unable to load settings|not authenticated/i);

  return expect
    .poll(
      async () => {
        if (new URL(page.url()).pathname === '/login' && (await loginHeading.isVisible())) {
          return 'login';
        }
        if ((await errorState.count()) > 0 && (await errorState.first().isVisible())) {
          return 'settings-error';
        }
        return 'pending';
      },
      { timeout: 10_000 },
    )
    .toMatch(/^(login|settings-error)$/);
}

test.beforeEach(async ({ page }) => {
  await suppressCookieConsent(page);
});

test.describe('Settings Page — Unauthenticated', () => {
  test('renders without crashing', async ({ page }) => {
    await page.goto('/settings');
    await expectAppShell(page);
    await expectPathOrRedirect(page, '/settings');
  });

  test('redirects to login or shows an unauthenticated state', async ({ page }) => {
    await page.goto('/settings');
    await expectPathOrRedirect(page, '/settings');

    await waitForUnauthenticatedSettingsState(page);

    if (new URL(page.url()).pathname === '/login') {
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({
        timeout: 5000,
      });
      return;
    }

    const errorState = page.getByText(/session expired|unable to load settings|not authenticated/i);
    if ((await errorState.count()) > 0) {
      await expect(errorState.first()).toBeVisible({ timeout: 5000 });
      return;
    }
    throw new Error('Expected settings to redirect to login or show an unauthenticated state');
  });

  test('has action button (Go to Login or Try Again)', async ({ page }) => {
    await page.goto('/settings');
    await expectPathOrRedirect(page, '/settings');

    await waitForUnauthenticatedSettingsState(page);

    if (new URL(page.url()).pathname === '/login') {
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible({
        timeout: 5000,
      });
      return;
    }

    const actionButton = page
      .getByRole('button', { name: /go to login|try again/i })
      .or(page.getByRole('link', { name: /go to login|try again/i }));
    if ((await actionButton.count()) > 0) {
      await expect(actionButton.first()).toBeVisible({ timeout: 5000 });
      return;
    }
    throw new Error('Expected unauthenticated settings to expose a login or retry action');
  });
});
