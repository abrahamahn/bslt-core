// tests/e2e/specs/admin/sessions.e2e.ts
/**
 * Sessions & Device Security E2E Tests
 *
 * Validates the active-sessions list, single-session revocation,
 * "log out all other devices" flow, and human-readable device labels.
 *
 * Requires E2E_BASE_URL to point at a running instance of the app.
 */

import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { createAndLoginE2eUser, ensureVerifiedE2eUser, loginViaUi } from '#tests/e2e/fixtures/auth';

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';
/**
 * The confirmation a revoke opens. Settings is itself a modal dialog now, so
 * this is the dialog that holds the Confirm button, not any dialog.
 */
function confirmationDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^confirm$/i }) });
}

async function dismissMobileOverlays(page: Page): Promise<void> {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register and log in a fresh user, returning the credentials used. */
async function registerAndLogin(page: Page): Promise<{ email: string; password: string }> {
  await dismissMobileOverlays(page);
  const user = await createAndLoginE2eUser(page, baseURL, 'sess', {
    firstName: 'Session',
    lastName: 'Tester',
  });
  return { email: user.email, password: user.password };
}

/** Log in with existing credentials. */
async function login(page: Page, email: string, password: string): Promise<void> {
  await ensureVerifiedE2eUser({ email, password });
  await dismissMobileOverlays(page);
  await loginViaUi(page, { email, password }, baseURL);
}

async function openSessionsSettings(page: Page): Promise<void> {
  await page.goto(`${baseURL}/settings/sessions`);
  await expect(page.getByRole('heading', { name: /active sessions/i })).toBeVisible();
  await dismissMobileOverlays(page);
}

async function expectRefreshRejected(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
          return response.status;
        }),
      { timeout: 5_000 },
    )
    .toBe(401);
}

async function expectRefreshAccepted(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
          return response.status;
        }),
      { timeout: 5_000 },
    )
    .toBe(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sessions & Device Security', () => {
  test.describe.configure({ timeout: 60_000 });

  test('login and navigate to settings to see active sessions list with "This device" indicator', async ({
    page,
  }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    await registerAndLogin(page);

    await openSessionsSettings(page);

    // Expect to see at least one active session entry
    const sessionsList = page.getByText(/active session/i).or(page.getByText(/this device/i));
    await expect(sessionsList.first()).toBeVisible();

    // The current session should be labeled as "This device" or "Current session"
    const currentIndicator = page.getByText(/this device/i).or(page.getByText(/current session/i));
    await expect(currentIndicator.first()).toBeVisible();
  });

  test('login from two sessions, revoke one, verify revoked session is logged out', async ({
    browser,
  }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    const contexts: BrowserContext[] = [];
    try {
      // Session A: register and login
      const contextA: BrowserContext = await browser.newContext();
      contexts.push(contextA);
      const pageA: Page = await contextA.newPage();
      const { email, password } = await registerAndLogin(pageA);

      // Session B: login with same credentials in a different browser context
      const contextB: BrowserContext = await browser.newContext();
      contexts.push(contextB);
      const pageB: Page = await contextB.newPage();
      await login(pageB, email, password);

      await openSessionsSettings(pageA);

      // There should be at least 2 sessions visible
      await expect(pageA.getByRole('button', { name: /^revoke$/i }).first()).toBeVisible();

      // Revoke the other session (not the current one)
      const revokeButton = pageA.getByRole('button', { name: /^revoke$/i }).first();
      await expect(revokeButton).toBeEnabled({ timeout: 10_000 });
      await dismissMobileOverlays(pageA);
      await revokeButton.click();

      const dialog = confirmationDialog(pageA);
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      const revokeResponse = pageA.waitForResponse(
        (response) =>
          response.url().includes('/api/users/me/sessions/') &&
          response.request().method() === 'DELETE' &&
          response.ok(),
      );
      const confirmButton = dialog.getByRole('button', { name: /^confirm$/i });
      await confirmButton.scrollIntoViewIfNeeded();
      await confirmButton.click({ force: true });
      await revokeResponse;

      // The revoked browser can keep its short-lived access token, but refresh must be denied.
      await expectRefreshRejected(pageB);
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  });

  test('"Log out all other devices" leaves only current session active', async ({ browser }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );
    test.setTimeout(90_000);

    const contexts: BrowserContext[] = [];
    try {
      // Session A: register and login
      const contextA: BrowserContext = await browser.newContext();
      contexts.push(contextA);
      const pageA: Page = await contextA.newPage();
      const { email, password } = await registerAndLogin(pageA);

      // Session B: login with same credentials
      const contextB: BrowserContext = await browser.newContext();
      contexts.push(contextB);
      const pageB: Page = await contextB.newPage();
      await login(pageB, email, password);

      // Session C: login with same credentials
      const contextC: BrowserContext = await browser.newContext();
      contexts.push(contextC);
      const pageC: Page = await contextC.newPage();
      await login(pageC, email, password);

      await openSessionsSettings(pageA);

      const revokeAllButton = pageA.getByRole('button', {
        name: /log out all|revoke all|end all other/i,
      });
      await expect(revokeAllButton.first()).toBeVisible();
      await dismissMobileOverlays(pageA);
      await revokeAllButton.first().click();

      const dialog = confirmationDialog(pageA);
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      const revokeAllResponse = pageA.waitForResponse(
        (response) =>
          response.url().includes('/api/users/me/sessions/revoke-all') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      const confirmButton = dialog.getByRole('button', { name: /^confirm$/i });
      await confirmButton.scrollIntoViewIfNeeded();
      await confirmButton.click({ force: true });
      await revokeAllResponse;

      await expectRefreshAccepted(pageA);
      await expectRefreshRejected(pageB);
      await expectRefreshRejected(pageC);
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  });

  test('session shows human-readable device label instead of raw UA string', async ({ page }) => {
    test.skip(
      process.env['E2E_BASE_URL'] === undefined,
      'Set E2E_BASE_URL to run this test against a live app',
    );

    await registerAndLogin(page);

    await openSessionsSettings(page);

    // Wait for the session list query to finish rendering before inspecting text counts.
    await expect(page.getByText(/this device|current session/i).first()).toBeVisible();

    // The UI should show a human-readable device label like "Chrome on Windows"
    // or "Safari on macOS", NOT the raw user agent string like "Mozilla/5.0 ..."
    const rawUaPattern = page.getByText(/^Mozilla\/5\.0/);
    const rawUaCount = await rawUaPattern.count();
    expect(rawUaCount).toBe(0);

    // Instead, expect a readable label containing a browser name
    const browserLabels = [/chrome/i, /firefox/i, /safari/i, /edge/i, /opera/i];
    const osLabels = [/windows/i, /macos/i, /linux/i, /ios/i, /android/i];

    let foundBrowserLabel = false;
    for (const pattern of browserLabels) {
      if ((await page.getByText(pattern).count()) > 0) {
        foundBrowserLabel = true;
        break;
      }
    }

    let foundOsLabel = false;
    for (const pattern of osLabels) {
      if ((await page.getByText(pattern).count()) > 0) {
        foundOsLabel = true;
        break;
      }
    }

    // At least a browser or OS label should be visible as part of the device description
    expect(foundBrowserLabel || foundOsLabel).toBeTruthy();
  });
});
