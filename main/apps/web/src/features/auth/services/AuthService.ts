// main/apps/web/src/features/auth/services/AuthService.ts
/**
 * AuthService - Manages authentication state and operations.
 *
 * Encapsulates auth logic previously spread across AuthContext.
 * Uses internal state management for user data, token store for persistence.
 */

import { clearApiClient, getApiClient, NetworkError, setDefaultOnUnauthorized } from '@bslt/api';
import { MS_PER_MINUTE } from '@bslt/shared/constants/time';
import { tokenStore } from '@bslt/shared/system/security';

import type { ClientConfig } from '@/config';
import type {
  ApiClient,
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
} from '@bslt/api';

interface TokenStore {
  get: () => string | null;
  set: (token: string) => void;
  clear: () => void;
}

// ============================================================================
// Types
// ============================================================================

export type AuthState = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isNewDevice: boolean;
  impersonation: ImpersonationSession | null;
};

export type ImpersonationSession = {
  targetUserId: string;
  targetEmail: string;
  expiresAt: string;
};

/**
 * Error thrown when login requires TOTP verification.
 * Contains the challenge token that must be sent back with the TOTP code.
 *
 * @complexity O(1)
 */
export class TotpChallengeError extends Error {
  /** Challenge JWT token to send back with the TOTP code */
  readonly challengeToken: string;

  constructor(challengeToken: string) {
    super('Two-factor authentication required');
    this.name = 'TotpChallengeError';
    this.challengeToken = challengeToken;
  }
}

/**
 * Error thrown when login requires SMS verification.
 * Contains the challenge token that must be sent with the SMS code.
 */
export class SmsChallengeError extends Error {
  /** Challenge JWT token to send back with the SMS code */
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

// ============================================================================
// AuthService Class
// ============================================================================

// Maximum backoff delay for token refresh (5 minutes)
const MAX_REFRESH_BACKOFF_MS = 5 * MS_PER_MINUTE;
const REQUEST_TIMEOUT_MS = 5000;
const INITIAL_SESSION_RESTORE_TIMEOUT_MS = 5000;
const INITIAL_USER_HYDRATION_TIMEOUT_MS = 5000;
const BROWSER_DEVICE_ID_STORAGE_KEY = 'bslt:browser-device-id';

type InitializeHydrationResult =
  | { status: 'hydrated'; user: User }
  | { status: 'failed' | 'stale' | 'timed-out' };

// Type guard for User
const isUser = (value: unknown): value is User => {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'id' in value &&
    'email' in value &&
    'role' in value
  );
};

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

