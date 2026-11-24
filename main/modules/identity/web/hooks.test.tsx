// main/modules/identity/web/hooks.test.tsx
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryCache } from '@bslt/client-engine';
import { QueryCacheProvider, TransportProvider } from '@bslt/react';

import {
  getOAuthLoginUrl,
  useAdminUser,
  useAdminUsers,
  useApiKeys,
  useBackupCodes,
  useChangeEmail,
  useConfirmEmailChange,
  useCreateApiKey,
  useDeactivateAccount,
  useDeleteAccount,
  useDeleteApiKey,
  useDevices,
  useEnabledAuthStrategies,
  useEnabledOAuthProviders,
  useForgotPassword,
  useLogoutAll,
  useOAuthConnections,
  usePasskeys,
  usePasswordChange,
  usePhone,
  useProfileCompleteness,
  useProfileUpdate,
  useReactivateAccount,
  useRegisterPasskey,
  useRevertEmailChange,
  useRevokeAllSessions,
  useRevokeSession,
  useSessions,
  useSetPassword,
  useSudo,
  useTotpManagement,
  useUserActions,
  useUsernameUpdate,
} from './hooks';

import type { ApiKey, ApiKeysListResponse, CreatedApiKey } from '../contract';
import type { Transport } from '@bslt/client-engine';

const LIST_KEY = ['identity', 'listApiKeys'] as const;

const KEY_1: ApiKey = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'CI deploy bot',
  keyPrefix: 'bslt_abcdef',
  last4: 'wxyz',
  lastUsedAt: null,
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const CREATED_1: CreatedApiKey = {
  ...KEY_1,
  token: 'bslt_abcdef_secret_wxyz',
};

afterEach(() => {
  cleanup();
});

function makeHttpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function makeWrapper(requestFn: ReturnType<typeof vi.fn>, cache = new QueryCache()) {
  const transport: Transport = {
    request: requestFn as Transport['request'],
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryCacheProvider,
      { cache },
      createElement(TransportProvider, { transport }, children),
    );
  return { cache, wrapper };
}

