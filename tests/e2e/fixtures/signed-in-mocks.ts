// tests/e2e/fixtures/signed-in-mocks.ts
/**
 * Route mocks for the dashboard a mocked login lands on.
 *
 * The advanced-auth specs (TOTP, SMS, passkey, magic link, email code) mock
 * the login and hand the client a fake access token. Any dashboard call left
 * to the real server then answers 401, the client tries to refresh (mocked to
 * 401 as well) and signs the mocked user out, so the test reads `/login`
 * instead of the dashboard whenever those calls win the race. Mocking them
 * makes the landing deterministic.
 */

import {
  completeProfileCompletenessResponse,
  emptyNotificationsListResponse,
  emptySessionsListResponse,
  signedInCapabilityContextResponse,
} from './auth-contracts';

import type { User } from '@bslt/identity/contract';
import type { Page } from '@playwright/test';

export async function mockSignedInDashboardEndpoints(
  page: Page,
  user: User,
  options?: { readonly authStrategies?: readonly string[] },
): Promise<void> {
  // The SPA asks for the viewer's capability context once the mocked login has
  // handed it the fake token. The anonymous request before login carries no
  // token and still goes to the server (or an anonymous route mock registered first).
  await page.route('**/api/platform/context', async (route) => {
    if (route.request().headers()['authorization'] === undefined) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(signedInCapabilityContextResponse(user, options)),
    });
  });
  await page.route('**/api/notifications/list*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyNotificationsListResponse()),
    });
  });
  await page.route('**/api/files/avatar', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ avatarUrl: null, fileId: null }),
    });
  });
  await page.route('**/api/users/me/profile-completeness', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(completeProfileCompletenessResponse()),
    });
  });
  await page.route('**/api/users/me/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptySessionsListResponse()),
    });
  });
}
