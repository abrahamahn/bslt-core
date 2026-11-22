// main/apps/web/src/__tests__/useWebauthn.test.tsx
/**
 * The passkey hooks against a stubbed `navigator.credentials` and `TransportProvider`:
 * what they post to the API and what they show when the browser fails.
 */
import {
  IdentityAuthProvider,
  useLoginWithPasskey,
  useRegisterPasskey,
  type AuthService,
} from '@bslt/identity/web';
import { TransportProvider } from '@bslt/react';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transport } from '@bslt/client-engine';

import {
  AUTHENTICATION_OPTIONS,
  E2E_AUTHENTICATION_CREDENTIAL,
  E2E_AUTHENTICATION_JSON,
  FULL_REGISTRATION_CREDENTIAL,
  FULL_REGISTRATION_JSON,
  REGISTRATION_OPTIONS,
} from '#app/__tests__/webauthn-fixtures';

const { completePasskeyLogin } = vi.hoisted(() => ({
  completePasskeyLogin: vi.fn(),
}));

const AUTH_RESPONSE = { token: 'access-token', user: { id: 'user-1' } };

let create = vi.fn();
let get = vi.fn();
let requestFn = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  const transport: Transport = { request: requestFn as Transport['request'] };
  const fakeAuth = { completePasskeyLogin } as unknown as AuthService;
  return createElement(
    TransportProvider,
    { transport },
    createElement(IdentityAuthProvider, { auth: fakeAuth }, children),
  );
}

