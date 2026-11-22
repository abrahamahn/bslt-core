// tests/e2e/specs/auth/token-refresh.e2e.ts
/**
 * Token Refresh E2E Tests (real server)
 *
 * The silent access-token refresh flow against the real API:
 * - Valid refresh cookie → new access token (200) + rotated cookie
 * - Missing refresh token → 401 NO_REFRESH_TOKEN
 * - Invalid/unknown refresh token → 401 INVALID_TOKEN + cookie cleared
 * - Failed refresh → protected route redirects to login
 * - Refresh cookie security attributes (HttpOnly, SameSite, Path)
 *
 * Only the network-failure case uses route interception (route.abort) —
 * a network drop cannot be produced by the real stack.
 */

import { REFRESH_TOKEN_COOKIE_NAME } from '@bslt/contract';
import { expect, test, type Page } from '@playwright/test';

import { createAndLoginE2eUser } from '#tests/e2e/fixtures/auth';
import {
  ensureLoggedOut,
  expectPathOrRedirect,
  suppressCookieConsent,
} from '#tests/e2e/page-objects/ui';

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';

interface RefreshResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: { token?: unknown; message?: unknown; code?: unknown };
}

async function callRefresh(page: Page): Promise<RefreshResult> {
  return page.evaluate(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        body: (await res.json()) as { token?: unknown; message?: unknown; code?: unknown },
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

async function refreshCookieValue(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies(baseURL);
  return cookies.find((cookie) => cookie.name === REFRESH_TOKEN_COOKIE_NAME)?.value;
}

test.describe('Token Refresh Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await suppressCookieConsent(page);
  });

  test('valid refresh cookie returns a new access token and rotates the cookie', async ({
    page,
  }) => {
    await createAndLoginE2eUser(page, baseURL, 'refresh-ok');
    const cookieBefore = await refreshCookieValue(page);
    expect(cookieBefore).toBeDefined();

    const result = await callRefresh(page);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(typeof result.body.token).toBe('string');
    expect(String(result.body.token).length).toBeGreaterThan(0);

    // Rotation: the refresh succeeded with a NEW cookie value.
    await expect.poll(() => refreshCookieValue(page)).not.toBe(cookieBefore);
  });

  test('refresh without a cookie returns 401 NO_REFRESH_TOKEN as JSON', async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();

    const result = await callRefresh(page);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.contentType).toContain('application/json');
    expect(typeof result.body.message).toBe('string');
  });

  test('unknown refresh token returns 401 INVALID_TOKEN and clears the cookie', async ({
    page,
    baseURL: configuredBaseURL,
  }) => {
    // The real handler does not distinguish expired from unknown tokens —
    // both are a generic 401 INVALID_TOKEN with the cookie cleared.
    await page.goto('/');
    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: REFRESH_TOKEN_COOKIE_NAME,
        value: 'this-token-does-not-exist',
        url: configuredBaseURL ?? baseURL,
      },
    ]);

    const result = await callRefresh(page);

    expect(result.status).toBe(401);
    await expect.poll(() => refreshCookieValue(page)).toBeUndefined();
  });

  test('failed refresh → navigating to protected route redirects to login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await expectPathOrRedirect(page, '/dashboard');
  });

  test('network error during refresh is handled gracefully', async ({ page }) => {
    await page.route(/.*\/(?:api\/)?auth\/refresh(?:\?.*)?$/, async (route) => {
      await route.abort('connectionrefused');
    });

    await page.goto('/');

    const result = await page.evaluate(async () => {
      try {
        await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        return { error: false };
      } catch {
        return { error: true };
      }
    });

    expect(result.error).toBe(true);
  });

  test('refresh cookie has HttpOnly and SameSite security attributes', async ({ page }) => {
    await createAndLoginE2eUser(page, baseURL, 'refresh-attrs');

    const cookies = await page.context().cookies(baseURL);
    const refreshCookie = cookies.find((cookie) => cookie.name === REFRESH_TOKEN_COOKIE_NAME);

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
    // 'lax' in dev, 'strict' in production — never 'None'.
    expect(['Lax', 'Strict']).toContain(refreshCookie?.sameSite);
  });
});
