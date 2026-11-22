// main/modules/identity/web/authService.ts
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  clearCsrfTokenCache,
  createEndpointClient,
  createTransport,
  setDefaultOnUnauthorized,
  type Transport,
} from '@bslt/client-engine';
import { useTransport } from '@bslt/react';

import { getAccountStatus } from '../contract';
import { identityModule } from '../module';

import { getPasskey, type PasskeyRequestOptionsJSON } from './webauthn';

import type {
  AuthResponse,
  CompleteOnboardingRequest,
  EmailOtpRequest,
  EmailOtpRequestResponse,
  EmailOtpVerifyRequest,
  EmailVerificationRequest,
  EmailVerificationResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LoginSuccessResponse,
  MagicLinkRequest,
  MagicLinkRequestResponse,
  MagicLinkVerifyRequest,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  SmsLoginChallengeResponse,
  TotpLoginChallengeResponse,
  User,
  WebauthnLoginVerifyRequest,
} from '../contract';
import type { AuthMode } from '@bslt/react/hooks';

const MS_PER_MINUTE = 60 * 1000;
const MAX_REFRESH_BACKOFF_MS = 5 * MS_PER_MINUTE;
const REQUEST_TIMEOUT_MS = 5000;
const INITIAL_SESSION_RESTORE_TIMEOUT_MS = 5000;
const INITIAL_USER_HYDRATION_TIMEOUT_MS = 5000;
const BROWSER_DEVICE_ID_STORAGE_KEY = 'bslt:browser-device-id';

// ============================================================================
// 1. Signup Attestation & Redirect Helpers
// ============================================================================

export const ELIGIBILITY_ATTESTATION_REQUIRED = 'ELIGIBILITY_ATTESTATION_REQUIRED';
export const SIGNUP_CONSENT_REQUIRED = 'SIGNUP_CONSENT_REQUIRED';

export function isEligibilityAttestationRequired(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    code === ELIGIBILITY_ATTESTATION_REQUIRED ||
    code === `identity.${ELIGIBILITY_ATTESTATION_REQUIRED}` ||
    code === SIGNUP_CONSENT_REQUIRED ||
    code === `identity.${SIGNUP_CONSENT_REQUIRED}`
  );
}

interface RedirectUserLocal {
  readonly role?: string;
  readonly deactivatedAt?: string | null | undefined;
  readonly deletedAt?: string | null | undefined;
  readonly deletionGracePeriodEnds?: string | null | undefined;
}

const toLifecycleDate = (value: string | null | undefined): Date | null =>
  value != null ? new Date(value) : null;

function isInactiveAccount(user: RedirectUserLocal | null | undefined): boolean {
  if (user == null) return false;
  return (
    getAccountStatus({
      deactivatedAt: toLifecycleDate(user.deactivatedAt),
      deletedAt: toLifecycleDate(user.deletedAt),
      deletionGracePeriodEnds: toLifecycleDate(user.deletionGracePeriodEnds),
    }) !== 'active'
  );
}

function isSafeRedirectPath(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }

  let cleaned = '';
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) {
      const char = decoded[i];
      if (char !== undefined) {
        cleaned += char;
      }
    }
  }

  if (!cleaned.startsWith('/')) return false;
  if (cleaned.startsWith('//')) return false;

  const lower = cleaned.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('data:') || lower.includes('vbscript:')) {
    return false;
  }

  return true;
}

export function getPostLoginRedirect(
  user: RedirectUserLocal | null | undefined,
  returnTo?: string | null,
): string {
  if (isInactiveAccount(user)) {
    return '/reactivate';
  }

  if (returnTo != null && returnTo !== '' && isSafeRedirectPath(returnTo)) {
    return returnTo;
  }

  if (user?.role === 'admin') {
    return '/admin';
  }

  return '/dashboard';
}

// ============================================================================
// 2. Auth Modal Store
// ============================================================================

export interface AuthModalState {
  readonly open: boolean;
  readonly mode: AuthMode;
}

let modalState: AuthModalState = { open: false, mode: 'login' };
const modalListeners = new Set<() => void>();

function setModalState(next: AuthModalState): void {
  modalState = next;
  modalListeners.forEach((listener) => {
    listener();
  });
}

export function openAuthModal(mode: AuthMode = 'login'): void {
  setModalState({ open: true, mode });
}

export function closeAuthModal(): void {
  if (modalState.open) setModalState({ ...modalState, open: false });
}

export function getAuthModalState(): AuthModalState {
  return modalState;
}

export function subscribeAuthModal(listener: () => void): () => void {
  modalListeners.add(listener);
  return () => modalListeners.delete(listener);
}

