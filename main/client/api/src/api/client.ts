// main/client/api/src/api/client.ts

import { HTTP_STATUS } from '@bslt/shared';
import {
  acceptTosResponseSchema,
  authResponseSchema,
  backupCodesRegenerateResponseSchema,
  backupCodesStatusResponseSchema,
  changeEmailResponseSchema,
  completeOnboardingResponseSchema,
  confirmEmailChangeResponseSchema,
  emailOtpRequestResponseSchema,
  emailOtpVerifyResponseSchema,
  emailVerificationResponseSchema,
  forgotPasswordResponseSchema,
  logoutResponseSchema,
  magicLinkRequestResponseSchema,
  magicLinkVerifyResponseSchema,
  oauthConnectionsResponseSchema,
  oauthEnabledProvidersResponseSchema,
  oauthLinkResponseSchema,
  oauthUnlinkResponseSchema,
  refreshResponseSchema,
  registerResponseSchema,
  resendVerificationResponseSchema,
  resetPasswordResponseSchema,
  revertEmailChangeResponseSchema,
  setPasswordResponseSchema,
  tosStatusResponseSchema,
  totpSetupResponseSchema,
  totpStatusResponseSchema,
  totpVerifyResponseSchema,
  type AuthResponse,
  type AuthStrategy,
  type BackupCodesRegenerateResponse,
  type BackupCodesStatusResponse,
  type ChangeEmailRequest,
  type ChangeEmailResponse,
  type ConfirmEmailChangeRequest,
  type ConfirmEmailChangeResponse,
  type CompleteOnboardingRequest,
  type CompleteOnboardingResponse,
  type EmailOtpRequest,
  type EmailOtpRequestResponse,
  type EmailOtpVerifyRequest,
  type EmailOtpVerifyResponse,
  type EmailVerificationRequest,
  type EmailVerificationResponse,
  type ForgotPasswordRequest,
  type ForgotPasswordResponse,
  type LoginRequest,
  type LoginSuccessResponse,
  type LogoutResponse,
  type MagicLinkRequest,
  type MagicLinkRequestResponse,
  type MagicLinkVerifyRequest,
  type MagicLinkVerifyResponse,
  type OAuthConnectionsResponse,
  type OAuthEnabledProvidersResponse,
  type OAuthLinkResponse,
  type OAuthProvider,
  type OAuthUnlinkResponse,
  type PasskeyListItem,
  type RefreshResponse,
  type RegisterRequest,
  type RegisterResponse,
  type ResendVerificationRequest,
  type ResendVerificationResponse,
  type ResetPasswordRequest,
  type ResetPasswordResponse,
  type RevertEmailChangeRequest,
  type RevertEmailChangeResponse,
  type SetPasswordRequest,
  type SetPasswordResponse,
  type SmsLoginChallengeResponse,
  type TotpLoginChallengeResponse,
  type TotpLoginVerifyRequest,
  type TotpSetupResponse,
  type TotpStatusResponse,
  type TotpVerifyRequest,
  type TotpVerifyResponse,
} from '@bslt/shared/core/auth';
import {
  updateConsentPreferencesRequestSchema,
  type DataExportFormat,
  type UpdateConsentPreferencesRequest,
} from '@bslt/shared/core/compliance';
import { type User } from '@bslt/shared/core/users';
import {
  type FileDeleteResponse,
  type FileDownloadResponse,
  type FileUploadResponse,
  type FilesListResponse,
} from '@bslt/shared/storage';

import { createApiError, NetworkError } from '../errors';
import { API_PREFIX, createRequestFactory } from '../utils';

import { parseLoginResponse, parseUserResponse } from './login-response';

import type { ApiErrorBody } from '../errors';
import type { BaseClientConfig } from '../utils';
import type { EndImpersonationResponse, ImpersonationResponse } from '@bslt/shared/core/admin';
import type {
  SetTenantFeatureOverrideRequest,
  TenantFeatureOverrideDeleteResponse,
  TenantFeatureOverrideResponse,
  TenantFeatureOverridesResponse,
} from '@bslt/shared/core/feature-flags';

/** Payload emitted when the server requires ToS acceptance (403 TOS_ACCEPTANCE_REQUIRED) */
export interface TosRequiredPayload {
  documentId: string;
  requiredVersion: number;
}

/**
 * A completed data export download. The server decides the representation from
 * the format chosen when the export was requested: a JSON `{ export }` envelope
 * or a raw CSV document.
 */
export type DataExportDownload =
  | { format: 'json'; export: Record<string, unknown> }
  | { format: 'csv'; content: string };

