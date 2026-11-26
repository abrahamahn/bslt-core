// main/modules/identity/server/index.ts
import {
  implementServer,
  type AnyServerModule,
  type KernelServices,
  type NotificationTemplate,
  type RequestContext,
  type Tx,
} from '@bslt/server-system/module';
import { getMetricsCollector } from '@bslt/server-system/observability';

import {
  AUTH_STRATEGIES,
  LOGIN_ATTEMPTS_RETENTION_DAYS,
  SESSIONS_RETENTION_DAYS,
  identityEvents,
  isAttestationConfirmed,
  sessionIdleWindowMs,
  sessionSpanDays,
  sessionSpanDaysOf,
  type AccountAlertPayload,
  type AuthStrategy,
  type OAuthCallbackQuery,
  type OAuthProvider,
  type SessionRevokedPayload,
  type User as ContractUser,
  type UserRegisteredPayload,
} from '../contract';
import { identityModule } from '../module';

import {
  ConsentedUserRefusalError,
  ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE,
  SIGNUP_CONSENT_REQUIRED_MESSAGE,
  authenticateUserInRepo,
  buildRotatedSessionAccessToken,
  completeOnboardingInRepo,
  confirmEmailChangeInRepo,
  createConsentedUserInRepo,
  createEmailVerificationTokenInRepo,
  enforcePostLoginSessionHygieneInRepo,
  generateDeviceFingerprint,
  generateStableDeviceFingerprint,
  generateUniqueUsernameInRepo,
  getProgressiveDelayInRepo,
  initiateEmailChangeInRepo,
  isAccountLockedInRepo,
  readValidatedDeviceIdHeader,
  registerUserInRepo,
  requestEmailOtpInRepo,
  requestMagicLinkInRepo,
  resendVerificationEmailInRepo,
  resetPasswordInRepo,
  revertEmailChangeInRepo,
  rotateRefreshTokenInRepo,
  setPasswordInRepo,
  splitFullName,
  verifyCaptchaToken,
  verifyEmailInRepo,
  verifyEmailOtpInRepo,
  verifyMagicLinkInRepo,
  verifyTurnstileToken,
  type CaptchaConfig,
  type CaptchaVerifyResult,
  type LockoutConfig,
  type SignupComplianceHooks,
} from './auth-flows';
import {
  DEFAULT_ARGON2_CONFIG,
  LIVENESS_TTL_MS,
  MIN_JWT_SECRET_LENGTH,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_BYTES,
  SUDO_TOKEN_HEADER,
  SUDO_TOKEN_TTL_MINUTES,
  canonicalizeEmail,
  clearLivenessCache,
  createAccessToken,
  createAuthEmailTemplates,
  createChallengeToken,
  createRefreshToken,
  createSudoToken,
  decryptToken,
  decryptTotpSecret,
  encryptToken,
  encryptTotpSecret,
  generateBase64UrlToken,
  generateNumericCode,
  generateSecureToken,
  getLiveness,
  getRefreshTokenExpiry,
  hashPassword,
  hashToken,
  hasPassword,
  initDummyHashPool,
  invalidateLiveness,
  isDummyHashPoolInitialized,
  isLegacyPlaintextSecret,
  needsRehash,
  normalizeEmail,
  parseUserAgentDeviceInfo,
  resetDummyHashPool,
  setLiveness,
  verifyChallengeToken,
  verifyPassword,
  verifyPasswordSafe,
  verifySudoToken,
  verifyToken,
  type Argon2Config,
  type AuthEmailTemplateOptions,
  type AuthEmailTemplates,
  type ChallengePurpose,
  type DeviceInfo,
  type EmailTemplateResult,
  type LivenessRecord,
  type TokenPayload,
} from './crypto';
import {
  assertUserActive,
  authGuardReposFromDb,
  createAuthGuard,
  createRequireAuth,
  createRequireRole,
  type AuthGuardRepositories,
} from './guard';
import {
  PHONE_REGEX,
  burnChallenge,
  checkSmsRateLimitInRepo,
  checkTotpVerifyRateLimit,
  disableTotpInRepo,
  enableTotpInRepo,
  getBackupCodesStatusInRepo,
  getTotpStatusInRepo,
  isChallengeBurned,
  regenerateBackupCodesInRepo,
  resetBurnedChallenges,
  resetTotpVerifyRateLimiter,
  sendSms2faCodeInRepo,
  setupTotpInRepo,
  verifyPhoneInRepo,
  verifySms2faCodeInRepo,
  verifyTotpCode,
  verifyTotpForLoginInRepo,
  type TotpServiceOptions,
} from './mfa';
import {
  getConnectedOAuthProvidersInRepo,
  getEnabledOAuthProviders,
  getOAuthAuthorizationUrl,
  handleOAuthCallbackInRepo,
  parseOAuthInitiateFlags,
  refreshExpiringOAuthTokensInRepo,
  unlinkOAuthAccountInRepo,
  type OAuthProvidersMap,
  type OAuthServiceConfig,
} from './oauth';
import {
  identityRepository,
  type ApiKeyAuthRecord,
  type ApiKeyRecord,
  type DbAdminUserListFilters,
  type DbQueryClient,
  type IdentityApiKeyRepository,
  type IdentityRepository,
  type NewApiKeyRecord,
  type User,
} from './repository';
import {
  ANONYMIZED_EMAIL_DOMAIN,
  RETAINED_USER_FIELDS,
  anonymizeExpiredUsers,
  anonymizedEmailFor,
  anonymizedUserFields,
  cleanupUnverifiedUsers,
  filterDeletedUsers,
  filterSoftDeletedFromResults,
  hardDeleteAnonymizedUsers,
  isAnonymizedUser,
  isReservedAnonymizedEmail,
  isUserDeleted,
  runUserRetention,
  type AnonymizeResult,
  type AnonymizedUserFields,
  type CleanupResult,
  type HardDeleteResult,
  type PaginatedUsersResult,
  type UserRetentionResult,
} from './retention';
import {
  API_KEY_TOKEN_PREFIX,
  adminCreateInvitedUser,
  adminForceLogoutUser,
  adminGetUser,
  adminHardBanUser,
  adminListUsers,
  adminLockUser,
  adminSearchUsers,
  adminSoftDeleteUser,
  adminUnlockUser,
  adminUpdateUser,
  authenticateApiKey,
  changeUserPassword,
  computeProfileCompleteness,
  createApiKeyForOwner,
  createRefreshTokenFamilyInRepo,
  deactivateUserAccount,
  deleteApiKeyForOwner,
  elevateSudoInRepo,
  generateApiKey,
  getMeProfile,
  getUserProfileCompleteness,
  hashApiKeyToken,
  invalidateAllUserSessionsInRepo,
  issueSession,
  listApiKeysForOwner,
  listDevicesForUser,
  listSessionsForUser,
  reactivateUserAccount,
  requestPasswordResetInRepo,
  requestUserDeletion,
  revokeAllSessionsForUser,
  revokeAllUserTokensInRepo,
  revokeDeviceForUser,
  revokeSessionForUser,
  revokeTokenFamilyInRepo,
  sendUserInviteEmail,
  toAdminUserDto,
  toUserDto,
  trustDeviceForUser,
  updateUserProfile,
  updateUsernameForUser,
  type ApiKeyIdentity,
  type AuthenticateApiKeyDeps,
  type IssueSessionOptions,
  type IssuedSession,
  type RefreshCookieConfig,
} from './service';
import {
  clearChallengeStore,
  deleteUserPasskeyInRepo,
  getWebauthnAuthenticationOptionsInRepo,
  getWebauthnRegistrationOptionsInRepo,
  listUserPasskeysInRepo,
  renameUserPasskeyInRepo,
  verifyWebauthnAuthenticationInRepo,
  verifyWebauthnRegistrationInRepo,
  type WebauthnServiceConfig,
} from './webauthn';

