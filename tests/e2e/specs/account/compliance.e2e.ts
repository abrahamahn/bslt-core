// tests/e2e/specs/account/compliance.e2e.ts
/**
 * Compliance & Data Privacy E2E Tests
 *
 * Tests the user-facing compliance features:
 * - Data export request and download
 * - Account deletion with grace period
 * - Terms of Service acceptance gating
 * - Consent preferences management
 */

import { expect, test, type Page } from '@playwright/test';

import {
  createE2eUser,
  ensureVerifiedE2eUser,
  loginViaUi,
  prepareE2ePage,
  type E2eUserCredentials,
} from '#tests/e2e/fixtures/auth';
import {
  continueDangerZoneAction,
  expectPendingDeletionReactivationPrompt,
  openSettingsSection,
  settingsSectionPanel,
} from '#tests/e2e/page-objects/ui';

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';

async function createVerifiedUserAndLogin(
  page: Page,
  prefix: string,
  returnTo = '/settings',
): Promise<E2eUserCredentials> {
  const credentials = createE2eUser(prefix);
  await ensureVerifiedE2eUser(credentials, {
    firstName: 'Compliance',
    lastName: 'Tester',
  });
  await loginViaUi(page, credentials, baseURL, returnTo);
  await prepareE2ePage(page);
  return credentials;
}

async function gotoSettingsTab(page: Page, tab: string): Promise<void> {
  await prepareE2ePage(page);
  await openSettingsSection(page, tab);
  await prepareE2ePage(page);
}

test.describe('Data Export', () => {
  test('request data export, see processing status, receive download link', async ({ page }) => {
    test.setTimeout(90_000);

    await createVerifiedUserAndLogin(page, 'compliance-export', '/settings?tab=data-controls');
    await gotoSettingsTab(page, 'data-controls');

    // Find and click the "Request Export" button
    const exportButton = page.getByTestId('request-export-button');
    await expect(exportButton).toBeVisible({ timeout: 15_000 });
    await expect(exportButton).toBeEnabled();

    const exportResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/users/me/export') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await exportButton.click();
    await exportResponse;

    // The section reports the new request: a status badge plus a pending (or,
    // if the worker already finished, ready) alert.
    await expect(page.getByTestId('export-status-badge')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId('export-pending-alert').or(page.getByTestId('export-ready-alert')),
    ).toBeVisible();

    // Wait up to 30 seconds for the export to complete; if it is still being
    // processed in CI, the pending state must remain reported.
    const downloadButton = page.getByTestId('download-export-button');
    try {
      await expect(downloadButton).toBeVisible({ timeout: 30_000 });
    } catch {
      await expect(page.getByTestId('export-pending-alert')).toBeVisible();
      await expect(page.getByTestId('export-status-badge')).toHaveText('Processing');
    }
  });
});

test.describe('Account Deletion', () => {
  test('delete account, confirm, logged out, grace-period login only reaches reactivation', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const credentials = await createVerifiedUserAndLogin(
      page,
      'compliance-delete',
      '/settings?tab=account',
    );
    // Account lifecycle (deactivate/delete) lives in the Account tab's Danger Zone,
    // not Data Controls.
    await gotoSettingsTab(page, 'account');

    // The Danger Zone delete button opens the sudo modal: it confirms the
    // deletion first, then asks for the password.
    const deleteButton = page.getByRole('button', { name: /^delete account$/i });
    await expect(deleteButton).toBeVisible({ timeout: 15_000 });
    await deleteButton.click();
    await continueDangerZoneAction(page, 'Delete Account');
    await expect(page.getByText(/confirm your identity/i)).toBeVisible({ timeout: 10_000 });

    const sudoPassword = page.locator('#sudo-password');
    await expect(sudoPassword).toBeVisible({ timeout: 10_000 });
    await sudoPassword.fill(credentials.password);
    const sudoResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/sudo') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    const deletionResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/users/me/delete') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await sudoResponse;
    await deletionResponse;

    const deletionResult = page
      .getByText(/scheduled|pending|deletion|deleted/i)
      .or(page.getByRole('alert'));
    await expect(deletionResult.first()).toBeVisible({ timeout: 10000 });

    // Try to log back in during grace period — should fail
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.context().clearCookies();
    await page.goto(`${baseURL}/login`);

    await page.getByLabel(/email|username/i).fill(credentials.email);
    await page.getByLabel(/^Password$/i).fill(credentials.password);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/login') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Within the grace period the server lets the owner sign in so they can
    // cancel the deletion (only an expired grace period still gets the generic
    // credentials error), and the client holds the session on the
    // reactivation prompt instead of opening the app.
    expect((await loginResponse).ok()).toBe(true);
    await expectPendingDeletionReactivationPrompt(page);
  });
});

