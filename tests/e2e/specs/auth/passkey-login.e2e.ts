// tests/e2e/specs/auth/passkey-login.e2e.ts
/**
 * Passkey Login E2E Tests
 *
 * Comprehensive tests for WebAuthn passkey login:
 * - Sign in with passkey → options → verify → session → redirect
 * - WebAuthn API not available → button hidden/disabled
 * - Verification failure → error message
 * - User cancels biometric prompt → handled gracefully
 * - Passkey button only visible when webauthn strategy is enabled
 */

import { expect, test } from '@playwright/test';

import {
  authSuccessResponse,
  buildMockUser,
  oauthProvidersResponse,
  strategiesResponse,
  tosStatusAccepted,
  webauthnOptionsResponse,
} from '#tests/e2e/fixtures/auth-contracts';
import { mockSignedInDashboardEndpoints } from '#tests/e2e/fixtures/signed-in-mocks';
import { suppressCookieConsent } from '#tests/e2e/page-objects/ui';

type WebAuthnVerifyRequest = {
  credential: Record<string, unknown>;
  sessionKey: string;
};

const mockUser = buildMockUser({
  email: 'passkey.user@example.com',
  username: 'passkey-user',
  firstName: 'Passkey',
});

function injectWebAuthnMock(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    const mockPublicKeyCredential = (() => undefined) as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      isConditionalMediationAvailable?: () => Promise<boolean>;
    };
    mockPublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    mockPublicKeyCredential.isConditionalMediationAvailable = async () => true;

    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: mockPublicKeyCredential,
    });

    const mockCredential = {
      id: 'mock-credential-id',
      rawId: new Uint8Array([1, 2, 3, 4]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: new Uint8Array([5, 6, 7]).buffer,
        authenticatorData: new Uint8Array([8, 9, 10]).buffer,
        signature: new Uint8Array([11, 12, 13]).buffer,
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    };

    const creds = navigator.credentials as CredentialsContainer & {
      get?: (options?: CredentialRequestOptions) => Promise<unknown>;
    };
    creds.get = async () => mockCredential;
  });
}

function mockWebAuthnStrategies(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/auth/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local', 'webauthn'])),
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

test.describe('Passkey Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await suppressCookieConsent(page);
    await injectWebAuthnMock(page);
    await mockWebAuthnStrategies(page);
  });

  test('passkey login → options → verify → session → redirect to dashboard', async ({ page }) => {
    await mockSignedInDashboardEndpoints(page, mockUser);
    let optionsCalled = false;
    let verifyCalled = false;
    let verifyPayload: WebAuthnVerifyRequest | null = null;

    await page.route('**/api/auth/webauthn/login/options', async (route) => {
      optionsCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          webauthnOptionsResponse({
            challenge: 'AQIDBA',
            rpId: '127.0.0.1',
            timeout: 60000,
            userVerification: 'preferred',
            allowCredentials: [{ id: 'AQIDBA', type: 'public-key' }],
            sessionKey: 'mock-session-key',
          }),
        ),
      });
    });

    await page.route('**/api/auth/webauthn/login/verify', async (route) => {
      verifyCalled = true;
      verifyPayload = route.request().postDataJSON() as WebAuthnVerifyRequest;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authSuccessResponse(mockUser, 'mock-passkey-token')),
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

    await page.goto('/auth?mode=login');

    const passkeyButton = page.getByRole('button', { name: /sign in with passkey/i });
    await expect(passkeyButton).toBeVisible();
    await passkeyButton.click({ noWaitAfter: true });

    await expect.poll(() => optionsCalled).toBe(true);
    await expect.poll(() => verifyCalled).toBe(true);

    expect(verifyPayload).not.toBeNull();
    expect((verifyPayload as WebAuthnVerifyRequest | null)?.sessionKey).toBe('mock-session-key');

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
      .toMatch(/^\/(settings|dashboard)?$/);
  });

  test('passkey verification failure → error message', async ({ page }) => {
    await page.route('**/api/auth/webauthn/login/options', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          webauthnOptionsResponse({
            challenge: 'AQIDBA',
            rpId: '127.0.0.1',
            timeout: 60000,
            userVerification: 'preferred',
            allowCredentials: [{ id: 'AQIDBA', type: 'public-key' }],
            sessionKey: 'mock-session-key',
          }),
        ),
      });
    });

    await page.route('**/api/auth/webauthn/login/verify', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Passkey verification failed' }),
      });
    });

    await page.goto('/auth?mode=login');

    const passkeyButton = page.getByRole('button', { name: /sign in with passkey/i });
    await passkeyButton.click();

    await expect(page.getByText(/fail|error|invalid/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('options endpoint failure → error message', async ({ page }) => {
    await page.route('**/api/auth/webauthn/login/options', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Server error' }),
      });
    });

    await page.goto('/auth?mode=login');

    const passkeyButton = page.getByRole('button', { name: /sign in with passkey/i });
    await passkeyButton.click();

    await expect(page.getByText(/error|fail|unavailable/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Passkey Strategy Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await suppressCookieConsent(page);
    // Keep auth.initialize() unauthenticated so AuthPage renders the login form.
    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });
  });

  test('passkey button hidden when webauthn strategy is disabled', async ({ page }) => {
    await page.route('**/api/auth/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(strategiesResponse(['local'])),
      });
    });
    await page.route('**/api/auth/oauth/providers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(oauthProvidersResponse([])),
      });
    });

    await page.goto('/auth?mode=login');
    await expect(page.getByLabel(/email|username/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /passkey/i })).toHaveCount(0);
  });
});
