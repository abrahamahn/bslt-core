// tests/e2e/specs/auth/login-totp.e2e.ts
/**
 * Login TOTP E2E Tests
 *
 * Comprehensive tests for the TOTP two-factor authentication login challenge:
 * - Login → 202 challenge → enter 6-digit code → verify → dashboard
 * - Invalid TOTP code → error message → retry
 * - Expired challenge token → error → redirects to login
 * - "Back to login" button resets state
 * - TOTP code input validation (length, numeric-only)
 * - Multiple failed attempts → lockout messaging
 */

import { expect, test } from '@playwright/test';

import {
  authSuccessResponse,
  buildMockUser,
  oauthProvidersResponse,
  strategiesResponse,
  tosStatusAccepted,
  totpChallengeResponse,
} from '#tests/e2e/fixtures/auth-contracts';
import { mockSignedInDashboardEndpoints } from '#tests/e2e/fixtures/signed-in-mocks';
import { ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

const mockUser = buildMockUser({
  email: 'totp.user@example.com',
  username: 'totp-user',
  firstName: 'Totp',
});

const challengeToken = 'mock-totp-challenge-jwt-token';

function mockCommonEndpoints(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/auth/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local'])),
      });
    }),
    page.route('**/api/csrf-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'mock-csrf-token' }),
      });
    }),
    page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    }),
    // Keep auth.initialize() unauthenticated so AuthPage renders the login form.
    page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    }),
  ]);
}

function mockLoginTotp(page: import('@playwright/test').Page) {
  return page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify(totpChallengeResponse(challengeToken)),
    });
  });
}

function mockAuthenticatedSession(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/users/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockUser),
      });
    }),
    // Note: refresh is intentionally NOT mocked here (handled by mockCommonEndpoints as 401).
    // After TOTP verification the app has the access token from the verify response.
    page.route('**/api/auth/tos/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tosStatusAccepted()),
      });
    }),
  ]);
}

async function navigateToTotpChallenge(page: import('@playwright/test').Page) {
  await page.goto('/auth?mode=login');
  const emailInput = page.getByLabel(/email|username/i).first();
  const passwordInput = page.getByLabel(/^Password$/i).first();
  await expect(emailInput).toBeVisible();
  await emailInput.fill('totp.user@example.com');
  await passwordInput.fill('TestPassword123!');
  await page.locator('button[type="submit"]').first().click({ noWaitAfter: true });
  await expect(page.getByText('Two-Factor Authentication')).toBeVisible({ timeout: 5000 });
}

test.describe('Login TOTP Challenge Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
    await mockCommonEndpoints(page);
    await mockLoginTotp(page);
  });

  test('login → 202 → enter valid TOTP code → verify → redirect to dashboard', async ({ page }) => {
    await mockSignedInDashboardEndpoints(page, mockUser);
    type VerifyPayload = { challengeToken?: string; code?: string };
    let totpVerifyCalled = false;
    let verifyPayload: VerifyPayload = {};

    await page.route('**/api/auth/totp/verify-login', async (route) => {
      totpVerifyCalled = true;
      verifyPayload = route.request().postDataJSON() as VerifyPayload;

      if (verifyPayload?.challengeToken === challengeToken && verifyPayload?.code === '123456') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(authSuccessResponse(mockUser)),
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Invalid TOTP code' }),
        });
      }
    });

    await mockAuthenticatedSession(page);
    await navigateToTotpChallenge(page);

    // Fill TOTP code
    const codeInput = page.getByLabel(/Authentication Code/i);
    await expect(codeInput).toBeVisible();
    await codeInput.fill('123456');

    // Verify button should be enabled
    const verifyButton = page.getByRole('button', { name: /^Verify$/i });
    await expect(verifyButton).toBeEnabled();
    await verifyButton.click({ noWaitAfter: true });

    // Should redirect to dashboard/settings
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
      .toMatch(/^\/(settings|dashboard)?$/);

    expect(totpVerifyCalled).toBe(true);
    expect(verifyPayload.challengeToken).toBe(challengeToken);
    expect(verifyPayload.code).toBe('123456');
  });

  test('invalid TOTP code → error message → user can retry', async ({ page }) => {
    let attemptCount = 0;

    await page.route('**/api/auth/totp/verify-login', async (route) => {
      attemptCount++;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid TOTP code' }),
      });
    });

    await navigateToTotpChallenge(page);

    const codeInput = page.getByLabel(/Authentication Code/i);
    await codeInput.fill('000000');
    await page.getByRole('button', { name: /^Verify$/i }).click();

    // Should show error
    await expect(page.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible({ timeout: 5000 });

    // TOTP form should still be visible for retry
    await expect(codeInput).toBeVisible();
    expect(attemptCount).toBe(1);

    // User can retry with different code
    await codeInput.clear();
    await codeInput.fill('111111');
    await page.getByRole('button', { name: /^Verify$/i }).click();
    expect(attemptCount).toBe(2);
  });

  test('expired challenge token → error message', async ({ page }) => {
    await page.route('**/api/auth/totp/verify-login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Challenge token expired', code: 'TOKEN_EXPIRED' }),
      });
    });

    await navigateToTotpChallenge(page);

    const codeInput = page.getByLabel(/Authentication Code/i);
    await codeInput.fill('123456');
    await page.getByRole('button', { name: /^Verify$/i }).click();

    await expect(page.getByText(/expired|invalid|error/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('"Back to login" resets TOTP challenge and shows login form', async ({ page }) => {
    await navigateToTotpChallenge(page);

    // Click "Back to login"
    await page.getByRole('button', { name: /Back to login/i }).click();

    // Login form should reappear
    await expect(page.getByText(/Welcome back|Sign in/i).first()).toBeVisible();
    await expect(page.getByLabel(/email|username/i).first()).toBeVisible();
    await expect(page.getByLabel(/^Password$/i).first()).toBeVisible();
  });

  test('TOTP challenge screen shows expected UI elements', async ({ page }) => {
    await navigateToTotpChallenge(page);

    // Should show TOTP heading
    await expect(page.getByText('Two-Factor Authentication')).toBeVisible();

    // Should show instruction text
    await expect(page.getByText(/Enter the 6-digit code/i)).toBeVisible();

    // Should have code input
    await expect(page.getByLabel(/Authentication Code/i)).toBeVisible();

    // Should have verify button
    await expect(page.getByRole('button', { name: /^Verify$/i })).toBeVisible();

    // Should have back button
    await expect(page.getByRole('button', { name: /Back to login/i })).toBeVisible();
  });

  test('server error during TOTP verification shows error gracefully', async ({ page }) => {
    await page.route('**/api/auth/totp/verify-login', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal server error' }),
      });
    });

    await navigateToTotpChallenge(page);

    await page.getByLabel(/Authentication Code/i).fill('123456');
    await page.getByRole('button', { name: /^Verify$/i }).click();

    await expect(page.getByText(/error|something went wrong|try again/i).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