beforeEach(() => {
  create = vi.fn();
  get = vi.fn();
  completePasskeyLogin.mockReset();
  vi.stubGlobal('PublicKeyCredential', vi.fn());
  Object.defineProperty(navigator, 'credentials', {
    value: { create, get },
    configurable: true,
  });
  requestFn = vi.fn((path: string) => {
    switch (path) {
      case '/api/auth/webauthn/register/options':
        return Promise.resolve({ options: REGISTRATION_OPTIONS });
      case '/api/auth/webauthn/register/verify':
        return Promise.resolve({ credentialId: 'cred-id', message: 'registered' });
      case '/api/auth/webauthn/login/options':
        return Promise.resolve({ options: AUTHENTICATION_OPTIONS });
      case '/api/auth/webauthn/login/verify':
        return Promise.resolve(AUTH_RESPONSE);
      default:
        return Promise.reject(new Error(`Unexpected path: ${path}`));
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function findRequestCalls(path: string): Array<[string, { method?: string; body?: string }]> {
  return (requestFn.mock.calls as Array<[string, { method?: string; body?: string }]>).filter(
    ([calledPath]) => calledPath === path,
  );
}

describe('useRegisterPasskey', () => {
  it('posts the encoded credential with the name and reports success', async () => {
    create.mockResolvedValueOnce(FULL_REGISTRATION_CREDENTIAL);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useRegisterPasskey(onSuccess), { wrapper });

    await act(() => result.current.register('Laptop'));

    const verifyCalls = findRequestCalls('/api/auth/webauthn/register/verify');
    expect(verifyCalls[0]?.[1].body).toBe(
      JSON.stringify({ credential: FULL_REGISTRATION_JSON, name: 'Laptop' }),
    );
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it('posts no name key when none is given', async () => {
    create.mockResolvedValueOnce(FULL_REGISTRATION_CREDENTIAL);
    const { result } = renderHook(() => useRegisterPasskey(), { wrapper });

    await act(() => result.current.register());

    const verifyCalls = findRequestCalls('/api/auth/webauthn/register/verify');
    expect(JSON.parse(verifyCalls[0]?.[1].body ?? '{}')).not.toHaveProperty('name');
  });

  it('shows a previously registered authenticator and rethrows without verifying', async () => {
    create.mockRejectedValueOnce(new DOMException('native', 'InvalidStateError'));
    const { result } = renderHook(() => useRegisterPasskey(), { wrapper });

    await act(async () => {
      await expect(result.current.register('Laptop')).rejects.toThrow(
        'The authenticator was previously registered',
      );
    });

    expect(result.current.error).toBe('The authenticator was previously registered');
    expect(result.current.isLoading).toBe(false);
    expect(findRequestCalls('/api/auth/webauthn/register/verify')).toHaveLength(0);
  });

  it('shows an unfinished ceremony and rethrows without verifying', async () => {
    create.mockResolvedValueOnce(null);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useRegisterPasskey(onSuccess), { wrapper });

    await act(async () => {
      await expect(result.current.register()).rejects.toThrow('Registration was not completed');
    });

    expect(result.current.error).toBe('Registration was not completed');
    expect(findRequestCalls('/api/auth/webauthn/register/verify')).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows the server refusing the credential and rethrows without reporting success', async () => {
    create.mockResolvedValueOnce(FULL_REGISTRATION_CREDENTIAL);
    const refused = new Error('Registration verification failed');
    requestFn.mockImplementation((path: string) =>
      path === '/api/auth/webauthn/register/verify'
        ? Promise.reject(refused)
        : Promise.resolve({ options: REGISTRATION_OPTIONS }),
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useRegisterPasskey(onSuccess), { wrapper });

    await act(async () => {
      await expect(result.current.register('Laptop')).rejects.toBe(refused);
    });

    expect(result.current.error).toBe('Registration verification failed');
    expect(result.current.isLoading).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows the generic message when the options request rejects with a non-Error', async () => {
    requestFn.mockRejectedValueOnce('offline');
    const { result } = renderHook(() => useRegisterPasskey(), { wrapper });

    await act(async () => {
      await expect(result.current.register()).rejects.toBe('offline');
    });

    expect(result.current.error).toBe('Registration failed');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('useLoginWithPasskey', () => {
  it('posts the encoded assertion with the session key and completes the login', async () => {
    get.mockResolvedValueOnce(E2E_AUTHENTICATION_CREDENTIAL);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginWithPasskey(onSuccess), { wrapper });

    await act(() => result.current.login('ada@example.com'));

    const optCalls = findRequestCalls('/api/auth/webauthn/login/options');
    expect(optCalls[0]?.[1].body).toBe(JSON.stringify({ email: 'ada@example.com' }));
    expect(get.mock.calls[0]?.[0]).toHaveProperty('publicKey.sessionKey', 'auth:k');
    const verifyCalls = findRequestCalls('/api/auth/webauthn/login/verify');
    expect(verifyCalls[0]?.[1].body).toBe(
      JSON.stringify({ credential: E2E_AUTHENTICATION_JSON, sessionKey: 'auth:k' }),
    );
    expect(completePasskeyLogin).toHaveBeenCalledWith(AUTH_RESPONSE);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('shows the browser message when the user cancels, without throwing or verifying', async () => {
    const message = 'The operation either timed out or was not allowed.';
    get.mockRejectedValueOnce(new DOMException(message, 'NotAllowedError'));
    const { result } = renderHook(() => useLoginWithPasskey(), { wrapper });

    await act(() => result.current.login());

    expect(result.current.error).toBe(message);
    expect(result.current.isLoading).toBe(false);
    expect(findRequestCalls('/api/auth/webauthn/login/verify')).toHaveLength(0);
    expect(completePasskeyLogin).not.toHaveBeenCalled();
  });

  it('asks the server first, then reports a browser without WebAuthn', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    const { result } = renderHook(() => useLoginWithPasskey(), { wrapper });

    await act(() => result.current.login());

    expect(result.current.error).toBe('WebAuthn is not supported in this browser');
    expect(findRequestCalls('/api/auth/webauthn/login/options')).toHaveLength(1);
    expect(get).not.toHaveBeenCalled();
    expect(findRequestCalls('/api/auth/webauthn/login/verify')).toHaveLength(0);
  });

  it('shows why the browser refused the RP ID for this host', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' });
    get.mockRejectedValueOnce(new DOMException('native', 'SecurityError'));
    const { result } = renderHook(() => useLoginWithPasskey(), { wrapper });

    await act(() => result.current.login());

    expect(result.current.error).toBe('The RP ID "127.0.0.1" is invalid for this domain');
    expect(findRequestCalls('/api/auth/webauthn/login/verify')).toHaveLength(0);
  });

  it('shows the server refusing the assertion without completing the login', async () => {
    get.mockResolvedValueOnce(E2E_AUTHENTICATION_CREDENTIAL);
    requestFn.mockImplementation((path: string) =>
      path === '/api/auth/webauthn/login/verify'
        ? Promise.reject(new Error('Authentication verification failed'))
        : Promise.resolve({ options: AUTHENTICATION_OPTIONS }),
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginWithPasskey(onSuccess), { wrapper });

    await act(() => result.current.login());

    expect(result.current.error).toBe('Authentication verification failed');
    expect(result.current.isLoading).toBe(false);
    expect(completePasskeyLogin).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows the generic message when the browser rejects with a non-Error', async () => {
    get.mockRejectedValueOnce(null);
    const { result } = renderHook(() => useLoginWithPasskey(), { wrapper });

    await act(() => result.current.login());

    expect(result.current.error).toBe('Authentication failed');
    expect(findRequestCalls('/api/auth/webauthn/login/verify')).toHaveLength(0);
    expect(completePasskeyLogin).not.toHaveBeenCalled();
  });
});
