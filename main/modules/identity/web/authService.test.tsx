// main/modules/identity/web/authService.test.tsx
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryCache } from '@bslt/client-engine';
import { QueryCacheProvider, TransportProvider } from '@bslt/react';

import {
  AuthService,
  closeAuthModal,
  createAuthService,
  ELIGIBILITY_ATTESTATION_REQUIRED,
  getAuthModalState,
  getOrCreateBrowserDeviceId,
  getPostLoginRedirect,
  IdentityAuthProvider,
  isEligibilityAttestationRequired,
  openAuthModal,
  SIGNUP_CONSENT_REQUIRED,
  SmsChallengeError,
  subscribeAuthModal,
  TotpChallengeError,
  useAuth,
  useAuthModal,
  useLogin,
  useLoginWithPasskey,
  useOptionalAuthService,
  useRegister,
  useVerifyEmail,
  type TokenStore,
} from './authService';

import type { User } from '../contract';
import type { Transport } from '@bslt/client-engine';
import type { UserId } from '@bslt/schema';

const USER_1: User = {
  id: '11111111-1111-4111-8111-111111111111' as UserId,
  email: 'alice@example.com',
  username: 'alice',
  firstName: 'Alice',
  lastName: 'Lovelace',
  role: 'user',
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  dateOfBirth: null,
  gender: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ADMIN_1: User = {
  ...USER_1,
  id: '22222222-2222-4222-8222-222222222222' as UserId,
  email: 'admin@example.com',
  username: 'adminuser',
  role: 'admin',
};

function makeTokenStore(initial: string | null = null): TokenStore & { current: string | null } {
  const store = {
    current: initial,
    get: () => store.current,
    set: (token: string) => {
      store.current = token;
    },
    clear: () => {
      store.current = null;
    },
  };
  return store;
}

describe('AuthService, redirects, attestation, modal store, and auth hooks', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    closeAuthModal();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('isEligibilityAttestationRequired & getPostLoginRedirect failure/boundary cases', () => {
    it('rejects null, primitives, and unrelated error codes while recognizing both plain and module-scoped codes', () => {
      expect(isEligibilityAttestationRequired(null)).toBe(false);
      expect(isEligibilityAttestationRequired('ELIGIBILITY_ATTESTATION_REQUIRED')).toBe(false);
      expect(isEligibilityAttestationRequired({ code: 'INVALID_CREDENTIALS' })).toBe(false);
      expect(isEligibilityAttestationRequired({})).toBe(false);

      expect(isEligibilityAttestationRequired({ code: ELIGIBILITY_ATTESTATION_REQUIRED })).toBe(
        true,
      );
      expect(
        isEligibilityAttestationRequired({ code: `identity.${ELIGIBILITY_ATTESTATION_REQUIRED}` }),
      ).toBe(true);
      expect(isEligibilityAttestationRequired({ code: SIGNUP_CONSENT_REQUIRED })).toBe(true);
      expect(
        isEligibilityAttestationRequired({ code: `identity.${SIGNUP_CONSENT_REQUIRED}` }),
      ).toBe(true);
    });

    it('blocks open redirects, dangerous schemes, malformed encodings, and prioritizes inactive account reactivation', () => {
      expect(getPostLoginRedirect(USER_1, 'https://evil.example/steal')).toBe('/dashboard');
      expect(getPostLoginRedirect(USER_1, '//evil.example/steal')).toBe('/dashboard');
      expect(getPostLoginRedirect(USER_1, '/%E0%A4%A')).toBe('/dashboard');
      expect(getPostLoginRedirect(USER_1, '/foo/javascript:alert(1)')).toBe('/dashboard');
      expect(getPostLoginRedirect(USER_1, '/foo/data:text/html,hi')).toBe('/dashboard');
      expect(getPostLoginRedirect(USER_1, '/foo/vbscript:msgbox')).toBe('/dashboard');
      expect(
        getPostLoginRedirect({ ...USER_1, deactivatedAt: '2026-02-01T00:00:00.000Z' }, '/billing'),
      ).toBe('/reactivate');

      expect(getPostLoginRedirect(ADMIN_1)).toBe('/admin');
      expect(getPostLoginRedirect(USER_1, '/settings?tab=security')).toBe('/settings?tab=security');
    });

    it('persists and reuses browser device id in localStorage', () => {
      const first = getOrCreateBrowserDeviceId();
      expect(first).not.toBeNull();
      expect(getOrCreateBrowserDeviceId()).toBe(first);
    });
  });

  describe('AuthService adversarial failure states', () => {
    it('throws TotpChallengeError and SmsChallengeError on MFA-gated logins without mutating authenticated state', async () => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({ requiresTotp: true, challengeToken: 'totp-tok' })
        .mockResolvedValueOnce({
          requiresSms: true,
          challengeToken: 'sms-tok',
          message: 'Code sent',
        });
      const auth = createAuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: makeTokenStore(),
        transport: { request: request as Transport['request'] },
      });

      await expect(
        auth.login({ identifier: 'alice@example.com', password: 'Password123!' }),
      ).rejects.toBeInstanceOf(TotpChallengeError);
      expect(auth.getState().isAuthenticated).toBe(false);

      await expect(
        auth.login({ identifier: 'alice@example.com', password: 'Password123!' }),
      ).rejects.toBeInstanceOf(SmsChallengeError);
      expect(auth.getState().isAuthenticated).toBe(false);
      auth.destroy();
    });

    it('preserves token on NETWORK_ERROR during refresh and clears session on 401 auth failure', async () => {
      const store = makeTokenStore('existing-access-token');
      const netErr = Object.assign(new Error('Offline'), { code: 'NETWORK_ERROR' });
      const authErr = Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
      const request = vi.fn().mockRejectedValueOnce(netErr).mockRejectedValueOnce(authErr);

      const auth = new AuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: store,
        transport: { request: request as Transport['request'] },
      });

      expect(await auth.refreshToken()).toBe(false);
      expect(store.get()).toBe('existing-access-token');

      expect(await auth.refreshToken()).toBe(false);
      expect(store.get()).toBeNull();
      expect(auth.getState().isAuthenticated).toBe(false);
      auth.destroy();
    });

    it('rolls back startImpersonation when target user fetch fails and rejects endImpersonation when not impersonating', async () => {
      const store = makeTokenStore('admin-jwt');
      const request = vi.fn().mockImplementation(async (path: string) => {
        if (path === '/admin/impersonate/target-1') {
          return {
            token: 'imp-jwt',
            targetUserId: 'target-1',
            targetEmail: 'target@example.com',
            expiresAt: '2026-01-01T01:00:00.000Z',
          };
        }
        if (path === '/api/users/me') {
          throw new Error('Target hydration failed');
        }
        throw new Error(`Unexpected ${path}`);
      });

      const auth = createAuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: store,
        transport: { request: request as Transport['request'] },
      });

      await expect(auth.endImpersonation()).rejects.toThrow('No active impersonation session');
      await expect(auth.startImpersonation('target-1')).rejects.toThrow('Target hydration failed');
      expect(store.get()).toBe('admin-jwt');
      expect(auth.getState().impersonation).toBeNull();
      auth.destroy();
    });

    it('clears local auth even when server /api/auth/logout rejects', async () => {
      const store = makeTokenStore('tok-1');
      const request = vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/users/me') return USER_1;
        if (path === '/api/auth/logout') throw new Error('500 server down');
        throw new Error(`Unexpected ${path}`);
      });

      const auth = createAuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: store,
        transport: { request: request as Transport['request'] },
      });

      await auth.initialize();
      expect(auth.getState().isAuthenticated).toBe(true);

      await auth.logout();
      expect(store.get()).toBeNull();
      expect(auth.getState().isAuthenticated).toBe(false);
      auth.destroy();
    });

    it('holds isAuthenticated false until BFF login token hydration finishes, deduplicates concurrent refresh, and survives missing refresh cookie in mocked environments', async () => {
      const store = makeTokenStore();
      let resolveRefresh: ((value: { token: string }) => void) | undefined;
      let refreshCallCount = 0;

      const request = vi.fn().mockImplementation((path: string) => {
        if (path === '/api/auth/login') {
          return Promise.resolve({ user: USER_1, isNewDevice: false });
        }
        if (path === '/api/auth/refresh') {
          refreshCallCount += 1;
          return new Promise<{ token: string }>((resolve) => {
            resolveRefresh = resolve;
          });
        }
        if (path === '/api/users/me') {
          return Promise.resolve(USER_1);
        }
        return Promise.reject(new Error(`Unexpected ${path}`));
      });

      const auth = createAuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: store,
        transport: { request: request as Transport['request'] },
      });

      const loginPromise = auth.login({
        identifier: 'alice@example.com',
        password: 'Password123!',
      });
      await waitFor(() => {
        expect(refreshCallCount).toBe(1);
      });

      // Must NOT flip isAuthenticated before access token is in store
      expect(store.get()).toBeNull();
      expect(auth.getState().isAuthenticated).toBe(false);

      // Concurrent refreshToken() shares the single in-flight /api/auth/refresh call
      const concurrentRefresh = auth.refreshToken();
      expect(refreshCallCount).toBe(1);

      resolveRefresh?.({ token: 'hydrated-jwt' });
      expect(await concurrentRefresh).toBe(true);
      await loginPromise;

      expect(store.get()).toBe('hydrated-jwt');
      expect(auth.getState().isAuthenticated).toBe(true);
      auth.destroy();

      // Mocked environment where /api/auth/refresh rejects 401 does not wipe the BFF login user
      const mockedOnlyLoginAuth = createAuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: makeTokenStore(),
        transport: {
          request: (async (path: string) => {
            if (path === '/api/auth/login') return { user: USER_1, isNewDevice: false };
            throw Object.assign(new Error('No refresh cookie'), { statusCode: 401 });
          }) as Transport['request'],
        },
      });
      await mockedOnlyLoginAuth.login({
        identifier: 'alice@example.com',
        password: 'Password123!',
      });
      expect(mockedOnlyLoginAuth.getState().isAuthenticated).toBe(true);
      mockedOnlyLoginAuth.destroy();
    });
  });

  describe('AuthService happy paths, modal store, and React hooks', () => {
    it('completes BFF login + refresh hydration, email OTP new-user onboarding, and impersonation round-trip', async () => {
      const store = makeTokenStore();
      let activeMe: User = USER_1;
      const request = vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/auth/login') return { user: USER_1, isNewDevice: true };
        if (path === '/api/auth/refresh') return { token: 'fresh-jwt' };
        if (path === '/api/users/me') return activeMe;
        if (path === '/api/auth/otp/verify') {
          return { token: 'onboard-jwt', user: USER_1, isNewUser: true };
        }
        if (path === '/api/auth/onboarding/complete') {
          return { user: USER_1 };
        }
        if (path === '/admin/impersonate/user-1') {
          activeMe = USER_1;
          return {
            token: 'imp-jwt',
            targetUserId: USER_1.id,
            targetEmail: USER_1.email,
            expiresAt: '2026-01-01T01:00:00.000Z',
          };
        }
        if (path === '/admin/impersonate/end') {
          activeMe = ADMIN_1;
          return { success: true };
        }
        throw new Error(`Unexpected ${path}`);
      });

      const auth = createAuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: store,
        transport: { request: request as Transport['request'] },
      });

      await auth.login({ identifier: 'alice@example.com', password: 'Password123!' });
      expect(store.get()).toBe('fresh-jwt');
      expect(auth.getState().isAuthenticated).toBe(true);
      expect(auth.getState().isNewDevice).toBe(true);
      auth.dismissNewDeviceBanner();
      expect(auth.getState().isNewDevice).toBe(false);

      // Email OTP new-user onboarding holds off authenticated state until completeOnboarding
      auth.completePasskeyLogin({ token: '', user: ADMIN_1 });
      const otpRes = await auth.verifyEmailOtp({ email: 'alice@example.com', code: '123456' });
      expect(otpRes.isNewUser).toBe(true);
      await auth.completeOnboarding({
        firstName: 'Alice',
        lastName: 'Lovelace',
        username: 'alice',
        password: 'Password123!',
      });
      expect(store.get()).toBe('onboard-jwt');

      // Impersonation start & end
      store.set('admin-jwt');
      await auth.startImpersonation('user-1');
      expect(auth.getState().impersonation?.targetEmail).toBe('alice@example.com');
      await auth.endImpersonation();
      expect(auth.getState().impersonation).toBeNull();
      expect(auth.getState().user?.role).toBe('admin');

      auth.destroy();
    });

    it('drives authModalStore and IdentityAuthProvider hooks including mutation error states', async () => {
      const listener = vi.fn();
      const unsub = subscribeAuthModal(listener);
      openAuthModal('register');
      expect(getAuthModalState()).toEqual({ open: true, mode: 'register' });
      closeAuthModal();
      expect(getAuthModalState()).toEqual({ open: false, mode: 'register' });
      unsub();

      const request = vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/auth/login') throw new Error('Bad credentials');
        if (path === '/api/auth/register') throw new Error('Email taken');
        if (path === '/api/auth/verify-email') throw new Error('Expired token');
        if (path === '/api/auth/webauthn/login/options') throw new Error('Passkeys disabled');
        throw new Error(`Unexpected ${path}`);
      });
      const transport: Transport = { request: request as Transport['request'] };
      const auth = createAuthService({
        config: { apiUrl: 'http://localhost:3000', tokenRefreshInterval: 60_000 },
        tokenStore: makeTokenStore(),
        transport,
      });
      const cache = new QueryCache();
      const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(
          QueryCacheProvider,
          { cache },
          createElement(
            TransportProvider,
            { transport },
            createElement(IdentityAuthProvider, { auth }, children),
          ),
        );

      const modalHook = renderHook(() => useAuthModal());
      expect(modalHook.result.current.open).toBe(false);

      const authHook = renderHook(() => useAuth(), { wrapper });
      expect(authHook.result.current.isAuthenticated).toBe(false);

      const loginHook = renderHook(() => useLogin(), { wrapper });
      await act(async () => {
        await expect(
          loginHook.result.current.mutate({ identifier: 'a@b.com', password: 'Password123!' }),
        ).rejects.toThrow('Bad credentials');
      });
      expect(loginHook.result.current.error?.message).toBe('Bad credentials');
      act(() => {
        loginHook.result.current.reset();
      });
      expect(loginHook.result.current.error).toBeNull();

      const registerHook = renderHook(() => useRegister(), { wrapper });
      await act(async () => {
        await expect(
          registerHook.result.current.mutate({
            email: 'a@b.com',
            username: 'alice',
            firstName: 'A',
            lastName: 'B',
            password: 'Password123!',
            tosAccepted: true,
            eligibilityAttested: true,
          }),
        ).rejects.toThrow('Email taken');
      });
      expect(registerHook.result.current.error?.message).toBe('Email taken');

      const verifyHook = renderHook(() => useVerifyEmail(), { wrapper });
      await act(async () => {
        await expect(verifyHook.result.current.mutate({ token: 'bad' })).rejects.toThrow(
          'Expired token',
        );
      });
      expect(verifyHook.result.current.error?.message).toBe('Expired token');

      const passkeyLoginHook = renderHook(() => useLoginWithPasskey(), { wrapper });
      await act(async () => {
        await passkeyLoginHook.result.current.login('a@b.com');
      });
      await waitFor(() => {
        expect(passkeyLoginHook.result.current.error).toBe('Passkeys disabled');
      });

      auth.destroy();
    });

    it('exposes getBaseUrl and useOptionalAuthService safely inside and outside provider', () => {
      const outside = renderHook(() => useOptionalAuthService());
      expect(outside.result.current).toBeUndefined();

      const auth = createAuthService({
        config: { apiUrl: 'https://api.example.test', tokenRefreshInterval: 60_000 },
        transport: { request: vi.fn() as Transport['request'] },
      });
      expect(auth.getBaseUrl()).toBe('https://api.example.test');

      const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(IdentityAuthProvider, { auth }, children);
      const inside = renderHook(() => useOptionalAuthService(), { wrapper });
      expect(inside.result.current).toBe(auth);
      auth.destroy();
    });
  });
});