export interface ApiClientConfig extends BaseClientConfig {
  /**
   * Returns a stable browser/device identifier to help the server recognize
   * repeat logins from the same browser profile even when the IP address changes.
   */
  getDeviceId?: (() => string | null) | undefined;

  /**
   * Called when the server returns 403 with code TOS_ACCEPTANCE_REQUIRED.
   * The promise should resolve after the user accepts the ToS,
   * allowing the original request to be retried automatically.
   * If not provided, the 403 error is thrown normally.
   */
  onTosRequired?: (payload: TosRequiredPayload) => Promise<void>;
}

export interface ApiClient {
  acceptTos: (documentId: string) => Promise<{ agreedAt: string }>;
  getConsent: () => Promise<{ preferences: Record<string, boolean | null> }>;
  updateConsent: (data: UpdateConsentPreferencesRequest) => Promise<{
    preferences: Record<string, boolean | null>;
    updated: number;
  }>;
  requestDataExport: (
    format?: DataExportFormat,
  ) => Promise<{ exportRequest: Record<string, unknown> }>;
  getDataExportStatus: (requestId: string) => Promise<{ exportRequest: Record<string, unknown> }>;
  downloadDataExport: (requestId: string) => Promise<DataExportDownload>;
  listFiles: () => Promise<FilesListResponse>;
  uploadFile: (formData: FormData) => Promise<FileUploadResponse>;
  deleteFile: (fileId: string) => Promise<FileDeleteResponse>;
  downloadFile: (fileId: string) => Promise<FileDownloadResponse>;
  evaluateFeatureFlags: (tenantId?: string) => Promise<{ flags: Record<string, boolean> }>;
  listTenantFeatureOverrides: (tenantId: string) => Promise<TenantFeatureOverridesResponse>;
  setTenantFeatureOverride: (
    tenantId: string,
    key: string,
    data: SetTenantFeatureOverrideRequest,
  ) => Promise<TenantFeatureOverrideResponse>;
  deleteTenantFeatureOverride: (
    tenantId: string,
    key: string,
  ) => Promise<TenantFeatureOverrideDeleteResponse>;
  startImpersonation: (userId: string) => Promise<ImpersonationResponse>;
  endImpersonation: (targetUserId: string) => Promise<EndImpersonationResponse>;
  hardBanAdminUser: (userId: string, reason: string) => Promise<Record<string, unknown>>;
  publishLegalDocument: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listActivities: () => Promise<Record<string, unknown>>;
  getCurrentLegalDocument: () => Promise<Record<string, unknown>>;
  getUserAgreements: () => Promise<Record<string, unknown>>;
  login: (
    data: LoginRequest,
  ) => Promise<LoginSuccessResponse | TotpLoginChallengeResponse | SmsLoginChallengeResponse>;
  register: (data: RegisterRequest) => Promise<RegisterResponse>;
  refresh: () => Promise<RefreshResponse>;
  logout: () => Promise<LogoutResponse>;
  logoutAll: () => Promise<LogoutResponse>;
  getCurrentUser: () => Promise<User>;
  forgotPassword: (data: ForgotPasswordRequest) => Promise<ForgotPasswordResponse>;
  resetPassword: (data: ResetPasswordRequest) => Promise<ResetPasswordResponse>;
  setPassword: (data: SetPasswordRequest) => Promise<SetPasswordResponse>;
  verifyEmail: (data: EmailVerificationRequest) => Promise<EmailVerificationResponse>;
  resendVerification: (data: ResendVerificationRequest) => Promise<ResendVerificationResponse>;
  // TOTP methods
  totpSetup: () => Promise<TotpSetupResponse>;
  totpEnable: (data: TotpVerifyRequest) => Promise<TotpVerifyResponse>;
  totpDisable: (data: TotpVerifyRequest) => Promise<TotpVerifyResponse>;
  totpStatus: () => Promise<TotpStatusResponse>;
  totpVerifyLogin: (data: TotpLoginVerifyRequest) => Promise<AuthResponse>;
  backupCodesStatus: () => Promise<BackupCodesStatusResponse>;
  regenerateBackupCodes: (data: TotpVerifyRequest) => Promise<BackupCodesRegenerateResponse>;
  // SMS 2FA methods
  smsSendCode: (data: { challengeToken: string }) => Promise<{ message: string }>;
  smsVerifyLogin: (data: { challengeToken: string; code: string }) => Promise<AuthResponse>;
  // Magic link methods
  magicLinkRequest: (data: MagicLinkRequest) => Promise<MagicLinkRequestResponse>;
  magicLinkVerify: (data: MagicLinkVerifyRequest) => Promise<MagicLinkVerifyResponse>;
  emailOtpRequest: (data: EmailOtpRequest) => Promise<EmailOtpRequestResponse>;
  emailOtpVerify: (data: EmailOtpVerifyRequest) => Promise<EmailOtpVerifyResponse>;
  completeOnboarding: (data: CompleteOnboardingRequest) => Promise<CompleteOnboardingResponse>;
  // Email change methods
  changeEmail: (data: ChangeEmailRequest) => Promise<ChangeEmailResponse>;
  confirmEmailChange: (data: ConfirmEmailChangeRequest) => Promise<ConfirmEmailChangeResponse>;
  revertEmailChange: (data: RevertEmailChangeRequest) => Promise<RevertEmailChangeResponse>;
  // OAuth methods
  getAuthStrategies: () => Promise<{
    enabled: AuthStrategy[];
    disabled: AuthStrategy[];
  }>;
  getEnabledOAuthProviders: () => Promise<OAuthEnabledProvidersResponse>;
  getOAuthConnections: () => Promise<OAuthConnectionsResponse>;
  linkOAuthProvider: (provider: OAuthProvider) => Promise<OAuthLinkResponse>;
  unlinkOAuthProvider: (provider: OAuthProvider) => Promise<OAuthUnlinkResponse>;
  getOAuthLoginUrl: (provider: OAuthProvider) => string;
  getOAuthLinkUrl: (provider: OAuthProvider) => string;
  // WebAuthn/Passkey methods
  webauthnRegisterOptions: () => Promise<{ options: Record<string, unknown> }>;
  webauthnRegisterVerify: (data: {
    credential: Record<string, unknown>;
    name?: string;
  }) => Promise<{ credentialId: string; message: string }>;
  webauthnLoginOptions: (email?: string) => Promise<{ options: Record<string, unknown> }>;
  webauthnLoginVerify: (data: {
    credential: Record<string, unknown>;
    sessionKey: string;
  }) => Promise<AuthResponse>;
  listPasskeys: () => Promise<PasskeyListItem[]>;
  renamePasskey: (id: string, name: string) => Promise<{ message: string }>;
  deletePasskey: (id: string) => Promise<{ message: string }>;
  getTosStatus: () => Promise<{
    accepted: boolean;
    requiredVersion: number | null;
    documentId: string | null;
  }>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { baseUrl, fetcher } = createRequestFactory(config);
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  let csrfToken: string | null = null;

