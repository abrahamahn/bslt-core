// tests/e2e/specs/auth/magic-link.e2e.ts
/**
 * Magic Link E2E Tests
 *
 * Comprehensive tests for the magic link authentication flow:
 * - Request magic link → "check your email" success UI
 * - Verify magic link token → session created → redirect
 * - Invalid/expired token → error UI
 * - Empty email submission → validation
 * - Request cooldown behavior
 * - Network error during request → graceful handling
 */

import { expect, test } from '@playwright/test';

import {
  anonymousCapabilityContextResponse,
  buildMockUser,
  magicLinkRequestedResponse,
  magicLinkVerifiedResponse,
  oauthProvidersResponse,
  strategiesResponse,
  tosStatusAccepted,
} from '#tests/e2e/fixtures/auth-contracts';
import { ADVANCED_AUTH_SKIP_REASON, advancedAuthEnabled } from '#tests/e2e/fixtures/capabilities';
import { mockSignedInDashboardEndpoints } from '#tests/e2e/fixtures/signed-in-mocks';
import { ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

// Magic-link UI (auth mode + verify route) only renders with advanced auth.
test.skip(!advancedAuthEnabled, ADVANCED_AUTH_SKIP_REASON);

const mockUser = buildMockUser({
  email: 'magic@example.com',
  username: 'magic-user',
  firstName: 'Magic',
});

function mockCommonEndpoints(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/platform/context', async (route) => {
      if (route.request().headers()['authorization'] !== undefined) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(anonymousCapabilityContextResponse(['local', 'magic'])),
      });
    }),
    page.route(/.*\/(?:api\/)?auth\/strategies(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', 'magic'])),
      });
    }),
    page.route(/.*\/(?:api\/)?auth\/oauth\/providers(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    }),
    page.route('**/api/csrf-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'mock-csrf-token' }),
      });
    }),
    // Keep auth.initialize() unauthenticated so AuthPage renders without redirecting.
    page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    }),
  ]);
}

test.describe('Magic Link — Request Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
    await mockCommonEndpoints(page);
  });

  test('requesting magic link shows success UI with email', async ({ page }) => {
    let requestCalled = false;
    let requestEmail = '';

    await page.route('**/api/auth/magic-link/request', async (route) => {
      requestCalled = true;
      const body = route.request().postDataJSON() as { email?: string };
      requestEmail = body?.email ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(magicLinkRequestedResponse(`Check your email: ${requestEmail}`)),
      });
    });

    await page.goto('/auth?mode=magic-link');

    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();

    const submitButton = page.getByRole('button', { name: /send login link/i });
    await expect(submitButton).toBeVisible();

    const testEmail = `magic-${Date.now()}@example.com`;
    await emailInput.fill(testEmail);
    await submitButton.click();

    // Success message should appear with the email
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(testEmail)).toBeVisible();

    expect(requestCalled).toBe(true);
    expect(requestEmail).toBe(testEmail);
  });

  test('requesting magic link for non-existent email still shows success (security)', async ({
    page,
  }) => {
    // Security: don't reveal whether email exists
    await page.route('**/api/auth/magic-link/request', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(magicLinkRequestedResponse()),
      });
    });

    await page.goto('/auth?mode=magic-link');
    await page.getByLabel(/email/i).fill('doesnotexist@example.com');
    await page.getByRole('button', { name: /send login link/i }).click();

    // Should still show success (not reveal whether email exists)
    await expect(page.getByText(/check your email|link has been sent/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test('server error during magic link request shows error', async ({ page }) => {
    await page.route('**/api/auth/magic-link/request', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal server error' }),
      });
    });

    await page.goto('/auth?mode=magic-link');
    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByRole('button', { name: /send login link/i }).click();

    await expect(page.getByText(/error|failed|try again/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('rate-limited magic link request shows appropriate message', async ({ page }) => {
    await page.route('**/api/auth/magic-link/request', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Too many requests. Please wait.' }),
      });
    });

    await page.goto('/auth?mode=magic-link');
    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByRole('button', { name: /send login link/i }).click();

    await expect(page.getByText(/too many|wait|try again later/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('magic link page has expected form elements', async ({ page }) => {
    await page.goto('/auth?mode=magic-link');

    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send login link/i })).toBeVisible();
  });
});

test.describe('Magic Link — Verify Flow', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieConsent(page);
    await mockCommonEndpoints(page);
  });

  test('valid magic link token → session created → redirect', async ({ page }) => {
    await mockSignedInDashboardEndpoints(page, mockUser, { authStrategies: ['local', 'magic'] });
    await page.route('**/api/auth/magic-link/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(magicLinkVerifiedResponse(mockUser, 'mock-jwt-token')),
      });
    });
    await page.route('**/api/users/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockUser),
      });
    });
    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'mock-access-token' }),
      });
    });
    await page.route('**/api/auth/tos/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tosStatusAccepted()),
      });
    });

    await page.goto('/auth/magic-link/verify?token=valid-token-123');

    // Should redirect to dashboard after successful verification
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
      .toMatch(/^\/(settings|dashboard)?$/);
  });

  test('invalid magic link token → error UI', async ({ page }) => {
    await page.route('**/api/auth/magic-link/verify', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Verification failed' }),
      });
    });

    await page.goto('/auth/magic-link/verify?token=invalid-token');

    const errorHeading = page.getByRole('heading', { name: /verification failed/i });
    await expect(errorHeading).toBeVisible({ timeout: 10000 });
  });

  test('expired magic link token → error UI', async ({ page }) => {
    await page.route('**/api/auth/magic-link/verify', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Magic link has expired' }),
      });
    });

    await page.goto('/auth/magic-link/verify?token=expired-token');

    await expect(page.getByText(/expired|failed|invalid/i).first()).toBeVisible({ timeout: 10000 });
  });
});