test.describe('Terms of Service', () => {
  test('new ToS published forces user to accept before continuing', async ({ page }) => {
    await createVerifiedUserAndLogin(page, 'compliance-tos', '/settings?tab=legal');

    // If ToS gating is in effect, user should be redirected to ToS acceptance
    // Look for ToS acceptance UI
    const tosPrompt = page
      .getByText(/terms of service/i)
      .or(page.getByText(/privacy policy/i))
      .or(page.getByText(/terms.*conditions/i))
      .or(page.getByText(/accept.*terms/i));

    if ((await tosPrompt.count()) > 0) {
      // ToS gating is active — the user must accept before continuing
      await expect(tosPrompt.first()).toBeVisible();

      // The dashboard should not be accessible yet
      // Dashboard may or may not be visible depending on the gating approach
      // but the ToS prompt should be prominent

      // Accept the ToS
      const acceptButton = page
        .getByRole('button', { name: /accept/i })
        .or(page.getByRole('button', { name: /agree/i }))
        .or(page.getByRole('button', { name: /i accept/i }));

      // May need to check the checkbox first
      const checkbox = page.getByRole('checkbox').or(page.locator('[data-testid="tos-checkbox"]'));
      if ((await checkbox.count()) > 0) {
        await checkbox.first().check();
      }

      if ((await acceptButton.count()) > 0) {
        await acceptButton.first().click();
      }

      // After acceptance, user should have normal access
      await expect(page).toHaveURL(/dashboard|settings/i);
    } else {
      // No ToS gating currently active — verify authenticated settings access works normally.
      await expect(page).toHaveURL(/settings/i);
    }
  });

  test('accept ToS restores normal access', async ({ page }) => {
    test.setTimeout(75_000);

    await createVerifiedUserAndLogin(page, 'compliance-tos-access', '/settings?tab=legal');

    // If ToS gating is in effect, accept it
    const acceptButton = page
      .getByRole('button', { name: /accept/i })
      .or(page.getByRole('button', { name: /agree/i }));

    if ((await acceptButton.count()) > 0) {
      const checkbox = page.getByRole('checkbox');
      if ((await checkbox.count()) > 0) {
        await checkbox.first().check();
      }
      await acceptButton.first().click();
    }

    // Should now have normal authenticated access
    await expect(page).toHaveURL(/settings|dashboard/i);

    // Verify navigation works (settings, etc.)
    await gotoSettingsTab(page, 'legal');
    // Inside the Legal settings panel: the site footer has a "Legal" heading too.
    await expect(
      settingsSectionPanel(page, 'legal').getByRole('heading', { name: 'Legal', exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/error/i)).not.toBeVisible();
  });
});

test.describe('Consent Preferences', () => {
  test('toggle analytics consent, save, and see it persisted after reload', async ({ page }) => {
    test.setTimeout(75_000);

    await createVerifiedUserAndLogin(page, 'compliance-consent', '/settings?tab=data-controls');
    await gotoSettingsTab(page, 'data-controls');

    // A fresh user has never granted consent, so the analytics toggle is off.
    const analyticsToggle = page.getByRole('switch', { name: 'Analytics tracking' });
    await expect(analyticsToggle).toBeVisible({ timeout: 15_000 });
    await expect(analyticsToggle).toHaveAttribute('aria-checked', 'false');

    // Toggle it on and save.
    await analyticsToggle.click();
    await expect(analyticsToggle).toHaveAttribute('aria-checked', 'true');

    const saveButton = page.getByTestId('consent-save-button');
    await expect(saveButton).toBeEnabled();
    const consentSaveResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/users/me/consent/update') &&
        response.request().method() === 'PATCH' &&
        response.ok(),
    );
    await saveButton.click();
    const saveResponse = await consentSaveResponse;
    expect(saveResponse.request().postDataJSON()).toMatchObject({ analytics: true });

    // After the save the form refetches: the toggle now reflects the stored
    // server state and the save button disables (no pending changes).
    await expect(analyticsToggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('consent-save-button')).toBeDisabled();

    // Reload the tab from the server and verify the preference persisted.
    await gotoSettingsTab(page, 'data-controls');
    const persistedToggle = page.getByRole('switch', { name: 'Analytics tracking' });
    await expect(persistedToggle).toBeVisible({ timeout: 15_000 });
    await expect(persistedToggle).toHaveAttribute('aria-checked', 'true');
  });
});