export function useAuthModal(): AuthModalState {
  return useSyncExternalStore(subscribeAuthModal, getAuthModalState, getAuthModalState);
}

// ============================================================================
// 3. Auth State, Errors & Browser Device Helpers
// ============================================================================

export interface TokenStore {
  get: () => string | null;
  set: (token: string) => void;
  clear: () => void;
}

function createInMemoryTokenStore(): TokenStore {
  let current: string | null = null;
  return {
    get: () => current,
    set: (token: string) => {
      current = token;
    },
    clear: () => {
      current = null;
    },
  };
}

const fallbackTokenStore = createInMemoryTokenStore();

export interface ImpersonationSession {
  targetUserId: string;
  targetEmail: string;
  expiresAt: string;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isNewDevice: boolean;
  impersonation: ImpersonationSession | null;
}

export class TotpChallengeError extends Error {
  readonly challengeToken: string;

  constructor(challengeToken: string) {
    super('Two-factor authentication required');
    this.name = 'TotpChallengeError';
    this.challengeToken = challengeToken;
  }
}

export class SmsChallengeError extends Error {
  readonly challengeToken: string;

  constructor(challengeToken: string) {
    super('SMS verification required');
    this.name = 'SmsChallengeError';
    this.challengeToken = challengeToken;
  }
}

type LoginResponse = LoginSuccessResponse | TotpLoginChallengeResponse | SmsLoginChallengeResponse;

function isTotpChallengeResponse(response: LoginResponse): response is TotpLoginChallengeResponse {
  return 'requiresTotp' in response && response.requiresTotp;
}

function isSmsChallengeResponse(response: LoginResponse): response is SmsLoginChallengeResponse {
  return 'requiresSms' in response && response.requiresSms;
}

type InitializeHydrationResult =
  { status: 'hydrated'; user: User } | { status: 'failed' | 'stale' | 'timed-out' };

const isUser = (value: unknown): value is User =>
  value !== null &&
  value !== undefined &&
  typeof value === 'object' &&
  'id' in value &&
  'email' in value &&
  'role' in value;

const withTimeout = async <T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('timed out');

const isNetworkFailure = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly name?: unknown };
  return candidate.code === 'NETWORK_ERROR' || candidate.name === 'NetworkError';
};

const normalizeUser = (user: User): User => ({
  ...user,
  firstName: typeof user.firstName === 'string' ? user.firstName : '',
  lastName: typeof user.lastName === 'string' ? user.lastName : '',
});

function createBrowserDeviceId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObject?.randomUUID !== undefined) {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 14);
  return `device-${Date.now().toString(36)}-${random}`;
}

function isValidBrowserDeviceId(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{16,128}$/.test(value);
}

