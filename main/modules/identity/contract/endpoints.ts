// main/modules/identity/contract/endpoints.ts
import { emptyBodySchema, endpoint } from '@bslt/contract';
import { object, string } from '@bslt/schema';

import { identityErrors } from './errors';
import {
  accountLifecycleResponseSchema,
  adminCreateUserRequestSchema,
  adminDeleteUserRequestSchema,
  adminForceLogoutRequestSchema,
  adminForceLogoutResponseSchema,
  adminHardBanRequestSchema,
  adminHardBanResponseSchema,
  adminLockUserRequestSchema,
  adminMessageResponseSchema,
  adminResetPasswordRequestSchema,
  adminUpdateUserRequestSchema,
  adminUpdateUserResponseSchema,
  adminUserListFiltersSchema,
  adminUserListResponseSchema,
  adminUserSchema,
  adminUserSearchQuerySchema,
  adminUserSearchResponseSchema,
  apiKeysListResponseSchema,
  authResponseSchema,
  authStrategiesResponseSchema,
  backupCodesRegenerateResponseSchema,
  backupCodesStatusResponseSchema,
  changeEmailRequestSchema,
  changeEmailResponseSchema,
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  completeOnboardingRequestSchema,
  completeOnboardingResponseSchema,
  confirmEmailChangeRequestSchema,
  confirmEmailChangeResponseSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  deactivateAccountRequestSchema,
  deleteAccountRequestSchema,
  deleteApiKeyResponseSchema,
  deviceListResponseSchema,
  emailOtpRequestResponseSchema,
  emailOtpRequestSchema,
  emailOtpVerifyRequestSchema,
  emailOtpVerifyResponseSchema,
  emailVerificationRequestSchema,
  emailVerificationResponseSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  invalidateSessionsResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  magicLinkRequestResponseSchema,
  magicLinkRequestSchema,
  magicLinkVerifyRequestSchema,
  magicLinkVerifyResponseSchema,
  oauthCallbackQuerySchema,
  oauthCallbackResponseSchema,
  oauthConnectionsResponseSchema,
  oauthEnabledProvidersResponseSchema,
  oauthInitiateQuerySchema,
  oauthInitiateResponseSchema,
  oauthLinkResponseSchema,
  oauthUnlinkResponseSchema,
  passkeyListResponseSchema,
  profileCompletenessResponseSchema,
  refreshResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  removePhoneResponseSchema,
  renamePasskeyRequestSchema,
  resendVerificationRequestSchema,
  resendVerificationResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  revertEmailChangeRequestSchema,
  revertEmailChangeResponseSchema,
  revokeAllSessionsResponseSchema,
  revokeSessionResponseSchema,
  sessionsListResponseSchema,
  setPasswordRequestSchema,
  setPasswordResponseSchema,
  setPhoneRequestSchema,
  setPhoneResponseSchema,
  smsChallengeRequestSchema,
  smsVerifyRequestSchema,
  sudoRequestSchema,
  sudoResponseSchema,
  totpLoginVerifyRequestSchema,
  totpSetupResponseSchema,
  totpStatusResponseSchema,
  totpVerifyRequestSchema,
  totpVerifyResponseSchema,
  trustDeviceResponseSchema,
  unlockAccountRequestSchema,
  updateProfileRequestSchema,
  updateUsernameRequestSchema,
  updateUsernameResponseSchema,
  userSchema,
  verifyPhoneRequestSchema,
  verifyPhoneResponseSchema,
  webauthnLoginOptionsRequestSchema,
  webauthnLoginVerifyRequestSchema,
  webauthnOptionsResponseSchema,
  webauthnRegisterVerifyRequestSchema,
  webauthnRegisterVerifyResponseSchema,
} from './schemas';

const idParamSchema = object({ id: string({ min: 1 }) });

