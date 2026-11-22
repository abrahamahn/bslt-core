// tests/e2e/specs/auth/resend-verification.e2e.ts
/**
 * Resend Verification E2E Tests (real server)
 *
 * The resend email verification flow against the real API:
 * - Register (real 201) → "Check your email" → click "Resend" → success toast
 * - Resend button enters cooldown state after click
 * - Rate-limited resend → shows rate limit message (mocked 429)
 * - Server error during resend → shows error gracefully (mocked 500)
 *
 * Registration and the first resend run the real handlers; page.route is
 * kept only for the 429/500 error states the real stack cannot produce
 * deterministically.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  ensureLoggedOut,
  fillRegisterForm,
  registerForm,
  suppressCookieConsent,
} from '#tests/e2e/page-objects/ui';

function uniqueEmail(prefix: string): string {
  return `${prefix}_${String(Date.now())}${String(Math.random()).slice(2, 6)}@example.com`;
}

async function registerAndReachVerificationScreen(page: Page, email: string): Promise<void> {
  // Not derived from the email: the register form allows 2-30 characters, and
  // the longer email prefixes ('resend_cooldown_' plus 17 digits) exceed that.
  const username = `rs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await fillRegisterForm(page, { email, username, password: 'TestPassword123!' });
  await registerForm(page)
    .getByRole('button', { name: /create account/i })
    .click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(email)).toBeVisible();
}

test.describe('Resend Verification Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
  });

  test('register → success → click "Resend" → success toast', async ({ page }) => {
    const email = uniqueEmail('resend_ok');
    await registerAndReachVerificationScreen(page, email);

    const resendButton = page.getByRole('button', { name: /Resend email/i });
    await expect(resendButton).toBeVisible();

    const resendResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/resend-verification') &&
        response.request().method() === 'POST',
    );
    await resendButton.click();
    const response = await resendResponse;

    expect(response.status()).toBe(200);
    await expect(page.getByText(/Verification email resent/i)).toBeVisible({ timeout: 5000 });
  });

  test('resend button shows cooldown timer after click', async ({ page }) => {
    const email = uniqueEmail('resend_cooldown');
    await registerAndReachVerificationScreen(page, email);

    await page.getByRole('button', { name: /Resend email/i }).click();

    // After resend, button should show cooldown state
    await expect(page.getByText(/Resend in \d+s/)).toBeVisible({ timeout: 3000 });
  });

  test('rate-limited resend shows error message', async ({ page }) => {
    // Hitting the real rate limiter would poison sibling tests — mocked.
    await page.route('**/api/auth/resend-verification', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Too many requests. Please wait.' }),
      });
    });

    const email = uniqueEmail('resend_limited');
    await registerAndReachVerificationScreen(page, email);

    await page.getByRole('button', { name: /Resend email/i }).click();

    await expect(page.getByText(/too many|wait|try again later/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('server error during resend shows error gracefully', async ({ page }) => {
    // 500s cannot be produced deterministically by the real stack — mocked.
    await page.route('**/api/auth/resend-verification', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal server error' }),
      });
    });

    const email = uniqueEmail('resend_error');
    await registerAndReachVerificationScreen(page, email);

    await page.getByRole('button', { name: /Resend email/i }).click();

    await expect(page.getByText(/error|failed|try again/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('verification success screen shows email address and resend option', async ({ page }) => {
    const email = uniqueEmail('resend_screen');
    await registerAndReachVerificationScreen(page, email);

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole('button', { name: /Resend email/i })).toBeVisible();
  });
});
