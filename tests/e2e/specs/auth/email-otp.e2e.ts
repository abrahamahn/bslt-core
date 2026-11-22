// tests/e2e/specs/auth/email-otp.e2e.ts
/**
 * Email OTP E2E Tests
 *
 * Passwordless login via a one-time 6-digit email code:
 * - Request code → "check your email" + code-entry step
 * - Enter valid code → session created → redirect
 * - Wrong code → error UI, stays on code step
 * - Rate-limited / server error during request → graceful handling
 */

import { expect, test } from '@playwright/test';

import {
  anonymousCapabilityContextResponse,
  buildMockUser,
  emailOtpRequestedResponse,
  emailOtpVerifiedResponse,
  oauthProvidersResponse,
  strategiesResponse,
  tosStatusAccepted,
} from '#tests/e2e/fixtures/auth-contracts';
import { ADVANCED_AUTH_SKIP_REASON, advancedAuthEnabled } from '#tests/e2e/fixtures/capabilities';
import { mockSignedInDashboardEndpoints } from '#tests/e2e/fixtures/signed-in-mocks';
import { ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

// Email-OTP UI (auth mode) only renders with advanced auth enabled.
test.skip(!advancedAuthEnabled, ADVANCED_AUTH_SKIP_REASON);

const mockUser = buildMockUser({
  email: 'otp@example.com',
  username: 'otp-user',
  firstName: 'Otp',
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

test.describe('Email OTP — Request Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
    await mockCommonEndpoints(page);
  });

  test('requesting a code reveals the code-entry step', async ({ page }) => {
    let requestEmail = '';
    await page.route('**/api/auth/otp/request', async (route) => {
      const body = route.request().postDataJSON() as { email?: string };
      requestEmail = body?.email ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emailOtpRequestedResponse()),
      });
    });

    await page.goto('/auth?mode=email-otp');

    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();

    const sendButton = page.getByRole('button', { name: /send code/i });
    await expect(sendButton).toBeVisible();

    const testEmail = `otp-${Date.now()}@example.com`;
    await emailInput.fill(testEmail);
    await sendButton.click();

    // Code-entry step appears
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel(/security code/i)).toBeVisible();
    expect(requestEmail).toBe(testEmail);
  });

  test('rate-limited request shows an appropriate message', async ({ page }) => {
    await page.route('**/api/auth/otp/request', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Too many requests. Please wait.' }),
      });
    });

    await page.goto('/auth?mode=email-otp');
    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByRole('button', { name: /send code/i }).click();

    await expect(page.getByText(/too many|wait|try again later/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('server error during request shows an error', async ({ page }) => {
    await page.route('**/api/auth/otp/request', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal server error' }),
      });
    });

    await page.goto('/auth?mode=email-otp');
    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByRole('button', { name: /send code/i }).click();

    await expect(page.getByText(/error|failed|try again/i).first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Email OTP — Verify Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
    await mockCommonEndpoints(page);
    await page.route('**/api/auth/otp/request', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emailOtpRequestedResponse()),
      });
    });
  });

  async function reachCodeStep(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/auth?mode=email-otp');
    await page.getByLabel(/email/i).fill('otp@example.com');
    await page.getByRole('button', { name: /send code/i }).click();
    await expect(page.getByLabel(/security code/i)).toBeVisible({ timeout: 10000 });
  }

  test('valid code → session created → redirect', async ({ page }) => {
    await mockSignedInDashboardEndpoints(page, mockUser, { authStrategies: ['local', 'magic'] });
    await page.route('**/api/auth/otp/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emailOtpVerifiedResponse(mockUser, 'mock-jwt-token')),
      });
    });
    await page.route('**/api/users/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockUser),
      });
    });
    await page.route('**/api/auth/tos/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tosStatusAccepted()),
      });
    });

    await reachCodeStep(page);
    await page.getByLabel(/security code/i).fill('123456');
    await page.getByRole('button', { name: /verify and sign in/i }).click();

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
      .toMatch(/^\/(settings|dashboard)?$/);
  });

  test('wrong code → error UI, stays on code step', async ({ page }) => {
    await page.route('**/api/auth/otp/verify', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid or expired security code' }),
      });
    });

    await reachCodeStep(page);
    await page.getByLabel(/security code/i).fill('000000');
    await page.getByRole('button', { name: /verify and sign in/i }).click();

    await expect(page.getByText(/invalid|expired|failed/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/security code/i)).toBeVisible();
  });
});