export const identityEndpoints = {
  // ============================================================================
  // Core Auth, Passwordless & Email Change (`/api/auth*`)
  // ============================================================================

  register: endpoint({
    method: 'POST',
    path: '/api/auth/register',
    auth: 'public',
    summary: 'Register a new user - sends verification email',
    body: registerRequestSchema,
    response: registerResponseSchema,
    errors: [
      identityErrors.LOCAL_AUTH_DISABLED,
      identityErrors.SIGNUP_CONSENT_REQUIRED,
      identityErrors.ELIGIBILITY_ATTESTATION_REQUIRED,
      identityErrors.CAPTCHA_VERIFICATION_FAILED,
      identityErrors.RESERVED_EMAIL_DOMAIN,
      identityErrors.USERNAME_TAKEN,
      identityErrors.WEAK_PASSWORD,
    ],
  }),

  login: endpoint({
    method: 'POST',
    path: '/api/auth/login',
    auth: 'public',
    summary: 'Login an existing user (returns 202 if 2FA challenge is required)',
    body: loginRequestSchema,
    response: loginResponseSchema,
    errors: [
      identityErrors.LOCAL_AUTH_DISABLED,
      identityErrors.CAPTCHA_VERIFICATION_FAILED,
      identityErrors.ACCOUNT_LOCKED,
      identityErrors.TOO_MANY_ATTEMPTS,
      identityErrors.INVALID_CREDENTIALS,
      identityErrors.EMAIL_NOT_VERIFIED,
    ],
  }),

  refresh: endpoint({
    method: 'POST',
    path: '/api/auth/refresh',
    auth: 'public',
    summary: 'Refresh access token using refresh token cookie',
    body: emptyBodySchema,
    response: refreshResponseSchema,
    errors: [identityErrors.NO_REFRESH_TOKEN, identityErrors.INVALID_TOKEN],
  }),

  logout: endpoint({
    method: 'POST',
    path: '/api/auth/logout',
    auth: 'public',
    summary: 'Logout and invalidate refresh token',
    body: emptyBodySchema,
    response: logoutResponseSchema,
  }),

  authStrategies: endpoint({
    method: 'GET',
    path: '/api/auth/strategies',
    auth: 'public',
    summary: 'Get enabled and disabled authentication strategies',
    response: authStrategiesResponseSchema,
  }),

  verifyEmail: endpoint({
    method: 'POST',
    path: '/api/auth/verify-email',
    auth: 'public',
    summary: 'Verify email with a token - auto-logs in user',
    body: emailVerificationRequestSchema,
    response: emailVerificationResponseSchema,
    errors: [identityErrors.LOCAL_AUTH_DISABLED, identityErrors.INVALID_TOKEN],
  }),

  resendVerification: endpoint({
    method: 'POST',
    path: '/api/auth/resend-verification',
    auth: 'public',
    summary: 'Resend verification email to unverified user',
    body: resendVerificationRequestSchema,
    response: resendVerificationResponseSchema,
    errors: [identityErrors.LOCAL_AUTH_DISABLED, identityErrors.EMAIL_SEND_FAILED],
  }),

  forgotPassword: endpoint({
    method: 'POST',
    path: '/api/auth/forgot-password',
    auth: 'public',
    summary: 'Request password reset',
    body: forgotPasswordRequestSchema,
    response: forgotPasswordResponseSchema,
    errors: [identityErrors.LOCAL_AUTH_DISABLED, identityErrors.CAPTCHA_VERIFICATION_FAILED],
  }),

  resetPassword: endpoint({
    method: 'POST',
    path: '/api/auth/reset-password',
    auth: 'public',
    summary: 'Reset password with token',
    body: resetPasswordRequestSchema,
    response: resetPasswordResponseSchema,
    errors: [
      identityErrors.LOCAL_AUTH_DISABLED,
      identityErrors.INVALID_TOKEN,
      identityErrors.WEAK_PASSWORD,
    ],
  }),

  setPassword: endpoint({
    method: 'POST',
    path: '/api/auth/set-password',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Set password for first time (passwordless accounts)',
    body: setPasswordRequestSchema,
    response: setPasswordResponseSchema,
    errors: [
      identityErrors.LOCAL_AUTH_DISABLED,
      identityErrors.INVALID_CREDENTIALS,
      identityErrors.PASSWORD_ALREADY_SET,
      identityErrors.WEAK_PASSWORD,
    ],
  }),

  magicLinkRequest: endpoint({
    method: 'POST',
    path: '/api/auth/magic-link/request',
    auth: 'public',
    summary: 'Request a magic link for passwordless login',
    body: magicLinkRequestSchema,
    response: magicLinkRequestResponseSchema,
    errors: [identityErrors.MAGIC_LINK_DISABLED, identityErrors.TOO_MANY_ATTEMPTS],
  }),

  magicLinkVerify: endpoint({
    method: 'POST',
    path: '/api/auth/magic-link/verify',
    auth: 'public',
    summary: 'Verify magic link token and login',
    body: magicLinkVerifyRequestSchema,
    response: magicLinkVerifyResponseSchema,
    errors: [
      identityErrors.MAGIC_LINK_DISABLED,
      identityErrors.ACCOUNT_LOCKED,
      identityErrors.ELIGIBILITY_ATTESTATION_REQUIRED,
      identityErrors.SIGNUP_CONSENT_REQUIRED,
      identityErrors.INVALID_TOKEN,
    ],
  }),

  emailOtpRequest: endpoint({
    method: 'POST',
    path: '/api/auth/otp/request',
    auth: 'public',
    summary: 'Request a 6-digit security code for passwordless login',
    body: emailOtpRequestSchema,
    response: emailOtpRequestResponseSchema,
    errors: [identityErrors.MAGIC_LINK_DISABLED, identityErrors.TOO_MANY_ATTEMPTS],
  }),

  emailOtpVerify: endpoint({
    method: 'POST',
    path: '/api/auth/otp/verify',
    auth: 'public',
    summary: 'Verify a 6-digit security code and login',
    body: emailOtpVerifyRequestSchema,
    response: emailOtpVerifyResponseSchema,
    errors: [
      identityErrors.MAGIC_LINK_DISABLED,
      identityErrors.ACCOUNT_LOCKED,
      identityErrors.ELIGIBILITY_ATTESTATION_REQUIRED,
      identityErrors.SIGNUP_CONSENT_REQUIRED,
      identityErrors.INVALID_TOKEN,
    ],
  }),

  completeOnboarding: endpoint({
    method: 'POST',
    path: '/api/auth/onboarding/complete',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Complete profile for a new passwordless user (name, username, password)',
    body: completeOnboardingRequestSchema,
    response: completeOnboardingResponseSchema,
    errors: [
      identityErrors.INVALID_CREDENTIALS,
      identityErrors.ONBOARDING_ALREADY_COMPLETE,
      identityErrors.USERNAME_TAKEN,
      identityErrors.WEAK_PASSWORD,
    ],
    invalidates: ['me', 'getProfileCompleteness'],
  }),

  changeEmail: endpoint({
    method: 'POST',
    path: '/api/auth/change-email',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Initiate email change - sends verification to new email',
    body: changeEmailRequestSchema,
    response: changeEmailResponseSchema,
    errors: [identityErrors.RESERVED_EMAIL_DOMAIN, identityErrors.INVALID_CREDENTIALS],
  }),

  confirmEmailChange: endpoint({
    method: 'POST',
    path: '/api/auth/change-email/confirm',
    auth: 'public',
    summary: 'Confirm email change with verification token',
    body: confirmEmailChangeRequestSchema,
    response: confirmEmailChangeResponseSchema,
    errors: [identityErrors.INVALID_TOKEN],
    invalidates: ['me'],
  }),

  revertEmailChange: endpoint({
    method: 'POST',
    path: '/api/auth/change-email/revert',
    auth: 'public',
    summary: 'Revert email change with reversion token',
    body: revertEmailChangeRequestSchema,
    response: revertEmailChangeResponseSchema,
    errors: [identityErrors.INVALID_TOKEN],
  }),

  // ============================================================================
  // API Keys (`/api/api-keys*`)
  // ============================================================================

  listApiKeys: endpoint({
    method: 'GET',
    path: '/api/api-keys',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'List API keys for the authenticated user',
    response: apiKeysListResponseSchema,
  }),

  createApiKey: endpoint({
    method: 'POST',
    path: '/api/api-keys/create',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Create an API key (the plaintext token is returned once)',
    body: createApiKeyRequestSchema,
    response: createApiKeyResponseSchema,
    invalidates: ['listApiKeys'],
  }),

  deleteApiKey: endpoint({
    method: 'POST',
    path: '/api/api-keys/:id/delete',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Revoke an API key',
    params: idParamSchema,
    body: emptyBodySchema,
    response: deleteApiKeyResponseSchema,
    errors: [identityErrors.API_KEY_NOT_FOUND],
    invalidates: ['listApiKeys'],
  }),

  // ============================================================================
  // Self-Service User Profile, Sessions & Account Lifecycle (`/api/users/me*`)
  // ============================================================================

  me: endpoint({
    method: 'GET',
    path: '/api/users/me',
    auth: 'user',
    summary: 'Get the authenticated user profile (ToS-exempt for session hydration)',
    response: userSchema,
    errors: [identityErrors.USER_NOT_FOUND],
  }),

  getProfileCompleteness: endpoint({
    method: 'GET',
    path: '/api/users/me/profile-completeness',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Compute profile completeness percentage and missing fields',
    response: profileCompletenessResponseSchema,
    errors: [identityErrors.USER_NOT_FOUND],
  }),

  updateProfile: endpoint({
    method: 'PATCH',
    path: '/api/users/me/update',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Update authenticated user profile fields',
    body: updateProfileRequestSchema,
    response: userSchema,
    errors: [identityErrors.USER_NOT_FOUND, identityErrors.PROFILE_USERNAME_TAKEN],
    invalidates: ['me', 'getProfileCompleteness'],
  }),

  updateUsername: endpoint({
    method: 'PATCH',
    path: '/api/users/me/username',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Update authenticated user username (30-day cooldown)',
    body: updateUsernameRequestSchema,
    response: updateUsernameResponseSchema,
    errors: [
      identityErrors.USER_NOT_FOUND,
      identityErrors.USERNAME_COOLDOWN_ACTIVE,
      identityErrors.USERNAME_RESERVED,
      identityErrors.USERNAME_UNCHANGED,
      identityErrors.USERNAME_TAKEN,
    ],
    invalidates: ['me', 'getProfileCompleteness'],
  }),

  changePassword: endpoint({
    method: 'POST',
    path: '/api/users/me/password',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Change authenticated user password and revoke active sessions',
    body: changePasswordRequestSchema,
    response: changePasswordResponseSchema,
    errors: [
      identityErrors.USER_NOT_FOUND,
      identityErrors.PASSWORD_NOT_SET,
      identityErrors.INVALID_PASSWORD,
      identityErrors.WEAK_PASSWORD,
    ],
    invalidates: ['listSessions'],
  }),

  listSessions: endpoint({
    method: 'GET',
    path: '/api/users/me/sessions',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'List active sessions for the authenticated user',
    response: sessionsListResponseSchema,
  }),

  revokeSession: endpoint({
    method: 'DELETE',
    path: '/api/users/me/sessions/:id',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Revoke a non-current session by ID',
    params: idParamSchema,
    body: emptyBodySchema,
    response: revokeSessionResponseSchema,
    errors: [identityErrors.SESSION_NOT_FOUND],
    invalidates: ['listSessions'],
  }),

  revokeAllSessions: endpoint({
    method: 'POST',
    path: '/api/users/me/sessions/revoke-all',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Revoke all sessions except the current session',
    body: emptyBodySchema,
    response: revokeAllSessionsResponseSchema,
    invalidates: ['listSessions'],
  }),

  deactivateAccount: endpoint({
    method: 'POST',
    path: '/api/users/me/deactivate',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Deactivate account (requires X-Sudo-Token header)',
    body: deactivateAccountRequestSchema,
    response: accountLifecycleResponseSchema,
    errors: [
      identityErrors.USER_NOT_FOUND,
      identityErrors.SUDO_REQUIRED,
      identityErrors.SUDO_EXPIRED,
      identityErrors.SUDO_MISMATCH,
      identityErrors.LIFECYCLE_TRANSITION_INVALID,
    ],
    invalidates: ['me'],
  }),

  deleteAccount: endpoint({
    method: 'POST',
    path: '/api/users/me/delete',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Request account deletion with 30-day grace period (requires X-Sudo-Token header)',
    body: deleteAccountRequestSchema,
    response: accountLifecycleResponseSchema,
    errors: [
      identityErrors.USER_NOT_FOUND,
      identityErrors.SUDO_REQUIRED,
      identityErrors.SUDO_EXPIRED,
      identityErrors.SUDO_MISMATCH,
      identityErrors.LIFECYCLE_TRANSITION_INVALID,
    ],
    invalidates: ['me'],
  }),

  reactivateAccount: endpoint({
    method: 'POST',
    path: '/api/users/me/reactivate',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Reactivate a deactivated or pending-deletion account within the grace period',
    body: emptyBodySchema,
    response: accountLifecycleResponseSchema,
    errors: [identityErrors.USER_NOT_FOUND, identityErrors.LIFECYCLE_TRANSITION_INVALID],
    invalidates: ['me'],
  }),

  // ============================================================================
  // Administrative User Management (`/api/admin/users*`)
  // ============================================================================

  adminListUsers: endpoint({
    method: 'GET',
    path: '/api/admin/users',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'List users with filtering, sorting, and pagination',
    query: adminUserListFiltersSchema,
    response: adminUserListResponseSchema,
  }),

  adminSearchUsers: endpoint({
    method: 'GET',
    path: '/api/admin/users/search',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Search users across email, username, name, or UUID',
    query: adminUserSearchQuerySchema,
    response: adminUserSearchResponseSchema,
  }),

  adminGetUser: endpoint({
    method: 'GET',
    path: '/api/admin/users/:id',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Get administrative view of a single user by ID',
    params: idParamSchema,
    response: adminUserSchema,
    errors: [identityErrors.USER_NOT_FOUND],
  }),

  adminCreateUser: endpoint({
    method: 'POST',
    path: '/api/admin/users/create',
    auth: 'admin',
    requires: ['tos.accepted'],
    status: 201,
    summary: 'Create a user via invitation',
    body: adminCreateUserRequestSchema,
    response: adminUpdateUserResponseSchema,
    errors: [identityErrors.USER_ALREADY_EXISTS],
    invalidates: ['adminListUsers'],
  }),

  adminUpdateUser: endpoint({
    method: 'POST',
    path: '/api/admin/users/:id/update',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Update user name or role',
    params: idParamSchema,
    body: adminUpdateUserRequestSchema,
    response: adminUpdateUserResponseSchema,
    errors: [identityErrors.USER_NOT_FOUND],
    invalidates: ['adminListUsers', 'adminGetUser'],
  }),

  adminLockUser: endpoint({
    method: 'POST',
    path: '/api/admin/users/:id/lock',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Lock a user account with reason and optional duration',
    params: idParamSchema,
    body: adminLockUserRequestSchema,
    response: adminUpdateUserResponseSchema,
    errors: [identityErrors.USER_NOT_FOUND, identityErrors.SELF_LOCK_FORBIDDEN],
    invalidates: ['adminListUsers', 'adminGetUser'],
  }),

  adminUnlockUser: endpoint({
    method: 'POST',
    path: '/api/admin/users/:id/unlock',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Unlock a locked user account',
    params: idParamSchema,
    body: unlockAccountRequestSchema,
    response: adminUpdateUserResponseSchema,
    errors: [identityErrors.USER_NOT_FOUND],
    invalidates: ['adminListUsers', 'adminGetUser'],
  }),

  adminForceLogoutUser: endpoint({
    method: 'POST',
    path: '/api/admin/users/:id/force-logout',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Revoke all active sessions for a user without locking the account',
    params: idParamSchema,
    body: adminForceLogoutRequestSchema,
    response: adminForceLogoutResponseSchema,
    errors: [identityErrors.USER_NOT_FOUND],
    invalidates: ['adminGetUser'],
  }),

  adminHardBanUser: endpoint({
    method: 'POST',
    path: '/api/admin/users/:id/hard-ban',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Permanently ban a user, cancel subscriptions, and schedule deletion (requires sudo)',
    params: idParamSchema,
    body: adminHardBanRequestSchema,
    response: adminHardBanResponseSchema,
    errors: [
      identityErrors.USER_NOT_FOUND,
      identityErrors.SELF_BAN_FORBIDDEN,
      identityErrors.SUDO_REQUIRED,
      identityErrors.SUDO_EXPIRED,
      identityErrors.SUDO_MISMATCH,
    ],
    invalidates: ['adminListUsers', 'adminGetUser'],
  }),

  adminDeleteUser: endpoint({
    method: 'POST',
    path: '/api/admin/users/:id/delete',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Soft-delete and anonymize a user account (requires sudo)',
    params: idParamSchema,
    body: adminDeleteUserRequestSchema,
    response: adminMessageResponseSchema,
    errors: [
      identityErrors.USER_NOT_FOUND,
      identityErrors.SELF_DELETE_FORBIDDEN,
      identityErrors.SUDO_REQUIRED,
      identityErrors.SUDO_EXPIRED,
      identityErrors.SUDO_MISMATCH,
    ],
    invalidates: ['adminListUsers', 'adminGetUser'],
  }),

  adminResetUserPassword: endpoint({
    method: 'POST',
    path: '/api/admin/users/:id/reset-password',
    auth: 'admin',
    requires: ['tos.accepted'],
    summary: 'Trigger a password-reset link email for a user',
    params: idParamSchema,
    body: adminResetPasswordRequestSchema,
    response: adminMessageResponseSchema,
    errors: [identityErrors.USER_NOT_FOUND, identityErrors.EMAIL_SERVICE_UNAVAILABLE],
  }),

  // ============================================================================
  // Sudo, Session Invalidation & Global Logout
  // ============================================================================

  sudo: endpoint({
    method: 'POST',
    path: '/api/auth/sudo',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Enter sudo mode for privileged operations',
    body: sudoRequestSchema,
    response: sudoResponseSchema,
    errors: [
      identityErrors.USER_NOT_FOUND,
      identityErrors.INVALID_CREDENTIALS,
      identityErrors.SUDO_CREDENTIAL_REQUIRED,
      identityErrors.TOTP_NOT_ENABLED,
      identityErrors.TOTP_NOT_CONFIGURED,
      identityErrors.TOTP_INVALID_CODE,
    ],
  }),

  logoutAll: endpoint({
    method: 'POST',
    path: '/api/auth/logout-all',
    auth: 'user',
    summary: 'Logout from all sessions across all devices',
    body: emptyBodySchema,
    response: logoutResponseSchema,
    invalidates: ['listSessions'],
  }),

  invalidateSessions: endpoint({
    method: 'POST',
    path: '/api/auth/invalidate-sessions',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Invalidate all sessions and force re-authentication',
    body: emptyBodySchema,
    response: invalidateSessionsResponseSchema,
    invalidates: ['listSessions'],
  }),

  // ============================================================================
  // Trusted Devices (`/api/users/me/devices*`)
  // ============================================================================

  listDevices: endpoint({
    method: 'GET',
    path: '/api/users/me/devices',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'List trusted devices',
    response: deviceListResponseSchema,
  }),

  trustDevice: endpoint({
    method: 'POST',
    path: '/api/users/me/devices/:id/trust',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Trust a device',
    params: idParamSchema,
    body: emptyBodySchema,
    response: trustDeviceResponseSchema,
    errors: [identityErrors.DEVICE_NOT_FOUND],
    invalidates: ['listDevices'],
  }),

  revokeDevice: endpoint({
    method: 'DELETE',
    path: '/api/users/me/devices/:id',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Revoke a trusted device',
    params: idParamSchema,
    body: emptyBodySchema,
    response: totpVerifyResponseSchema,
    errors: [identityErrors.DEVICE_NOT_FOUND],
    invalidates: ['listDevices'],
  }),

  // ============================================================================
  // Phone Verification & SMS 2FA
  // ============================================================================

  setPhone: endpoint({
    method: 'POST',
    path: '/api/users/me/phone',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Set phone number and send verification code',
    body: setPhoneRequestSchema,
    response: setPhoneResponseSchema,
    errors: [
      identityErrors.INVALID_PHONE_NUMBER,
      identityErrors.SMS_RATE_LIMIT,
      identityErrors.SMS_SERVICE_UNAVAILABLE,
      identityErrors.SMS_SEND_FAILED,
    ],
  }),

  verifyPhone: endpoint({
    method: 'POST',
    path: '/api/users/me/phone/verify',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Verify phone number',
    body: verifyPhoneRequestSchema,
    response: verifyPhoneResponseSchema,
    errors: [identityErrors.SMS_VERIFICATION_FAILED, identityErrors.PHONE_VERIFICATION_PENDING],
    invalidates: ['me', 'getProfileCompleteness'],
  }),

  removePhone: endpoint({
    method: 'DELETE',
    path: '/api/users/me/phone/delete',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Remove phone number',
    body: emptyBodySchema,
    response: removePhoneResponseSchema,
    invalidates: ['me', 'getProfileCompleteness'],
  }),

  smsSendCode: endpoint({
    method: 'POST',
    path: '/api/auth/sms/send',
    auth: 'public',
    summary: 'Send SMS verification code for login challenge',
    body: smsChallengeRequestSchema,
    response: totpVerifyResponseSchema,
    errors: [
      identityErrors.CHALLENGE_TOKEN_INVALID,
      identityErrors.PHONE_NOT_VERIFIED,
      identityErrors.SMS_RATE_LIMIT,
      identityErrors.SMS_SERVICE_UNAVAILABLE,
      identityErrors.SMS_SEND_FAILED,
    ],
  }),

  smsVerifyCode: endpoint({
    method: 'POST',
    path: '/api/auth/sms/verify',
    auth: 'public',
    summary: 'Verify SMS code for login challenge',
    body: smsVerifyRequestSchema,
    response: authResponseSchema,
    errors: [identityErrors.CHALLENGE_TOKEN_INVALID, identityErrors.SMS_CODE_INVALID],
  }),

  // ============================================================================
  // MFA / TOTP & Backup Codes
  // ============================================================================

  totpSetup: endpoint({
    method: 'POST',
    path: '/api/auth/totp/setup',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Generate TOTP secret and backup codes for 2FA setup',
    body: emptyBodySchema,
    response: totpSetupResponseSchema,
  }),

  totpEnable: endpoint({
    method: 'POST',
    path: '/api/auth/totp/enable',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Verify TOTP code and enable 2FA',
    body: totpVerifyRequestSchema,
    response: totpVerifyResponseSchema,
    errors: [identityErrors.TOTP_ENABLE_FAILED],
    invalidates: ['totpStatus', 'backupCodesStatus'],
  }),

  totpDisable: endpoint({
    method: 'POST',
    path: '/api/auth/totp/disable',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Disable 2FA by verifying current TOTP code',
    body: totpVerifyRequestSchema,
    response: totpVerifyResponseSchema,
    errors: [identityErrors.TOTP_DISABLE_FAILED],
    invalidates: ['totpStatus', 'backupCodesStatus'],
  }),

  totpStatus: endpoint({
    method: 'GET',
    path: '/api/auth/totp/status',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Check if 2FA is enabled for current user',
    response: totpStatusResponseSchema,
  }),

  backupCodesStatus: endpoint({
    method: 'GET',
    path: '/api/auth/backup-codes/status',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Check remaining TOTP backup codes for current user',
    response: backupCodesStatusResponseSchema,
  }),

  backupCodesRegenerate: endpoint({
    method: 'POST',
    path: '/api/auth/backup-codes/regenerate',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Regenerate TOTP backup codes',
    body: totpVerifyRequestSchema,
    response: backupCodesRegenerateResponseSchema,
    errors: [identityErrors.BACKUP_CODES_REGENERATE_FAILED],
    invalidates: ['backupCodesStatus'],
  }),

  totpVerifyLogin: endpoint({
    method: 'POST',
    path: '/api/auth/totp/verify-login',
    auth: 'public',
    summary: 'Verify TOTP code during login challenge',
    body: totpLoginVerifyRequestSchema,
    response: authResponseSchema,
    errors: [
      identityErrors.CHALLENGE_TOKEN_INVALID,
      identityErrors.TOO_MANY_ATTEMPTS,
      identityErrors.TOTP_INVALID_CODE,
    ],
  }),

  // ============================================================================
  // WebAuthn & Passkeys
  // ============================================================================

  webauthnRegisterOptions: endpoint({
    method: 'POST',
    path: '/api/auth/webauthn/register/options',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Generate WebAuthn registration options',
    body: emptyBodySchema,
    response: webauthnOptionsResponseSchema,
    errors: [identityErrors.WEBAUTHN_DISABLED, identityErrors.WEBAUTHN_FAILED],
  }),

  webauthnRegisterVerify: endpoint({
    method: 'POST',
    path: '/api/auth/webauthn/register/verify',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Verify WebAuthn registration',
    body: webauthnRegisterVerifyRequestSchema,
    response: webauthnRegisterVerifyResponseSchema,
    errors: [identityErrors.WEBAUTHN_DISABLED, identityErrors.WEBAUTHN_FAILED],
    invalidates: ['listPasskeys'],
  }),

  webauthnLoginOptions: endpoint({
    method: 'POST',
    path: '/api/auth/webauthn/login/options',
    auth: 'public',
    summary: 'Generate WebAuthn login options',
    body: webauthnLoginOptionsRequestSchema,
    response: webauthnOptionsResponseSchema,
    errors: [identityErrors.WEBAUTHN_DISABLED, identityErrors.WEBAUTHN_FAILED],
  }),

  webauthnLoginVerify: endpoint({
    method: 'POST',
    path: '/api/auth/webauthn/login/verify',
    auth: 'public',
    summary: 'Verify WebAuthn login',
    body: webauthnLoginVerifyRequestSchema,
    response: authResponseSchema,
    errors: [
      identityErrors.WEBAUTHN_DISABLED,
      identityErrors.WEBAUTHN_FAILED,
      identityErrors.INVALID_CREDENTIALS,
    ],
  }),

  listPasskeys: endpoint({
    method: 'GET',
    path: '/api/users/me/passkeys',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'List passkeys',
    response: passkeyListResponseSchema,
    errors: [identityErrors.WEBAUTHN_DISABLED],
  }),

  renamePasskey: endpoint({
    method: 'PATCH',
    path: '/api/users/me/passkeys/:id',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Rename passkey',
    params: idParamSchema,
    body: renamePasskeyRequestSchema,
    response: totpVerifyResponseSchema,
    errors: [identityErrors.WEBAUTHN_DISABLED, identityErrors.PASSKEY_NOT_FOUND],
    invalidates: ['listPasskeys'],
  }),

  deletePasskey: endpoint({
    method: 'DELETE',
    path: '/api/users/me/passkeys/:id/delete',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Delete passkey',
    params: idParamSchema,
    body: emptyBodySchema,
    response: totpVerifyResponseSchema,
    errors: [identityErrors.WEBAUTHN_DISABLED, identityErrors.PASSKEY_NOT_FOUND],
    invalidates: ['listPasskeys'],
  }),

  // ============================================================================
  // OAuth 2.0 & Apple OIDC (`/api/auth/oauth/*`)
  // ============================================================================

  initiateGoogle: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/google',
    auth: 'public',
    summary: 'Initiate Google OAuth flow',
    query: oauthInitiateQuerySchema,
    response: oauthInitiateResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  initiateGithub: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/github',
    auth: 'public',
    summary: 'Initiate GitHub OAuth flow',
    query: oauthInitiateQuerySchema,
    response: oauthInitiateResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  initiateApple: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/apple',
    auth: 'public',
    summary: 'Initiate Apple OAuth flow',
    query: oauthInitiateQuerySchema,
    response: oauthInitiateResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  initiateKakao: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/kakao',
    auth: 'public',
    summary: 'Initiate Kakao OAuth flow',
    query: oauthInitiateQuerySchema,
    response: oauthInitiateResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  callbackGoogle: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/google/callback',
    auth: 'public',
    summary: 'Handle Google OAuth callback',
    query: oauthCallbackQuerySchema,
    response: oauthCallbackResponseSchema,
    errors: [
      identityErrors.OAUTH_NOT_CONFIGURED,
      identityErrors.OAUTH_FAILED,
      identityErrors.OAUTH_STATE_MISMATCH,
      identityErrors.OAUTH_EMAIL_EXISTS,
      identityErrors.OAUTH_ALREADY_LINKED,
      identityErrors.OAUTH_LINKED_TO_OTHER,
      identityErrors.SIGNUP_CONSENT_REQUIRED,
      identityErrors.ELIGIBILITY_ATTESTATION_REQUIRED,
    ],
  }),

  callbackGithub: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/github/callback',
    auth: 'public',
    summary: 'Handle GitHub OAuth callback',
    query: oauthCallbackQuerySchema,
    response: oauthCallbackResponseSchema,
    errors: [
      identityErrors.OAUTH_NOT_CONFIGURED,
      identityErrors.OAUTH_FAILED,
      identityErrors.OAUTH_STATE_MISMATCH,
      identityErrors.OAUTH_EMAIL_EXISTS,
      identityErrors.OAUTH_ALREADY_LINKED,
      identityErrors.OAUTH_LINKED_TO_OTHER,
      identityErrors.SIGNUP_CONSENT_REQUIRED,
      identityErrors.ELIGIBILITY_ATTESTATION_REQUIRED,
    ],
  }),

  callbackApple: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/apple/callback',
    auth: 'public',
    summary: 'Handle Apple OAuth callback',
    query: oauthCallbackQuerySchema,
    response: oauthCallbackResponseSchema,
    errors: [
      identityErrors.OAUTH_NOT_CONFIGURED,
      identityErrors.OAUTH_FAILED,
      identityErrors.OAUTH_STATE_MISMATCH,
      identityErrors.OAUTH_EMAIL_EXISTS,
      identityErrors.OAUTH_ALREADY_LINKED,
      identityErrors.OAUTH_LINKED_TO_OTHER,
      identityErrors.SIGNUP_CONSENT_REQUIRED,
      identityErrors.ELIGIBILITY_ATTESTATION_REQUIRED,
    ],
  }),

  callbackKakao: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/kakao/callback',
    auth: 'public',
    summary: 'Handle Kakao OAuth callback',
    query: oauthCallbackQuerySchema,
    response: oauthCallbackResponseSchema,
    errors: [
      identityErrors.OAUTH_NOT_CONFIGURED,
      identityErrors.OAUTH_FAILED,
      identityErrors.OAUTH_STATE_MISMATCH,
      identityErrors.OAUTH_EMAIL_EXISTS,
      identityErrors.OAUTH_ALREADY_LINKED,
      identityErrors.OAUTH_LINKED_TO_OTHER,
      identityErrors.SIGNUP_CONSENT_REQUIRED,
      identityErrors.ELIGIBILITY_ATTESTATION_REQUIRED,
    ],
  }),

  linkGoogle: endpoint({
    method: 'POST',
    path: '/api/auth/oauth/google/link',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Link Google account to authenticated user',
    body: emptyBodySchema,
    response: oauthLinkResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  linkGithub: endpoint({
    method: 'POST',
    path: '/api/auth/oauth/github/link',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Link GitHub account to authenticated user',
    body: emptyBodySchema,
    response: oauthLinkResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  linkApple: endpoint({
    method: 'POST',
    path: '/api/auth/oauth/apple/link',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Link Apple account to authenticated user',
    body: emptyBodySchema,
    response: oauthLinkResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  linkKakao: endpoint({
    method: 'POST',
    path: '/api/auth/oauth/kakao/link',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Link Kakao account to authenticated user',
    body: emptyBodySchema,
    response: oauthLinkResponseSchema,
    errors: [identityErrors.OAUTH_NOT_CONFIGURED],
  }),

  unlinkGoogle: endpoint({
    method: 'DELETE',
    path: '/api/auth/oauth/google/unlink',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Unlink Google account from authenticated user',
    body: emptyBodySchema,
    response: oauthUnlinkResponseSchema,
    errors: [identityErrors.OAUTH_CONNECTION_NOT_FOUND, identityErrors.CANNOT_UNLINK_ONLY_AUTH],
    invalidates: ['getConnections'],
  }),

  unlinkGithub: endpoint({
    method: 'DELETE',
    path: '/api/auth/oauth/github/unlink',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Unlink GitHub account from authenticated user',
    body: emptyBodySchema,
    response: oauthUnlinkResponseSchema,
    errors: [identityErrors.OAUTH_CONNECTION_NOT_FOUND, identityErrors.CANNOT_UNLINK_ONLY_AUTH],
    invalidates: ['getConnections'],
  }),

  unlinkApple: endpoint({
    method: 'DELETE',
    path: '/api/auth/oauth/apple/unlink',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Unlink Apple account from authenticated user',
    body: emptyBodySchema,
    response: oauthUnlinkResponseSchema,
    errors: [identityErrors.OAUTH_CONNECTION_NOT_FOUND, identityErrors.CANNOT_UNLINK_ONLY_AUTH],
    invalidates: ['getConnections'],
  }),

  unlinkKakao: endpoint({
    method: 'DELETE',
    path: '/api/auth/oauth/kakao/unlink',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Unlink Kakao account from authenticated user',
    body: emptyBodySchema,
    response: oauthUnlinkResponseSchema,
    errors: [identityErrors.OAUTH_CONNECTION_NOT_FOUND, identityErrors.CANNOT_UNLINK_ONLY_AUTH],
    invalidates: ['getConnections'],
  }),

  getConnections: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/connections',
    auth: 'user',
    requires: ['tos.accepted'],
    summary: 'Get OAuth connections for authenticated user',
    response: oauthConnectionsResponseSchema,
  }),

  getEnabledProviders: endpoint({
    method: 'GET',
    path: '/api/auth/oauth/providers',
    auth: 'public',
    summary: 'Get list of enabled OAuth providers',
    response: oauthEnabledProvidersResponseSchema,
  }),
} as const;
