// tests/e2e/specs/auth/auth-strategies.e2e.ts
/**
 * Auth Strategies E2E Tests
 *
 * Comprehensive tests for the GET /api/auth/strategies endpoint
 * controlling OAuth provider button visibility:
 * - Strategies endpoint called on page load
 * - Single provider enabled → only that button shown
 * - All providers enabled → all buttons shown
 * - All providers disabled → no OAuth buttons
 * - Mixed enabled/disabled → correct subset shown
 * - Strategies endpoint failure → graceful fallback
 * - Strategy affects both login and register pages
 */

import { expect, test } from '@playwright/test';

import { oauthProvidersResponse, strategiesResponse } from '#tests/e2e/fixtures/auth-contracts';
import { ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

const providers = ['Google', 'GitHub', 'Apple'] as const;

function mockCsrf(page: import('@playwright/test').Page) {
  return page.route('**/api/csrf-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'mock-csrf-token' }),
    });
  });
}

test.describe('Auth Strategies — Provider Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
    await mockCsrf(page);
    // Keep auth.initialize() unauthenticated so AuthPage renders without redirecting.
    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });
  });

  test('strategies endpoint is called on page load', async ({ page }) => {
    let strategiesCalled = false;

    await page.route('**/api/auth/strategies*', async (route) => {
      strategiesCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local'])),
      });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    });

    await page.goto('/auth?mode=login');
    await expect(page.getByLabel(/email|username/i).first()).toBeVisible({ timeout: 5000 });

    expect(strategiesCalled).toBe(true);
  });

  test('Google enabled → Google button visible, others hidden', async ({ page }) => {
    await page.route('**/api/auth/strategies*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', 'google'])),
      });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse(['google'])),
      });
    });

    await page.goto('/auth?mode=login');

    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible({
      timeout: 5000,
    });

    await expect(page.getByRole('button', { name: /GitHub/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Apple/i })).toHaveCount(0);
  });

  test('all providers enabled → all buttons visible', async ({ page }) => {
    await page.route('**/api/auth/strategies*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', 'google', 'github', 'apple'])),
      });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse(['google', 'github', 'apple'])),
      });
    });

    await page.goto('/auth?mode=login');

    for (const provider of providers) {
      await expect(page.getByRole('button', { name: new RegExp(provider, 'i') })).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('all OAuth disabled → no OAuth buttons, login form still renders', async ({ page }) => {
    await page.route('**/api/auth/strategies*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local'])),
      });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    });

    await page.goto('/auth?mode=login');

    // Login form should still render
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({
      timeout: 5000,
    });

    // No OAuth buttons
    for (const provider of providers) {
      await expect(page.getByRole('button', { name: new RegExp(provider, 'i') })).toHaveCount(0);
    }
  });

  test('mixed providers (Google + GitHub only) → correct subset visible', async ({ page }) => {
    await page.route('**/api/auth/strategies*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', 'google', 'github'])),
      });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse(['google', 'github'])),
      });
    });

    await page.goto('/auth?mode=login');

    await expect(page.getByRole('button', { name: /Google/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /GitHub/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Apple/i })).toHaveCount(0);
  });

  test('strategies endpoint failure → login form still renders gracefully', async ({ page }) => {
    await page.route('**/api/auth/strategies*', async (route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    });

    await page.goto('/auth?mode=login');

    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: /^Sign in$/i })).toBeVisible();
  });

  test('strategies affect register page identically', async ({ page }) => {
    await page.route('**/api/auth/strategies*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', 'google'])),
      });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse(['google'])),
      });
    });

    await page.goto('/register');
    await expect(
      page.getByRole('button', { name: /(Continue with|Sign up with) Google/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /GitHub/i })).toHaveCount(0);
  });
});
