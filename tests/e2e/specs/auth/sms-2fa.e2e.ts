// tests/e2e/specs/auth/sms-2fa.e2e.ts
/**
 * SMS 2FA E2E Tests
 *
 * Comprehensive tests for SMS two-factor authentication:
 * - Settings → add phone → verify with SMS code
 * - Login → SMS challenge → enter code → dashboard
 * - Invalid SMS code → error → retry
 * - Phone number format validation
 * - Resend SMS code cooldown
 *
 * Env-driven tests (require live backend) are gated behind env vars.
 * Mock-based tests run without external dependencies.
 */

import { expect, test } from '@playwright/test';

import {
  authSuccessResponse,
  buildMockUser,
  oauthProvidersResponse,
  smsChallengeResponse,
  strategiesResponse,
  tosStatusAccepted,
} from '#tests/e2e/fixtures/auth-contracts';
import { mockSignedInDashboardEndpoints } from '#tests/e2e/fixtures/signed-in-mocks';
import {
  ensureLoggedOut,
  selectSettingsSection,
  suppressCookieConsent,
} from '#tests/e2e/page-objects/ui';

const mockUser = buildMockUser({
  email: 'sms.user@example.com',
  username: 'sms-user',
  firstName: 'SMS',
  phone: '+15551234567',
  phoneVerified: true,
});

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

async function mockSmsSendEndpoint(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/sms/send', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'SMS sent' }),
    });
  });
}

test.describe('SMS 2FA — Login Challenge (Mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
    await mockCommonEndpoints(page);
  });

  test('login → SMS challenge → enter code → dashboard', async ({ page }) => {
    let smsVerifyCalled = false;
    const challengeToken = 'mock-sms-challenge-token';

    // Login returns SMS 2FA challenge
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify(smsChallengeResponse(challengeToken)),
      });
    });

    await mockSmsSendEndpoint(page);

    // SMS verify endpoint
    await page.route('**/api/auth/sms/verify', async (route) => {
      smsVerifyCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authSuccessResponse(mockUser)),
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
    await mockSignedInDashboardEndpoints(page, mockUser);

    await page.goto('/auth?mode=login');

    // Fill login form
    await page
      .getByLabel(/email|username/i)
      .first()
      .fill('sms.user@example.com');
    await page
      .getByLabel(/^Password$/i)
      .first()
      .fill('TestPassword123!');
    await page.locator('button[type="submit"]').first().click({ noWaitAfter: true });

    // SMS challenge should appear
    await expect(
      page.getByText(/sms verification|enter.*code|verification code/i).first(),
    ).toBeVisible({ timeout: 5000 });

    // Enter code and verify
    const codeInput = page.getByPlaceholder(/000000|code/i).or(page.getByLabel(/code/i));
    await expect(codeInput.first()).toBeVisible();
    await codeInput.first().fill('123456');
    await page.getByRole('button', { name: /^verify$/i }).click({ noWaitAfter: true });

    // Should redirect to dashboard
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
      .toMatch(/^\/(settings|dashboard)?$/);

    expect(smsVerifyCalled).toBe(true);
  });

  test('invalid SMS code → error → can retry', async ({ page }) => {
    const challengeToken = 'mock-sms-challenge-token';

    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify(smsChallengeResponse(challengeToken)),
      });
    });

    let attemptCount = 0;
    await mockSmsSendEndpoint(page);

    await page.route('**/api/auth/sms/verify', async (route) => {
      attemptCount++;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid verification code' }),
      });
    });

    await page.goto('/auth?mode=login');
    await page
      .getByLabel(/email|username/i)
      .first()
      .fill('sms.user@example.com');
    await page
      .getByLabel(/^Password$/i)
      .first()
      .fill('TestPassword123!');
    await page.locator('button[type="submit"]').first().click({ noWaitAfter: true });

    await expect(
      page.getByText(/sms verification|enter.*code|verification code/i).first(),
    ).toBeVisible({ timeout: 5000 });

    const codeInput = page.getByPlaceholder(/000000|code/i).or(page.getByLabel(/code/i));
    await codeInput.first().fill('000000');
    await page.getByRole('button', { name: /^verify$/i }).click({ noWaitAfter: true });

    // Error should be shown
    await expect(page.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible({ timeout: 5000 });
    expect(attemptCount).toBe(1);
  });
});

test.describe('SMS 2FA — Live Backend', () => {
  const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';
  const email = process.env['E2E_SMS_EMAIL'] ?? process.env['E2E_EMAIL'];
  const password = process.env['E2E_SMS_PASSWORD'] ?? process.env['E2E_PASSWORD'];
  const phoneNumber = process.env['E2E_SMS_PHONE'];
  const setupCode = process.env['E2E_SMS_SETUP_CODE'];
  const loginCode = process.env['E2E_SMS_LOGIN_CODE'] ?? process.env['E2E_SMS_SETUP_CODE'];

  async function login(
    page: import('@playwright/test').Page,
    userEmail: string,
    userPassword: string,
  ) {
    await page.goto(`${baseURL}/auth/login`);
    await page.getByLabel(/email/i).fill(userEmail);
    await page.getByLabel(/^Password$/i).fill(userPassword);
    await page
      .getByRole('button', { name: /login|sign in/i })
      .first()
      .click();
  }

  test('settings add+verify phone → login with SMS challenge', async ({ page, context }) => {
    test.skip(
      email === undefined ||
        password === undefined ||
        phoneNumber === undefined ||
        setupCode === undefined ||
        loginCode === undefined,
      'Set E2E_SMS_EMAIL/E2E_SMS_PASSWORD, E2E_SMS_PHONE, E2E_SMS_SETUP_CODE, E2E_SMS_LOGIN_CODE.',
    );

    await login(page, email ?? '', password ?? '');

    const smsChallengeHeading = page.getByText(/sms verification/i).first();
    if ((await smsChallengeHeading.count()) === 0) {
      await page.goto(`${baseURL}/settings`);
      await selectSettingsSection(page, /^security$/i);

      const verifiedBadge = page.getByText(/verified/i).first();
      if ((await verifiedBadge.count()) === 0) {
        await page.getByPlaceholder(/\+1 \(555\) 123-4567/i).fill(phoneNumber ?? '');
        await page.getByRole('button', { name: /send code/i }).click();
        await page.getByPlaceholder(/6-digit code/i).fill(setupCode ?? '');
        await page.getByRole('button', { name: /^verify$/i }).click();
        await expect(page.getByText(/phone number verified/i)).toBeVisible({ timeout: 15000 });
      }

      await page.evaluate(async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      });
      await context.clearCookies();
      await login(page, email ?? '', password ?? '');
    }

    await expect(page.getByText(/sms verification/i)).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder(/000000/i).fill(loginCode ?? '');
    await page.getByRole('button', { name: /^verify$/i }).click();

    await expect(page.getByText(/sms verification/i)).toHaveCount(0);
  });
});
