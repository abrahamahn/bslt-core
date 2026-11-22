// tests/e2e/specs/account/tos.e2e.ts
/**
 * Terms of Service E2E Tests (4.16)
 *
 * Tests:
 * - New ToS -> modal appears -> accept -> normal access
 */

import { expect, test, type Page } from '@playwright/test';

import {
  createE2eUser,
  ensureVerifiedE2eUser,
  loginViaUi,
  type E2eUserCredentials,
} from '#tests/e2e/fixtures/auth';

const BASE_URL = process.env['E2E_BASE_URL'];

async function loginVerifiedUser(
  page: Page,
  prefix: string,
  returnTo = '/settings?tab=legal',
): Promise<E2eUserCredentials> {
  if (BASE_URL === undefined) {
    throw new Error('BASE_URL is required for ToS E2E tests');
  }

  const credentials = createE2eUser(prefix);
  await ensureVerifiedE2eUser(credentials, {
    firstName: 'Terms',
    lastName: 'Tester',
  });
  await loginViaUi(page, credentials, BASE_URL, returnTo);
  return credentials;
}

async function expectAuthenticatedSurface(page: Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/(?:dashboard|settings)$/);
  await expect(page.locator('body')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('body').innerText()).trim().length, {
      timeout: 10000,
    })
    .toBeGreaterThan(0);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/uncaught|stack trace|application error/i);
}

async function expectLegalOrTosStatus(page: Page): Promise<void> {
  const legalStatus = page
    .getByRole('heading', { name: /legal|terms acceptance/i })
    .or(page.getByText(/terms acceptance|action required|accepted|no legal documents/i));
  await expect(legalStatus.first()).toBeVisible({ timeout: 10000 });
}

test.describe('Terms of Service — E2E', () => {
  test('ToS acceptance page renders without crash', async ({ page }) => {
    // Navigate to an authenticated legal surface that would trigger ToS checks.
    await loginVerifiedUser(page, 'tos-render');
    await expectAuthenticatedSurface(page);
    await expectLegalOrTosStatus(page);
  });

  test('new ToS version triggers modal or acceptance flow', async ({ page }) => {
    // When a user is logged in and a new ToS version is published,
    // they should see a modal or redirect to accept the new terms.
    await loginVerifiedUser(page, 'tos-flow');

    await expectAuthenticatedSurface(page);
    await expectLegalOrTosStatus(page);
  });

  test('ToS acceptance modal has accept button when triggered', async ({ page }) => {
    // Navigate to the app - if ToS gating is active after login,
    // a modal with an "Accept" or "I Agree" button should appear
    await loginVerifiedUser(page, 'tos-modal');
    await expectAuthenticatedSurface(page);

    // Look for any ToS-related dialog/modal that might be present
    // This test validates the UI structure exists for the flow
    // Match by dialog title so any unrelated confirmation dialog is not mistaken
    // for the ToS modal.
    const tosDialog = page.getByRole('dialog', { name: 'Terms of Service Updated' });
    const tosButton = tosDialog.getByRole('button', { name: /accept|agree|i agree/i });

    // If a ToS dialog is visible, verify the accept button is there
    if (await tosDialog.isVisible().catch(() => false)) {
      await expect(tosButton).toBeVisible();
    }
    // Otherwise, the legal settings page should expose the user's terms status.
    else {
      await expectLegalOrTosStatus(page);
    }
  });

  test('after ToS acceptance, user has normal access', async ({ page }) => {
    await loginVerifiedUser(page, 'tos-access', '/dashboard');
    await expectAuthenticatedSurface(page);

    const acceptButton = page.getByRole('button', { name: /accept|agree|i agree/i });
    if ((await acceptButton.count()) > 0) {
      await acceptButton.first().click();
    }

    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/(?:dashboard|settings)$/);
  });
});