export function getOrCreateBrowserDeviceId(): string | null {
  try {
    const storage = globalThis.localStorage;
    const existing = storage.getItem(BROWSER_DEVICE_ID_STORAGE_KEY);
    if (existing !== null && isValidBrowserDeviceId(existing)) {
      return existing;
    }
    const next = createBrowserDeviceId();
    storage.setItem(BROWSER_DEVICE_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return null;
  }
}

// ============================================================================
// 4. AuthService (Contract-Inferred Transport)
// ============================================================================

export interface AuthServiceConfig {
  readonly apiUrl: string;
  readonly tokenRefreshInterval: number;
}

export interface AuthServiceOptions {
  readonly config: AuthServiceConfig;
  readonly tokenStore?: TokenStore | undefined;
  readonly transport?: Transport | undefined;
  readonly onTosRequired?:
    ((payload: { documentId: string; requiredVersion: number }) => Promise<void>) | undefined;
}

interface AdminImpersonationWire {
  readonly token: string;
  readonly targetUserId: string;
  readonly targetEmail: string;
  readonly expiresAt: string;
}

export class AuthService {
  private readonly transport: Transport;
  private readonly client: ReturnType<
    typeof createEndpointClient<'identity', typeof identityModule.endpoints>
  >;
  private readonly config: AuthServiceConfig;
  private readonly tokenStore: TokenStore;
  private refreshIntervalId: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: Set<() => void> = new Set();
  private initialized = false;
  private refreshBackoffMs = 0;
  private consecutiveRefreshFailures = 0;
  private refreshPromise: Promise<boolean> | null = null;
  private authGeneration = 0;
  private impersonation: ImpersonationSession | null = null;
  private preImpersonationToken: string | null = null;
  private pendingOnboardingToken: string | null = null;
  private user: User | null = null;
  private isLoadingUser = false;
  private isInitializing = false;
  private newDevice = false;

  constructor(args: AuthServiceOptions) {
    this.config = args.config;
    const backingStore = args.tokenStore ?? fallbackTokenStore;
    this.tokenStore = {
      get: (): string | null => backingStore.get(),
      set: (token: string): void => {
        backingStore.set(token);
      },
      clear: (): void => {
        backingStore.clear();
      },
    };

    const resolvedTransport =
      args.transport ??
      createTransport({
        baseUrl: this.config.apiUrl,
        getToken: (): string | null => this.tokenStore.get(),
        onUnauthorized: (): Promise<boolean> => this.refreshToken(),
        ...(args.onTosRequired !== undefined
          ? {
              onRequirement: async (code, details) => {
                if (code !== 'TOS_ACCEPTANCE_REQUIRED' || args.onTosRequired === undefined) {
                  return false;
                }
                const documentId =
                  typeof details['documentId'] === 'string' ? details['documentId'] : '';
                const requiredVersion =
                  typeof details['requiredVersion'] === 'number' ? details['requiredVersion'] : 0;
                if (documentId === '') return false;
                await args.onTosRequired({ documentId, requiredVersion });
                return true;
              },
            }
          : {}),
      });

    this.transport = resolvedTransport;
    this.client = createEndpointClient(identityModule, resolvedTransport);

    setDefaultOnUnauthorized((): Promise<boolean> => this.refreshToken());

    const currentToken: string | null = this.tokenStore.get();
    if (currentToken !== null) {
      this.startRefreshInterval();
    }
  }

  async initialize(): Promise<User | null> {
    if (this.initialized) {
      return this.getState().user;
    }
    const initializeGeneration = this.authGeneration;
    this.initialized = true;
    this.isInitializing = true;
    this.notifyListeners();

    try {
      const existingToken: string | null = this.tokenStore.get();
      if (existingToken !== null) {
        try {
          const hydration = await this.hydrateUserForInitialize(initializeGeneration);
          if (hydration.status === 'hydrated') return hydration.user;
          if (hydration.status === 'timed-out') {
            if (this.isAuthGenerationCurrent(initializeGeneration)) {
              this.clearAuth();
              return null;
            }
            return this.getState().user;
          }
          if (hydration.status === 'stale') {
            return this.getState().user;
          }

          const refreshed = await this.refreshSessionForInitialize(initializeGeneration);
          if (refreshed) {
            const refreshedHydration = await this.hydrateUserForInitialize(initializeGeneration);
            if (refreshedHydration.status === 'hydrated') return refreshedHydration.user;
            if (refreshedHydration.status === 'timed-out') {
              if (this.isAuthGenerationCurrent(initializeGeneration)) {
                this.clearAuth();
                return null;
              }
              return this.getState().user;
            }
            if (refreshedHydration.status === 'stale') {
              return this.getState().user;
            }
          }

          if (this.isAuthGenerationCurrent(initializeGeneration)) {
            this.clearAuth();
            return null;
          }
          return this.getState().user;
        } catch {
          return null;
        } finally {
          this.isInitializing = false;
          this.notifyListeners();
        }
      }

      try {
        const refreshed = await this.refreshSessionForInitialize(initializeGeneration);
        if (refreshed) {
          const refreshedHydration = await this.hydrateUserForInitialize(initializeGeneration);
          if (refreshedHydration.status === 'hydrated') return refreshedHydration.user;
          if (refreshedHydration.status === 'stale') {
            return this.getState().user;
          }
          if (this.isAuthGenerationCurrent(initializeGeneration)) {
            this.clearAuth();
            return null;
          }
          return this.getState().user;
        }
        if (!this.isAuthGenerationCurrent(initializeGeneration)) {
          return this.getState().user;
        }
        return null;
      } catch {
        return null;
      }
    } finally {
      this.isInitializing = false;
      this.notifyListeners();
    }
  }

  getState(): AuthState {
    return {
      user: this.user,
      isLoading: this.isInitializing || this.isLoadingUser,
      isAuthenticated: Boolean(this.user),
      isNewDevice: this.newDevice,
      impersonation: this.impersonation,
    };
  }

  getBaseUrl(): string {
    return this.config.apiUrl;
  }

  dismissNewDeviceBanner(): void {
    this.newDevice = false;
    this.notifyListeners();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async login(credentials: LoginRequest): Promise<void> {
    const deviceId = getOrCreateBrowserDeviceId();
    const callOptions =
      deviceId !== null && deviceId.trim() !== ''
        ? { headers: { 'x-device-id': deviceId.trim() } }
        : undefined;
    const response = await withTimeout(
      this.client.login({ body: credentials }, callOptions),
      'Login request',
    );

    if (isTotpChallengeResponse(response)) {
      throw new TotpChallengeError(response.challengeToken);
    }

    if (isSmsChallengeResponse(response)) {
      throw new SmsChallengeError(response.challengeToken);
    }

    const loginGeneration = this.handleBffLoginSuccess();
    const hydratedUser = await this.hydrateSessionAfterLogin(loginGeneration);

    if (this.isAuthGenerationCurrent(loginGeneration)) {
      this.user = hydratedUser ?? normalizeUser(response.user);
      this.isLoadingUser = false;
      this.newDevice = response.isNewDevice === true;
      this.notifyListeners();
    }
  }

  async verifyTotpLogin(challengeToken: string, code: string): Promise<void> {
    const response = await this.client.totpVerifyLogin({ body: { challengeToken, code } });
    this.handleAuthSuccess(response);
  }

  async sendSmsCode(challengeToken: string): Promise<void> {
    await this.client.smsSendCode({ body: { challengeToken } });
  }

  async verifySmsLogin(challengeToken: string, code: string): Promise<void> {
    const response = await this.client.smsVerifyCode({ body: { challengeToken, code } });
    this.handleAuthSuccess(response);
  }

  async register(data: RegisterRequest): Promise<RegisterResponse> {
    return this.client.register({ body: data });
  }

  async logout(): Promise<void> {
    this.stopRefreshInterval();
    await this.client.logout({ body: {} }).catch(() => null);
    this.clearAuth();
  }

  async refreshToken(): Promise<boolean> {
    return this.executeSingleFlightRefresh({
      generation: this.authGeneration,
      label: 'Token refresh',
      timeoutMs: REQUEST_TIMEOUT_MS,
      clearOnAuthFailure: true,
    });
  }

  async startImpersonation(userId: string): Promise<void> {
    const adminToken = this.tokenStore.get();
    const response = await this.transport.request<AdminImpersonationWire>(
      `/admin/impersonate/${encodeURIComponent(userId)}`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
    const impersonationGeneration = this.markAuthStateChanged();
    const previousUser = this.user;

    this.preImpersonationToken = adminToken;
    this.impersonation = {
      targetUserId: response.targetUserId,
      targetEmail: response.targetEmail,
      expiresAt: response.expiresAt,
    };
    this.stopRefreshInterval();
    this.tokenStore.set(response.token);
    this.isLoadingUser = true;
    this.notifyListeners();

    try {
      const targetUser = await withTimeout<User>(this.client.me(), 'Fetch impersonated user');
      if (!this.isAuthGenerationCurrent(impersonationGeneration)) {
        return;
      }
      if (!isUser(targetUser)) {
        throw new Error('Invalid impersonated user data received from API');
      }
      this.user = normalizeUser(targetUser);
      this.isLoadingUser = false;
      this.notifyListeners();
    } catch (error) {
      if (this.isAuthGenerationCurrent(impersonationGeneration)) {
        if (adminToken !== null) {
          this.tokenStore.set(adminToken);
        } else {
          this.tokenStore.clear();
        }
        this.user = previousUser;
        this.impersonation = null;
        this.preImpersonationToken = null;
        this.isLoadingUser = false;
        this.notifyListeners();
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async endImpersonation(): Promise<void> {
    const activeImpersonation = this.impersonation;
    if (activeImpersonation === null) {
      throw new Error('No active impersonation session');
    }

    const impersonationToken = this.tokenStore.get();
    const restoreGeneration = this.markAuthStateChanged();
    this.isLoadingUser = true;
    this.notifyListeners();

    try {
      if (this.preImpersonationToken !== null) {
        this.tokenStore.set(this.preImpersonationToken);
      } else {
        const refreshResponse = await withTimeout(
          this.client.refresh({ body: {} }),
          'Restore admin session',
        );
        const refreshObj = refreshResponse as { token?: unknown };
        if (typeof refreshObj.token !== 'string' || refreshObj.token.length === 0) {
          throw new Error('Unable to restore admin session');
        }
        this.tokenStore.set(refreshObj.token);
      }

      await this.transport.request('/admin/impersonate/end', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: activeImpersonation.targetUserId }),
      });
      const adminUser = await withTimeout<User>(this.client.me(), 'Fetch current user');

      if (!this.isAuthGenerationCurrent(restoreGeneration)) {
        return;
      }
      if (!isUser(adminUser)) {
        throw new Error('Invalid admin user data received from API');
      }

      this.user = normalizeUser(adminUser);
      this.impersonation = null;
      this.preImpersonationToken = null;
      this.isLoadingUser = false;
      this.startRefreshInterval();
      this.notifyListeners();
    } catch (error) {
      if (this.isAuthGenerationCurrent(restoreGeneration)) {
        if (impersonationToken !== null) {
          this.tokenStore.set(impersonationToken);
        }
        this.impersonation = activeImpersonation;
        this.isLoadingUser = false;
        this.notifyListeners();
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async executeSingleFlightRefresh(options: {
    readonly generation: number;
    readonly label: string;
    readonly timeoutMs: number;
    readonly clearOnAuthFailure: boolean;
  }): Promise<boolean> {
    if (this.impersonation !== null) {
      return false;
    }
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async (): Promise<boolean> => {
      try {
        const response = await withTimeout(
          this.client.refresh({ body: {} }),
          options.label,
          options.timeoutMs,
        );
        const respObj = response as { token?: string };
        if (typeof respObj.token === 'string' && respObj.token.length > 0) {
          if (!this.isAuthGenerationCurrent(options.generation)) {
            return false;
          }
          this.tokenStore.set(respObj.token);
          this.resetRefreshBackoff();
          this.notifyListeners();
          return true;
        }
        throw new Error('Invalid response format from refresh API');
      } catch (error: unknown) {
        if (isNetworkFailure(error) || isTimeoutError(error)) {
          return false;
        }
        if (options.clearOnAuthFailure && this.isAuthGenerationCurrent(options.generation)) {
          this.clearAuth();
        }
        return false;
      }
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshSessionForInitialize(initializeGeneration: number): Promise<boolean> {
    return this.executeSingleFlightRefresh({
      generation: initializeGeneration,
      label: 'Initial session restore',
      timeoutMs: INITIAL_SESSION_RESTORE_TIMEOUT_MS,
      clearOnAuthFailure: true,
    });
  }

  private async hydrateUserForInitialize(
    initializeGeneration: number,
  ): Promise<InitializeHydrationResult> {
    try {
      const userResult = await withTimeout<User>(
        this.client.me(),
        'Initial user fetch',
        INITIAL_USER_HYDRATION_TIMEOUT_MS,
      );
      if (!this.isAuthGenerationCurrent(initializeGeneration)) {
        return { status: 'stale' };
      }
      if (!isUser(userResult)) {
        return { status: 'failed' };
      }
      this.user = normalizeUser(userResult);
      this.isLoadingUser = false;
      this.startRefreshInterval();
      this.notifyListeners();
      return { status: 'hydrated', user: this.user };
    } catch (error: unknown) {
      return { status: isTimeoutError(error) ? 'timed-out' : 'failed' };
    }
  }

  private resetRefreshBackoff(): void {
    this.refreshBackoffMs = 0;
    this.consecutiveRefreshFailures = 0;
  }

  private incrementRefreshBackoff(): void {
    this.consecutiveRefreshFailures += 1;
    const baseDelay = this.config.tokenRefreshInterval;
    const exponentialDelay = Math.pow(2, this.consecutiveRefreshFailures) * baseDelay;
    this.refreshBackoffMs = Math.min(exponentialDelay, MAX_REFRESH_BACKOFF_MS);
  }

  async fetchCurrentUser(): Promise<User | null> {
    const fetchGeneration = this.authGeneration;
    const currentToken: string | null = this.tokenStore.get();
    if (currentToken === null) {
      return null;
    }

    this.isLoadingUser = true;
    this.notifyListeners();

    try {
      const userResult = await withTimeout<User>(this.client.me(), 'Fetch current user');
      if (!this.isAuthGenerationCurrent(fetchGeneration)) {
        return this.getState().user;
      }
      if (isUser(userResult)) {
        this.user = normalizeUser(userResult);
        this.isLoadingUser = false;
        this.startRefreshInterval();
        this.notifyListeners();
        return this.user;
      }
      throw new Error('Invalid user data received from API');
    } catch {
      if (!this.isAuthGenerationCurrent(fetchGeneration)) {
        return this.getState().user;
      }
      const refreshed = await this.refreshToken();
      if (!this.isAuthGenerationCurrent(fetchGeneration)) {
        return this.getState().user;
      }
      if (refreshed) {
        try {
          const refreshedUser = await withTimeout<User>(this.client.me(), 'Fetch current user');
          if (!this.isAuthGenerationCurrent(fetchGeneration)) {
            return this.getState().user;
          }
          this.user = normalizeUser(refreshedUser);
          this.isLoadingUser = false;
          this.startRefreshInterval();
          this.notifyListeners();
          return this.user;
        } catch {
          if (this.isAuthGenerationCurrent(fetchGeneration)) {
            this.isLoadingUser = false;
            this.clearAuth();
          }
          return null;
        }
      }
      this.isLoadingUser = false;
      this.notifyListeners();
      return null;
    }
  }

  forgotPassword(data: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
    return this.client.forgotPassword({ body: data });
  }

  resetPassword(data: ResetPasswordRequest): Promise<ResetPasswordResponse> {
    return this.client.resetPassword({ body: data });
  }

  async verifyEmail(data: EmailVerificationRequest): Promise<EmailVerificationResponse> {
    const response = await this.client.verifyEmail({ body: data });
    this.handleAuthSuccess({ token: response.token, user: response.user });
    return response;
  }

  resendVerification(data: ResendVerificationRequest): Promise<ResendVerificationResponse> {
    return this.client.resendVerification({ body: data });
  }

  requestMagicLink(data: MagicLinkRequest): Promise<MagicLinkRequestResponse> {
    return this.client.magicLinkRequest({ body: data });
  }

  async verifyMagicLink(data: MagicLinkVerifyRequest): Promise<void> {
    const response = await this.client.magicLinkVerify({ body: data });
    this.handleAuthSuccess({ token: response.token, user: response.user });
  }

  requestEmailOtp(data: EmailOtpRequest): Promise<EmailOtpRequestResponse> {
    return this.client.emailOtpRequest({ body: data });
  }

  async verifyEmailOtp(data: EmailOtpVerifyRequest): Promise<{ isNewUser: boolean }> {
    const response = await this.client.emailOtpVerify({ body: data });
    if (response.isNewUser) {
      this.pendingOnboardingToken = response.token;
      this.tokenStore.set(response.token);
      return { isNewUser: true };
    }
    this.handleAuthSuccess({ token: response.token, user: response.user });
    return { isNewUser: false };
  }

  async completeOnboarding(data: CompleteOnboardingRequest): Promise<void> {
    const response = await this.client.completeOnboarding({ body: data });
    const token = this.pendingOnboardingToken ?? this.tokenStore.get() ?? '';
    this.pendingOnboardingToken = null;
    this.handleAuthSuccess({ token, user: response.user });
  }

  completePasskeyLogin(response: AuthResponse): void {
    this.handleAuthSuccess(response);
  }

  private handleAuthSuccess(response: AuthResponse): void {
    this.markAuthStateChanged();
    if (response.token.length > 0) {
      this.tokenStore.set(response.token);
    } else {
      this.tokenStore.clear();
    }
    this.user = normalizeUser(response.user);
    this.isLoadingUser = false;
    this.startRefreshInterval();
    this.notifyListeners();
  }

  private handleBffLoginSuccess(): number {
    this.markAuthStateChanged();
    this.tokenStore.clear();
    this.user = null;
    this.isLoadingUser = true;
    this.notifyListeners();
    return this.authGeneration;
  }

  private async hydrateSessionAfterLogin(loginGeneration: number): Promise<User | null> {
    const refreshed = await this.executeSingleFlightRefresh({
      generation: loginGeneration,
      label: 'Token refresh',
      timeoutMs: REQUEST_TIMEOUT_MS,
      clearOnAuthFailure: false,
    });
    if (!refreshed || !this.isAuthGenerationCurrent(loginGeneration)) {
      return null;
    }
    this.startRefreshInterval();

    const userResult = await withTimeout<User>(this.client.me(), 'Fetch current user').catch(
      () => null,
    );
    if (userResult === null || !this.isAuthGenerationCurrent(loginGeneration)) {
      return null;
    }
    return isUser(userResult) ? normalizeUser(userResult) : null;
  }

  private clearAuth(): void {
    this.markAuthStateChanged();
    this.tokenStore.clear();
    this.user = null;
    this.impersonation = null;
    this.preImpersonationToken = null;
    this.isLoadingUser = false;
    this.newDevice = false;
    this.initialized = false;
    this.stopRefreshInterval();
    this.notifyListeners();
  }

  private markAuthStateChanged(): number {
    this.authGeneration += 1;
    return this.authGeneration;
  }

  private isAuthGenerationCurrent(generation: number): boolean {
    return this.authGeneration === generation;
  }

  private startRefreshInterval(): void {
    this.stopRefreshInterval();
    this.scheduleNextRefresh();
  }

  private scheduleNextRefresh(): void {
    const delay =
      this.refreshBackoffMs > 0 ? this.refreshBackoffMs : this.config.tokenRefreshInterval;

    this.refreshIntervalId = setTimeout(() => {
      void this.performScheduledRefresh();
    }, delay);
  }

  private async performScheduledRefresh(): Promise<void> {
    const success = await this.refreshToken();
    if (success) {
      this.scheduleNextRefresh();
    } else {
      const stillHasToken: string | null = this.tokenStore.get();
      if (stillHasToken !== null) {
        this.incrementRefreshBackoff();
        this.scheduleNextRefresh();
      }
    }
  }

  private stopRefreshInterval(): void {
    if (this.refreshIntervalId !== null) {
      clearTimeout(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  destroy(): void {
    this.stopRefreshInterval();
    this.listeners.clear();
    setDefaultOnUnauthorized(undefined);
    clearCsrfTokenCache();
  }
}

export function createAuthService(args: AuthServiceOptions): AuthService {
  return new AuthService(args);
}

// ============================================================================
// 5. IdentityAuthProvider & React Auth Hooks
// ============================================================================

const IdentityAuthContext = createContext<AuthService | undefined>(undefined);

export function IdentityAuthProvider({
  auth,
  children,
}: {
  readonly auth: AuthService;
  readonly children?: ReactNode;
}): ReactElement {
  return createElement(IdentityAuthContext.Provider, { value: auth }, children);
}

export function useOptionalAuthService(): AuthService | undefined {
  return useContext(IdentityAuthContext);
}

function useAuthServiceInstance(): AuthService {
  const auth = useContext(IdentityAuthContext);
  if (auth === undefined) {
    throw new Error('useAuth must be used within IdentityAuthProvider');
  }
  return auth;
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isNewDevice: boolean;
  impersonation: ImpersonationSession | null;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  reloadUser: () => Promise<void>;
  forgotPassword: (data: ForgotPasswordRequest) => Promise<void>;
  resetPassword: (data: ResetPasswordRequest) => Promise<void>;
  verifyEmail: (data: EmailVerificationRequest) => Promise<EmailVerificationResponse>;
  resendVerification: (data: ResendVerificationRequest) => Promise<void>;
  verifyTotpLogin: (challengeToken: string, code: string) => Promise<void>;
  sendSmsCode: (challengeToken: string) => Promise<void>;
  verifySmsLogin: (challengeToken: string, code: string) => Promise<void>;
  requestMagicLink: (data: MagicLinkRequest) => Promise<MagicLinkRequestResponse>;
  verifyMagicLink: (data: MagicLinkVerifyRequest) => Promise<void>;
  requestEmailOtp: (data: EmailOtpRequest) => Promise<EmailOtpRequestResponse>;
  verifyEmailOtp: (data: EmailOtpVerifyRequest) => Promise<{ isNewUser: boolean }>;
  completeOnboarding: (data: CompleteOnboardingRequest) => Promise<void>;
  startImpersonation: (userId: string) => Promise<void>;
  endImpersonation: () => Promise<void>;
  dismissNewDeviceBanner: () => void;
}

export function useAuth(): AuthContextType {
  const auth = useAuthServiceInstance();
  const [state, setState] = useState<AuthState>(() => auth.getState());
  const [prevAuth, setPrevAuth] = useState(auth);
  if (prevAuth !== auth) {
    setPrevAuth(auth);
    setState(auth.getState());
  }

  useEffect(() => {
    const unsubscribe = auth.subscribe(() => {
      setState(auth.getState());
    });
    return unsubscribe;
  }, [auth]);

  const login = useCallback(
    async (credentials: LoginRequest): Promise<void> => {
      await auth.login(credentials);
    },
    [auth],
  );

  const register = useCallback(
    async (data: RegisterRequest): Promise<RegisterResponse> => auth.register(data),
    [auth],
  );

  const logout = useCallback(async (): Promise<void> => {
    await auth.logout();
  }, [auth]);

  const refreshToken = useCallback(async (): Promise<boolean> => auth.refreshToken(), [auth]);

  const reloadUser = useCallback(async (): Promise<void> => {
    await auth.fetchCurrentUser();
  }, [auth]);

  const forgotPassword = useCallback(
    async (data: ForgotPasswordRequest): Promise<void> => {
      await auth.forgotPassword(data);
    },
    [auth],
  );

  const resetPassword = useCallback(
    async (data: ResetPasswordRequest): Promise<void> => {
      await auth.resetPassword(data);
    },
    [auth],
  );

  const verifyEmail = useCallback(
    async (data: EmailVerificationRequest): Promise<EmailVerificationResponse> =>
      auth.verifyEmail(data),
    [auth],
  );

  const resendVerification = useCallback(
    async (data: ResendVerificationRequest): Promise<void> => {
      await auth.resendVerification(data);
    },
    [auth],
  );

  const verifyTotpLogin = useCallback(
    async (challengeToken: string, code: string): Promise<void> => {
      await auth.verifyTotpLogin(challengeToken, code);
    },
    [auth],
  );

  const sendSmsCode = useCallback(
    async (challengeToken: string): Promise<void> => {
      await auth.sendSmsCode(challengeToken);
    },
    [auth],
  );

  const verifySmsLogin = useCallback(
    async (challengeToken: string, code: string): Promise<void> => {
      await auth.verifySmsLogin(challengeToken, code);
    },
    [auth],
  );

  const requestMagicLink = useCallback(
    async (data: MagicLinkRequest): Promise<MagicLinkRequestResponse> =>
      auth.requestMagicLink(data),
    [auth],
  );

  const verifyMagicLink = useCallback(
    async (data: MagicLinkVerifyRequest): Promise<void> => {
      await auth.verifyMagicLink(data);
    },
    [auth],
  );

  const requestEmailOtp = useCallback(
    async (data: EmailOtpRequest): Promise<EmailOtpRequestResponse> => auth.requestEmailOtp(data),
    [auth],
  );

  const verifyEmailOtp = useCallback(
    async (data: EmailOtpVerifyRequest): Promise<{ isNewUser: boolean }> =>
      auth.verifyEmailOtp(data),
    [auth],
  );

  const completeOnboarding = useCallback(
    async (data: CompleteOnboardingRequest): Promise<void> => {
      await auth.completeOnboarding(data);
    },
    [auth],
  );

  const startImpersonation = useCallback(
    async (userId: string): Promise<void> => {
      await auth.startImpersonation(userId);
    },
    [auth],
  );

  const endImpersonation = useCallback(async (): Promise<void> => {
    await auth.endImpersonation();
  }, [auth]);

  const dismissNewDeviceBanner = useCallback((): void => {
    auth.dismissNewDeviceBanner();
  }, [auth]);

  return {
    user: state.user,
    isLoading: state.isLoading,
    isAuthenticated: state.isAuthenticated,
    isNewDevice: state.isNewDevice,
    impersonation: state.impersonation,
    login,
    register,
    logout,
    refreshToken,
    reloadUser,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerification,
    verifyTotpLogin,
    sendSmsCode,
    verifySmsLogin,
    requestMagicLink,
    verifyMagicLink,
    requestEmailOtp,
    verifyEmailOtp,
    completeOnboarding,
    startImpersonation,
    endImpersonation,
    dismissNewDeviceBanner,
  };
}

interface AuthMutationState<TData = void, TVariables = unknown> {
  mutate: (variables: TVariables) => Promise<TData>;
  isLoading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useVerifyEmail(): AuthMutationState<
  EmailVerificationResponse,
  EmailVerificationRequest
> {
  const { verifyEmail } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const mutate = useCallback(
    async (data: EmailVerificationRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        return await verifyEmail(data);
      } catch (err) {
        const nextErr = err instanceof Error ? err : new Error(String(err));
        setError(nextErr);
        throw nextErr;
      } finally {
        setIsLoading(false);
      }
    },
    [verifyEmail],
  );

  return { mutate, isLoading, error, reset };
}

export function useLogin(): AuthMutationState<void, LoginRequest> {
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const mutate = useCallback(
    async (data: LoginRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        await login(data);
      } catch (err) {
        const nextErr = err instanceof Error ? err : new Error(String(err));
        setError(nextErr);
        throw nextErr;
      } finally {
        setIsLoading(false);
      }
    },
    [login],
  );

  return { mutate, isLoading, error, reset };
}

export function useRegister(): AuthMutationState<RegisterResponse, RegisterRequest> {
  const { register } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const mutate = useCallback(
    async (data: RegisterRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        return await register(data);
      } catch (err) {
        const nextErr = err instanceof Error ? err : new Error(String(err));
        setError(nextErr);
        throw nextErr;
      } finally {
        setIsLoading(false);
      }
    },
    [register],
  );

  return { mutate, isLoading, error, reset };
}

export interface LoginWithPasskeyState {
  login: (email?: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useLoginWithPasskey(onSuccess?: () => void): LoginWithPasskeyState {
  const auth = useAuthServiceInstance();
  const transport = useTransport();
  const client = useMemo(() => createEndpointClient(identityModule, transport), [transport]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (email?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { options } = await client.webauthnLoginOptions({
          body: email !== undefined ? { email } : {},
        });
        const sessionKey = options['sessionKey'] as string;
        const credential = (await getPasskey(
          options as unknown as PasskeyRequestOptionsJSON,
        )) as unknown as WebauthnLoginVerifyRequest['credential'];
        const authResponse = await client.webauthnLoginVerify({
          body: { credential, sessionKey },
        });
        auth.completePasskeyLogin(authResponse);
        onSuccess?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [auth, client, onSuccess],
  );

  return { login, isLoading, error };
}