describe('identity API key hooks', () => {
  it('fetches keys via TransportProvider and invalidates listApiKeys on create', async () => {
    const requestFn = vi
      .fn()
      .mockResolvedValueOnce({ keys: [] })
      .mockResolvedValueOnce({ key: CREATED_1 })
      .mockResolvedValueOnce({ keys: [KEY_1] });
    const { wrapper } = makeWrapper(requestFn);

    let createdCallbackResult: CreatedApiKey | null = null;
    const { result } = renderHook(
      () => ({
        list: useApiKeys(),
        create: useCreateApiKey({
          onSuccess: (res) => {
            createdCallbackResult = res.key;
          },
        }),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.list.isLoading).toBe(false);
    });
    expect(result.current.list.data).toEqual([]);

    act(() => {
      result.current.create.create({ name: 'CI deploy bot', expiresInDays: 30 });
    });

    await waitFor(() => {
      expect(createdCallbackResult).toEqual(CREATED_1);
      expect(result.current.list.data).toEqual([KEY_1]);
    });
  });

  it('optimistically removes a key while delete is in flight', async () => {
    let resolveDelete!: (value: unknown) => void;
    const deletePromise = new Promise((resolve) => {
      resolveDelete = resolve;
    });
    const cache = new QueryCache();
    cache.setQueryData(LIST_KEY, { keys: [KEY_1] } satisfies ApiKeysListResponse);

    const requestFn = vi
      .fn()
      .mockImplementation((_path: string, opts?: { method?: string }) =>
        opts?.method === 'POST' ? deletePromise : Promise.resolve({ keys: [] }),
      );
    const { wrapper } = makeWrapper(requestFn, cache);
    const { result } = renderHook(() => useDeleteApiKey(), { wrapper });

    act(() => {
      result.current.revoke(KEY_1.id);
    });

    const optimistic = cache.getQueryData(LIST_KEY) as ApiKeysListResponse | undefined;
    expect(optimistic?.keys).toEqual([]);

    await act(async () => {
      resolveDelete({ id: KEY_1.id });
      await deletePromise;
    });
  });

  it('restores the optimistic cache snapshot when revoking an API key fails', async () => {
    const cache = new QueryCache();
    cache.setQueryData(LIST_KEY, { keys: [KEY_1] } satisfies ApiKeysListResponse);

    const requestFn = vi.fn().mockImplementation((_path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') {
        return Promise.reject(makeHttpError(500, 'Database offline'));
      }
      return Promise.resolve({ keys: [KEY_1] });
    });
    const { wrapper } = makeWrapper(requestFn, cache);
    const { result } = renderHook(() => useDeleteApiKey(), { wrapper });

    await act(async () => {
      await expect(result.current.revokeAsync(KEY_1.id)).rejects.toThrow('Database offline');
    });

    const restored = cache.getQueryData(LIST_KEY) as ApiKeysListResponse | undefined;
    expect(restored?.keys).toEqual([KEY_1]);
    expect(result.current.error?.message).toBe('Database offline');
  });

  it('surfaces list error state and empty fallback when GET /api/api-keys fails', async () => {
    const requestFn = vi.fn().mockRejectedValue(makeHttpError(401, 'Unauthorized'));
    const { wrapper } = makeWrapper(requestFn);

    const { result } = renderHook(() => useApiKeys(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe('Unauthorized');
    expect(result.current.data).toEqual([]);
  });

  it('surfaces create error state when POST /api/api-keys/create fails', async () => {
    const requestFn = vi.fn().mockRejectedValue(makeHttpError(400, 'name is required'));
    const { wrapper } = makeWrapper(requestFn);

    const { result } = renderHook(() => useCreateApiKey(), { wrapper });

    act(() => {
      result.current.create({ name: '' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe('name is required');
  });

  it('drives profile, username, password, sessions, lifecycle (with x-sudo-token), and admin user hooks including error states', async () => {
    const requestFn = vi
      .fn()
      // useProfileCompleteness initial GET
      .mockResolvedValueOnce({ percentage: 60, missingFields: ['bio'] })
      // useProfileUpdate PATCH
      .mockRejectedValueOnce(makeHttpError(400, 'Invalid website'))
      // useUsernameUpdate PATCH
      .mockRejectedValueOnce(makeHttpError(409, 'Username taken'))
      // usePasswordChange POST
      .mockRejectedValueOnce(makeHttpError(400, 'Wrong current password'))
      // useSessions GET
      .mockResolvedValueOnce({ sessions: [] })
      // useRevokeSession DELETE
      .mockRejectedValueOnce(makeHttpError(404, 'Session not found'))
      // useRevokeAllSessions POST
      .mockResolvedValueOnce({ success: true, revokedCount: 3 })
      // useDeactivateAccount POST (verifies x-sudo-token header!)
      .mockResolvedValueOnce({ message: 'Deactivated', status: 'deactivated' })
      // useDeleteAccount POST (error)
      .mockRejectedValueOnce(makeHttpError(403, 'Sudo expired'))
      // useReactivateAccount POST
      .mockResolvedValueOnce({ message: 'Active', status: 'active' })
      // useAdminUsers GET
      .mockRejectedValueOnce(makeHttpError(403, 'Admin required'))
      // useAdminUser GET
      .mockRejectedValueOnce(makeHttpError(404, 'User missing'))
      // useUserActions hardBanUserAction POST (verifies x-sudo-token header!)
      .mockResolvedValueOnce({
        message: 'Banned',
        gracePeriodEnds: '2026-02-01T00:00:00.000Z',
        subscriptionsCancelled: true,
      });

    const { wrapper } = makeWrapper(requestFn);

    const completenessHook = renderHook(() => useProfileCompleteness(), { wrapper });
    await waitFor(() => {
      expect(completenessHook.result.current.isLoading).toBe(false);
    });
    expect(completenessHook.result.current.data?.percentage).toBe(60);
    completenessHook.unmount();

    const profileHook = renderHook(() => useProfileUpdate(), { wrapper });
    act(() => {
      profileHook.result.current.updateProfile({ website: 'bad' });
    });
    await waitFor(() => {
      expect(profileHook.result.current.isError).toBe(true);
    });

    const usernameHook = renderHook(() => useUsernameUpdate(), { wrapper });
    act(() => {
      usernameHook.result.current.updateUsername({ username: 'alice_1' });
    });
    await waitFor(() => {
      expect(usernameHook.result.current.isError).toBe(true);
    });

    const pwdHook = renderHook(() => usePasswordChange(), { wrapper });
    act(() => {
      pwdHook.result.current.changePassword({
        currentPassword: 'old',
        newPassword: 'NewPassword123!',
      });
    });
    await waitFor(() => {
      expect(pwdHook.result.current.isError).toBe(true);
    });

    const sessionsHook = renderHook(() => useSessions(), { wrapper });
    await waitFor(() => {
      expect(sessionsHook.result.current.isLoading).toBe(false);
    });
    expect(sessionsHook.result.current.sessions).toEqual([]);
    sessionsHook.unmount();

    const revokeHook = renderHook(() => useRevokeSession(), { wrapper });
    act(() => {
      revokeHook.result.current.revokeSession(KEY_1.id);
    });
    await waitFor(() => {
      expect(revokeHook.result.current.isError).toBe(true);
    });

    const revokeAllHook = renderHook(() => useRevokeAllSessions(), { wrapper });
    act(() => {
      revokeAllHook.result.current.revokeAllSessions();
    });
    await waitFor(() => {
      expect(revokeAllHook.result.current.revokedCount).toBe(3);
    });

    const deactivateHook = renderHook(() => useDeactivateAccount(), { wrapper });
    act(() => {
      deactivateHook.result.current.deactivate({ reason: 'break' }, 'sudo-jwt-1');
    });
    await waitFor(() => {
      expect(deactivateHook.result.current.isLoading).toBe(false);
    });
    expect(requestFn).toHaveBeenCalledWith(
      '/api/users/me/deactivate',
      expect.objectContaining({
        headers: { 'x-sudo-token': 'sudo-jwt-1' },
      }),
    );

    const deleteAccHook = renderHook(() => useDeleteAccount(), { wrapper });
    act(() => {
      deleteAccHook.result.current.requestDeletion({}, 'expired-sudo');
    });
    await waitFor(() => {
      expect(deleteAccHook.result.current.error?.message).toBe('Sudo expired');
    });

    const reactivateHook = renderHook(() => useReactivateAccount(), { wrapper });
    act(() => {
      reactivateHook.result.current.reactivate();
    });
    await waitFor(() => {
      expect(reactivateHook.result.current.isLoading).toBe(false);
    });

    const adminUsersHook = renderHook(() => useAdminUsers(), { wrapper });
    await waitFor(() => {
      expect(adminUsersHook.result.current.error).toBe('Admin required');
    });

    const adminUserHook = renderHook(() => useAdminUser(KEY_1.id), { wrapper });
    await waitFor(() => {
      expect(adminUserHook.result.current.error).toBe('User missing');
    });

    const actionsHook = renderHook(() => useUserActions(), { wrapper });
    let banRes: Awaited<ReturnType<typeof actionsHook.result.current.hardBanUserAction>> = null;
    await act(async () => {
      banRes = await actionsHook.result.current.hardBanUserAction(
        KEY_1.id,
        { reason: 'fraud' },
        'admin-sudo-jwt',
      );
    });
    expect(banRes).toMatchObject({ subscriptionsCancelled: true });
    expect(requestFn).toHaveBeenCalledWith(
      `/api/admin/users/${KEY_1.id}/hard-ban`,
      expect.objectContaining({
        headers: { 'x-sudo-token': 'admin-sudo-jwt' },
      }),
    );
  });

  it('drives sudo, devices, phone, TOTP, backup codes, and passkey hooks with >=60% failure assertions', async () => {
    const requestFn = vi
      .fn()
      // 1. useSudo: failure then success
      .mockRejectedValueOnce(makeHttpError(401, 'Invalid credentials'))
      .mockResolvedValueOnce({
        sudoToken: 'sudo-jwt',
        expiresAt: '2026-01-01T00:05:00.000Z',
      })
      // 2. useDevices: list -> trust failure -> invalidate failure
      .mockResolvedValueOnce({ devices: [] })
      .mockRejectedValueOnce(makeHttpError(404, 'Device not found'))
      .mockRejectedValueOnce(makeHttpError(500, 'Session invalidation failed'))
      // 3. usePhone: setPhone failure -> verifyPhone failure
      .mockRejectedValueOnce(makeHttpError(400, 'Invalid phone format'))
      .mockRejectedValueOnce(makeHttpError(400, 'Invalid verification code'))
      // 4. useTotpManagement: totpStatus failure -> beginSetup failure -> enable success
      .mockRejectedValueOnce(makeHttpError(500, 'Status unavailable'))
      .mockRejectedValueOnce(makeHttpError(409, '2FA already enabled'))
      .mockResolvedValueOnce({ message: '2FA enabled successfully' })
      // 5. useBackupCodes: status failure -> regenerate failure
      .mockRejectedValueOnce(makeHttpError(500, 'Backup status unavailable'))
      .mockRejectedValueOnce(makeHttpError(401, 'Invalid 2FA code'))
      // 6. usePasskeys: list failure
      .mockRejectedValueOnce(makeHttpError(403, 'Passkeys disabled'))
      // 7. useRegisterPasskey: registerOptions failure
      .mockRejectedValueOnce(makeHttpError(503, 'WebAuthn unavailable'));

    const { wrapper } = makeWrapper(requestFn);

    // 1. useSudo
    const sudoHook = renderHook(() => useSudo(), { wrapper });
    act(() => {
      sudoHook.result.current.sudo({ password: 'wrong' });
    });
    await waitFor(() => {
      expect(sudoHook.result.current.isError).toBe(true);
    });
    expect(sudoHook.result.current.error?.message).toBe('Invalid credentials');

    act(() => {
      sudoHook.result.current.sudo({ password: 'correct' });
    });
    await waitFor(() => {
      expect(sudoHook.result.current.isSuccess).toBe(true);
    });
    expect(sudoHook.result.current.data?.sudoToken).toBe('sudo-jwt');

    // 2. useDevices
    const devicesHook = renderHook(() => useDevices(), { wrapper });
    await waitFor(() => {
      expect(devicesHook.result.current.isLoading).toBe(false);
    });
    await act(async () => {
      await expect(devicesHook.result.current.trustDevice(KEY_1.id)).rejects.toThrow(
        'Device not found',
      );
      await expect(devicesHook.result.current.invalidateSessions()).rejects.toThrow(
        'Session invalidation failed',
      );
    });
    expect(devicesHook.result.current.error?.message).toBe('Device not found');
    devicesHook.unmount();

    // 3. usePhone
    const phoneHook = renderHook(() => usePhone(), { wrapper });
    await act(async () => {
      await expect(phoneHook.result.current.setPhone('bad')).rejects.toThrow(
        'Invalid phone format',
      );
      await expect(phoneHook.result.current.verifyPhone('000000')).rejects.toThrow(
        'Invalid verification code',
      );
    });
    expect(phoneHook.result.current.error?.message).toBe('Invalid phone format');

    // 4. useTotpManagement
    const totpHook = renderHook(() => useTotpManagement(), { wrapper });
    await waitFor(() => {
      expect(totpHook.result.current.error).toBe('Status unavailable');
    });
    expect(totpHook.result.current.state).toBe('disabled');
    await act(async () => {
      await totpHook.result.current.beginSetup();
    });
    expect(totpHook.result.current.error).toBe('2FA already enabled');
    await act(async () => {
      await totpHook.result.current.enable('123456');
    });
    expect(totpHook.result.current.state).toBe('enabled');

    // 5. useBackupCodes
    const backupHook = renderHook(() => useBackupCodes(), { wrapper });
    await waitFor(() => {
      expect(backupHook.result.current.isLoading).toBe(false);
    });
    expect(backupHook.result.current.error).toBe('Backup status unavailable');
    await act(async () => {
      await backupHook.result.current.regenerate('000000');
    });
    expect(backupHook.result.current.error).toBe('Invalid 2FA code');

    // 6. usePasskeys
    const passkeysHook = renderHook(() => usePasskeys(), { wrapper });
    await waitFor(() => {
      expect(passkeysHook.result.current.isLoading).toBe(false);
    });
    expect(passkeysHook.result.current.error).toBe('Passkeys disabled');

    // 7. useRegisterPasskey
    const regPasskeyHook = renderHook(() => useRegisterPasskey(), { wrapper });
    await act(async () => {
      await expect(regPasskeyHook.result.current.register('Key')).rejects.toThrow(
        'WebAuthn unavailable',
      );
    });
    expect(regPasskeyHook.result.current.error).toBe('WebAuthn unavailable');
  });

  describe('OAuth & auth strategy hooks', () => {
    it('builds getOAuthLoginUrl cleanly and never claims attestation/consent unless true', () => {
      expect(getOAuthLoginUrl('https://api.example.com', 'google')).toBe(
        'https://api.example.com/api/auth/oauth/google',
      );
      expect(getOAuthLoginUrl('https://api.example.com///', 'github')).toBe(
        'https://api.example.com/api/auth/oauth/github',
      );
      expect(getOAuthLoginUrl('https://api.example.com', 'google')).not.toContain('attested');
      expect(getOAuthLoginUrl('https://api.example.com', 'google', false)).not.toContain(
        'consented',
      );
      expect(getOAuthLoginUrl('https://api.example.com', 'apple', true)).toBe(
        'https://api.example.com/api/auth/oauth/apple?attested=true&consented=true',
      );
    });

    it('surfaces failure states across useEnabledAuthStrategies, useEnabledOAuthProviders, and useOAuthConnections', async () => {
      const requestFn = vi.fn().mockImplementation(async (path: string, options?: RequestInit) => {
        const method = options?.method ?? 'GET';
        if (path === '/api/auth/strategies') {
          throw makeHttpError(500, 'Strategies unavailable');
        }
        if (path === '/api/auth/oauth/providers') {
          throw makeHttpError(503, 'Providers unavailable');
        }
        if (path === '/api/auth/oauth/connections') {
          throw makeHttpError(401, 'Session expired');
        }
        if (path === '/api/auth/oauth/google/link' && method === 'POST') {
          throw makeHttpError(409, 'Already linked');
        }
        if (path === '/api/auth/oauth/github/unlink' && method === 'DELETE') {
          throw makeHttpError(400, 'Cannot unlink last login method');
        }
        throw new Error(`Unexpected ${method} ${path}`);
      });

      const { wrapper } = makeWrapper(requestFn);

      const strategiesHook = renderHook(() => useEnabledAuthStrategies(), { wrapper });
      await waitFor(() => {
        expect(strategiesHook.result.current.isLoading).toBe(false);
      });
      expect(strategiesHook.result.current.error?.message).toBe('Strategies unavailable');
      expect(strategiesHook.result.current.enabled).toEqual([]);
      expect(strategiesHook.result.current.disabled).toEqual([]);

      const providersHook = renderHook(() => useEnabledOAuthProviders(), { wrapper });
      await waitFor(() => {
        expect(providersHook.result.current.isLoading).toBe(false);
      });
      expect(providersHook.result.current.error?.message).toBe('Providers unavailable');
      expect(providersHook.result.current.providers).toEqual([]);

      const connectionsHook = renderHook(() => useOAuthConnections(), { wrapper });
      await waitFor(() => {
        expect(connectionsHook.result.current.isLoading).toBe(false);
      });
      expect(connectionsHook.result.current.error?.message).toBe('Session expired');

      await act(async () => {
        await expect(connectionsHook.result.current.link('google')).rejects.toThrow(
          'Already linked',
        );
        await expect(connectionsHook.result.current.unlink('github')).rejects.toThrow(
          'Cannot unlink last login method',
        );
      });
    });

    it('fetches strategies, providers, and links/unlinks OAuth connections on success', async () => {
      const requestFn = vi.fn().mockImplementation(async (path: string, options?: RequestInit) => {
        const method = options?.method ?? 'GET';
        if (path === '/api/auth/strategies') {
          return { enabled: ['local', 'google', 'webauthn'], disabled: ['apple'] };
        }
        if (path === '/api/auth/oauth/providers') {
          return { providers: ['google', 'github'] };
        }
        if (path === '/api/auth/oauth/connections') {
          return {
            connections: [
              {
                id: KEY_1.id,
                provider: 'google',
                providerEmail: 'user@example.com',
                connectedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          };
        }
        if (path === '/api/auth/oauth/github/link' && method === 'POST') {
          return { url: 'https://github.com/login/oauth/authorize?state=abc' };
        }
        if (path === '/api/auth/oauth/google/unlink' && method === 'DELETE') {
          return { message: 'Unlinked' };
        }
        throw new Error(`Unexpected ${method} ${path}`);
      });

      const { wrapper } = makeWrapper(requestFn);

      const strategiesHook = renderHook(() => useEnabledAuthStrategies(), { wrapper });
      await waitFor(() => {
        expect(strategiesHook.result.current.enabled).toEqual(['local', 'google', 'webauthn']);
      });

      const providersHook = renderHook(() => useEnabledOAuthProviders(), { wrapper });
      await waitFor(() => {
        expect(providersHook.result.current.providers).toEqual(['google', 'github']);
      });

      const connectionsHook = renderHook(() => useOAuthConnections(), { wrapper });
      await waitFor(() => {
        expect(connectionsHook.result.current.connections).toHaveLength(1);
      });
      expect(connectionsHook.result.current.getLinkUrl('github')).toBe(
        '/api/auth/oauth/github/link',
      );

      let redirectUrl = '';
      await act(async () => {
        redirectUrl = await connectionsHook.result.current.link('github');
        await connectionsHook.result.current.unlink('google');
      });
      expect(redirectUrl).toBe('https://github.com/login/oauth/authorize?state=abc');
    });
  });

  describe('email change, password setup/forgot, and logoutAll hooks', () => {
    it('surfaces failure states across useLogoutAll, useChangeEmail, useConfirmEmailChange, useRevertEmailChange, useSetPassword, and useForgotPassword', async () => {
      const requestFn = vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/auth/logout-all') throw makeHttpError(401, 'Unauthorized logoutAll');
        if (path === '/api/auth/change-email') throw makeHttpError(400, 'Incorrect password');
        if (path === '/api/auth/change-email/confirm') throw makeHttpError(400, 'Invalid token');
        if (path === '/api/auth/change-email/revert') throw makeHttpError(410, 'Expired revert');
        if (path === '/api/auth/set-password') throw makeHttpError(409, 'Password already set');
        if (path === '/api/auth/forgot-password') throw makeHttpError(429, 'Rate limited');
        throw new Error(`Unexpected ${path}`);
      });

      const { wrapper } = makeWrapper(requestFn);

      const logoutAllHook = renderHook(() => useLogoutAll(), { wrapper });
      const changeEmailHook = renderHook(() => useChangeEmail(), { wrapper });
      const confirmHook = renderHook(() => useConfirmEmailChange(), { wrapper });
      const revertHook = renderHook(() => useRevertEmailChange(), { wrapper });
      const setPwdHook = renderHook(() => useSetPassword(), { wrapper });
      const forgotHook = renderHook(() => useForgotPassword(), { wrapper });

      await act(async () => {
        await expect(logoutAllHook.result.current()).rejects.toThrow('Unauthorized logoutAll');
        await expect(
          changeEmailHook.result.current({ newEmail: 'new@example.com', password: 'wrong' }),
        ).rejects.toThrow('Incorrect password');
        await expect(confirmHook.result.current({ token: 'bad' })).rejects.toThrow('Invalid token');
        await expect(revertHook.result.current({ token: 'bad' })).rejects.toThrow('Expired revert');
        await expect(setPwdHook.result.current({ password: 'Password123!' })).rejects.toThrow(
          'Password already set',
        );
        await expect(forgotHook.result.current({ email: 'u@example.com' })).rejects.toThrow(
          'Rate limited',
        );
      });
    });

    it('resolves email change, password setup/forgot, and logoutAll on success', async () => {
      const requestFn = vi.fn().mockImplementation(async (path: string) => {
        if (path === '/api/auth/logout-all') return { message: 'Logged out all' };
        if (path === '/api/auth/change-email') return { message: 'Check new email' };
        if (path === '/api/auth/change-email/confirm') {
          return { message: 'Confirmed', email: 'new@example.com' };
        }
        if (path === '/api/auth/change-email/revert') {
          return { message: 'Reverted', email: 'old@example.com' };
        }
        if (path === '/api/auth/set-password') return { message: 'Password set' };
        if (path === '/api/auth/forgot-password') return { message: 'Reset sent' };
        throw new Error(`Unexpected ${path}`);
      });

      const { wrapper } = makeWrapper(requestFn);

      const logoutAllHook = renderHook(() => useLogoutAll(), { wrapper });
      const changeEmailHook = renderHook(() => useChangeEmail(), { wrapper });
      const confirmHook = renderHook(() => useConfirmEmailChange(), { wrapper });
      const revertHook = renderHook(() => useRevertEmailChange(), { wrapper });
      const setPwdHook = renderHook(() => useSetPassword(), { wrapper });
      const forgotHook = renderHook(() => useForgotPassword(), { wrapper });

      await act(async () => {
        expect(await logoutAllHook.result.current()).toEqual({ message: 'Logged out all' });
        expect(
          await changeEmailHook.result.current({
            newEmail: 'new@example.com',
            password: 'Password123!',
          }),
        ).toEqual({ message: 'Check new email' });
        expect(await confirmHook.result.current({ token: 'tok' })).toEqual({
          message: 'Confirmed',
          email: 'new@example.com',
        });
        expect(await revertHook.result.current({ token: 'tok' })).toEqual({
          message: 'Reverted',
          email: 'old@example.com',
        });
        expect(await setPwdHook.result.current({ password: 'Password123!' })).toEqual({
          message: 'Password set',
        });
        expect(await forgotHook.result.current({ email: 'u@example.com' })).toEqual({
          message: 'Reset sent',
        });
      });
    });
  });
});
