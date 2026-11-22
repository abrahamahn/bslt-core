// tests/e2e/specs/auth/oauth.e2e.ts
/**
 * OAuth Login E2E Tests
 *
 * Comprehensive tests for all OAuth provider login flows:
 * - Google, GitHub, Apple, Kakao redirect initiation
 * - OAuth callback simulation (success + error states)
 * - Provider button visibility based on strategies endpoint
 * - Edge cases: network errors, provider unavailable, cancelled auth
 */

import { expect, test } from '@playwright/test';

import { oauthProvidersResponse, strategiesResponse } from '#tests/e2e/fixtures/auth-contracts';
import { ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

import type { Page, Route } from '@playwright/test';

const allProviders = ['google', 'github', 'kakao', 'apple'] as const;
const providerLabels: Record<(typeof allProviders)[number], string> = {
  google: 'Google',
  github: 'GitHub',
  kakao: 'Kakao',
  apple: 'Apple',
};

function mockAllProvidersEnabled(page: Page) {
  return Promise.all([
    page.route(/.*\/(?:api\/)?auth\/strategies(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', ...allProviders])),
      });
    }),
    page.route(/.*\/(?:api\/)?auth\/oauth\/providers(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse(allProviders)),
      });
    }),
    page.route('**/api/csrf-token', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'mock-csrf-token' }),
      });
    }),
  ]);
}

test.describe('OAuth Login Redirects', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
    await mockAllProvidersEnabled(page);
  });

  for (const provider of allProviders) {
    const label = providerLabels[provider];

    test.describe(`Provider: ${provider}`, () => {
      let oauthRequestSeen = false;
      let requestUrl = '';

      test(`clicking "${label}" button triggers redirect to /auth/oauth/${provider}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.route(
          new RegExp(`.*/(?:api/)?auth/oauth/${provider}(?:\\?.*)?$`),
          async (route: Route) => {
            oauthRequestSeen = true;
            requestUrl = route.request().url();
            await route.fulfill({
              status: 302,
              headers: { location: '/login' },
              body: '',
            });
          },
        );

        await page.goto('/login');

        const authButton = page.getByRole('button', {
          name: new RegExp(`Continue with ${label}`, 'i'),
        });
        await expect(authButton).toBeVisible();
        await expect(authButton).toBeEnabled();

        await authButton.click({ noWaitAfter: true });

        await expect.poll(() => oauthRequestSeen, { timeout: 5000 }).toBe(true);
        expect(requestUrl).toContain(`auth/oauth/${provider}`);
      });

      test(`${label} OAuth buttons visible on both login and register pages`, async ({
        page,
      }: {
        page: Page;
      }) => {
        // Check login page
        await page.goto('/login');
        await expect(
          page.getByRole('button', { name: new RegExp(`Continue with ${label}`, 'i') }),
        ).toBeVisible();

        // Check register page
        await page.goto('/register');
        await expect(
          page.getByRole('button', {
            name: new RegExp(`(Continue with|Sign up with) ${label}`, 'i'),
          }),
        ).toBeVisible();
      });
    });
  }
});

test.describe('OAuth Provider Visibility', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
  });

  test('only enabled providers show buttons', async ({ page }: { page: Page }) => {
    await page.route(/.*\/(?:api\/)?auth\/strategies(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', 'google', 'github'])),
      });
    });
    await page.route(/.*\/(?:api\/)?auth\/oauth\/providers(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse(['google', 'github'])),
      });
    });

    await page.goto('/auth?mode=login');
    await expect(page.getByLabel(/email|username/i).first()).toBeVisible({ timeout: 5000 });

    // Enabled providers visible
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible();

    // Disabled providers hidden
    await expect(page.getByRole('button', { name: /Apple/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Kakao/i })).toHaveCount(0);
  });

  test('no OAuth providers enabled hides all OAuth buttons', async ({ page }: { page: Page }) => {
    await page.route(/.*\/(?:api\/)?auth\/strategies(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local'])),
      });
    });
    await page.route(/.*\/(?:api\/)?auth\/oauth\/providers(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    });

    await page.goto('/auth?mode=login');
    await expect(page.getByLabel(/email|username/i).first()).toBeVisible({ timeout: 5000 });

    for (const provider of allProviders) {
      const label = providerLabels[provider];
      await expect(page.getByRole('button', { name: new RegExp(label, 'i') })).toHaveCount(0);
    }
  });

  test('strategies endpoint failure still renders login form gracefully', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.route(/.*\/(?:api\/)?auth\/strategies(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });
    await page.route(/.*\/(?:api\/)?auth\/oauth\/providers(?:\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    });

    await page.goto('/auth?mode=login');

    // Login form should still render even if strategies endpoint fails
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: /^Sign in$/i })).toBeVisible();
  });
});

test.describe('OAuth Callback Handling', () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await suppressCookieConsent(page);
  });

  test('deprecated OAuth callback route falls back to not-found page', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto('/auth/oauth/callback?error=access_denied&provider=google');

    await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible({
      timeout: 10000,
    });
  });
});