export {
  ANONYMIZED_EMAIL_DOMAIN,
  API_KEY_TOKEN_PREFIX,
  DEFAULT_ARGON2_CONFIG,
  LIVENESS_TTL_MS,
  MIN_JWT_SECRET_LENGTH,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_BYTES,
  RETAINED_USER_FIELDS,
  SUDO_TOKEN_HEADER,
  SUDO_TOKEN_TTL_MINUTES,
  ConsentedUserRefusalError,
  ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE,
  SIGNUP_CONSENT_REQUIRED_MESSAGE,
  adminCreateInvitedUser,
  adminSearchUsers,
  adminSoftDeleteUser,
  anonymizeExpiredUsers,
  anonymizedEmailFor,
  anonymizedUserFields,
  assertUserActive,
  authGuardReposFromDb,
  authenticateApiKey,
  authenticateUserInRepo,
  burnChallenge,
  canonicalizeEmail,
  cleanupUnverifiedUsers,
  clearChallengeStore,
  clearLivenessCache,
  completeOnboardingInRepo,
  computeProfileCompleteness,
  confirmEmailChangeInRepo,
  createAccessToken,
  createAuthEmailTemplates,
  createAuthGuard,
  createChallengeToken,
  createConsentedUserInRepo,
  createEmailVerificationTokenInRepo,
  createRefreshToken,
  createRefreshTokenFamilyInRepo,
  createRequireAuth,
  createRequireRole,
  createSudoToken,
  decryptToken,
  decryptTotpSecret,
  encryptToken,
  encryptTotpSecret,
  filterDeletedUsers,
  filterSoftDeletedFromResults,
  generateApiKey,
  generateBase64UrlToken,
  generateDeviceFingerprint,
  generateNumericCode,
  generateSecureToken,
  generateStableDeviceFingerprint,
  generateUniqueUsernameInRepo,
  getLiveness,
  getProgressiveDelayInRepo,
  getRefreshTokenExpiry,
  hardDeleteAnonymizedUsers,
  hashApiKeyToken,
  hashPassword,
  hashToken,
  hasPassword,
  identityRepository,
  initDummyHashPool,
  initiateEmailChangeInRepo,
  invalidateLiveness,
  isAccountLockedInRepo,
  isAnonymizedUser,
  isChallengeBurned,
  isDummyHashPoolInitialized,
  isLegacyPlaintextSecret,
  isReservedAnonymizedEmail,
  isUserDeleted,
  issueSession,
  needsRehash,
  normalizeEmail,
  parseUserAgentDeviceInfo,
  registerUserInRepo,
  requestEmailOtpInRepo,
  requestMagicLinkInRepo,
  requestPasswordResetInRepo,
  resendVerificationEmailInRepo,
  resetBurnedChallenges,
  resetDummyHashPool,
  resetPasswordInRepo,
  resetTotpVerifyRateLimiter,
  revertEmailChangeInRepo,
  revokeAllUserTokensInRepo,
  revokeTokenFamilyInRepo,
  rotateRefreshTokenInRepo,
  runUserRetention,
  setLiveness,
  setPasswordInRepo,
  splitFullName,
  toAdminUserDto,
  toUserDto,
  verifyCaptchaToken,
  verifyChallengeToken,
  verifyEmailInRepo,
  verifyEmailOtpInRepo,
  verifyMagicLinkInRepo,
  verifyPassword,
  verifyPasswordSafe,
  verifySudoToken,
  verifyToken,
  verifyTotpCode,
  verifyTurnstileToken,
  type AnonymizeResult,
  type AnonymizedUserFields,
  type ApiKeyAuthRecord,
  type ApiKeyIdentity,
  type ApiKeyRecord,
  type Argon2Config,
  type AuthEmailTemplateOptions,
  type AuthEmailTemplates,
  type AuthGuardRepositories,
  type AuthenticateApiKeyDeps,
  type CaptchaConfig,
  type CaptchaVerifyResult,
  type ChallengePurpose,
  type CleanupResult,
  type DbAdminUserListFilters,
  type DbQueryClient,
  type DeviceInfo,
  type EmailTemplateResult,
  type HardDeleteResult,
  type IdentityApiKeyRepository,
  type IdentityRepository,
  type IssueSessionOptions,
  type IssuedSession,
  type LivenessRecord,
  type LockoutConfig,
  type NewApiKeyRecord,
  type PaginatedUsersResult,
  type RefreshCookieConfig,
  type SignupComplianceHooks,
  type TokenPayload,
  type User,
  type UserRetentionResult,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PublishIdentityEventOptions {
  readonly actorUserId?: string | null;
  readonly orgId?: string | null;
}

export async function publishUserRegistered(
  events: KernelServices['events'],
  tx: Tx,
  payload: UserRegisteredPayload,
  options: { readonly actorUserId: string; readonly orgId?: string | null },
): Promise<void> {
  await events.publish(tx, identityEvents.userRegistered, payload, options);
}

export async function publishSessionRevoked(
  events: KernelServices['events'],
  tx: Tx,
  payload: SessionRevokedPayload,
  options: { readonly actorUserId: string; readonly orgId?: string | null },
): Promise<void> {
  await events.publish(tx, identityEvents.sessionRevoked, payload, options);
}

export async function publishAccountAlert(
  events: KernelServices['events'],
  tx: Tx,
  payload: AccountAlertPayload,
  options: PublishIdentityEventOptions = {},
): Promise<void> {
  await events.publish(tx, identityEvents.accountAlerted, payload, options);
}

function resolveAlertSubjectLabel(payload: Readonly<Record<string, unknown>>): string {
  const email = payload['subjectEmail'];
  if (typeof email === 'string' && email !== '') return email;
  const username = payload['subjectUsername'];
  if (typeof username === 'string' && username !== '') return username;
  const userId = payload['subjectUserId'];
  if (typeof userId === 'string' && userId !== '') return userId;
  return 'a user';
}

const renderIdentityAccountAlert: NotificationTemplate = (payload) => {
  const alertType = typeof payload['alertType'] === 'string' ? payload['alertType'] : '';
  const subjectUserId =
    typeof payload['subjectUserId'] === 'string' && payload['subjectUserId'] !== ''
      ? payload['subjectUserId']
      : undefined;
  const who = resolveAlertSubjectLabel(payload);
  const ip = payload['ipAddress'];
  const from = typeof ip === 'string' && ip !== '' ? ` from ${ip}` : '';
  const data =
    alertType !== '' || subjectUserId !== undefined
      ? {
          ...(alertType !== '' ? { eventType: alertType } : {}),
          ...(subjectUserId !== undefined ? { targetUserId: subjectUserId } : {}),
        }
      : undefined;

  switch (alertType) {
    case 'user_signup':
      return {
        level: 'info',
        title: 'New user registered',
        message: `${who} created an account.`,
        data,
      };
    case 'account_reactivated':
      return {
        level: 'info',
        title: 'Account reactivated',
        message: `${who} reactivated their account.`,
        data,
      };
    case 'password_changed':
      return {
        level: 'warning',
        title: 'Password changed',
        message: `${who} changed their password.`,
        data,
      };
    case 'password_reset':
      return {
        level: 'warning',
        title: 'Password reset completed',
        message: `${who} reset their password.`,
        data,
      };
    case 'account_deactivated':
      return {
        level: 'warning',
        title: 'Account deactivated',
        message: `${who} deactivated their account.`,
        data,
      };
    case 'deletion_requested':
      return {
        level: 'warning',
        title: 'Account deletion requested',
        message: `${who} requested account deletion.`,
        data,
      };
    case 'new_device_login':
      return {
        level: 'warning',
        title: 'New device sign-in',
        message: `${who} signed in from a new device${from}.`,
        data,
      };
    case 'account_locked':
      return {
        level: 'error',
        title: 'Account locked (unusual activity)',
        message: `${who} was locked out after repeated failed sign-ins${from}.`,
        data,
      };
    default:
      return {
        level: 'warning',
        title: 'Account activity alert',
        message: `${who} triggered an account security event.`,
        ...(data !== undefined ? { data } : {}),
      };
  }
};

function readHeaderString(headers: RequestContext['headers'], name: string): string | undefined {
  const raw = headers?.[name];
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') return raw;
  return raw[0];
}

function assertSudoForViewer(
  req: {
    readonly headers?: RequestContext['headers'];
    readonly viewer: { readonly userId: string };
    fail(code: 'SUDO_REQUIRED' | 'SUDO_EXPIRED' | 'SUDO_MISMATCH', message?: string): never;
  },
  jwtSecret: string | undefined,
  missingMessage: string,
): void {
  const sudoToken = readHeaderString(req.headers, SUDO_TOKEN_HEADER);
  if (sudoToken === undefined || sudoToken.length === 0) {
    req.fail('SUDO_REQUIRED', missingMessage);
  }
  if (jwtSecret === undefined || jwtSecret.length === 0) {
    req.fail('SUDO_EXPIRED', 'Sudo token is invalid or expired. Please re-verify your identity.');
  }
  const verified = verifySudoToken(sudoToken, jwtSecret);
  if (verified === null) {
    req.fail('SUDO_EXPIRED', 'Sudo token is invalid or expired. Please re-verify your identity.');
  }
  if (verified.userId !== req.viewer.userId) {
    req.fail('SUDO_MISMATCH', 'Sudo token does not match authenticated user.');
  }
}

async function resolveCurrentFamilyIdFromCookies(
  tx: Tx,
  cookies: RequestContext['cookies'],
): Promise<string | undefined> {
  const refreshToken = cookies?.[REFRESH_COOKIE_NAME];
  if (refreshToken === undefined || refreshToken === '') {
    return undefined;
  }
  const record = await identityRepository(tx).findRefreshTokenByValue(refreshToken);
  return record?.familyId ?? undefined;
}

function resolveOptionalViewerUserId(
  req: Pick<RequestContext, 'viewer' | 'headers'>,
  jwtSecret: string | undefined,
): string | undefined {
  if (req.viewer !== null) {
    return req.viewer.userId;
  }
  if (jwtSecret === undefined || jwtSecret === '') {
    return undefined;
  }
  const rawAuth = readHeaderString(req.headers, 'authorization');
  if (rawAuth === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/iu.exec(rawAuth.trim());
  const bearer = match?.[1];
  if (bearer === undefined) {
    return undefined;
  }
  try {
    return verifyToken(bearer, jwtSecret).userId;
  } catch {
    return undefined;
  }
}

interface OAuthHandlerService {
  readonly kernel: KernelServices;
  readonly events: KernelServices['events'];
  readonly clock: KernelServices['clock'];
  readonly log: KernelServices['log'];
  readonly oauthConfig: OAuthServiceConfig;
}

async function runOAuthCallback(
  provider: OAuthProvider,
  query: OAuthCallbackQuery,
  req: {
    readonly ip?: string | null | undefined;
    readonly userAgent?: string | null | undefined;
    readonly headers?: RequestContext['headers'];
    readonly setCookie?: RequestContext['setCookie'];
    fail(
      code:
        | 'OAUTH_NOT_CONFIGURED'
        | 'OAUTH_FAILED'
        | 'OAUTH_STATE_MISMATCH'
        | 'OAUTH_EMAIL_EXISTS'
        | 'OAUTH_ALREADY_LINKED'
        | 'OAUTH_LINKED_TO_OTHER'
        | 'SIGNUP_CONSENT_REQUIRED'
        | 'ELIGIBILITY_ATTESTATION_REQUIRED',
      message?: string,
      details?: Readonly<Record<string, unknown>>,
    ): never;
  },
  s: OAuthHandlerService,
): Promise<
  | { readonly token: string; readonly user: ContractUser; readonly isNewUser: boolean }
  | { readonly linked: boolean; readonly provider: OAuthProvider }
> {
  const metrics = getMetricsCollector();
  metrics.recordLoginAttempt(provider);

  const peekAgreements: SignupComplianceHooks['peekAgreements'] = async (tx: Tx) => {
    const actions = s.kernel.actions;
    if (actions === undefined || !actions.has('compliance.peekSignupAgreements')) {
      return [];
    }
    return actions.invoke<ReadonlyArray<{ readonly id: string }>>(
      'compliance.peekSignupAgreements',
      tx,
      {},
    );
  };
  const recordConsents: SignupComplianceHooks['recordConsents'] = async (tx, consentData) => {
    const actions = s.kernel.actions;
    if (actions === undefined || !actions.has('compliance.recordSignupConsents')) {
      return;
    }
    await actions.invoke('compliance.recordSignupConsents', tx, consentData);
  };

  const now = s.clock.now();
  const outcome = await s.kernel.db.system(async (sysTx) => {
    const res = await handleOAuthCallbackInRepo({
      repo: identityRepository(sysTx),
      tx: sysTx,
      config: s.oauthConfig,
      provider,
      query,
      peekAgreements,
      recordConsents,
      onUserCreatedInTx: async (tx, newUser) => {
        await publishUserRegistered(
          s.events,
          tx,
          {
            userId: newUser.id,
            email: newUser.email,
            ...(newUser.username !== null && newUser.username !== ''
              ? { username: newUser.username }
              : {}),
            ...(newUser.firstName !== '' ? { firstName: newUser.firstName } : {}),
          },
          { actorUserId: newUser.id },
        );
      },
      ipAddress: req.ip,
      userAgent: req.userAgent,
      deviceId: readValidatedDeviceIdHeader(req.headers),
      now,
    });
    if (res.ok && res.isLinking) {
      await s.events.publish(
        sysTx,
        identityEvents.oauthLinked,
        {
          userId: res.userId,
          provider: res.provider,
          ...(res.providerEmail !== '' ? { providerEmail: res.providerEmail } : {}),
        },
        { actorUserId: res.userId },
      );
    }
    return res;
  });

  if (!outcome.ok) {
    metrics.recordLoginFailure(provider);
    return req.fail(outcome.code, outcome.message, outcome.details);
  }

  if (outcome.isLinking) {
    return { linked: outcome.linked, provider: outcome.provider };
  }

  metrics.recordLoginSuccess(provider);
  req.setCookie?.(REFRESH_COOKIE_NAME, outcome.issued.refreshToken, outcome.issued.cookieOptions);

  const actions = s.kernel.actions;
  if (actions !== undefined && actions.has('orgs.ensurePersonalOrg')) {
    try {
      await s.kernel.db.system((sysTx) =>
        actions.invoke('orgs.ensurePersonalOrg', sysTx, {
          userId: outcome.user.id,
          email: outcome.user.email,
          username: outcome.user.username,
        }),
      );
    } catch (err: unknown) {
      s.log.warn({ err, userId: outcome.user.id }, 'Failed to ensure personal tenant');
    }
  }

  if (outcome.createdUser !== undefined) {
    const created = outcome.createdUser;
    void s.kernel.db
      .system((sysTx) =>
        publishAccountAlert(
          s.events,
          sysTx,
          {
            alertType: 'user_signup',
            subjectUserId: created.id,
            subjectEmail: created.email,
            ...(created.username !== null && created.username !== ''
              ? { subjectUsername: created.username }
              : {}),
            ...(req.ip !== undefined && req.ip !== null && req.ip !== ''
              ? { ipAddress: req.ip }
              : {}),
          },
          { actorUserId: created.id },
        ),
      )
      .catch((err: unknown) => {
        s.log.warn({ err, userId: created.id }, 'Failed to publish OAuth signup alert');
      });
  }

  return {
    token: outcome.token,
    user: outcome.user,
    isNewUser: outcome.isNewUser,
  };
}

async function runOAuthUnlink(
  provider: OAuthProvider,
  req: {
    readonly viewer: {
      readonly userId: string;
      readonly actingOrg?: { readonly orgId: string } | undefined;
    };
    tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
    fail(code: 'OAUTH_CONNECTION_NOT_FOUND' | 'CANNOT_UNLINK_ONLY_AUTH', message?: string): never;
  },
  s: Pick<OAuthHandlerService, 'events'>,
): Promise<{ readonly message: string }> {
  const res = await req.tx(async (tx) => {
    const unlinked = await unlinkOAuthAccountInRepo(
      identityRepository(tx),
      req.viewer.userId,
      provider,
    );
    if (unlinked.ok) {
      await s.events.publish(
        tx,
        identityEvents.oauthUnlinked,
        {
          userId: req.viewer.userId,
          provider,
        },
        { actorUserId: req.viewer.userId, orgId: req.viewer.actingOrg?.orgId ?? null },
      );
    }
    return unlinked;
  });

  if (!res.ok) {
    return req.fail(res.code, res.message);
  }
  return { message: `${provider} account unlinked successfully` };
}

export const identityServer: AnyServerModule<typeof identityModule> = implementServer(
  identityModule,
  {
    migrations: new URL('./migrations/', import.meta.url),
    create: (k) => {
      const argon2Config: Argon2Config = {
        type: (k.env.ARGON2_TYPE as 0 | 1 | 2 | undefined) ?? DEFAULT_ARGON2_CONFIG.type,
        memoryCost: k.env.ARGON2_MEMORY_COST ?? DEFAULT_ARGON2_CONFIG.memoryCost,
        timeCost: k.env.ARGON2_TIME_COST ?? DEFAULT_ARGON2_CONFIG.timeCost,
        parallelism: k.env.ARGON2_PARALLELISM ?? DEFAULT_ARGON2_CONFIG.parallelism,
      };
      const jwtSecret = k.env.JWT_SECRET ?? k.comms?.hmacSecret;
      const encryptionKey =
        k.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? jwtSecret ?? 'bslt-default-totp-key-32-chars!!';
      const cookieConfig: RefreshCookieConfig = {
        httpOnly: k.env.COOKIE_HTTP_ONLY ?? true,
        secure: k.env.COOKIE_SECURE ?? false,
        sameSite: k.env.COOKIE_SAME_SITE ?? 'lax',
        path: k.env.COOKIE_PATH ?? '/',
      };
      const totpOptions: TotpServiceOptions = {
        issuer: k.env.TOTP_ISSUER ?? 'BSLT',
        window: k.env.TOTP_WINDOW ?? 1,
        encryptionKey,
      };
      const strategyList =
        k.env.AUTH_STRATEGIES !== undefined
          ? k.env.AUTH_STRATEGIES.split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          : null;
      const enabledStrategies = strategyList !== null ? new Set(strategyList) : null;
      const webauthnConfig: WebauthnServiceConfig | undefined =
        k.env.WEBAUTHN_RP_NAME !== undefined &&
        k.env.WEBAUTHN_RP_ID !== undefined &&
        k.env.WEBAUTHN_ORIGIN !== undefined
          ? {
              rpName: k.env.WEBAUTHN_RP_NAME,
              rpId: k.env.WEBAUTHN_RP_ID,
              origin: k.env.WEBAUTHN_ORIGIN,
              attestation: k.env.WEBAUTHN_ATTESTATION ?? 'none',
            }
          : undefined;
      const lockoutConfig: LockoutConfig = {
        maxAttempts: k.env.LOCKOUT_MAX_ATTEMPTS ?? 5,
        lockoutDurationMs: k.env.LOCKOUT_DURATION_MS ?? 15 * 60_000,
        progressiveDelay: k.env.LOCKOUT_PROGRESSIVE_DELAY ?? true,
        baseDelayMs: k.env.LOCKOUT_BASE_DELAY_MS ?? 1000,
      };
      const captchaConfig: CaptchaConfig = {
        enabled: k.env.CAPTCHA_ENABLED ?? false,
        secretKey: k.env.CAPTCHA_SECRET_KEY ?? '',
      };
      const defaultTemplates = createAuthEmailTemplates({ appName: k.env.APP_NAME });
      const injectedTemplates = k.comms?.emailTemplates as Partial<AuthEmailTemplates> | undefined;
      const emailTemplates: AuthEmailTemplates = {
        ...defaultTemplates,
        ...(injectedTemplates ?? {}),
      };
      const appBaseUrl = k.env.APP_BASE_URL ?? k.comms?.appBaseUrl ?? 'http://localhost:5173';
      const apiBaseUrl = (k.env.API_BASE_URL ?? appBaseUrl).replace(/\/$/u, '');
      const cookieSecret = k.env.COOKIE_SECRET ?? jwtSecret ?? encryptionKey;
      const applePrivateKey =
        k.env.APPLE_PRIVATE_KEY_BASE64 !== undefined && k.env.APPLE_PRIVATE_KEY_BASE64 !== ''
          ? Buffer.from(k.env.APPLE_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
          : (k.env.APPLE_PRIVATE_KEY ?? '');
      const oauthProviders: OAuthProvidersMap = {
        ...(k.env.GOOGLE_CLIENT_ID !== undefined &&
        k.env.GOOGLE_CLIENT_ID !== '' &&
        k.env.GOOGLE_CLIENT_SECRET !== undefined &&
        k.env.GOOGLE_CLIENT_SECRET !== ''
          ? {
              google: {
                clientId: k.env.GOOGLE_CLIENT_ID,
                clientSecret: k.env.GOOGLE_CLIENT_SECRET,
                callbackUrl:
                  k.env.GOOGLE_CALLBACK_URL ?? `${apiBaseUrl}/api/auth/oauth/google/callback`,
              },
            }
          : {}),
        ...(k.env.GITHUB_CLIENT_ID !== undefined &&
        k.env.GITHUB_CLIENT_ID !== '' &&
        k.env.GITHUB_CLIENT_SECRET !== undefined &&
        k.env.GITHUB_CLIENT_SECRET !== ''
          ? {
              github: {
                clientId: k.env.GITHUB_CLIENT_ID,
                clientSecret: k.env.GITHUB_CLIENT_SECRET,
                callbackUrl:
                  k.env.GITHUB_CALLBACK_URL ?? `${apiBaseUrl}/api/auth/oauth/github/callback`,
              },
            }
          : {}),
        ...(k.env.APPLE_CLIENT_ID !== undefined && k.env.APPLE_CLIENT_ID !== ''
          ? {
              apple: {
                clientId: k.env.APPLE_CLIENT_ID,
                callbackUrl:
                  k.env.APPLE_CALLBACK_URL ?? `${apiBaseUrl}/api/auth/oauth/apple/callback`,
                teamId: k.env.APPLE_TEAM_ID ?? '',
                keyId: k.env.APPLE_KEY_ID ?? '',
                privateKey: applePrivateKey,
              },
            }
          : {}),
      };
      const oauthConfig: OAuthServiceConfig = {
        appBaseUrl,
        stateEncryptionKey: cookieSecret,
        tokenEncryptionKey: encryptionKey,
        jwtSecret: jwtSecret ?? encryptionKey,
        accessTokenExpiry: k.env.JWT_ACCESS_EXPIRY ?? '15m',
        refreshExpiryDays: k.env.REFRESH_EXPIRY_DAYS ?? 7,
        cookie: cookieConfig,
        enabledStrategies,
        providers: oauthProviders,
      };

      return {
        kernel: k,
        events: k.events,
        clock: k.clock,
        log: k.log,
        argon2Config,
        jwtSecret,
        accessTokenExpiry: k.env.JWT_ACCESS_EXPIRY ?? '15m',
        refreshExpiryDays: k.env.REFRESH_EXPIRY_DAYS ?? 7,
        refreshGracePeriodSeconds: k.env.REFRESH_GRACE_PERIOD_SECONDS ?? 30,
        maxConcurrentSessions: k.env.MAX_CONCURRENT_SESSIONS ?? 10,
        autoVerifyEmail: k.env.AUTH_AUTO_VERIFY_EMAIL ?? false,
        demoMode: k.env.DEMO_MODE === true,
        lockoutConfig,
        captchaConfig,
        magicLinkExpiryMinutes: k.env.MAGIC_LINK_EXPIRY_MINUTES ?? 15,
        magicLinkMaxAttempts: k.env.MAGIC_LINK_MAX_ATTEMPTS ?? 3,
        loginAttemptsRetentionDays:
          k.env.LOGIN_ATTEMPTS_RETENTION_DAYS ?? LOGIN_ATTEMPTS_RETENTION_DAYS,
        cookieConfig,
        totpOptions,
        strategyList,
        enabledStrategies,
        webauthnConfig,
        oauthConfig,
        appBaseUrl,
        sendEmail: k.comms?.sendEmail,
        sendSms: k.comms?.sendSms,
        emailTemplates,
      };
    },
    context: async (s, viewer) => {
      const authStrategies = s.strategyList ?? ['local'];
      const demoFlags = s.demoMode ? { flags: { 'identity.demo_mode': true } } : {};
      if (viewer === null) {
        return { authStrategies, ...demoFlags };
      }
      const cached = getLiveness(viewer.userId);
      if (cached?.emailVerified !== undefined) {
        return {
          authStrategies,
          ...demoFlags,
          eligibility: {
            emailVerified: cached.emailVerified,
          },
        };
      }
      const user = await s.kernel.db.system((tx) =>
        identityRepository(tx).findUserById(viewer.userId),
      );
      if (user !== null) {
        setLiveness(user.id, {
          tokenVersion: user.tokenVersion,
          lockedUntil: user.lockedUntil,
          lockReason: user.lockReason,
          role: user.role,
          emailVerified: user.emailVerified,
        });
      }
      return {
        authStrategies,
        ...demoFlags,
        eligibility: {
          emailVerified: user?.emailVerified === true,
        },
      };
    },
    privacy: {
      exportUser: async (s, userId) =>
        s.kernel.db.system(async (tx) => {
          const repo = identityRepository(tx);
          const [user, keys, sessions] = await Promise.all([
            repo.findUserById(userId),
            listApiKeysForOwner(userId, repo),
            listSessionsForUser(repo, userId),
          ]);
          return {
            user: user !== null ? toUserDto(user) : null,
            apiKeys: keys,
            sessions,
          };
        }),
      eraseUser: async (s, tx, userId) => {
        const repo = identityRepository(tx);
        const now = s.clock.now();
        await repo.deleteApiKeysByOwner(userId);
        await revokeAllUserTokensInRepo(repo, userId, now);
        await repo.deleteUserSessionsByUserId(userId);
        await repo.updateUser(userId, {
          deletedAt: now,
          deletionGracePeriodEnds: now,
          ...anonymizedUserFields(userId),
        });
        invalidateLiveness(userId);
      },
    },
    actions: {
      'identity.suspend': async (s, tx, rawInput) => {
        const input = (rawInput ?? {}) as {
          readonly userId?: unknown;
          readonly ownerUserId?: unknown;
          readonly targetId?: unknown;
          readonly reason?: unknown;
          readonly durationMinutes?: unknown;
        };
        const candidateId = input.userId ?? input.ownerUserId ?? input.targetId;
        if (typeof candidateId !== 'string' || candidateId.trim().length === 0) {
          throw new Error('identity.suspend requires a non-empty userId');
        }
        const userId = candidateId.trim();
        const reason =
          typeof input.reason === 'string' && input.reason.trim().length > 0
            ? input.reason.trim()
            : 'Suspended by moderation';
        const durationMinutes =
          typeof input.durationMinutes === 'number' && input.durationMinutes > 0
            ? input.durationMinutes
            : undefined;
        const repo = identityRepository(tx);
        const now = s.clock.now();
        const lockedUntil =
          durationMinutes !== undefined
            ? new Date(now.getTime() + durationMinutes * 60 * 1000)
            : new Date('2099-12-31T23:59:59.999Z');
        await repo.lockUserAccount(userId, lockedUntil, reason);
        await revokeAllUserTokensInRepo(repo, userId, now);
        invalidateLiveness(userId);
      },
      'identity.completeSsoLogin': async (s, tx, rawInput) => {
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          throw new Error('JWT secret not configured for SSO login');
        }
        const input = (rawInput ?? {}) as {
          readonly email?: unknown;
          readonly name?: unknown;
          readonly picture?: unknown;
          readonly emailVerified?: unknown;
          readonly ipAddress?: unknown;
          readonly userAgent?: unknown;
          readonly deviceId?: unknown;
        };
        if (typeof input.email !== 'string' || !input.email.includes('@')) {
          throw new Error('identity.completeSsoLogin requires a valid email');
        }
        const rawEmail = normalizeEmail(input.email);
        const canonical = canonicalizeEmail(rawEmail);
        const picture =
          typeof input.picture === 'string' && input.picture.trim() !== ''
            ? input.picture.trim()
            : null;
        const displayName =
          typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : null;
        const ipAddress =
          typeof input.ipAddress === 'string' && input.ipAddress !== ''
            ? input.ipAddress
            : undefined;
        const userAgent =
          typeof input.userAgent === 'string' && input.userAgent !== ''
            ? input.userAgent
            : undefined;
        const deviceId =
          typeof input.deviceId === 'string' && input.deviceId !== '' ? input.deviceId : undefined;
        const now = s.clock.now();
        const repo = identityRepository(tx);

        let user = await repo.findUserByEmail(canonical);
        let isNewUser = false;

        if (user !== null) {
          if (user.deletedAt !== null || user.deactivatedAt !== null) {
            throw new Error('Account is inactive or deleted');
          }
          if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
            throw new Error('Account is temporarily locked');
          }
          const updates: Partial<User> = {};
          if (!user.emailVerified && input.emailVerified !== false) {
            updates.emailVerified = true;
            updates.emailVerifiedAt = now;
          }
          if (user.avatarUrl === null && picture !== null) {
            updates.avatarUrl = picture;
          }
          if (Object.keys(updates).length > 0) {
            const refreshed = await repo.updateUser(user.id, updates);
            if (refreshed !== null) {
              user = refreshed;
            }
          }
        } else {
          const username = await generateUniqueUsernameInRepo(repo, rawEmail);
          const { firstName, lastName } = splitFullName(displayName);
          const actions = s.kernel.actions;
          const peekAgreements: SignupComplianceHooks['peekAgreements'] = async (innerTx) => {
            if (actions === undefined || !actions.has('compliance.peekSignupAgreements')) {
              return [];
            }
            return actions.invoke<ReadonlyArray<{ readonly id: string }>>(
              'compliance.peekSignupAgreements',
              innerTx,
              {},
            );
          };
          const recordConsents: SignupComplianceHooks['recordConsents'] = async (
            innerTx,
            consentData,
          ) => {
            if (actions === undefined || !actions.has('compliance.recordSignupConsents')) {
              return;
            }
            await actions.invoke('compliance.recordSignupConsents', innerTx, consentData);
          };

          const created = await createConsentedUserInRepo(
            repo,
            {
              email: rawEmail,
              canonicalEmail: canonical,
              username,
              firstName,
              lastName,
              passwordHash: '',
              role: 'user',
              emailVerified: true,
              emailVerifiedAt: now,
              ...(picture !== null ? { avatarUrl: picture } : {}),
            },
            {
              agreed: true,
              attested: true,
              ...(ipAddress !== undefined ? { ipAddress } : {}),
              ...(userAgent !== undefined ? { userAgent } : {}),
            },
            {
              peekAgreements,
              recordConsents,
            },
            tx,
            now,
          );
          await publishUserRegistered(
            s.events,
            tx,
            {
              userId: created.id,
              email: created.email,
              ...(created.username !== null && created.username !== ''
                ? { username: created.username }
                : {}),
              ...(created.firstName !== '' ? { firstName: created.firstName } : {}),
            },
            { actorUserId: created.id },
          );
          user = created;
          isNewUser = true;
        }

        const issued = await issueSession(repo, user, {
          jwtSecret: s.jwtSecret,
          accessTokenExpiry: s.accessTokenExpiry,
          refreshExpiryDays: s.refreshExpiryDays,
          cookie: s.cookieConfig,
          ipAddress,
          userAgent,
          deviceId,
          now,
        });

        return {
          token: issued.token,
          user: issued.user,
          refreshToken: issued.refreshToken,
          cookieOptions: issued.cookieOptions,
          isNewUser,
        };
      },
    },
    jobs: {
      sessionCleanup: async (_payload, s) => {
        const cutoff = new Date(
          s.clock.now().getTime() - SESSIONS_RETENTION_DAYS * MS_PER_DAY,
        ).toISOString();
        await s.kernel.db.system(async (tx) => {
          const deleted = await identityRepository(tx).deleteRevokedSessionsBefore(cutoff);
          if (deleted > 0) {
            s.log.info({ deleted }, 'Revoked session cleanup completed');
          }
        });
      },
      userRetention: async (_payload, s) => {
        await s.kernel.db.system(async (tx) => {
          await runUserRetention(tx, s.log);
        });
      },
      loginCleanup: async (_payload, s) => {
        const cutoff = new Date(
          s.clock.now().getTime() - s.loginAttemptsRetentionDays * MS_PER_DAY,
        ).toISOString();
        await s.kernel.db.system(async (tx) => {
          await identityRepository(tx).deleteLoginAttemptsOlderThan(cutoff);
        });
      },
      authTokensCleanup: async (_payload, s) => {
        await s.kernel.db.system(async (tx) => {
          await identityRepository(tx).deleteExpiredAuthTokens(s.clock.now());
        });
      },
      oauthRefresh: async (_payload, s) => {
        await s.kernel.db.system(async (tx) => {
          const summary = await refreshExpiringOAuthTokensInRepo({
            repo: identityRepository(tx),
            config: s.oauthConfig,
            now: s.clock.now(),
            onWarn: (ctx, msg) => {
              s.log.warn(ctx, msg);
            },
            onError: (ctx, msg) => {
              s.log.error(ctx, msg);
            },
          });
          if (summary.total > 0) {
            s.log.info(
              {
                total: summary.total,
                refreshed: summary.refreshed,
                failed: summary.failed,
              },
              'OAuth token refresh complete',
            );
          }
        });
      },
    },
    cron: [
      { job: 'sessionCleanup', schedule: '40 2 * * *', catchUp: false },
      { job: 'userRetention', schedule: '0 3 * * *', catchUp: false },
      { job: 'loginCleanup', schedule: '30 2 * * *', catchUp: false },
      { job: 'authTokensCleanup', schedule: '35 2 * * *', catchUp: false },
      { job: 'oauthRefresh', schedule: '15 * * * *', catchUp: false },
    ],
    handlers: {
      // -----------------------------------------------------------------------
      // Core Auth, Passwordless & Email Change (`/api/auth*`)
      // -----------------------------------------------------------------------
      register: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('local')) {
          return req.fail('LOCAL_AUTH_DISABLED', 'Local authentication is not enabled');
        }
        if (!input.body.tosAccepted) {
          return req.fail('SIGNUP_CONSENT_REQUIRED', SIGNUP_CONSENT_REQUIRED_MESSAGE);
        }
        if (!isAttestationConfirmed(input.body.eligibilityAttested)) {
          return req.fail(
            'ELIGIBILITY_ATTESTATION_REQUIRED',
            ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE,
          );
        }
        if (s.captchaConfig.enabled) {
          const captcha = await verifyCaptchaToken(
            s.captchaConfig,
            input.body.captchaToken ?? '',
            req.ip,
          );
          if (!captcha.success) {
            return req.fail('CAPTCHA_VERIFICATION_FAILED', 'CAPTCHA verification failed');
          }
        }

        const peekAgreements: SignupComplianceHooks['peekAgreements'] = async (tx: Tx) => {
          const actions = s.kernel.actions;
          if (actions === undefined || !actions.has('compliance.peekSignupAgreements')) {
            return [];
          }
          const docs = await actions.invoke<ReadonlyArray<{ readonly id: string }>>(
            'compliance.peekSignupAgreements',
            tx,
            {},
          );
          return docs;
        };
        const recordConsents: SignupComplianceHooks['recordConsents'] = async (tx, consentData) => {
          const actions = s.kernel.actions;
          if (actions === undefined || !actions.has('compliance.recordSignupConsents')) {
            return;
          }
          await actions.invoke('compliance.recordSignupConsents', tx, consentData);
        };

        const now = s.clock.now();
        const res = await s.kernel.db.system((sysTx) =>
          registerUserInRepo({
            repo: identityRepository(sysTx),
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx), sysTx)),
            email: input.body.email,
            password: input.body.password,
            username: input.body.username,
            firstName: input.body.firstName,
            lastName: input.body.lastName,
            tosAccepted: input.body.tosAccepted,
            eligibilityAttested: input.body.eligibilityAttested,
            argon2Config: s.argon2Config,
            autoVerifyEmail: s.autoVerifyEmail,
            appBaseUrl: s.appBaseUrl,
            emailTemplates: s.emailTemplates,
            sendEmail: s.sendEmail,
            peekAgreements,
            recordConsents,
            onUserCreatedInTx: async (tx, newUser) => {
              await publishUserRegistered(
                s.events,
                tx,
                {
                  userId: newUser.id,
                  email: newUser.email,
                  ...(newUser.username !== null && newUser.username !== ''
                    ? { username: newUser.username }
                    : {}),
                  ...(newUser.firstName !== '' ? { firstName: newUser.firstName } : {}),
                },
                { actorUserId: newUser.id },
              );
            },
            onWarn: (context, msg) => {
              s.log.warn(context, msg);
            },
            ipAddress: req.ip,
            userAgent: req.userAgent,
            now,
          }),
        );

        if (!res.ok) {
          return req.fail(res.code, res.message, res.details);
        }

        if (res.createdUser !== undefined) {
          const created = res.createdUser;
          void s.kernel.db
            .system((sysTx) =>
              publishAccountAlert(
                s.events,
                sysTx,
                {
                  alertType: 'user_signup',
                  subjectUserId: created.id,
                  subjectEmail: created.email,
                  ...(created.username !== null && created.username !== ''
                    ? { subjectUsername: created.username }
                    : {}),
                },
                { actorUserId: created.id },
              ),
            )
            .catch((err: unknown) => {
              s.log.warn(
                { reason: err instanceof Error ? err.message : String(err) },
                'Failed to publish user_signup account alert',
              );
            });
        }

        return res.value;
      },

      login: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('local')) {
          return req.fail('LOCAL_AUTH_DISABLED', 'Local authentication is not enabled');
        }
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('INVALID_CREDENTIALS', 'JWT secret not configured');
        }
        if (
          input.body.identifier.includes('@') &&
          s.kernel.actions?.has('orgs.checkDomainSsoEnforcement') === true
        ) {
          const ssoAction = s.kernel.actions;
          const ssoCheck = await s.kernel.db.system((sysTx) =>
            ssoAction.invoke<{
              readonly enforced: boolean;
              readonly orgSlug?: string;
              readonly providerName?: string;
            }>('orgs.checkDomainSsoEnforcement', sysTx, { email: input.body.identifier }),
          );
          if (ssoCheck.enforced) {
            return req.fail(
              'SSO_REQUIRED',
              ssoCheck.providerName !== undefined
                ? `Your organization requires Single Sign-On (${ssoCheck.providerName}).`
                : 'Your organization requires Single Sign-On.',
              {
                ...(ssoCheck.orgSlug !== undefined ? { orgSlug: ssoCheck.orgSlug } : {}),
                ...(ssoCheck.providerName !== undefined
                  ? { providerName: ssoCheck.providerName }
                  : {}),
                ...(ssoCheck.orgSlug !== undefined
                  ? {
                      initiateUrl: `/api/auth/sso/oidc/${encodeURIComponent(ssoCheck.orgSlug)}/initiate`,
                    }
                  : {}),
              },
            );
          }
        }
        const jwtSecret = s.jwtSecret;
        const metrics = getMetricsCollector();
        const provider = 'password';
        metrics.recordLoginAttempt(provider);

        if (s.captchaConfig.enabled) {
          const captcha = await verifyCaptchaToken(
            s.captchaConfig,
            input.body.captchaToken ?? '',
            req.ip,
          );
          if (!captcha.success) {
            metrics.recordLoginFailure(provider);
            return req.fail('CAPTCHA_VERIFICATION_FAILED', 'CAPTCHA verification failed');
          }
        }

        const deviceId = readValidatedDeviceIdHeader(req.headers);
        const spanDays = sessionSpanDays(input.body.rememberMe);
        const now = s.clock.now();

        const outcome = await s.kernel.db.system((sysTx) =>
          authenticateUserInRepo({
            repo: identityRepository(sysTx),
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx))),
            identifier: input.body.identifier,
            password: input.body.password,
            jwtSecret,
            accessTokenExpiry: s.accessTokenExpiry,
            spanDays,
            cookieConfig: s.cookieConfig,
            argon2Config: s.argon2Config,
            lockoutConfig: s.lockoutConfig,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            deviceId,
            now,
          }),
        );

        if (!outcome.ok) {
          metrics.recordLoginFailure(provider);
          if (outcome.code === 'ACCOUNT_LOCKED') {
            void s.kernel.db
              .system((sysTx) =>
                publishAccountAlert(s.events, sysTx, {
                  alertType: 'account_locked',
                  ...(input.body.identifier !== '' ? { subjectEmail: input.body.identifier } : {}),
                  ...(req.ip !== undefined && req.ip !== null && req.ip !== ''
                    ? { ipAddress: req.ip }
                    : {}),
                }),
              )
              .catch((err: unknown) => {
                s.log.warn({ err }, 'Failed to publish account_locked alert');
              });
          }
          if (outcome.code === 'EMAIL_NOT_VERIFIED' && outcome.email !== undefined) {
            const unverifiedEmail = outcome.email;
            void s.kernel.db
              .system((sysTx) =>
                resendVerificationEmailInRepo({
                  repo: identityRepository(sysTx),
                  runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx))),
                  email: unverifiedEmail,
                  appBaseUrl: s.appBaseUrl,
                  emailTemplates: s.emailTemplates,
                  sendEmail: s.sendEmail,
                  now,
                }),
              )
              .catch((err: unknown) => {
                s.log.warn(
                  { err, email: unverifiedEmail },
                  'Failed to resend verification email on login',
                );
              });
          }
          return req.fail(outcome.code, outcome.message, outcome.details);
        }

        if (outcome.needsPasswordRehash) {
          void hashPassword(input.body.password, s.argon2Config)
            .then((upgradedHash) =>
              s.kernel.db.system((sysTx) =>
                identityRepository(sysTx).updateUser(outcome.dbUser.id, {
                  passwordHash: upgradedHash,
                }),
              ),
            )
            .catch((err: unknown) => {
              s.log.warn(
                { err, userId: outcome.dbUser.id },
                'Failed to upgrade password hash on login',
              );
            });
        }

        if (outcome.kind === 'totp' || outcome.kind === 'sms') {
          req.setStatus?.(202);
          return outcome.challenge;
        }

        metrics.recordLoginSuccess(provider);
        const { issued } = outcome;

        const isNewDevice = await s.kernel.db.system(async (sysTx) => {
          const repo = identityRepository(sysTx);
          try {
            await enforcePostLoginSessionHygieneInRepo(repo, {
              userId: issued.user.id,
              currentFamilyId: issued.familyId,
              maxConcurrentSessions: s.maxConcurrentSessions,
              deviceId,
              ipAddress: req.ip,
              userAgent: req.userAgent,
              now,
            });
          } catch (err: unknown) {
            s.log.warn({ err }, 'Failed to enforce post-login session hygiene');
          }

          const fingerprint =
            deviceId !== undefined
              ? generateStableDeviceFingerprint(deviceId)
              : generateDeviceFingerprint(`ip:${req.ip ?? ''}`, req.userAgent ?? '');
          const known = await repo.findTrustedDeviceByFingerprint(issued.user.id, fingerprint);
          try {
            await repo.upsertTrustedDeviceAccess({
              userId: issued.user.id,
              deviceFingerprint: fingerprint,
              ipAddress: req.ip ?? null,
              userAgent: req.userAgent ?? null,
              lastSeenAt: now,
            });
          } catch (err: unknown) {
            s.log.warn({ err }, 'Failed to record device access');
          }
          return known === null;
        });

        const loginActions = s.kernel.actions;
        if (loginActions !== undefined && loginActions.has('orgs.ensurePersonalOrg')) {
          try {
            await s.kernel.db.system((sysTx) =>
              loginActions.invoke('orgs.ensurePersonalOrg', sysTx, {
                userId: issued.user.id,
                email: issued.user.email,
                username: issued.user.username,
              }),
            );
          } catch (err: unknown) {
            s.log.warn({ err, userId: issued.user.id }, 'Failed to ensure personal tenant');
          }
        }

        if (isNewDevice) {
          if (s.sendEmail !== undefined) {
            const template = s.emailTemplates.newLoginAlert(
              req.ip ?? 'Unknown',
              req.userAgent ?? 'Unknown',
              now,
            );
            void s
              .sendEmail({
                to: issued.user.email,
                subject: template.subject,
                text: template.text ?? '',
                html: template.html ?? '',
              })
              .catch((err: unknown) => {
                s.log.warn(
                  { err, email: issued.user.email },
                  'Failed to send new login alert email',
                );
              });
          }
          void s.kernel.db
            .system((sysTx) =>
              publishAccountAlert(
                s.events,
                sysTx,
                {
                  alertType: 'new_device_login',
                  subjectUserId: issued.user.id,
                  subjectEmail: issued.user.email,
                  ...(req.ip !== undefined && req.ip !== null && req.ip !== ''
                    ? { ipAddress: req.ip }
                    : {}),
                },
                { actorUserId: issued.user.id },
              ),
            )
            .catch((err: unknown) => {
              s.log.warn({ err }, 'Failed to publish new_device_login account alert');
            });
        }

        req.setCookie?.(REFRESH_COOKIE_NAME, issued.refreshToken, issued.cookieOptions);
        return {
          user: issued.user,
          isNewDevice,
        };
      },

      refresh: async (_input, req, s) => {
        const oldRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
        if (oldRefreshToken === undefined || oldRefreshToken === '') {
          return req.fail('NO_REFRESH_TOKEN', 'No refresh token provided');
        }
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('INVALID_TOKEN', 'Invalid or expired token');
        }
        const jwtSecret = s.jwtSecret;
        const now = s.clock.now();

        const preCheck = await s.kernel.db.system(async (sysTx) => {
          const repo = identityRepository(sysTx);
          const tokenRecord = await repo.findRefreshTokenByValue(oldRefreshToken);
          const spanDays =
            tokenRecord === null
              ? undefined
              : sessionSpanDaysOf(tokenRecord.createdAt, tokenRecord.expiresAt);
          if (tokenRecord !== null && tokenRecord.rotatedAt === null) {
            const idleMs = now.getTime() - tokenRecord.createdAt.getTime();
            if (idleMs > sessionIdleWindowMs(spanDays ?? s.refreshExpiryDays)) {
              return { expiredIdle: true as const, spanDays };
            }
          }
          return { expiredIdle: false as const, spanDays };
        });

        if (preCheck.expiredIdle) {
          req.clearCookie?.(REFRESH_COOKIE_NAME, { path: '/' });
          return req.fail('INVALID_TOKEN', 'Invalid or expired token');
        }

        const effectiveSpanDays = preCheck.spanDays ?? s.refreshExpiryDays;
        const rotated = await s.kernel.db.system((sysTx) =>
          rotateRefreshTokenInRepo({
            repo: identityRepository(sysTx),
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx))),
            oldToken: oldRefreshToken,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            expiryDays: effectiveSpanDays,
            gracePeriodSeconds: s.refreshGracePeriodSeconds,
            now,
          }),
        );

        if (!rotated.ok) {
          req.clearCookie?.(REFRESH_COOKIE_NAME, { path: '/' });
          if (
            rotated.kind === 'reuse' &&
            rotated.email !== undefined &&
            rotated.email !== '' &&
            s.sendEmail !== undefined
          ) {
            const template = s.emailTemplates.tokenReuseAlert(
              req.ip ?? 'Unknown',
              req.userAgent ?? 'Unknown',
              now,
            );
            void s
              .sendEmail({
                to: rotated.email,
                subject: template.subject,
                text: template.text ?? '',
                html: template.html ?? '',
              })
              .catch((err: unknown) => {
                s.log.error(
                  { err, userId: rotated.userId, email: rotated.email },
                  'Failed to send token reuse alert email',
                );
              });
          }
          return req.fail('INVALID_TOKEN', 'Invalid or expired token');
        }

        const accessToken = buildRotatedSessionAccessToken(
          rotated.user,
          jwtSecret,
          s.accessTokenExpiry,
        );
        req.setCookie?.(REFRESH_COOKIE_NAME, rotated.token, {
          httpOnly: s.cookieConfig.httpOnly,
          secure: s.cookieConfig.secure,
          sameSite: s.cookieConfig.sameSite,
          path: s.cookieConfig.path,
          maxAge: Math.round(effectiveSpanDays * 86_400),
        });
        return { token: accessToken };
      },

      logout: async (_input, req, s) => {
        const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
        if (refreshToken !== undefined && refreshToken !== '') {
          await s.kernel.db.system((sysTx) =>
            identityRepository(sysTx).deleteRefreshTokenByValue(refreshToken),
          );
        }
        req.clearCookie?.(REFRESH_COOKIE_NAME, { path: '/' });
        return { message: 'Logged out successfully' };
      },

      authStrategies: (_input, _req, s) => {
        const rawList = s.strategyList ?? ['local'];
        const enabled = rawList.filter((item): item is AuthStrategy =>
          (AUTH_STRATEGIES as readonly string[]).includes(item),
        );
        const disabled = AUTH_STRATEGIES.filter((item) => !enabled.includes(item));
        return Promise.resolve({ enabled, disabled });
      },

      verifyEmail: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('local')) {
          return req.fail('LOCAL_AUTH_DISABLED', 'Local authentication is not enabled');
        }
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('INVALID_TOKEN', 'Invalid or expired verification token');
        }
        const jwtSecret = s.jwtSecret;
        const res = await s.kernel.db.system((sysTx) =>
          verifyEmailInRepo({
            repo: identityRepository(sysTx),
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx))),
            token: input.body.token,
            jwtSecret,
            accessTokenExpiry: s.accessTokenExpiry,
            refreshExpiryDays: s.refreshExpiryDays,
            cookieConfig: s.cookieConfig,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        req.setCookie?.(REFRESH_COOKIE_NAME, res.issued.refreshToken, res.issued.cookieOptions);
        return {
          verified: true,
          token: res.issued.token,
          user: res.issued.user,
        };
      },

      resendVerification: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('local')) {
          return req.fail('LOCAL_AUTH_DISABLED', 'Local authentication is not enabled');
        }
        const res = await s.kernel.db.system((sysTx) =>
          resendVerificationEmailInRepo({
            repo: identityRepository(sysTx),
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx))),
            email: input.body.email,
            appBaseUrl: s.appBaseUrl,
            emailTemplates: s.emailTemplates,
            sendEmail: s.sendEmail,
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          s.log.error({ error: res.error }, 'Failed to resend verification email');
          return req.fail(
            'EMAIL_SEND_FAILED',
            'Failed to send email. Please try again or use the resend option.',
          );
        }
        return {
          message:
            'Verification email sent. Please check your inbox and click the confirmation link.',
        };
      },

      forgotPassword: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('local')) {
          return req.fail('LOCAL_AUTH_DISABLED', 'Local authentication is not enabled');
        }
        if (s.captchaConfig.enabled) {
          const captcha = await verifyCaptchaToken(
            s.captchaConfig,
            input.body.captchaToken ?? '',
            req.ip,
          );
          if (!captcha.success) {
            return req.fail('CAPTCHA_VERIFICATION_FAILED', 'CAPTCHA verification failed');
          }
        }
        if (s.sendEmail !== undefined) {
          const sendEmail = s.sendEmail;
          try {
            await s.kernel.db.system((sysTx) =>
              requestPasswordResetInRepo(
                identityRepository(sysTx),
                sendEmail,
                input.body.email,
                s.appBaseUrl,
                s.emailTemplates,
                s.clock.now(),
              ),
            );
          } catch (err: unknown) {
            s.log.error(
              {
                email: input.body.email,
                originalError: err instanceof Error ? err.message : String(err),
              },
              'Failed to send password reset email',
            );
          }
        }
        return { message: 'Password reset email sent' };
      },

      resetPassword: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('local')) {
          return req.fail('LOCAL_AUTH_DISABLED', 'Local authentication is not enabled');
        }
        const now = s.clock.now();
        const res = await s.kernel.db.system((sysTx) =>
          resetPasswordInRepo({
            repo: identityRepository(sysTx),
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx))),
            token: input.body.token,
            newPassword: input.body.password,
            argon2Config: s.argon2Config,
            now,
          }),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message, res.details);
        }

        const resetUser = res.user;
        void s.kernel.db
          .system((sysTx) =>
            publishAccountAlert(
              s.events,
              sysTx,
              {
                alertType: 'password_reset',
                subjectUserId: resetUser.id,
                subjectEmail: resetUser.email,
                ...(resetUser.username !== null && resetUser.username !== ''
                  ? { subjectUsername: resetUser.username }
                  : {}),
              },
              { actorUserId: resetUser.id },
            ),
          )
          .catch((err: unknown) => {
            s.log.warn(
              { reason: err instanceof Error ? err.message : String(err) },
              'Failed to publish password_reset account alert',
            );
          });

        if (s.sendEmail !== undefined) {
          const template = s.emailTemplates.passwordChangedAlert(
            req.ip ?? 'Unknown',
            req.userAgent ?? 'Unknown',
            now,
          );
          void s
            .sendEmail({
              to: resetUser.email,
              subject: template.subject,
              text: template.text ?? '',
              html: template.html ?? '',
            })
            .catch((err: unknown) => {
              s.log.warn(
                { err, email: resetUser.email },
                'Failed to send password changed alert email',
              );
            });
        }

        return { message: 'Password reset successfully' };
      },

      setPassword: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('local')) {
          return req.fail('LOCAL_AUTH_DISABLED', 'Local authentication is not enabled');
        }
        const res = await req.tx((tx) =>
          setPasswordInRepo(
            identityRepository(tx),
            req.viewer.userId,
            input.body.password,
            s.argon2Config,
          ),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message, res.details);
        }
        return { message: 'Password set successfully' };
      },

      magicLinkRequest: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('magic')) {
          return req.fail('MAGIC_LINK_DISABLED', 'Magic link authentication is not enabled');
        }
        if (s.kernel.actions?.has('orgs.checkDomainSsoEnforcement') === true) {
          const ssoAction = s.kernel.actions;
          const ssoCheck = await s.kernel.db.system((sysTx) =>
            ssoAction.invoke<{
              readonly enforced: boolean;
              readonly orgSlug?: string;
              readonly providerName?: string;
            }>('orgs.checkDomainSsoEnforcement', sysTx, { email: input.body.email }),
          );
          if (ssoCheck.enforced) {
            return req.fail(
              'SSO_REQUIRED',
              ssoCheck.providerName !== undefined
                ? `Your organization requires Single Sign-On (${ssoCheck.providerName}).`
                : 'Your organization requires Single Sign-On.',
              {
                ...(ssoCheck.orgSlug !== undefined ? { orgSlug: ssoCheck.orgSlug } : {}),
                ...(ssoCheck.providerName !== undefined
                  ? { providerName: ssoCheck.providerName }
                  : {}),
                ...(ssoCheck.orgSlug !== undefined
                  ? {
                      initiateUrl: `/api/auth/sso/oidc/${encodeURIComponent(ssoCheck.orgSlug)}/initiate`,
                    }
                  : {}),
              },
            );
          }
        }
        const res = await s.kernel.db.system((sysTx) =>
          requestMagicLinkInRepo({
            repo: identityRepository(sysTx),
            email: input.body.email,
            appBaseUrl: s.appBaseUrl,
            emailTemplates: s.emailTemplates,
            sendEmail: s.sendEmail,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            tokenExpiryMinutes: s.magicLinkExpiryMinutes,
            maxAttemptsPerEmail: s.magicLinkMaxAttempts,
            onEmailError: (error) => {
              s.log.error(
                { email: input.body.email, originalError: error },
                'Failed to send magic link email',
              );
            },
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      magicLinkVerify: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('magic')) {
          return req.fail('MAGIC_LINK_DISABLED', 'Magic link authentication is not enabled');
        }
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('INVALID_TOKEN', 'Invalid or expired magic link');
        }
        const jwtSecret = s.jwtSecret;
        const metrics = getMetricsCollector();
        const provider = 'magic';
        metrics.recordLoginAttempt(provider);

        const peekAgreements: SignupComplianceHooks['peekAgreements'] = async (tx: Tx) => {
          const actions = s.kernel.actions;
          if (actions === undefined || !actions.has('compliance.peekSignupAgreements')) {
            return [];
          }
          const docs = await actions.invoke<ReadonlyArray<{ readonly id: string }>>(
            'compliance.peekSignupAgreements',
            tx,
            {},
          );
          return docs;
        };
        const recordConsents: SignupComplianceHooks['recordConsents'] = async (tx, consentData) => {
          const actions = s.kernel.actions;
          if (actions === undefined || !actions.has('compliance.recordSignupConsents')) {
            return;
          }
          await actions.invoke('compliance.recordSignupConsents', tx, consentData);
        };

        const res = await s.kernel.db.system((sysTx) =>
          verifyMagicLinkInRepo({
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx), sysTx)),
            token: input.body.token,
            eligibilityAttested: input.body.eligibilityAttested,
            tosAccepted: input.body.tosAccepted,
            jwtSecret,
            accessTokenExpiry: s.accessTokenExpiry,
            refreshExpiryDays: s.refreshExpiryDays,
            cookieConfig: s.cookieConfig,
            peekAgreements,
            recordConsents,
            onUserCreatedInTx: async (tx, newUser) => {
              await publishUserRegistered(
                s.events,
                tx,
                {
                  userId: newUser.id,
                  email: newUser.email,
                  ...(newUser.username !== null && newUser.username !== ''
                    ? { username: newUser.username }
                    : {}),
                  ...(newUser.firstName !== '' ? { firstName: newUser.firstName } : {}),
                },
                { actorUserId: newUser.id },
              );
            },
            ipAddress: req.ip,
            userAgent: req.userAgent,
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          metrics.recordLoginFailure(provider);
          return req.fail(res.code, res.message, res.details);
        }

        metrics.recordLoginSuccess(provider);
        req.setCookie?.(REFRESH_COOKIE_NAME, res.issued.refreshToken, res.issued.cookieOptions);

        const magicActions = s.kernel.actions;
        if (magicActions !== undefined && magicActions.has('orgs.ensurePersonalOrg')) {
          try {
            await s.kernel.db.system((sysTx) =>
              magicActions.invoke('orgs.ensurePersonalOrg', sysTx, {
                userId: res.issued.user.id,
                email: res.issued.user.email,
                username: res.issued.user.username,
              }),
            );
          } catch (err: unknown) {
            s.log.warn({ err, userId: res.issued.user.id }, 'Failed to ensure personal tenant');
          }
        }

        return res.response;
      },

      emailOtpRequest: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('magic')) {
          return req.fail('MAGIC_LINK_DISABLED', 'Email code authentication is not enabled');
        }
        if (s.kernel.actions?.has('orgs.checkDomainSsoEnforcement') === true) {
          const ssoAction = s.kernel.actions;
          const ssoCheck = await s.kernel.db.system((sysTx) =>
            ssoAction.invoke<{
              readonly enforced: boolean;
              readonly orgSlug?: string;
              readonly providerName?: string;
            }>('orgs.checkDomainSsoEnforcement', sysTx, { email: input.body.email }),
          );
          if (ssoCheck.enforced) {
            return req.fail(
              'SSO_REQUIRED',
              ssoCheck.providerName !== undefined
                ? `Your organization requires Single Sign-On (${ssoCheck.providerName}).`
                : 'Your organization requires Single Sign-On.',
              {
                ...(ssoCheck.orgSlug !== undefined ? { orgSlug: ssoCheck.orgSlug } : {}),
                ...(ssoCheck.providerName !== undefined
                  ? { providerName: ssoCheck.providerName }
                  : {}),
                ...(ssoCheck.orgSlug !== undefined
                  ? {
                      initiateUrl: `/api/auth/sso/oidc/${encodeURIComponent(ssoCheck.orgSlug)}/initiate`,
                    }
                  : {}),
              },
            );
          }
        }
        const res = await s.kernel.db.system((sysTx) =>
          requestEmailOtpInRepo({
            repo: identityRepository(sysTx),
            email: input.body.email,
            emailTemplates: s.emailTemplates,
            sendEmail: s.sendEmail,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            onEmailError: (error) => {
              s.log.error(
                { email: input.body.email, originalError: error },
                'Failed to send email OTP',
              );
            },
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      emailOtpVerify: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('magic')) {
          return req.fail('MAGIC_LINK_DISABLED', 'Email code authentication is not enabled');
        }
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('INVALID_TOKEN', 'Invalid or expired security code');
        }
        const jwtSecret = s.jwtSecret;
        const metrics = getMetricsCollector();
        const provider = 'email_otp';
        metrics.recordLoginAttempt(provider);

        const peekAgreements: SignupComplianceHooks['peekAgreements'] = async (tx: Tx) => {
          const actions = s.kernel.actions;
          if (actions === undefined || !actions.has('compliance.peekSignupAgreements')) {
            return [];
          }
          const docs = await actions.invoke<ReadonlyArray<{ readonly id: string }>>(
            'compliance.peekSignupAgreements',
            tx,
            {},
          );
          return docs;
        };
        const recordConsents: SignupComplianceHooks['recordConsents'] = async (tx, consentData) => {
          const actions = s.kernel.actions;
          if (actions === undefined || !actions.has('compliance.recordSignupConsents')) {
            return;
          }
          await actions.invoke('compliance.recordSignupConsents', tx, consentData);
        };

        const res = await s.kernel.db.system((sysTx) =>
          verifyEmailOtpInRepo({
            runInTx: (fn) => Promise.resolve(fn(identityRepository(sysTx), sysTx)),
            email: input.body.email,
            code: input.body.code,
            eligibilityAttested: input.body.eligibilityAttested,
            tosAccepted: input.body.tosAccepted,
            jwtSecret,
            accessTokenExpiry: s.accessTokenExpiry,
            refreshExpiryDays: s.refreshExpiryDays,
            cookieConfig: s.cookieConfig,
            peekAgreements,
            recordConsents,
            onUserCreatedInTx: async (tx, newUser) => {
              await publishUserRegistered(
                s.events,
                tx,
                {
                  userId: newUser.id,
                  email: newUser.email,
                  ...(newUser.username !== null && newUser.username !== ''
                    ? { username: newUser.username }
                    : {}),
                  ...(newUser.firstName !== '' ? { firstName: newUser.firstName } : {}),
                },
                { actorUserId: newUser.id },
              );
            },
            ipAddress: req.ip,
            userAgent: req.userAgent,
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          metrics.recordLoginFailure(provider);
          return req.fail(res.code, res.message, res.details);
        }

        metrics.recordLoginSuccess(provider);
        req.setCookie?.(REFRESH_COOKIE_NAME, res.issued.refreshToken, res.issued.cookieOptions);

        const otpActions = s.kernel.actions;
        if (otpActions !== undefined && otpActions.has('orgs.ensurePersonalOrg')) {
          try {
            await s.kernel.db.system((sysTx) =>
              otpActions.invoke('orgs.ensurePersonalOrg', sysTx, {
                userId: res.issued.user.id,
                email: res.issued.user.email,
                username: res.issued.user.username,
              }),
            );
          } catch (err: unknown) {
            s.log.warn({ err, userId: res.issued.user.id }, 'Failed to ensure personal tenant');
          }
        }

        if (res.createdUser !== undefined) {
          const created = res.createdUser;
          void s.kernel.db
            .system((sysTx) =>
              publishAccountAlert(
                s.events,
                sysTx,
                {
                  alertType: 'user_signup',
                  subjectUserId: created.id,
                  subjectEmail: created.email,
                  ...(created.username !== null && created.username !== ''
                    ? { subjectUsername: created.username }
                    : {}),
                  ...(req.ip !== undefined && req.ip !== null && req.ip !== ''
                    ? { ipAddress: req.ip }
                    : {}),
                },
                { actorUserId: created.id },
              ),
            )
            .catch((err: unknown) => {
              s.log.warn({ err, userId: created.id }, 'Failed to publish email OTP signup alert');
            });
        }

        return res.response;
      },

      completeOnboarding: async (input, req, s) => {
        const systemUsernames = {
          findUserByUsername: (username: string) =>
            s.kernel.db.system((sysTx) => identityRepository(sysTx).findUserByUsername(username)),
        };
        const res = await req.tx((tx) =>
          completeOnboardingInRepo(
            identityRepository(tx),
            systemUsernames,
            req.viewer.userId,
            input.body,
            s.argon2Config,
          ),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message, res.details);
        }
        return { user: res.user };
      },

      changeEmail: async (input, req, s) => {
        const systemRepo = {
          findUserByEmail: (email: string) =>
            s.kernel.db.system((sysTx) => identityRepository(sysTx).findUserByEmail(email)),
          invalidateUnusedAuthTokens: (type: 'email_change', userId: string, now?: Date) =>
            s.kernel.db.system((sysTx) =>
              identityRepository(sysTx).invalidateUnusedAuthTokens(type, userId, now),
            ),
          insertAuthToken: (data: Parameters<IdentityRepository['insertAuthToken']>[0]) =>
            s.kernel.db.system((sysTx) => identityRepository(sysTx).insertAuthToken(data)),
        };
        const res = await req.tx((tx) =>
          initiateEmailChangeInRepo({
            viewerRepo: identityRepository(tx),
            systemRepo,
            userId: req.viewer.userId,
            newEmail: input.body.newEmail,
            password: input.body.password,
            argon2Config: s.argon2Config,
            appBaseUrl: s.appBaseUrl,
            emailTemplates: s.emailTemplates,
            sendEmail: s.sendEmail,
            onEmailError: (err) => {
              s.log.error({ err }, 'Failed to send email change verification');
            },
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      confirmEmailChange: async (input, req, s) => {
        const now = s.clock.now();
        const res = await s.kernel.db.system((sysTx) =>
          confirmEmailChangeInRepo(identityRepository(sysTx), input.body.token, now),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        if (s.sendEmail !== undefined) {
          const revertUrl = `${s.appBaseUrl}/auth/change-email/revert?token=${res.revertToken}`;
          const template = s.emailTemplates.emailChangedAlert(
            res.value.email,
            req.ip ?? 'Unknown',
            req.userAgent ?? 'Unknown',
            now,
            revertUrl,
          );
          void s
            .sendEmail({
              to: res.previousEmail,
              subject: template.subject,
              text: template.text ?? '',
              html: template.html ?? '',
            })
            .catch((err: unknown) => {
              s.log.warn(
                { err, previousEmail: res.previousEmail },
                'Failed to send email changed alert',
              );
            });
        }
        return res.value;
      },

      revertEmailChange: async (input, req, s) => {
        const res = await s.kernel.db.system((sysTx) =>
          revertEmailChangeInRepo(identityRepository(sysTx), input.body.token, s.clock.now()),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },
      // -----------------------------------------------------------------------
      // API Keys
      // -----------------------------------------------------------------------
      listApiKeys: async (_input, req) => ({
        keys: await req.tx((tx) => listApiKeysForOwner(req.viewer.userId, identityRepository(tx))),
      }),

      createApiKey: async (input, req, s) => ({
        key: await req.tx(async (tx) => {
          const created = await createApiKeyForOwner(
            req.viewer.userId,
            input.body,
            identityRepository(tx),
            s.clock.now(),
            req.viewer.actingOrg?.orgId ?? null,
          );
          await s.events.publish(
            tx,
            identityEvents.apiKeyCreated,
            {
              keyId: created.id,
              userId: req.viewer.userId,
              keyPrefix: created.keyPrefix,
            },
            { actorUserId: req.viewer.userId, orgId: req.viewer.actingOrg?.orgId ?? null },
          );
          return created;
        }),
      }),

      deleteApiKey: async (input, req, s) => {
        const deleted = await req.tx(async (tx) => {
          const record = await deleteApiKeyForOwner(
            req.viewer.userId,
            input.params.id,
            identityRepository(tx),
          );
          if (record !== null) {
            await s.events.publish(
              tx,
              identityEvents.apiKeyRevoked,
              {
                keyId: record.id,
                userId: req.viewer.userId,
              },
              { actorUserId: req.viewer.userId, orgId: req.viewer.actingOrg?.orgId ?? null },
            );
          }
          return record;
        });
        if (deleted === null) {
          return req.fail('API_KEY_NOT_FOUND', 'API key not found');
        }
        return { id: deleted.id };
      },

      // -----------------------------------------------------------------------
      // Self-Service User Profile, Sessions & Lifecycle (`/api/users/me*`)
      // -----------------------------------------------------------------------
      me: async (_input, req) => {
        const res = await req.tx((tx) => getMeProfile(identityRepository(tx), req.viewer.userId));
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      getProfileCompleteness: async (_input, req) => {
        const res = await req.tx((tx) =>
          getUserProfileCompleteness(identityRepository(tx), req.viewer.userId),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      updateProfile: async (input, req, s) => {
        const systemUsernames = {
          findUserByUsername: (username: string) =>
            s.kernel.db.system((sysTx) => identityRepository(sysTx).findUserByUsername(username)),
        };
        const res = await req.tx((tx) =>
          updateUserProfile(identityRepository(tx), req.viewer.userId, input.body, systemUsernames),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      updateUsername: async (input, req, s) => {
        const systemUsernames = {
          findUserByUsername: (username: string) =>
            s.kernel.db.system((sysTx) => identityRepository(sysTx).findUserByUsername(username)),
        };
        const res = await req.tx((tx) =>
          updateUsernameForUser(
            identityRepository(tx),
            req.viewer.userId,
            input.body.username,
            systemUsernames,
            s.clock.now(),
          ),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      changePassword: async (input, req, s) => {
        const res = await req.tx(async (tx) => {
          const changed = await changeUserPassword(
            identityRepository(tx),
            req.viewer.userId,
            input.body.currentPassword,
            input.body.newPassword,
            s.argon2Config,
            s.clock.now(),
          );
          if (changed.ok) {
            await publishAccountAlert(
              s.events,
              tx,
              {
                alertType: 'password_changed',
                subjectUserId: req.viewer.userId,
                subjectEmail: changed.value.email,
                ...(changed.value.username !== null && changed.value.username !== ''
                  ? { subjectUsername: changed.value.username }
                  : {}),
              },
              { actorUserId: req.viewer.userId },
            );
          }
          return changed;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return { success: true, message: 'Password changed successfully' };
      },

      listSessions: async (_input, req) => {
        const sessions = await req.tx(async (tx) => {
          const currentFamilyId = await resolveCurrentFamilyIdFromCookies(tx, req.cookies);
          return listSessionsForUser(identityRepository(tx), req.viewer.userId, currentFamilyId);
        });
        return { sessions };
      },

      revokeSession: async (input, req, s) => {
        const res = await req.tx(async (tx) => {
          const currentFamilyId = await resolveCurrentFamilyIdFromCookies(tx, req.cookies);
          const revoked = await revokeSessionForUser(
            identityRepository(tx),
            req.viewer.userId,
            input.params.id,
            currentFamilyId,
            s.clock.now(),
          );
          if (revoked.ok) {
            await publishSessionRevoked(
              s.events,
              tx,
              { userId: req.viewer.userId, sessionId: input.params.id },
              { actorUserId: req.viewer.userId },
            );
          }
          return revoked;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      revokeAllSessions: async (_input, req, s) => {
        const revokedCount = await req.tx(async (tx) => {
          const currentFamilyId = await resolveCurrentFamilyIdFromCookies(tx, req.cookies);
          const count = await revokeAllSessionsForUser(
            identityRepository(tx),
            req.viewer.userId,
            currentFamilyId,
            s.clock.now(),
          );
          await publishSessionRevoked(
            s.events,
            tx,
            { userId: req.viewer.userId },
            { actorUserId: req.viewer.userId },
          );
          return count;
        });
        return { success: true, revokedCount };
      },

      deactivateAccount: async (_input, req, s) => {
        assertSudoForViewer(
          req,
          s.jwtSecret,
          'Sudo re-authentication required for this action. Please re-verify your identity.',
        );
        const res = await req.tx(async (tx) => {
          const out = await deactivateUserAccount(
            identityRepository(tx),
            req.viewer.userId,
            s.clock.now(),
          );
          if (out.ok) {
            await publishAccountAlert(
              s.events,
              tx,
              {
                alertType: 'account_deactivated',
                subjectUserId: req.viewer.userId,
                subjectEmail: out.value.email,
                ...(out.value.username !== null && out.value.username !== ''
                  ? { subjectUsername: out.value.username }
                  : {}),
              },
              { actorUserId: req.viewer.userId },
            );
          }
          return out;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info({ userId: req.viewer.userId }, 'Account deactivated');
        return { message: res.value.message, status: res.value.status };
      },

      deleteAccount: async (_input, req, s) => {
        assertSudoForViewer(
          req,
          s.jwtSecret,
          'Sudo re-authentication required for this action. Please re-verify your identity.',
        );
        const res = await req.tx(async (tx) => {
          const out = await requestUserDeletion(
            identityRepository(tx),
            req.viewer.userId,
            s.clock.now(),
          );
          if (out.ok) {
            await publishAccountAlert(
              s.events,
              tx,
              {
                alertType: 'deletion_requested',
                subjectUserId: req.viewer.userId,
                subjectEmail: out.value.email,
                ...(out.value.username !== null && out.value.username !== ''
                  ? { subjectUsername: out.value.username }
                  : {}),
              },
              { actorUserId: req.viewer.userId },
            );
          }
          return out;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          { userId: req.viewer.userId, gracePeriodEnds: res.value.deletionGracePeriodEnds },
          'Account deletion requested',
        );
        return {
          message: res.value.message,
          status: res.value.status,
          ...(res.value.deletionGracePeriodEnds !== undefined
            ? { deletionGracePeriodEnds: res.value.deletionGracePeriodEnds }
            : {}),
        };
      },

      reactivateAccount: async (_input, req, s) => {
        const res = await req.tx(async (tx) => {
          const out = await reactivateUserAccount(
            identityRepository(tx),
            req.viewer.userId,
            s.clock.now(),
          );
          if (out.ok) {
            await publishAccountAlert(
              s.events,
              tx,
              {
                alertType: 'account_reactivated',
                subjectUserId: req.viewer.userId,
                subjectEmail: out.value.email,
                ...(out.value.username !== null && out.value.username !== ''
                  ? { subjectUsername: out.value.username }
                  : {}),
              },
              { actorUserId: req.viewer.userId },
            );
          }
          return out;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info({ userId: req.viewer.userId }, 'Account reactivated');
        return { message: res.value.message, status: res.value.status };
      },

      // -----------------------------------------------------------------------
      // Administrative User Management (`/api/admin/users*`)
      // -----------------------------------------------------------------------
      adminListUsers: async (input, req, s) => {
        const result = await req.tx((tx) => adminListUsers(identityRepository(tx), input.query));
        s.log.info(
          { adminId: req.viewer.userId, filters: input.query, resultCount: result.data.length },
          'Admin listed users',
        );
        return result;
      },

      adminSearchUsers: async (input, req, s) => {
        const result = await req.tx((tx) =>
          adminSearchUsers(identityRepository(tx), input.query.q, {
            limit: input.query.limit,
            offset: input.query.offset,
          }),
        );
        s.log.info(
          { adminId: req.viewer.userId, query: input.query.q, resultCount: result.users.length },
          'Admin searched users',
        );
        return result;
      },

      adminGetUser: async (input, req, s) => {
        const res = await req.tx((tx) => adminGetUser(identityRepository(tx), input.params.id));
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          { adminId: req.viewer.userId, targetUserId: input.params.id },
          'Admin retrieved user',
        );
        return res.value;
      },

      adminCreateUser: async (input, req, s) => {
        const res = await req.tx((tx) =>
          adminCreateInvitedUser(identityRepository(tx), input.body, s.argon2Config, s.clock.now()),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        if (s.sendEmail !== undefined) {
          sendUserInviteEmail(s.sendEmail, res.value.email, s.appBaseUrl).catch((err: unknown) => {
            s.log.warn({ err, newUserId: res.value.id }, 'Failed to send user invite email');
          });
        }
        s.log.info({ adminId: req.viewer.userId, newUserId: res.value.id }, 'Admin created a user');
        return {
          message: 'User created. An invitation email has been sent.',
          user: res.value,
        };
      },

      adminUpdateUser: async (input, req, s) => {
        const res = await req.tx((tx) =>
          adminUpdateUser(identityRepository(tx), input.params.id, input.body),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          {
            adminId: req.viewer.userId,
            targetUserId: input.params.id,
            updates: Object.keys(input.body),
          },
          'Admin updated user',
        );
        return { message: 'User updated successfully', user: res.value };
      },

      adminLockUser: async (input, req, s) => {
        if (input.params.id === req.viewer.userId) {
          return req.fail('SELF_LOCK_FORBIDDEN', 'Cannot lock your own account');
        }
        const res = await req.tx((tx) =>
          adminLockUser(
            identityRepository(tx),
            input.params.id,
            input.body.reason,
            input.body.durationMinutes,
            {
              sendEmail: s.sendEmail,
              onEmailError: (err) => {
                s.log.warn({ err, targetUserId: input.params.id }, 'Failed to send lock email');
              },
              now: s.clock.now(),
            },
          ),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          {
            adminId: req.viewer.userId,
            targetUserId: input.params.id,
            reason: input.body.reason,
            durationMinutes: input.body.durationMinutes,
          },
          'Admin locked user account',
        );
        return { message: 'User account locked successfully', user: res.value };
      },

      adminUnlockUser: async (input, req, s) => {
        const res = await req.tx((tx) =>
          adminUnlockUser(identityRepository(tx), input.params.id, {
            sendEmail: s.sendEmail,
            onEmailError: (err) => {
              s.log.warn({ err, targetUserId: input.params.id }, 'Failed to send unlock email');
            },
          }),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          { adminId: req.viewer.userId, targetUserId: input.params.id, reason: input.body.reason },
          'Admin unlocked user account',
        );
        return { message: 'User account unlocked successfully', user: res.value };
      },

      adminForceLogoutUser: async (input, req, s) => {
        const res = await req.tx(async (tx) => {
          const out = await adminForceLogoutUser(
            identityRepository(tx),
            input.params.id,
            s.clock.now(),
          );
          if (out.ok) {
            await s.events.publish(
              tx,
              identityEvents.userForceLoggedOut,
              {
                userId: input.params.id,
                email: out.value.email,
                adminUserId: req.viewer.userId,
                reason: input.body.reason,
                revokedSessions: out.value.revokedSessions,
              },
              { actorUserId: req.viewer.userId },
            );
          }
          return out;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          {
            adminId: req.viewer.userId,
            targetUserId: input.params.id,
            reason: input.body.reason,
            revokedSessions: res.value.revokedSessions,
          },
          'Admin force-logged-out user',
        );
        return { message: res.value.message, revokedSessions: res.value.revokedSessions };
      },

      adminHardBanUser: async (input, req, s) => {
        if (input.params.id === req.viewer.userId) {
          return req.fail('SELF_BAN_FORBIDDEN', 'Cannot ban your own account');
        }
        assertSudoForViewer(
          req,
          s.jwtSecret,
          'Sudo re-authentication required for hard ban. Please re-verify your identity.',
        );

        const cancelSubscriptions = async (bannedUserId: string): Promise<boolean> => {
          const actions = s.kernel.actions;
          if (actions === undefined || !actions.has('billing.cancelSubscriptionsForBannedUser')) {
            return false;
          }
          const outcome = await s.kernel.db.system((sysTx) =>
            actions.invoke<{ readonly cancelled?: boolean } | undefined>(
              'billing.cancelSubscriptionsForBannedUser',
              sysTx,
              { userId: bannedUserId },
            ),
          );
          return outcome !== undefined && outcome.cancelled === true;
        };

        const res = await req.tx(async (tx) => {
          const out = await adminHardBanUser(
            identityRepository(tx),
            input.params.id,
            input.body.reason,
            {
              cancelSubscriptions,
              onCancelError: (err) => {
                s.log.error(
                  {
                    userId: input.params.id,
                    error: err instanceof Error ? err.message : String(err),
                  },
                  'Hard ban: subscription cancellation failed; the banned user may retain an active subscription',
                );
              },
              sendEmail: s.sendEmail,
              onEmailError: (err) => {
                s.log.warn(
                  {
                    userId: input.params.id,
                    error: err instanceof Error ? err.message : String(err),
                  },
                  'Hard ban: notification email failed to send',
                );
              },
              now: s.clock.now(),
            },
          );
          if (out.ok) {
            await s.events.publish(
              tx,
              identityEvents.userHardBanned,
              {
                userId: input.params.id,
                email: out.value.email,
                adminUserId: req.viewer.userId,
                reason: input.body.reason,
                gracePeriodEnds: out.value.gracePeriodEnds,
              },
              { actorUserId: req.viewer.userId },
            );
          }
          return out;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          {
            adminId: req.viewer.userId,
            targetUserId: input.params.id,
            reason: input.body.reason,
            gracePeriodEnds: res.value.gracePeriodEnds,
            subscriptionsCancelled: res.value.subscriptionsCancelled,
          },
          'Admin hard-banned user account',
        );
        return {
          message: res.value.message,
          gracePeriodEnds: res.value.gracePeriodEnds,
          subscriptionsCancelled: res.value.subscriptionsCancelled,
        };
      },

      adminDeleteUser: async (input, req, s) => {
        if (input.params.id === req.viewer.userId) {
          return req.fail('SELF_DELETE_FORBIDDEN', 'Cannot delete your own account');
        }
        assertSudoForViewer(
          req,
          s.jwtSecret,
          'Sudo re-authentication required to delete a user. Please re-verify your identity.',
        );

        const res = await req.tx(async (tx) => {
          const out = await adminSoftDeleteUser(
            identityRepository(tx),
            input.params.id,
            s.clock.now(),
          );
          if (out.ok && !out.value.alreadyDeleted) {
            await s.events.publish(
              tx,
              identityEvents.userSoftDeleted,
              {
                userId: input.params.id,
                email: out.value.email,
                adminUserId: req.viewer.userId,
                reason: input.body.reason,
              },
              { actorUserId: req.viewer.userId },
            );
          }
          return out;
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        s.log.info(
          { adminId: req.viewer.userId, targetUserId: input.params.id, reason: input.body.reason },
          'Admin soft-deleted user account',
        );
        return { message: res.value.message };
      },

      adminResetUserPassword: async (input, req, s) => {
        const userRes = await req.tx((tx) => adminGetUser(identityRepository(tx), input.params.id));
        if (!userRes.ok) {
          return req.fail(userRes.code, userRes.message);
        }
        if (s.sendEmail === undefined) {
          return req.fail(
            'EMAIL_SERVICE_UNAVAILABLE',
            'Email service is not configured; cannot send a password reset.',
          );
        }
        const sendEmail = s.sendEmail;
        await s.kernel.db.system((sysTx) =>
          requestPasswordResetInRepo(
            identityRepository(sysTx),
            sendEmail,
            userRes.value.email,
            s.appBaseUrl,
            s.emailTemplates,
            s.clock.now(),
          ),
        );
        s.log.info(
          { adminId: req.viewer.userId, targetUserId: input.params.id, reason: input.body.reason },
          'Admin triggered a password reset for user',
        );
        return { message: 'Password reset email sent to the user.' };
      },

      sudo: async (input, req, s) => {
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('INVALID_CREDENTIALS', 'JWT secret not configured');
        }
        const jwtSecret = s.jwtSecret;
        const res = await req.tx((tx) =>
          elevateSudoInRepo(identityRepository(tx), req.viewer.userId, input.body, {
            jwtSecret,
            encryptionKey: s.totpOptions.encryptionKey,
            totpWindow: s.totpOptions.window,
            argon2Config: s.argon2Config,
            now: s.clock.now(),
          }),
        );
        if (!res.ok) {
          s.log.warn({ userId: req.viewer.userId, code: res.code }, 'Sudo elevation failed');
          return req.fail(res.code, res.message);
        }
        s.log.info({ userId: req.viewer.userId }, 'Sudo elevation granted');
        return res.value;
      },

      logoutAll: async (_input, req, s) => {
        await req.tx(async (tx) => {
          await invalidateAllUserSessionsInRepo(
            identityRepository(tx),
            req.viewer.userId,
            s.clock.now(),
          );
          await publishSessionRevoked(
            s.events,
            tx,
            { userId: req.viewer.userId },
            { actorUserId: req.viewer.userId },
          );
        });
        req.clearCookie?.(REFRESH_COOKIE_NAME, { path: '/' });
        return { message: 'Logged out from all devices' };
      },

      invalidateSessions: async (_input, req, s) => {
        await req.tx((tx) =>
          invalidateAllUserSessionsInRepo(identityRepository(tx), req.viewer.userId, s.clock.now()),
        );
        req.clearCookie?.(REFRESH_COOKIE_NAME, { path: '/' });
        return { message: 'All sessions invalidated' };
      },

      listDevices: async (_input, req) => {
        const devices = await req.tx((tx) =>
          listDevicesForUser(identityRepository(tx), req.viewer.userId),
        );
        return { devices };
      },

      trustDevice: async (input, req, s) => {
        const res = await req.tx((tx) =>
          trustDeviceForUser(
            identityRepository(tx),
            req.viewer.userId,
            input.params.id,
            s.clock.now(),
          ),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      revokeDevice: async (input, req) => {
        const res = await req.tx((tx) =>
          revokeDeviceForUser(identityRepository(tx), req.viewer.userId, input.params.id),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      setPhone: async (input, req, s) => {
        if (!PHONE_REGEX.test(input.body.phone)) {
          return req.fail('INVALID_PHONE_NUMBER', 'Invalid phone number format');
        }
        if (s.sendSms === undefined) {
          s.log.error('SMS provider not configured');
          return req.fail('SMS_SERVICE_UNAVAILABLE', 'SMS service unavailable');
        }
        const sendSms = s.sendSms;
        const outcome = await req.tx(async (tx) => {
          const repo = identityRepository(tx);
          const rate = await checkSmsRateLimitInRepo(repo, req.viewer.userId, s.clock.now());
          if (!rate.allowed) {
            return { kind: 'rate' as const };
          }
          const sent = await sendSms2faCodeInRepo(
            repo,
            sendSms,
            req.viewer.userId,
            input.body.phone,
            s.clock.now(),
          );
          if (!sent.success) {
            return { kind: 'send_failed' as const, error: sent.error };
          }
          return { kind: 'ok' as const };
        });
        if (outcome.kind === 'rate') {
          return req.fail('SMS_RATE_LIMIT', 'Too many SMS requests. Please try again later.');
        }
        if (outcome.kind === 'send_failed') {
          s.log.error({ error: outcome.error }, 'Failed to send SMS verification code');
          return req.fail('SMS_SEND_FAILED', 'Failed to send verification code');
        }
        return { message: 'Verification code sent' };
      },

      verifyPhone: async (input, req) => {
        const res = await req.tx((tx) =>
          verifyPhoneInRepo(identityRepository(tx), req.viewer.userId, input.body.code),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      removePhone: async (_input, req) => {
        await req.tx((tx) => identityRepository(tx).clearUserPhone(req.viewer.userId));
        return { message: 'Phone number removed' };
      },

      smsSendCode: async (input, req, s) => {
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'Challenge token is invalid or expired');
        }
        const challenge = verifyChallengeToken(input.body.challengeToken, s.jwtSecret, [
          'sms_challenge',
          'totp_challenge',
        ]);
        if (challenge === null) {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'Challenge token is invalid or expired');
        }
        if (s.sendSms === undefined) {
          s.log.error('SMS provider not configured');
          return req.fail('SMS_SERVICE_UNAVAILABLE', 'SMS service unavailable');
        }
        const sendSms = s.sendSms;
        const outcome = await s.kernel.db.system(async (sysTx) => {
          const repo = identityRepository(sysTx);
          const user = await repo.findUserById(challenge.userId);
          if (user === null) {
            return { kind: 'no_user' as const };
          }
          if (user.phone === null || user.phoneVerified !== true) {
            return { kind: 'unverified' as const };
          }
          const rate = await checkSmsRateLimitInRepo(repo, user.id, s.clock.now());
          if (!rate.allowed) {
            return { kind: 'rate' as const };
          }
          const sent = await sendSms2faCodeInRepo(
            repo,
            sendSms,
            user.id,
            user.phone,
            s.clock.now(),
          );
          if (!sent.success) {
            return { kind: 'send_failed' as const, error: sent.error };
          }
          return { kind: 'ok' as const };
        });
        if (outcome.kind === 'no_user') {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'User not found');
        }
        if (outcome.kind === 'unverified') {
          return req.fail('PHONE_NOT_VERIFIED', 'No verified phone number on account');
        }
        if (outcome.kind === 'rate') {
          return req.fail('SMS_RATE_LIMIT', 'Too many SMS requests. Please try again later.');
        }
        if (outcome.kind === 'send_failed') {
          s.log.error({ error: outcome.error }, 'Failed to send SMS challenge code');
          return req.fail('SMS_SEND_FAILED', 'Failed to send verification code');
        }
        return { message: 'Verification code sent' };
      },

      smsVerifyCode: async (input, req, s) => {
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'Challenge token is invalid or expired');
        }
        const jwtSecret = s.jwtSecret;
        const challenge = verifyChallengeToken(input.body.challengeToken, jwtSecret, [
          'sms_challenge',
          'totp_challenge',
        ]);
        if (challenge === null) {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'Challenge token is invalid or expired');
        }
        const outcome = await s.kernel.db.system(async (sysTx) => {
          const repo = identityRepository(sysTx);
          const verified = await verifySms2faCodeInRepo(repo, challenge.userId, input.body.code);
          if (!verified.valid) {
            return { kind: 'invalid_code' as const, message: verified.message };
          }
          const user = await repo.findUserById(challenge.userId);
          if (user === null) {
            return { kind: 'no_user' as const };
          }
          const issued = await issueSession(repo, user, {
            jwtSecret,
            accessTokenExpiry: s.accessTokenExpiry,
            refreshExpiryDays: s.refreshExpiryDays,
            cookie: s.cookieConfig,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            deviceId: readHeaderString(req.headers, 'x-device-id'),
            now: s.clock.now(),
          });
          return { kind: 'ok' as const, issued };
        });
        if (outcome.kind === 'invalid_code') {
          return req.fail('SMS_CODE_INVALID', outcome.message);
        }
        if (outcome.kind === 'no_user') {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'User not found');
        }
        req.setCookie?.(
          REFRESH_COOKIE_NAME,
          outcome.issued.refreshToken,
          outcome.issued.cookieOptions,
        );
        return { token: outcome.issued.token, user: outcome.issued.user };
      },

      totpSetup: async (_input, req, s) =>
        req.tx(async (tx) => {
          const repo = identityRepository(tx);
          const user = await repo.findUserById(req.viewer.userId);
          return setupTotpInRepo(repo, req.viewer.userId, user?.email ?? '', s.totpOptions);
        }),

      totpEnable: async (input, req, s) => {
        const res = await req.tx((tx) =>
          enableTotpInRepo(
            identityRepository(tx),
            req.viewer.userId,
            input.body.code,
            s.totpOptions,
          ),
        );
        if (!res.success) {
          return req.fail('TOTP_ENABLE_FAILED', res.message);
        }
        return { message: res.message };
      },

      totpDisable: async (input, req, s) => {
        const res = await req.tx((tx) =>
          disableTotpInRepo(
            identityRepository(tx),
            req.viewer.userId,
            input.body.code,
            s.totpOptions,
          ),
        );
        if (!res.success) {
          return req.fail('TOTP_DISABLE_FAILED', res.message);
        }
        return { message: res.message };
      },

      totpStatus: async (_input, req) =>
        req.tx((tx) => getTotpStatusInRepo(identityRepository(tx), req.viewer.userId)),

      backupCodesStatus: async (_input, req) =>
        req.tx((tx) => getBackupCodesStatusInRepo(identityRepository(tx), req.viewer.userId)),

      backupCodesRegenerate: async (input, req, s) => {
        const res = await req.tx((tx) =>
          regenerateBackupCodesInRepo(
            identityRepository(tx),
            req.viewer.userId,
            input.body.code,
            s.totpOptions,
          ),
        );
        if (!res.ok) {
          return req.fail('BACKUP_CODES_REGENERATE_FAILED', res.message);
        }
        return res.value;
      },

      totpVerifyLogin: async (input, req, s) => {
        if (s.jwtSecret === undefined || s.jwtSecret.length === 0) {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'Challenge token is invalid or expired');
        }
        const jwtSecret = s.jwtSecret;
        const challenge = verifyChallengeToken(input.body.challengeToken, jwtSecret, [
          'totp_challenge',
        ]);
        if (challenge === null) {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'Challenge token is invalid or expired');
        }
        if (challenge.jti !== null && isChallengeBurned(challenge.jti)) {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'Challenge token is invalid or expired');
        }
        const rate = await checkTotpVerifyRateLimit(challenge.userId);
        if (!rate.allowed) {
          if (challenge.jti !== null) {
            const ttlMs =
              challenge.exp !== null ? Math.max(0, challenge.exp * 1000 - Date.now()) : 5 * 60_000;
            burnChallenge(challenge.jti, ttlMs);
          }
          return req.fail('TOO_MANY_ATTEMPTS', 'Too many code attempts. Please sign in again.', {
            retryAfterMs: rate.resetMs,
          });
        }
        const outcome = await s.kernel.db.system(async (sysTx) => {
          const repo = identityRepository(sysTx);
          const valid = await verifyTotpForLoginInRepo(
            repo,
            challenge.userId,
            input.body.code,
            s.totpOptions,
          );
          if (!valid) {
            return { kind: 'invalid_code' as const };
          }
          const user = await repo.findUserById(challenge.userId);
          if (user === null) {
            return { kind: 'no_user' as const };
          }
          const issued = await issueSession(repo, user, {
            jwtSecret,
            accessTokenExpiry: s.accessTokenExpiry,
            refreshExpiryDays: s.refreshExpiryDays,
            cookie: s.cookieConfig,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            deviceId: readHeaderString(req.headers, 'x-device-id'),
            now: s.clock.now(),
          });
          return { kind: 'ok' as const, issued };
        });
        if (outcome.kind === 'invalid_code') {
          return req.fail('TOTP_INVALID_CODE', 'Invalid TOTP code');
        }
        if (outcome.kind === 'no_user') {
          return req.fail('CHALLENGE_TOKEN_INVALID', 'User not found');
        }
        req.setCookie?.(
          REFRESH_COOKIE_NAME,
          outcome.issued.refreshToken,
          outcome.issued.cookieOptions,
        );
        return { token: outcome.issued.token, user: outcome.issued.user };
      },

      webauthnRegisterOptions: async (_input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('webauthn')) {
          return req.fail('WEBAUTHN_DISABLED', 'WebAuthn authentication is not enabled');
        }
        if (s.webauthnConfig === undefined) {
          throw new Error('WebAuthn is not configured. Set auth.webauthn in config.');
        }
        const webauthnConfig = s.webauthnConfig;
        const options = await req.tx(async (tx) => {
          const repo = identityRepository(tx);
          const user = await repo.findUserById(req.viewer.userId);
          return getWebauthnRegistrationOptionsInRepo(
            repo,
            req.viewer.userId,
            user?.email ?? '',
            webauthnConfig,
          );
        });
        return { options };
      },

      webauthnRegisterVerify: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('webauthn')) {
          return req.fail('WEBAUTHN_DISABLED', 'WebAuthn authentication is not enabled');
        }
        if (s.webauthnConfig === undefined) {
          throw new Error('WebAuthn is not configured. Set auth.webauthn in config.');
        }
        const webauthnConfig = s.webauthnConfig;
        try {
          return await req.tx((tx) =>
            verifyWebauthnRegistrationInRepo(
              identityRepository(tx),
              req.viewer.userId,
              input.body.credential,
              webauthnConfig,
              input.body.name,
            ),
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'WebAuthn registration failed';
          return req.fail('WEBAUTHN_FAILED', msg);
        }
      },

      webauthnLoginOptions: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('webauthn')) {
          return req.fail('WEBAUTHN_DISABLED', 'WebAuthn authentication is not enabled');
        }
        if (s.webauthnConfig === undefined) {
          throw new Error('WebAuthn is not configured. Set auth.webauthn in config.');
        }
        const webauthnConfig = s.webauthnConfig;
        const { options } = await s.kernel.db.system((sysTx) =>
          getWebauthnAuthenticationOptionsInRepo(
            identityRepository(sysTx),
            webauthnConfig,
            input.body.email,
          ),
        );
        return { options };
      },

      webauthnLoginVerify: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('webauthn')) {
          return req.fail('WEBAUTHN_DISABLED', 'WebAuthn authentication is not enabled');
        }
        if (s.webauthnConfig === undefined || s.jwtSecret === undefined || s.jwtSecret === '') {
          throw new Error('WebAuthn is not configured. Set auth.webauthn in config.');
        }
        const webauthnConfig = s.webauthnConfig;
        const jwtSecret = s.jwtSecret;
        let userId: string;
        try {
          const verified = await s.kernel.db.system((sysTx) =>
            verifyWebauthnAuthenticationInRepo(
              identityRepository(sysTx),
              input.body.credential,
              input.body.sessionKey,
              webauthnConfig,
            ),
          );
          userId = verified.userId;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'WebAuthn authentication failed';
          return req.fail('WEBAUTHN_FAILED', msg);
        }

        const issued = await s.kernel.db.system(async (sysTx) => {
          const repo = identityRepository(sysTx);
          const user = await repo.findUserById(userId);
          if (user === null || user.deletedAt !== null) {
            return null;
          }
          if (user.lockedUntil !== null && user.lockedUntil > s.clock.now()) {
            return 'locked' as const;
          }
          return issueSession(repo, user, {
            jwtSecret,
            accessTokenExpiry: s.accessTokenExpiry,
            refreshExpiryDays: s.refreshExpiryDays,
            cookie: s.cookieConfig,
            ipAddress: req.ip,
            userAgent: req.userAgent,
            deviceId: readHeaderString(req.headers, 'x-device-id'),
            now: s.clock.now(),
          });
        });

        if (issued === null || issued === 'locked') {
          return req.fail('INVALID_CREDENTIALS', 'User not found');
        }

        req.setCookie?.(REFRESH_COOKIE_NAME, issued.refreshToken, issued.cookieOptions);
        return { token: issued.token, user: issued.user };
      },

      listPasskeys: async (_input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('webauthn')) {
          return req.fail('WEBAUTHN_DISABLED', 'WebAuthn authentication is not enabled');
        }
        return req.tx((tx) => listUserPasskeysInRepo(identityRepository(tx), req.viewer.userId));
      },

      renamePasskey: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('webauthn')) {
          return req.fail('WEBAUTHN_DISABLED', 'WebAuthn authentication is not enabled');
        }
        const res = await req.tx((tx) =>
          renameUserPasskeyInRepo(
            identityRepository(tx),
            req.viewer.userId,
            input.params.id,
            input.body.name,
          ),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      deletePasskey: async (input, req, s) => {
        if (s.enabledStrategies !== null && !s.enabledStrategies.has('webauthn')) {
          return req.fail('WEBAUTHN_DISABLED', 'WebAuthn authentication is not enabled');
        }
        const res = await req.tx((tx) =>
          deleteUserPasskeyInRepo(identityRepository(tx), req.viewer.userId, input.params.id),
        );
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return res.value;
      },

      // -----------------------------------------------------------------------
      // OAuth 2.0 & Apple OIDC (`/api/auth/oauth/*`)
      // -----------------------------------------------------------------------
      initiateGoogle: (input, req, s) => {
        const viewerUserId = resolveOptionalViewerUserId(req, s.jwtSecret);
        const flags = parseOAuthInitiateFlags(input.query);
        const res = getOAuthAuthorizationUrl({
          provider: 'google',
          config: s.oauthConfig,
          isLinking: viewerUserId !== undefined,
          userId: viewerUserId,
          eligibilityAttested: flags.eligibilityAttested,
          tosAccepted: flags.tosAccepted,
          nowMs: s.clock.now().getTime(),
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        req.setStatus?.(302);
        req.setHeader?.('Location', res.url);
        return Promise.resolve({ url: res.url });
      },

      initiateGithub: (input, req, s) => {
        const viewerUserId = resolveOptionalViewerUserId(req, s.jwtSecret);
        const flags = parseOAuthInitiateFlags(input.query);
        const res = getOAuthAuthorizationUrl({
          provider: 'github',
          config: s.oauthConfig,
          isLinking: viewerUserId !== undefined,
          userId: viewerUserId,
          eligibilityAttested: flags.eligibilityAttested,
          tosAccepted: flags.tosAccepted,
          nowMs: s.clock.now().getTime(),
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        req.setStatus?.(302);
        req.setHeader?.('Location', res.url);
        return Promise.resolve({ url: res.url });
      },

      initiateApple: (input, req, s) => {
        const viewerUserId = resolveOptionalViewerUserId(req, s.jwtSecret);
        const flags = parseOAuthInitiateFlags(input.query);
        const res = getOAuthAuthorizationUrl({
          provider: 'apple',
          config: s.oauthConfig,
          isLinking: viewerUserId !== undefined,
          userId: viewerUserId,
          eligibilityAttested: flags.eligibilityAttested,
          tosAccepted: flags.tosAccepted,
          nowMs: s.clock.now().getTime(),
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        req.setStatus?.(302);
        req.setHeader?.('Location', res.url);
        return Promise.resolve({ url: res.url });
      },

      callbackGoogle: (input, req, s) => runOAuthCallback('google', input.query, req, s),
      callbackGithub: (input, req, s) => runOAuthCallback('github', input.query, req, s),
      callbackApple: (input, req, s) => runOAuthCallback('apple', input.query, req, s),

      linkGoogle: (_input, req, s) => {
        const res = getOAuthAuthorizationUrl({
          provider: 'google',
          config: s.oauthConfig,
          isLinking: true,
          userId: req.viewer.userId,
          nowMs: s.clock.now().getTime(),
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return Promise.resolve({ url: res.url });
      },

      linkGithub: (_input, req, s) => {
        const res = getOAuthAuthorizationUrl({
          provider: 'github',
          config: s.oauthConfig,
          isLinking: true,
          userId: req.viewer.userId,
          nowMs: s.clock.now().getTime(),
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return Promise.resolve({ url: res.url });
      },

      linkApple: (_input, req, s) => {
        const res = getOAuthAuthorizationUrl({
          provider: 'apple',
          config: s.oauthConfig,
          isLinking: true,
          userId: req.viewer.userId,
          nowMs: s.clock.now().getTime(),
        });
        if (!res.ok) {
          return req.fail(res.code, res.message);
        }
        return Promise.resolve({ url: res.url });
      },

      unlinkGoogle: (_input, req, s) => runOAuthUnlink('google', req, s),
      unlinkGithub: (_input, req, s) => runOAuthUnlink('github', req, s),
      unlinkApple: (_input, req, s) => runOAuthUnlink('apple', req, s),

      getConnections: async (_input, req) => ({
        connections: await req.tx((tx) =>
          getConnectedOAuthProvidersInRepo(identityRepository(tx), req.viewer.userId),
        ),
      }),

      getEnabledProviders: (_input, _req, s) =>
        Promise.resolve({
          providers: getEnabledOAuthProviders(s.oauthConfig),
        }),
    },
    notificationKinds: {
      'identity.account_alert': renderIdentityAccountAlert,
    },
  },
);
