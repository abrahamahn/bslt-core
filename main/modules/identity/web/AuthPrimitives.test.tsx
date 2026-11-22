// main/modules/identity/web/AuthPrimitives.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter, toastStore } from '@bslt/react';

import {
  AccountLockedMessage,
  AppleIcon,
  GitHubIcon,
  GoogleIcon,
  KakaoIcon,
  NewDeviceBanner,
  OAuthButtons,
  PasskeyLoginButton,
  SmsChallenge,
  TurnstileWidget,
} from './AuthPrimitives';

const mocks = vi.hoisted(() => ({
  useEnabledOAuthProviders: vi.fn(),
  getOAuthLoginUrl: vi.fn(
    (baseUrl: string, provider: string, attested = false) =>
      `${baseUrl}/api/auth/oauth/${provider}${attested ? '?attested=true' : ''}`,
  ),
  useEnabledAuthStrategies: vi.fn(),
  useLoginWithPasskey: vi.fn(),
  useOptionalAuthService: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useEnabledOAuthProviders: mocks.useEnabledOAuthProviders,
    getOAuthLoginUrl: mocks.getOAuthLoginUrl,
    useEnabledAuthStrategies: mocks.useEnabledAuthStrategies,
  };
});

vi.mock('./authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authService')>();
  return {
    ...actual,
    useLoginWithPasskey: mocks.useLoginWithPasskey,
    useOptionalAuthService: mocks.useOptionalAuthService,
    useAuth: mocks.useAuth,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OAuthProviderIcons & OAuthButtons', () => {
  beforeEach(() => {
    mocks.useOptionalAuthService.mockReturnValue({
      getBaseUrl: () => 'http://localhost:3000',
    });
  });

  it('renders provider icons aria-hidden', () => {
    const { container } = render(
      <div>
        <GoogleIcon className="g" />
        <GitHubIcon className="gh" />
        <KakaoIcon className="k" />
        <AppleIcon className="a" />
      </div>,
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  });

  it('suppresses OAuthButtons when provider list is empty or errored', () => {
    mocks.useEnabledOAuthProviders.mockReturnValue({
      providers: ['google'],
      isLoading: false,
      error: new Error('Unavailable'),
    });
    const { container: errContainer } = render(<OAuthButtons mode="login" />);
    expect(errContainer).toBeEmptyDOMElement();

    mocks.useEnabledOAuthProviders.mockReturnValue({
      providers: [],
      isLoading: false,
      error: null,
    });
    const { container: emptyContainer } = render(<OAuthButtons mode="register" />);
    expect(emptyContainer).toBeEmptyDOMElement();
  });

  it('renders enabled OAuth buttons and forwards eligibilityAttested when clicked', () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });
    mocks.useEnabledOAuthProviders.mockReturnValue({
      providers: ['google', 'github'],
      isLoading: false,
      error: null,
    });

    render(<OAuthButtons mode="register" eligibilityAttested />);
    fireEvent.click(screen.getByRole('button', { name: /Sign up with Google/i }));
    expect(mocks.getOAuthLoginUrl).toHaveBeenCalledWith('http://localhost:3000', 'google', true);
    expect(assignSpy).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/oauth/google?attested=true',
    );
  });
});

describe('PasskeyLoginButton', () => {
  it('returns null when WebAuthn is unsupported, strategy errored, or webauthn disabled', () => {
    const originalCred = window.PublicKeyCredential;
    Reflect.deleteProperty(window, 'PublicKeyCredential');
    mocks.useEnabledAuthStrategies.mockReturnValue({
      enabled: ['webauthn'],
      disabled: [],
      isLoading: false,
      error: null,
    });
    mocks.useLoginWithPasskey.mockReturnValue({ login: vi.fn(), isLoading: false, error: null });

    const { container: noCred } = render(<PasskeyLoginButton />);
    expect(noCred).toBeEmptyDOMElement();

    Object.defineProperty(window, 'PublicKeyCredential', {
      value: originalCred ?? function PublicKeyCredentialStub() {},
      configurable: true,
    });

    mocks.useEnabledAuthStrategies.mockReturnValue({
      enabled: ['local'],
      disabled: ['webauthn'],
      isLoading: false,
      error: null,
    });
    const { container: disabled } = render(<PasskeyLoginButton />);
    expect(disabled).toBeEmptyDOMElement();
  });

  it('displays passkey authentication failure message and disables while loading', () => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: function PublicKeyCredentialStub() {},
      configurable: true,
    });
    mocks.useEnabledAuthStrategies.mockReturnValue({
      enabled: ['webauthn'],
      disabled: [],
      isLoading: false,
      error: null,
    });
    mocks.useLoginWithPasskey.mockReturnValue({
      login: vi.fn(),
      isLoading: true,
      error: 'Passkey cancelled by user',
    });

    render(<PasskeyLoginButton />);
    expect(screen.getByRole('button', { name: /Verifying/i })).toBeDisabled();
    expect(screen.getByText('Passkey cancelled by user')).toBeInTheDocument();
  });
});