  type ResponseSchema<T> = {
    parse(data: unknown): T;
  };

  const isCsrfError = (status: number, data: Record<string, unknown>): boolean => {
    if (status !== HTTP_STATUS.FORBIDDEN) return false;
    const message = typeof data['message'] === 'string' ? data['message'].toLowerCase() : '';
    return message.includes('csrf');
  };

  const fetchCsrfToken = async (): Promise<string> => {
    const response = await fetcher(`${baseUrl}${API_PREFIX}/csrf-token`, {
      method: 'GET',
      credentials: 'include',
    });

    const data = (await response.json().catch(() => ({}))) as {
      token?: unknown;
      message?: unknown;
    };
    if (!response.ok || typeof data.token !== 'string' || data.token.length === 0) {
      throw createApiError(response.status, {
        message: typeof data.message === 'string' ? data.message : 'Failed to fetch CSRF token',
      });
    }

    csrfToken = data.token;
    return data.token;
  };

  // Custom request helper with ToS interception (not shared by other clients)
  const request = async <T>(
    path: string,
    options?: RequestInit,
    responseSchema?: ResponseSchema<T>,
    attempt: number = 0,
  ): Promise<T> => {
    const headers = new Headers(options?.headers);
    headers.set('Content-Type', 'application/json');
    const method = options?.method ?? 'GET';
    const requiresCsrf = !safeMethods.has(method.toUpperCase());

    const token = config.getToken?.();
    if (token !== null && token !== undefined) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const deviceId = config.getDeviceId?.();
    if (deviceId !== null && deviceId !== undefined && deviceId.trim() !== '') {
      headers.set('x-device-id', deviceId.trim());
    }
    if (requiresCsrf && csrfToken !== null && csrfToken.length > 0) {
      headers.set('x-csrf-token', csrfToken);
    }

    const url = `${baseUrl}${API_PREFIX}${path}`;

    let response: Response;
    try {
      response = await fetcher(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies for refresh token
      });
    } catch (error: unknown) {
      // Network error (offline, DNS failure, etc.)
      const errorMessage = `Failed to fetch ${options?.method ?? 'GET'} ${path}`;
      const originalError = error instanceof Error ? error : new Error(String(error));
      throw new NetworkError(errorMessage, originalError) as Error;
    }