function getOrCreateBrowserDeviceId(): string | null {
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

export class AuthService {
  private readonly api: ApiClient;
  private readonly config: ClientConfig;
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

  /** Access token held between OTP verify and onboarding completion for new users. */
  private pendingOnboardingToken: string | null = null;

  /** Current authenticated user (internal state, replaces QueryClient) */
  private user: User | null = null;
  /** Whether user data is currently being loaded */
  private isLoadingUser = false;
  /** Whether auth is currently initializing (restoring session on app load) */
  private isInitializing = false;
  /** Whether the current login was from a new/unrecognized device */
  private newDevice = false;

  constructor(args: {
    config: ClientConfig;
    onTosRequired?: (payload: { documentId: string; requiredVersion: number }) => Promise<void>;
  }) {
    this.config = args.config;

    const sharedTokenStore = tokenStore as TokenStore;
    this.tokenStore = {
      get: (): string | null => sharedTokenStore.get(),
      set: (token: string): void => {
        sharedTokenStore.set(token);
      },
      clear: (): void => {
        sharedTokenStore.clear();
      },
    };

    const apiClient = getApiClient({
      baseUrl: this.config.apiUrl,
      getToken: (): string | null => this.tokenStore.get(),
      getDeviceId: getOrCreateBrowserDeviceId,
      // Transparently refresh a lapsed in-memory access token on any 401, then
      // retry once. `refreshToken` coalesces concurrent calls, so parallel 401s
      // trigger a single network refresh. `/auth/*` is excluded in the client to
      // avoid recursing through `/auth/refresh`.
      onUnauthorized: (): Promise<boolean> => this.refreshToken(),
      ...(args.onTosRequired !== undefined ? { onTosRequired: args.onTosRequired } : {}),
    });
    this.api = apiClient;

    // Publish this instance's coalesced refresh as the fallback 401 handler for
    // every other feature client (which only pass `getToken`), so a lapsed
    // access token self-heals app-wide rather than per-client. `/auth/*` is
    // excluded in the api client, so this never recurses through `/auth/refresh`.
    setDefaultOnUnauthorized((): Promise<boolean> => this.refreshToken());

    // Start refresh interval if we have a token
    const currentToken: string | null = this.tokenStore.get();
    if (currentToken !== null) {
      this.startRefreshInterval();
    }
  }

  /**
   * Initialize auth state on app load.
   *
   * With memory-based token storage (default for security), tokens are cleared
   * on page refresh. This method attempts to restore the session using the
   * refresh token (stored in HTTP-only cookie).
   *
   * Call this once on app startup.
   */
  async initialize(): Promise<User | null> {
    if (this.initialized) {
      return this.getState().user;
    }
    const initializeGeneration = this.authGeneration;
    this.initialized = true;
    this.isInitializing = true;
    this.notifyListeners(); // Notify that we're initializing

    try {
      // If we already have a token in memory, fetch the user
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

      // No token in memory - try to restore session from refresh token cookie.
      // Use a bounded timeout so app routing doesn't stay blocked on slow refresh.
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
        // No refresh token available - user is not logged in (this is normal)
        return null;
      } catch {
        return null;
      }
    } finally {
      this.isInitializing = false;
      this.notifyListeners();
    }
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /** Get current auth state */
  getState(): AuthState {
    return {
      user: this.user,
      isLoading: this.isInitializing || this.isLoadingUser,
      isAuthenticated: Boolean(this.user),
      isNewDevice: this.newDevice,
      impersonation: this.impersonation,
    };
  }

  /** Dismiss the new device banner */
  dismissNewDeviceBanner(): void {
    this.newDevice = false;
    this.notifyListeners();
  }

  /** Subscribe to auth state changes */
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

  // ==========================================================================
  // Auth Operations
  // ==========================================================================

  /**
   * Login with email/password.
   * Throws TotpChallengeError if user has 2FA enabled.
   *
   * @throws {TotpChallengeError} When 2FA verification is required
   */
  async login(credentials: LoginRequest): Promise<void> {
    const response = await withTimeout(this.api.login(credentials), 'Login request');

    if (isTotpChallengeResponse(response)) {
      throw new TotpChallengeError(response.challengeToken);
    }

    if (isSmsChallengeResponse(response)) {
      throw new SmsChallengeError(response.challengeToken);
    }

    const loginGeneration = this.handleBffLoginSuccess(response);
    await this.hydrateSessionAfterLogin(loginGeneration);

    if (this.isAuthGenerationCurrent(loginGeneration)) {
      this.isLoadingUser = false;
      this.notifyListeners();
    }

    // Track new device flag for banner display. Explicitly clear it on known devices.
    this.newDevice = response.isNewDevice === true;
    this.notifyListeners();
  }

  /**
   * Verify TOTP code during login challenge.
   * Called after login throws TotpChallengeError.
   *
   * @param challengeToken - JWT challenge token from TotpChallengeError
   * @param code - 6-digit TOTP code from authenticator app
   */
  async verifyTotpLogin(challengeToken: string, code: string): Promise<void> {
    const response = await this.api.totpVerifyLogin({ challengeToken, code });
    this.handleAuthSuccess(response);
  }

  /** Send SMS verification code during login challenge. */
  async sendSmsCode(challengeToken: string): Promise<void> {
    await this.api.smsSendCode({ challengeToken });
  }

  /**
   * Verify SMS code during login challenge.
   * Called after login throws SmsChallengeError and user enters the code.
   */
  async verifySmsLogin(challengeToken: string, code: string): Promise<void> {
    const response = await this.api.smsVerifyLogin({ challengeToken, code });
    this.handleAuthSuccess(response);
  }

  /** Register new account - returns pending status, user must verify email */
  async register(data: RegisterRequest): Promise<RegisterResponse> {
    const response = await this.api.register(data);
    // No auto-login - user must verify email first
    return response;
  }

  /** Logout and clear session */
  async logout(): Promise<void> {
    this.stopRefreshInterval();

    // Call server to invalidate refresh token
    try {
      await this.api.logout();
    } catch {
      // Continue with local cleanup even if server logout fails
    }

    this.clearAuth();
  }

  /** Refresh access token (with mutex to prevent concurrent refresh requests) */
  async refreshToken(): Promise<boolean> {
    if (this.impersonation !== null) {
      return false;
    }

    // If refresh already in progress, wait for it
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    // Start new refresh
    this.refreshPromise = this.performRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /** Start an admin impersonation session and hydrate auth state as the target user. */
  async startImpersonation(userId: string): Promise<void> {
    const adminToken = this.tokenStore.get();
    const response = await this.api.startImpersonation(userId);
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
      const targetUser = await withTimeout<User>(
        this.api.getCurrentUser(),
        'Fetch impersonated user',
      );
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

  /** End the current admin impersonation session and restore the admin user. */
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
        const refreshResponse = await withTimeout(this.api.refresh(), 'Restore admin session');
        const refreshObj = refreshResponse as { token?: unknown };
        if (typeof refreshObj.token !== 'string' || refreshObj.token.length === 0) {
          throw new Error('Unable to restore admin session');
        }
        this.tokenStore.set(refreshObj.token);
      }

      await this.api.endImpersonation(activeImpersonation.targetUserId);
      const adminUser = await withTimeout<User>(this.api.getCurrentUser(), 'Fetch current user');

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

  /** Perform the actual token refresh */
  private async performRefresh(): Promise<boolean> {
    const refreshGeneration = this.authGeneration;
    try {
      const response = await withTimeout(this.api.refresh(), 'Token refresh');
      // Type guard: ensure response has token property
      const respObj = response as { token?: string };
      if (typeof respObj.token === 'string') {
        if (!this.isAuthGenerationCurrent(refreshGeneration)) {
          return false;
        }
        this.tokenStore.set(respObj.token);
        this.resetRefreshBackoff();
        this.notifyListeners();
        return true;
      }
      throw new Error('Invalid response format from refresh API');
    } catch (error: unknown) {
      // Network errors and timeouts: keep session, let backoff retry
      if (error instanceof NetworkError || isTimeoutError(error)) {
        return false;
      }
      // Auth errors (401, invalid token, etc.): clear session
      void error;
      if (this.isAuthGenerationCurrent(refreshGeneration)) {
        this.clearAuth();
      }
      return false;
    }
  }

  /**
   * Attempt a one-time session restore during initialize with a short timeout.
   * This avoids late auth state mutation after initialize has already completed.
   */
  private async refreshSessionForInitialize(initializeGeneration: number): Promise<boolean> {
    try {
      const response = await withTimeout(
        this.api.refresh(),
        'Initial session restore',
        INITIAL_SESSION_RESTORE_TIMEOUT_MS,
      );
      const respObj = response as { token?: string };
      if (typeof respObj.token === 'string') {
        if (!this.isAuthGenerationCurrent(initializeGeneration)) {
          return false;
        }
        this.tokenStore.set(respObj.token);
        this.resetRefreshBackoff();
        this.notifyListeners();
        return true;
      }
      throw new Error('Invalid response format from refresh API');
    } catch (error: unknown) {
      if (error instanceof NetworkError || isTimeoutError(error)) {
        return false;
      }
      if (this.isAuthGenerationCurrent(initializeGeneration)) {
        this.clearAuth();
      }
      return false;
    }
  }

  /**
   * Fetch and cache current user during initialize with a strict timeout.
   * This keeps initial route decisions responsive when auth backend is slow.
   */
  private async hydrateUserForInitialize(
    initializeGeneration: number,
  ): Promise<InitializeHydrationResult> {
    try {
      const userResult = await withTimeout<User>(
        this.api.getCurrentUser(),
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

  /** Reset backoff state after successful refresh */
  private resetRefreshBackoff(): void {
    this.refreshBackoffMs = 0;
    this.consecutiveRefreshFailures = 0;
  }

  /** Calculate next backoff delay using exponential backoff */
  private incrementRefreshBackoff(): void {
    this.consecutiveRefreshFailures += 1;
    // Exponential backoff: 2^failures * base interval, capped at max
    const baseDelay = this.config.tokenRefreshInterval;
    const exponentialDelay = Math.pow(2, this.consecutiveRefreshFailures) * baseDelay;
    this.refreshBackoffMs = Math.min(exponentialDelay, MAX_REFRESH_BACKOFF_MS);
  }

  /** Fetch current user (call on app load if token exists) */
  async fetchCurrentUser(): Promise<User | null> {
    const fetchGeneration = this.authGeneration;
    const currentToken: string | null = this.tokenStore.get();
    if (currentToken === null) {
      return null;
    }

    this.isLoadingUser = true;
    this.notifyListeners();

    try {
      const userResult = await withTimeout<User>(this.api.getCurrentUser(), 'Fetch current user');
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
      // Token might be expired, try refresh
      const refreshed = await this.refreshToken();
      if (!this.isAuthGenerationCurrent(fetchGeneration)) {
        return this.getState().user;
      }
      if (refreshed) {
        try {
          const refreshedUser = await withTimeout<User>(
            this.api.getCurrentUser(),
            'Fetch current user',
          );
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

  /** Request password reset */
  forgotPassword(data: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
    return this.api.forgotPassword(data);
  }

  /** Reset password with token */
  resetPassword(data: ResetPasswordRequest): Promise<ResetPasswordResponse> {
    return this.api.resetPassword(data);
  }

  /** Verify email with token - auto-logs in user on success */
  async verifyEmail(data: EmailVerificationRequest): Promise<EmailVerificationResponse> {
    const response = await this.api.verifyEmail(data);
    // Auto-login on successful verification
    this.handleAuthSuccess({ token: response.token, user: response.user });
    return response;
  }

  /** Resend verification email */
  resendVerification(data: ResendVerificationRequest): Promise<ResendVerificationResponse> {
    return this.api.resendVerification(data);
  }

  /** Request magic link for passwordless login */
  requestMagicLink(data: MagicLinkRequest): Promise<MagicLinkRequestResponse> {
    return this.api.magicLinkRequest(data);
  }

  /** Verify magic link token and login */
  async verifyMagicLink(data: MagicLinkVerifyRequest): Promise<void> {
    const response = await this.api.magicLinkVerify(data);
    this.handleAuthSuccess({ token: response.token, user: response.user });
  }

  /** Request a 6-digit security code for passwordless login */
  requestEmailOtp(data: EmailOtpRequest): Promise<EmailOtpRequestResponse> {
    return this.api.emailOtpRequest(data);
  }

  /**
   * Verify a 6-digit security code and login.
   *
   * For a brand-new account, the access token is stored (so the follow-up
   * onboarding request is authenticated) but the app is NOT flipped to
   * "signed in" yet — otherwise the auth page would redirect away before the
   * mandatory onboarding step renders. {@link completeOnboarding} finalizes it.
   */
  async verifyEmailOtp(data: EmailOtpVerifyRequest): Promise<{ isNewUser: boolean }> {
    const response = await this.api.emailOtpVerify(data);
    if (response.isNewUser) {
      this.pendingOnboardingToken = response.token;
      this.tokenStore.set(response.token);
      return { isNewUser: true };
    }
    this.handleAuthSuccess({ token: response.token, user: response.user });
    return { isNewUser: false };
  }

  /** Finish onboarding for a new passwordless user, then complete sign-in. */
  async completeOnboarding(data: CompleteOnboardingRequest): Promise<void> {
    const response = await this.api.completeOnboarding(data);
    const token = this.pendingOnboardingToken ?? this.tokenStore.get() ?? '';
    this.pendingOnboardingToken = null;
    this.handleAuthSuccess({ token, user: response.user });
  }

  /** Complete passkey login by applying auth response to local auth state. */
  completePasskeyLogin(response: AuthResponse): void {
    this.handleAuthSuccess(response);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

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

  private handleBffLoginSuccess(response: LoginSuccessResponse): number {
    this.markAuthStateChanged();
    this.tokenStore.clear();
    this.user = normalizeUser(response.user);
    this.isLoadingUser = true;
    this.notifyListeners();
    return this.authGeneration;
  }

  private async hydrateSessionAfterLogin(loginGeneration: number): Promise<void> {
    try {
      const refreshResponse = await withTimeout(this.api.refresh(), 'Token refresh');
      const refreshObj = refreshResponse as { token?: unknown };
      if (!this.isAuthGenerationCurrent(loginGeneration)) {
        return;
      }
      if (typeof refreshObj.token === 'string' && refreshObj.token.length > 0) {
        this.tokenStore.set(refreshObj.token);
        this.startRefreshInterval();
      }

      const userResult = await withTimeout<User>(this.api.getCurrentUser(), 'Fetch current user');
      if (!this.isAuthGenerationCurrent(loginGeneration)) {
        return;
      }
      if (isUser(userResult)) {
        this.user = normalizeUser(userResult);
      }
    } catch {
      // Keep user from login response.
    }
  }

  private clearAuth(): void {
    this.markAuthStateChanged();
    this.tokenStore.clear();
    this.user = null;
    this.impersonation = null;
    this.preImpersonationToken = null;
    this.isLoadingUser = false;
    this.newDevice = false;
    this.initialized = false; // Allow re-initialization after logout
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

  /** Schedule the next token refresh with backoff support */
  private scheduleNextRefresh(): void {
    // Use backoff delay if set, otherwise use normal interval
    const delay =
      this.refreshBackoffMs > 0 ? this.refreshBackoffMs : this.config.tokenRefreshInterval;

    this.refreshIntervalId = setTimeout(() => {
      void this.performScheduledRefresh();
    }, delay);
  }

  /** Perform scheduled refresh and reschedule based on result */
  private async performScheduledRefresh(): Promise<void> {
    const success = await this.refreshToken();

    if (success) {
      // On success, backoff is already reset in refreshToken()
      // Schedule next refresh at normal interval
      this.scheduleNextRefresh();
    } else {
      // On failure, increment backoff and reschedule if we still have a token
      // (network errors preserve the token; auth errors clear it)
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

  /** Cleanup on unmount */
  destroy(): void {
    this.stopRefreshInterval();
    this.listeners.clear();
    setDefaultOnUnauthorized(undefined);
    clearApiClient();
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAuthService(args: {
  config: ClientConfig;
  onTosRequired?: (payload: { documentId: string; requiredVersion: number }) => Promise<void>;
}): AuthService {
  return new AuthService(args);
}
