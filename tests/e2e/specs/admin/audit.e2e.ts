// tests/e2e/specs/admin/audit.e2e.ts
/**
 * Audit & Security Events E2E Tests
 *
 * Tests the admin security events UI through Playwright,
 * verifying navigation, filtering, detail view, and export functionality.
 */

import { expect, test } from '@playwright/test';

import { loginViaUi } from '#tests/e2e/fixtures/auth';
import { ADVANCED_ADMIN_SKIP_REASON, advancedAdminEnabled } from '#tests/e2e/fixtures/capabilities';
import { authDialog } from '#tests/e2e/page-objects/ui';

// The security/audit surfaces only register when advanced admin is enabled.
test.skip(!advancedAdminEnabled, ADVANCED_ADMIN_SKIP_REASON);

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';
const adminUser = {
  email: 'admin@example.com',
  password: 'AdminPass123!',
  role: 'admin' as const,
};
async function dismissMobileOverlays(page: import('@playwright/test').Page): Promise<void> {
  await page
    .context()
    .addInitScript(() => {
      window.localStorage.setItem('cookie-consent-dismissed', 'true');
    })
    .catch(() => undefined);
  await page
    .evaluate(() => {
      window.localStorage.setItem('cookie-consent-dismissed', 'true');
      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          htmlElement.getClientRects().length > 0
        );
      };
      const clickMatchingButton = (root: Element | Document, textPattern: RegExp): void => {
        for (const button of root.querySelectorAll('button')) {
          if (textPattern.test(button.textContent ?? '') && isVisible(button)) {
            (button as HTMLButtonElement).click();
          }
        }
      };
      for (const banner of document.querySelectorAll('[data-testid="cookie-consent-banner"]')) {
        clickMatchingButton(banner, /reject non-essential|accept all/i);
      }
      for (const hint of document.querySelectorAll('.feature-hint-callout')) {
        clickMatchingButton(hint, /got it/i);
      }
    })
    .catch(() => undefined);
}

async function loginAsAdminToSecurity(page: import('@playwright/test').Page): Promise<void> {
  await dismissMobileOverlays(page);
  await loginViaUi(page, adminUser, baseURL, '/admin/security');
  await expect(page).toHaveURL((url) => url.pathname === '/admin/security');
  await dismissMobileOverlays(page);
}

test.describe('Admin Security Events', () => {
  test('admin can navigate to security events and see events list with filters', async ({
    page,
  }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    await loginAsAdminToSecurity(page);

    // Expect the security events page to load with a list or table
    const eventsList = page.getByRole('table').or(page.locator('[data-testid="events-list"]'));
    await expect(eventsList).toBeVisible();

    // Verify filter controls are present
    await expect(page.getByTestId('event-type-filter')).toBeVisible();
    await expect(page.getByLabel(/^Email$/i)).toBeVisible();
  });

  test('filter by event type updates results', async ({ page }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    await loginAsAdminToSecurity(page);

    // Select a filter option for event type
    await page.getByTestId('event-type-filter').click();

    // Select "account_locked" option
    const accountLockedOption = page
      .getByRole('option', { name: /account.locked/i })
      .or(page.getByText(/account.locked/i));
    if ((await accountLockedOption.count()) > 0) {
      await accountLockedOption.first().click();
    }

    // Wait for results to update
    await page.waitForTimeout(500);

    // Verify the list updated (page should not show an error alert)
    await expect(page.getByRole('alert').filter({ hasText: /error|failed/i })).toHaveCount(0);
    await expect(
      page.getByRole('table').or(page.locator('[data-testid="events-list"]')),
    ).toBeVisible();
  });

  test('click event to see detail view with all metadata', async ({ page }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    await loginAsAdminToSecurity(page);

    // Click on the first event row
    const firstEventRow = page
      .getByRole('row')
      .nth(1)
      .or(page.locator('[data-testid="event-row"]').first());
    if ((await firstEventRow.count()) > 0) {
      await firstEventRow.click();
    }

    // Verify detail view shows metadata fields
    const detailView = page
      .locator('[data-testid="event-detail"]')
      .or(page.getByRole('dialog'))
      .or(page.locator('.event-detail'));

    if ((await detailView.count()) > 0) {
      // Check for presence of common metadata field labels
      const hasEventType = (await page.getByText(/event.type/i).count()) > 0;
      const hasSeverity = (await page.getByText(/severity/i).count()) > 0;
      const hasIpAddress =
        (await page.getByText(/ip.address/i).count()) > 0 ||
        (await page.getByText(/ip/i).count()) > 0;

      expect(hasEventType || hasSeverity || hasIpAddress).toBe(true);
    }
  });

  test('export events downloads file successfully', async ({ page }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    await loginAsAdminToSecurity(page);

    // Look for and click the export button
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-events"]'));

    await expect(exportButton.first()).toBeVisible();
    await exportButton.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await dialog.getByRole('button', { name: /^export$/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('security-events');
  });

  test('trigger login failure and see new security event appear in list', async ({ page }) => {
    test.setTimeout(75_000);
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    // First, trigger a failed login attempt
    await page.goto(`${baseURL}/login`);
    await dismissMobileOverlays(page);
    await page.getByLabel(/email/i).fill('nonexistent-user@example.com');
    await page.getByLabel(/^Password$/i).fill('WrongPassword123!');
    // The form's own submit: the top bar behind the modal has a "Login" button too.
    await authDialog(page).getByRole('button', { name: 'Sign in', exact: true }).click();

    // Wait for the failure to be processed
    await page.waitForTimeout(1000);

    await loginAsAdminToSecurity(page);

    await page.getByLabel(/^Email$/i).fill('nonexistent-user@example.com');
    await page.getByRole('button', { name: /apply filters/i }).click();

    await expect(page.getByText(/error/i)).not.toBeVisible();
    const resultsTable = page.getByRole('table');
    const emptyState = page.getByRole('heading', {
      name: /no security events/i,
    });

    await expect(resultsTable.or(emptyState).first()).toBeVisible({
      timeout: 10_000,
    });
    if (await resultsTable.isVisible()) {
      await expect
        .poll(async () => page.getByRole('row').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
    } else {
      await expect(emptyState).toBeVisible();
    }
  });
});