    const data = (await response.json().catch((parseError: unknown) => {
      void parseError;
      return {};
    })) as Record<string, unknown>;

    if (!response.ok) {
      // Intercept 403 TOS_ACCEPTANCE_REQUIRED: allow caller to show ToS modal and retry.
      // The server sends the document under the error wire's `details` object
      // (see TosAcceptanceRequiredError in server core).
      if (
        response.status === HTTP_STATUS.FORBIDDEN &&
        data['code'] === 'TOS_ACCEPTANCE_REQUIRED' &&
        config.onTosRequired !== undefined
      ) {
        const details = (
          typeof data['details'] === 'object' && data['details'] !== null ? data['details'] : {}
        ) as Record<string, unknown>;
        const documentId = typeof details['documentId'] === 'string' ? details['documentId'] : '';
        const requiredVersion =
          typeof details['requiredVersion'] === 'number' ? details['requiredVersion'] : 0;

        if (documentId !== '') {
          // Wait for the user to accept ToS, then retry the original request
          await config.onTosRequired({ documentId, requiredVersion });
          return request<T>(path, options, responseSchema, attempt);
        }
      }
      if (requiresCsrf && attempt === 0 && isCsrfError(response.status, data)) {
        await fetchCsrfToken();
        return request<T>(path, options, responseSchema, 1);
      }
      // Refresh-on-401: the access token lives in memory and can lapse (e.g. a
      // backgrounded tab). Refresh once and retry. `/auth/*` is excluded — a 401
      // there is a genuine auth failure, and retrying `/auth/refresh` (which runs
      // through this client) would recurse. Shares the single-retry budget with CSRF.
      if (
        response.status === HTTP_STATUS.UNAUTHORIZED &&
        attempt === 0 &&
        !path.startsWith('/auth/') &&
        config.onUnauthorized !== undefined &&
        (await config.onUnauthorized())
      ) {
        return request<T>(path, options, responseSchema, 1);
      }

      const errorBody: ApiErrorBody = {};
      if (typeof data['message'] === 'string') {
        errorBody.message = data['message'];
      }
      if (typeof data['code'] === 'string') {
        errorBody.code = data['code'];
      }
      if (typeof data['details'] === 'object' && data['details'] !== null) {
        errorBody.details = data['details'] as Record<string, unknown>;
      }
      throw createApiError(response.status, errorBody);
    }

    if (responseSchema !== undefined) {
      return responseSchema.parse(data);
    }

