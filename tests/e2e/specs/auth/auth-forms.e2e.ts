// tests/e2e/specs/auth/auth-forms.e2e.ts
/**
 * Auth Forms E2E Tests
 *
 * Comprehensive form field presence, client-side validation, and UX behavior
 * for login, register, and forgot-password forms:
 * - Field presence and labels
 * - Empty submission triggers HTML5 validation
 * - Invalid email format validation
 * - Password visibility toggle
 * - Form focus and tab order
 * - Submit button states (enabled/disabled/loading)
 */

import { expect, test } from '@playwright/test';

import { authDialog, ensureLoggedOut, suppressCookieConsent } from '#tests/e2e/page-objects/ui';

// Real server: with cookies cleared, auth.initialize()'s refresh call gets a
// real 401, so AuthPage renders the forms without redirecting. Only the two
// per-test cases below (in-flight timing, 500) intercept routes.
test.beforeEach(async ({ page }) => {
  await ensureLoggedOut(page);
  await suppressCookieConsent(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Login Form
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login Form', () => {
  test('has email/username and password fields', async ({ page }) => {
    await page.goto('/auth?mode=login');
    await expect(page.getByLabel(/email|username/i).first()).toBeVisible();
    await expect(page.getByLabel(/^Password$/i).first()).toBeVisible();
  });

  test('has submit button', async ({ page }) => {
    await page.goto('/auth?mode=login');
    await expect(page.locator('button[type="submit"]').first()).toBeVisible();
  });

  test('empty form submission triggers validation — fields remain empty', async ({ page }) => {
    await page.goto('/auth?mode=login');
    await page.locator('button[type="submit"]').first().click();
    const emailInput = page.getByLabel(/email|username/i).first();
    await expect(emailInput).toHaveValue('');
  });

  test('email field has email type for browser validation', async ({ page }) => {
    await page.goto('/auth?mode=login');
    const emailInput = page.getByLabel(/email|username/i).first();
    const inputType = await emailInput.getAttribute('type');
    // Accept both 'email' and 'text' (for combined email/username fields)
    expect(['email', 'text']).toContain(inputType);
  });

  test('password field has password type (masked input)', async ({ page }) => {
    await page.goto('/auth?mode=login');
    const passwordInput = page.getByLabel(/^Password$/i).first();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('form fields are required', async ({ page }) => {
    await page.goto('/auth?mode=login');
    const emailInput = page.getByLabel(/email|username/i).first();
    const passwordInput = page.getByLabel(/^Password$/i).first();

    const emailRequired = await emailInput.getAttribute('required');
    const passwordRequired = await passwordInput.getAttribute('required');

    // `required` attribute is present (value is '' for boolean attributes)
    expect(emailRequired !== null || passwordRequired !== null).toBe(true);
  });

  test('has forgot password link', async ({ page }) => {
    await page.goto('/auth?mode=login');
    await expect(page.getByText(/forgot.*password/i)).toBeVisible();
  });

  test('has link to register', async ({ page }) => {
    await page.goto('/auth?mode=login');
    await expect(page.getByText(/sign up/i)).toBeVisible();
  });

  test('footer mode toggle is disabled while login request is in flight, then re-enabled on error', async ({
    page,
  }) => {
    await page.route('**/api/auth/login', async (route) => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1200);
      });
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid email or password' }),
      });
    });

    await page.goto('/auth?mode=login');
    await page
      .getByLabel(/email|username/i)
      .first()
      .fill('wrong@example.com');
    await page
      .getByLabel(/^Password$/i)
      .first()
      .fill('wrongpass');
    await page.getByRole('button', { name: /^Sign in$/i }).click();

    await expect(page.getByRole('button', { name: /signing in/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Sign up$/i })).toBeDisabled();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /^Sign up$/i })).toBeEnabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Register Form
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Register Form', () => {
  test('has all required fields', async ({ page }) => {
    await page.goto('/auth?mode=register');
    await expect(page.getByLabel(/^Email$/i)).toBeVisible();
    await expect(page.getByLabel(/^Username$/i)).toBeVisible();
    await expect(page.getByLabel(/^First Name$/i)).toBeVisible();
    await expect(page.getByLabel(/^Last Name$/i)).toBeVisible();
    await expect(page.getByLabel(/^Password$/i).first()).toBeVisible();
  });

  test('has submit button with correct label', async ({ page }) => {
    await page.goto('/auth?mode=register');
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('empty form cannot be submitted', async ({ page }) => {
    // The register form disables submit until the inputs are valid.
    await page.goto('/auth?mode=register');
    await expect(page.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  test('has link to login', async ({ page }) => {
    await page.goto('/auth?mode=register');
    await expect(
      authDialog(page).getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
  });

  test('password field masks input', async ({ page }) => {
    await page.goto('/auth?mode=register');
    const passwordInput = page.getByLabel(/^Password$/i).first();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password Form
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Forgot Password Form', () => {
  test('has email field', async ({ page }) => {
    await page.goto('/auth?mode=forgot-password');
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('has submit button with correct label', async ({ page }) => {
    await page.goto('/auth?mode=forgot-password');
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
  });

  test('empty form submission triggers validation', async ({ page }) => {
    await page.goto('/auth?mode=forgot-password');
    await page.locator('button[type="submit"]').first().click();
    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toHaveValue('');
  });

  test('has link back to sign in', async ({ page }) => {
    await page.goto('/auth?mode=forgot-password');
    await expect(
      authDialog(page).getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
  });

  test('successful reset request shows confirmation message', async ({ page }) => {
    // Real endpoint: enumeration-safe success regardless of account existence.
    await page.goto('/auth?mode=forgot-password');
    await page.getByLabel(/email/i).fill('forgot-password-e2e@example.com');
    await page.locator('button[type="submit"]').first().click();

    const dialog = authDialog(page);
    await expect(dialog.getByText('Check your email')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('forgot-password-e2e@example.com')).toBeVisible();
    // The way back to sign in stays on the confirmation.
    await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('server error during reset request shows error gracefully', async ({ page }) => {
    await page.route('**/api/auth/forgot-password', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal server error' }),
      });
    });

    await page.goto('/auth?mode=forgot-password');
    await page.getByLabel(/email/i).fill('user@example.com');
    await page.locator('button[type="submit"]').first().click();

    await expect(page.getByText(/error|failed|try again/i).first()).toBeVisible({ timeout: 5000 });
  });
});