describe('AccountLockedMessage & SmsChallenge & NewDeviceBanner & TurnstileWidget', () => {
  it('renders permanent, expired, and relative lock durations in AccountLockedMessage', () => {
    render(
      <MemoryRouter>
        <AccountLockedMessage lockReason="Abuse" lockedUntil="2099-01-01T00:00:00.000Z" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Account Suspended')).toBeInTheDocument();
    expect(screen.getByText(/Abuse/)).toBeInTheDocument();
    expect(screen.getByText('This suspension is permanent.')).toBeInTheDocument();
    cleanup();

    render(
      <MemoryRouter>
        <AccountLockedMessage lockedUntil="2020-01-01T00:00:00.000Z" />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('This lock has expired. Please try logging in again.'),
    ).toBeInTheDocument();
  });

  it('surfaces SMS send and verification failures in SmsChallenge', async () => {
    const onSendCode = vi
      .fn()
      .mockRejectedValueOnce(new Error('SMS gateway down'))
      .mockResolvedValueOnce(undefined);
    const onVerify = vi.fn().mockRejectedValueOnce(new Error('Wrong SMS code'));
    const onCancel = vi.fn();

    const { unmount } = render(
      <SmsChallenge
        challengeToken="tok-1"
        onSendCode={onSendCode}
        onVerify={onVerify}
        onCancel={onCancel}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('SMS gateway down')).toBeInTheDocument();
    });
    unmount();

    render(
      <SmsChallenge
        challengeToken="tok-2"
        onSendCode={onSendCode}
        onVerify={onVerify}
        onCancel={onCancel}
      />,
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('000000')).not.toBeDisabled();
    });
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Wrong SMS code')).toBeInTheDocument();
    });
  });

  it('does not raise toast when isNewDevice is false, and raises once when true', () => {
    const showSpy = vi.spyOn(toastStore.getState(), 'show');
    const dismiss = vi.fn();

    mocks.useAuth.mockReturnValue({ isNewDevice: false, dismissNewDeviceBanner: dismiss });
    const { rerender } = render(<NewDeviceBanner />);
    expect(showSpy).not.toHaveBeenCalled();

    mocks.useAuth.mockReturnValue({ isNewDevice: true, dismissNewDeviceBanner: dismiss });
    rerender(<NewDeviceBanner />);
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    showSpy.mockRestore();
  });

  it('returns null when TurnstileWidget is disabled and invokes onToken / onError when enabled', async () => {
    const onToken = vi.fn();
    const onError = vi.fn();
    const { container: disabled } = render(
      <TurnstileWidget enabled={false} siteKey="" onToken={onToken} />,
    );
    expect(disabled).toBeEmptyDOMElement();

    const removeSpy = vi.fn();
    window.turnstile = {
      render: (_el, opts) => {
        opts.callback('tok-captcha');
        return 'wid-1';
      },
      reset: vi.fn(),
      remove: removeSpy,
    };

    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as HTMLScriptElement;
      queueMicrotask(() => {
        script.onload?.(new Event('load'));
      });
      return node;
    });

    const { unmount } = render(
      <TurnstileWidget enabled siteKey="site-key-1" onToken={onToken} onError={onError} />,
    );
    await waitFor(() => {
      expect(onToken).toHaveBeenCalledWith('tok-captcha');
    });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('wid-1');
    appendSpy.mockRestore();
    delete window.turnstile;
  });
});