    return data as T;
  };

  const authStrategiesResponseSchema = {
    parse(value: unknown): {
      enabled: AuthStrategy[];
      disabled: AuthStrategy[];
    } {
      if (value === null || typeof value !== 'object') {
        throw new Error('Invalid auth strategies response');
      }
      const obj = value as Record<string, unknown>;
      const enabledRaw = obj['enabled'];
      const disabledRaw = obj['disabled'];
      if (!Array.isArray(enabledRaw) || !Array.isArray(disabledRaw)) {
        throw new Error('Invalid auth strategies payload');
      }
      const enabled = enabledRaw.filter((item): item is AuthStrategy => typeof item === 'string');
      const disabled = disabledRaw.filter((item): item is AuthStrategy => typeof item === 'string');
      return { enabled, disabled };
    },
  };

  const requestMultipart = async <T = Record<string, unknown>>(
    path: string,
    formData: FormData,
    options?: RequestInit,
    attempt: number = 0,
  ): Promise<T> => {
    const headers = new Headers();
    const optionHeaders = options?.headers;
    if (optionHeaders instanceof Headers) {
      optionHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    } else if (Array.isArray(optionHeaders)) {
      for (const [key, value] of optionHeaders) {
        headers.set(key, value);
      }
    } else if (optionHeaders !== undefined) {
      for (const [key, value] of Object.entries(optionHeaders)) {
        if (typeof value === 'string') {
          headers.set(key, value);
        }
      }
    }

    const token = config.getToken?.();
    if (token !== null && token !== undefined) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const method = options?.method ?? 'POST';
    const requiresCsrf = !safeMethods.has(method.toUpperCase());
    if (requiresCsrf && csrfToken !== null && csrfToken.length > 0) {
      headers.set('x-csrf-token', csrfToken);
    }

    const response = await fetcher(`${baseUrl}${API_PREFIX}${path}`, {
      ...options,
      method,
      headers,
      body: formData,
      credentials: 'include',
    });

    const data = (await response.json().catch(() => ({}))) as ApiErrorBody &
      Record<string, unknown>;
    if (!response.ok) {
      if (requiresCsrf && attempt === 0 && isCsrfError(response.status, data)) {
        await fetchCsrfToken();
        return requestMultipart<T>(path, formData, options, 1);
      }
      // Refresh-on-401, mirroring request(); see the note there.
      if (
        response.status === HTTP_STATUS.UNAUTHORIZED &&
        attempt === 0 &&
        !path.startsWith('/auth/') &&
        config.onUnauthorized !== undefined &&
        (await config.onUnauthorized())
      ) {
        return requestMultipart<T>(path, formData, options, 1);
      }
      throw createApiError(response.status, data);
    }
    return data as T;
  };

  return {
    async acceptTos(documentId: string): Promise<{ agreedAt: string }> {
      return request<{ agreedAt: string }>(
        '/auth/tos/accept',
        {
          method: 'POST',
          body: JSON.stringify({ documentId }),
        },
        acceptTosResponseSchema,
      );
    },
    async getConsent(): Promise<{
      preferences: Record<string, boolean | null>;
    }> {
      return request<{ preferences: Record<string, boolean | null> }>('/users/me/consent');
    },
    async updateConsent(data: UpdateConsentPreferencesRequest): Promise<{
      preferences: Record<string, boolean | null>;
      updated: number;
    }> {
      const validated = updateConsentPreferencesRequestSchema.parse(data);
      return request<{
        preferences: Record<string, boolean | null>;
        updated: number;
      }>('/users/me/consent/update', {
        method: 'PATCH',
        body: JSON.stringify(validated),
      });
    },
    async requestDataExport(format: DataExportFormat = 'json'): Promise<{
      exportRequest: Record<string, unknown>;
    }> {
      return request<{ exportRequest: Record<string, unknown> }>('/users/me/export', {
        method: 'POST',
        body: JSON.stringify({ format }),
      });
    },
    async getDataExportStatus(
      requestId: string,
    ): Promise<{ exportRequest: Record<string, unknown> }> {
      return request<{ exportRequest: Record<string, unknown> }>(
        `/users/me/export/${requestId}/status`,
      );
    },
    async downloadDataExport(requestId: string): Promise<DataExportDownload> {
      // The download can be JSON or CSV depending on the stored request format,
      // so we read the raw Response and branch on its content type instead of
      // assuming JSON (the shared `request` helper always parses JSON).
      const headers = new Headers();
      const token = config.getToken?.();
      if (token !== null && token !== undefined && token !== '') {
        headers.set('Authorization', `Bearer ${token}`);
      }
      const url = `${baseUrl}${API_PREFIX}/users/me/export/${requestId}/download`;

      let response: Response;
      try {
        response = await fetcher(url, { headers, credentials: 'include' });
      } catch (error: unknown) {
        const original = error instanceof Error ? error : new Error(String(error));
        throw new NetworkError(
          `Failed to fetch GET /users/me/export/${requestId}/download`,
          original,
        ) as Error;
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiErrorBody;
        throw createApiError(response.status, data);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/csv')) {
        return { format: 'csv', content: await response.text() };
      }

      const data = (await response.json().catch(() => ({}))) as { export?: unknown };
      const exportData =
        data.export !== null && typeof data.export === 'object'
          ? (data.export as Record<string, unknown>)
          : {};
      return { format: 'json', export: exportData };
    },
    async listFiles(): Promise<FilesListResponse> {
      return request('/files');
    },
    async uploadFile(formData: FormData): Promise<FileUploadResponse> {
      return requestMultipart<FileUploadResponse>('/files/upload', formData);
    },
    async deleteFile(fileId: string): Promise<FileDeleteResponse> {
      return request(`/files/${fileId}/delete`, { method: 'POST' });
    },
    async downloadFile(fileId: string): Promise<FileDownloadResponse> {
      return request(`/files/${fileId}/download`);
    },
    async evaluateFeatureFlags(tenantId?: string): Promise<{ flags: Record<string, boolean> }> {
      const query = tenantId !== undefined ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
      return request<{ flags: Record<string, boolean> }>(`/feature-flags/evaluate${query}`);
    },
    async listTenantFeatureOverrides(tenantId: string): Promise<TenantFeatureOverridesResponse> {
      return request<TenantFeatureOverridesResponse>(
        `/admin/tenants/${tenantId}/feature-overrides`,
      );
    },
    async setTenantFeatureOverride(
      tenantId: string,
      key: string,
      data: SetTenantFeatureOverrideRequest,
    ): Promise<TenantFeatureOverrideResponse> {
      return request<TenantFeatureOverrideResponse>(
        `/admin/tenants/${tenantId}/feature-overrides/${key}`,
        {
          method: 'PUT',
          body: JSON.stringify(data),
        },
      );
    },
    async deleteTenantFeatureOverride(
      tenantId: string,
      key: string,
    ): Promise<TenantFeatureOverrideDeleteResponse> {
      return request<TenantFeatureOverrideDeleteResponse>(
        `/admin/tenants/${tenantId}/feature-overrides/${key}/delete`,
        {
          method: 'POST',
        },
      );
    },
    async startImpersonation(userId: string): Promise<ImpersonationResponse> {
      return request<ImpersonationResponse>(`/admin/impersonate/${userId}`, {
        method: 'POST',
      });
    },
    async endImpersonation(targetUserId: string): Promise<EndImpersonationResponse> {
      return request<EndImpersonationResponse>('/admin/impersonate/end', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
    },
    async hardBanAdminUser(userId: string, reason: string): Promise<Record<string, unknown>> {
      return request(`/admin/users/${userId}/hard-ban`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    },
    async publishLegalDocument(data: Record<string, unknown>): Promise<Record<string, unknown>> {
      return request('/admin/legal/publish', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    async listActivities(): Promise<Record<string, unknown>> {
      return request('/activities');
    },
    async getCurrentLegalDocument(): Promise<Record<string, unknown>> {
      return request('/legal/current');
    },
    async getUserAgreements(): Promise<Record<string, unknown>> {
      return request('/users/me/agreements');
    },
    async login(
      data: LoginRequest,
    ): Promise<LoginSuccessResponse | TotpLoginChallengeResponse | SmsLoginChallengeResponse> {
      return request(
        '/auth/login',
        { method: 'POST', body: JSON.stringify(data) },
        {
          parse(
            value: unknown,
          ): LoginSuccessResponse | TotpLoginChallengeResponse | SmsLoginChallengeResponse {
            return parseLoginResponse(value) as
              | LoginSuccessResponse
              | TotpLoginChallengeResponse
              | SmsLoginChallengeResponse;
          },
        },
      );
    },
    async register(data: RegisterRequest): Promise<RegisterResponse> {
      return request<RegisterResponse>(
        '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        registerResponseSchema,
      );
    },
    async refresh(): Promise<RefreshResponse> {
      return request<RefreshResponse>(
        '/auth/refresh',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        refreshResponseSchema,
      );
    },
    async logout(): Promise<LogoutResponse> {
      return request<LogoutResponse>(
        '/auth/logout',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        logoutResponseSchema,
      );
    },
    async logoutAll(): Promise<LogoutResponse> {
      return request<LogoutResponse>(
        '/auth/logout-all',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        logoutResponseSchema,
      );
    },
    async getCurrentUser(): Promise<User> {
      return request<User>('/users/me', undefined, { parse: parseUserResponse });
    },
    async forgotPassword(data: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
      return request<ForgotPasswordResponse>(
        '/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        forgotPasswordResponseSchema,
      );
    },
    async resetPassword(data: ResetPasswordRequest): Promise<ResetPasswordResponse> {
      return request<ResetPasswordResponse>(
        '/auth/reset-password',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        resetPasswordResponseSchema,
      );
    },
    async setPassword(data: SetPasswordRequest): Promise<SetPasswordResponse> {
      return request<SetPasswordResponse>(
        '/auth/set-password',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        setPasswordResponseSchema,
      );
    },
    async verifyEmail(data: EmailVerificationRequest): Promise<EmailVerificationResponse> {
      return request<EmailVerificationResponse>(
        '/auth/verify-email',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        emailVerificationResponseSchema,
      );
    },
    async resendVerification(data: ResendVerificationRequest): Promise<ResendVerificationResponse> {
      return request<ResendVerificationResponse>(
        '/auth/resend-verification',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        resendVerificationResponseSchema,
      );
    },
    async getTosStatus(): Promise<{
      accepted: boolean;
      requiredVersion: number | null;
      documentId: string | null;
    }> {
      return request('/auth/tos/status', undefined, tosStatusResponseSchema);
    },
    // TOTP methods
    async totpSetup(): Promise<TotpSetupResponse> {
      return request<TotpSetupResponse>(
        '/auth/totp/setup',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        totpSetupResponseSchema,
      );
    },
    async totpEnable(data: TotpVerifyRequest): Promise<TotpVerifyResponse> {
      return request<TotpVerifyResponse>(
        '/auth/totp/enable',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        totpVerifyResponseSchema,
      );
    },
    async totpDisable(data: TotpVerifyRequest): Promise<TotpVerifyResponse> {
      return request<TotpVerifyResponse>(
        '/auth/totp/disable',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        totpVerifyResponseSchema,
      );
    },
    async totpStatus(): Promise<TotpStatusResponse> {
      return request<TotpStatusResponse>('/auth/totp/status', undefined, totpStatusResponseSchema);
    },
    async backupCodesStatus(): Promise<BackupCodesStatusResponse> {
      return request<BackupCodesStatusResponse>(
        '/auth/backup-codes/status',
        undefined,
        backupCodesStatusResponseSchema,
      );
    },
    async regenerateBackupCodes(data: TotpVerifyRequest): Promise<BackupCodesRegenerateResponse> {
      return request<BackupCodesRegenerateResponse>(
        '/auth/backup-codes/regenerate',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        backupCodesRegenerateResponseSchema,
      );
    },
    async totpVerifyLogin(data: TotpLoginVerifyRequest): Promise<AuthResponse> {
      return request<AuthResponse>(
        '/auth/totp/verify-login',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        authResponseSchema,
      );
    },
    // SMS 2FA methods
    async smsSendCode(data: { challengeToken: string }): Promise<{ message: string }> {
      return request<{ message: string }>(
        '/auth/sms/send',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        totpVerifyResponseSchema,
      );
    },
    async smsVerifyLogin(data: { challengeToken: string; code: string }): Promise<AuthResponse> {
      return request<AuthResponse>(
        '/auth/sms/verify',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        authResponseSchema,
      );
    },
    // Magic link methods
    async magicLinkRequest(data: MagicLinkRequest): Promise<MagicLinkRequestResponse> {
      return request<MagicLinkRequestResponse>(
        '/auth/magic-link/request',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        magicLinkRequestResponseSchema,
      );
    },
    async magicLinkVerify(data: MagicLinkVerifyRequest): Promise<MagicLinkVerifyResponse> {
      return request<MagicLinkVerifyResponse>(
        '/auth/magic-link/verify',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        magicLinkVerifyResponseSchema,
      );
    },
    // Email OTP methods
    async emailOtpRequest(data: EmailOtpRequest): Promise<EmailOtpRequestResponse> {
      return request<EmailOtpRequestResponse>(
        '/auth/otp/request',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        emailOtpRequestResponseSchema,
      );
    },
    async emailOtpVerify(data: EmailOtpVerifyRequest): Promise<EmailOtpVerifyResponse> {
      return request<EmailOtpVerifyResponse>(
        '/auth/otp/verify',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        emailOtpVerifyResponseSchema,
      );
    },
    async completeOnboarding(data: CompleteOnboardingRequest): Promise<CompleteOnboardingResponse> {
      return request<CompleteOnboardingResponse>(
        '/auth/onboarding/complete',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        completeOnboardingResponseSchema,
      );
    },
    // Email change methods
    async changeEmail(data: ChangeEmailRequest): Promise<ChangeEmailResponse> {
      return request<ChangeEmailResponse>(
        '/auth/change-email',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        changeEmailResponseSchema,
      );
    },
    async confirmEmailChange(data: ConfirmEmailChangeRequest): Promise<ConfirmEmailChangeResponse> {
      return request<ConfirmEmailChangeResponse>(
        '/auth/change-email/confirm',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        confirmEmailChangeResponseSchema,
      );
    },
    async revertEmailChange(data: RevertEmailChangeRequest): Promise<RevertEmailChangeResponse> {
      return request<RevertEmailChangeResponse>(
        '/auth/change-email/revert',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        revertEmailChangeResponseSchema,
      );
    },
    // OAuth methods
    async getAuthStrategies(): Promise<{
      enabled: AuthStrategy[];
      disabled: AuthStrategy[];
    }> {
      return request('/auth/strategies', undefined, authStrategiesResponseSchema);
    },
    async getEnabledOAuthProviders(): Promise<OAuthEnabledProvidersResponse> {
      return request('/auth/oauth/providers', undefined, oauthEnabledProvidersResponseSchema);
    },
    async getOAuthConnections(): Promise<OAuthConnectionsResponse> {
      return request('/auth/oauth/connections', undefined, oauthConnectionsResponseSchema);
    },
    async linkOAuthProvider(provider: OAuthProvider): Promise<OAuthLinkResponse> {
      // OAuthProvider is already a string literal union type
      const providerStr = provider as string;
      return request<OAuthLinkResponse>(
        `/auth/oauth/${providerStr}/link`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        oauthLinkResponseSchema,
      );
    },
    async unlinkOAuthProvider(provider: OAuthProvider): Promise<OAuthUnlinkResponse> {
      // OAuthProvider is already a string literal union type
      const providerStr = provider as string;
      return request<OAuthUnlinkResponse>(
        `/auth/oauth/${providerStr}/unlink`,
        {
          method: 'DELETE',
        },
        oauthUnlinkResponseSchema,
      );
    },
    getOAuthLoginUrl(provider: OAuthProvider): string {
      // This returns a URL the browser should navigate to (redirect)
      const providerStr = provider as string;
      return `${baseUrl}${API_PREFIX}/auth/oauth/${providerStr}`;
    },
    getOAuthLinkUrl(provider: OAuthProvider): string {
      // This returns the link initiation endpoint - must be called with auth
      const providerStr = provider as string;
      return `${baseUrl}${API_PREFIX}/auth/oauth/${providerStr}/link`;
    },
    // WebAuthn/Passkey methods
    async webauthnRegisterOptions(): Promise<{
      options: Record<string, unknown>;
    }> {
      return request<{ options: Record<string, unknown> }>(
        '/auth/webauthn/register/options',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        {
          parse(value: unknown): { options: Record<string, unknown> } {
            if (value === null || typeof value !== 'object') {
              throw new Error('Invalid WebAuthn options response');
            }
            const obj = value as Record<string, unknown>;
            if (obj['options'] === null || typeof obj['options'] !== 'object') {
              throw new Error('Invalid WebAuthn options payload');
            }
            return { options: obj['options'] as Record<string, unknown> };
          },
        },
      );
    },
    async webauthnRegisterVerify(data: {
      credential: Record<string, unknown>;
      name?: string;
    }): Promise<{ credentialId: string; message: string }> {
      return request<{ credentialId: string; message: string }>(
        '/auth/webauthn/register/verify',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        {
          parse(value: unknown): { credentialId: string; message: string } {
            if (value === null || typeof value !== 'object') {
              throw new Error('Invalid WebAuthn verify response');
            }
            const obj = value as Record<string, unknown>;
            if (typeof obj['credentialId'] !== 'string' || typeof obj['message'] !== 'string') {
              throw new Error('Invalid WebAuthn verify payload');
            }
            return {
              credentialId: obj['credentialId'],
              message: obj['message'],
            };
          },
        },
      );
    },
    async webauthnLoginOptions(email?: string): Promise<{ options: Record<string, unknown> }> {
      return request<{ options: Record<string, unknown> }>(
        '/auth/webauthn/login/options',
        {
          method: 'POST',
          body: JSON.stringify(email !== undefined ? { email } : {}),
        },
        {
          parse(value: unknown): { options: Record<string, unknown> } {
            if (value === null || typeof value !== 'object') {
              throw new Error('Invalid WebAuthn options response');
            }
            const obj = value as Record<string, unknown>;
            if (obj['options'] === null || typeof obj['options'] !== 'object') {
              throw new Error('Invalid WebAuthn options payload');
            }
            return { options: obj['options'] as Record<string, unknown> };
          },
        },
      );
    },
    async webauthnLoginVerify(data: {
      credential: Record<string, unknown>;
      sessionKey: string;
    }): Promise<AuthResponse> {
      return request<AuthResponse>(
        '/auth/webauthn/login/verify',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
        authResponseSchema,
      );
    },
    async listPasskeys(): Promise<PasskeyListItem[]> {
      return request<PasskeyListItem[]>('/users/me/passkeys', undefined, {
        parse(value: unknown): PasskeyListItem[] {
          if (!Array.isArray(value)) {
            throw new Error('Invalid passkey list response');
          }
          return value.map((item) => {
            if (item === null || typeof item !== 'object') {
              throw new Error('Invalid passkey item');
            }
            const obj = item as Record<string, unknown>;
            if (
              typeof obj['id'] !== 'string' ||
              typeof obj['name'] !== 'string' ||
              (obj['deviceType'] !== null && typeof obj['deviceType'] !== 'string') ||
              typeof obj['backedUp'] !== 'boolean' ||
              typeof obj['createdAt'] !== 'string' ||
              (obj['lastUsedAt'] !== null && typeof obj['lastUsedAt'] !== 'string')
            ) {
              throw new Error('Invalid passkey item fields');
            }
            return {
              id: obj['id'],
              name: obj['name'],
              deviceType: obj['deviceType'],
              backedUp: obj['backedUp'],
              createdAt: obj['createdAt'],
              lastUsedAt: obj['lastUsedAt'],
            };
          });
        },
      });
    },
    async renamePasskey(id: string, name: string): Promise<{ message: string }> {
      return request<{ message: string }>(
        `/users/me/passkeys/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        },
        totpVerifyResponseSchema,
      );
    },
    async deletePasskey(id: string): Promise<{ message: string }> {
      return request<{ message: string }>(
        `/users/me/passkeys/${id}/delete`,
        {
          method: 'DELETE',
        },
        totpVerifyResponseSchema,
      );
    },
  };
}
