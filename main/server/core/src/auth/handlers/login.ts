// main/server/core/src/auth/handlers/login.ts
/**
 * Login Handler
 *
 * Handles user authentication via email or username + password.
 *
 * @module handlers/login
 */

import { makeTenantSchemaProvisioner } from '@bslt/db';
import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { getMetricsCollector } from '@bslt/server-system/observability';
import { HTTP_STATUS } from '@bslt/shared/constants';
import {
  type AuthResponse,
  type LoginRequest,
  type SmsChallengeResponse,
  type TotpLoginChallengeResponse,
  isStrategyEnabled,
  sessionSpanDays,
} from '@bslt/shared/core/auth';
import { BadRequestError, NotFoundError } from '@bslt/shared/system';

import { record } from '../../audit/service';
import { notifyAdmins } from '../../notifications/admin-alerts';
import { AccountLockedError, EmailNotVerifiedError } from '../errors';
import { ensurePersonalTenant } from '../personal-tenant';
import {
  generateDeviceFingerprint,
  generateStableDeviceFingerprint,
  isCaptchaRequired,
  isKnownDevice,
  logNewDeviceLogin,
  recordDeviceAccess,
  sendNewLoginAlert,
  verifyCaptchaToken,
} from '../security';
import { authenticateUser } from '../service';
import { createErrorMapperLogger } from '../types';
import { revokeTokenFamily, setRefreshTokenCookie } from '../utils';
import { resendVerificationEmail } from '../verification/service';

import type { AuthResult, SmsChallengeResult, TotpChallengeResult } from '../service';
import type { AppContext, ReplyWithCookies, RequestWithCookies } from '../types';
import type { RefreshTokenFamilyView } from '@bslt/db/schema';

type LoginResult = AuthResult | TotpChallengeResult | SmsChallengeResult;
type BffLoginResponse = Pick<AuthResponse, 'user' | 'isNewDevice'>;

function readDeviceIdHeader(request: RequestWithCookies): string | undefined {
  const raw = request.headers['x-device-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeDeviceValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function sameLoginDevice(
  family: RefreshTokenFamilyView,
  deviceId: string | undefined,
  ipAddress: string | undefined,
  userAgent: string | undefined,
): boolean {
  const familyDeviceId = normalizeDeviceValue(family.deviceId);
  if (deviceId !== undefined && familyDeviceId !== null) {
    return familyDeviceId === deviceId;
  }

  const familyIpAddress = normalizeDeviceValue(family.ipAddress);
  const familyUserAgent = normalizeDeviceValue(family.userAgent);
  return (
    familyIpAddress !== null &&
    familyUserAgent !== null &&
    familyIpAddress === normalizeDeviceValue(ipAddress) &&
    familyUserAgent === normalizeDeviceValue(userAgent)
  );
}

function getCreatedAtTime(family: RefreshTokenFamilyView): number {
  const time = family.familyCreatedAt.getTime();
  return Number.isFinite(time) ? time : 0;
}

async function revokeOlderSessionsForLoginDevice(
  ctx: AppContext,
  userId: string,
  currentFamilyId: string | undefined,
  deviceId: string | undefined,
  ipAddress: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  if (currentFamilyId === undefined) return;

  const families = await ctx.repos.refreshTokens.findActiveFamilies(userId);
  const currentFamily = families.find((family) => family.familyId === currentFamilyId);
  if (currentFamily === undefined) return;

  const currentCreatedAt = getCreatedAtTime(currentFamily);
  for (const family of families) {
    if (family.familyId === currentFamilyId) continue;
    if (getCreatedAtTime(family) > currentCreatedAt) continue;
    if (!sameLoginDevice(family, deviceId, ipAddress, userAgent)) continue;

    await revokeTokenFamily(ctx.db, family.familyId, 'Superseded by newer login on same device');
  }
}

function isTotpChallenge(result: LoginResult): result is TotpChallengeResult {
  return 'requiresTotp' in result && result.requiresTotp;
}

function isSmsChallenge(result: LoginResult): result is SmsChallengeResult {
  return 'requiresSms' in result && result.requiresSms;
}

/**
 * Handle user login via identifier (email or username) and password.
 *
 * @param ctx - Application context
 * @param body - Login request body (identifier + password)
 * @param request - Request with cookies and request info
 * @param reply - Reply with cookie support
 * @returns Auth response with tokens or error response
 * @complexity O(1)
 */
export async function handleLogin(
  ctx: AppContext,
  body: LoginRequest,
  request: RequestWithCookies,
  reply: ReplyWithCookies,
): Promise<
  | { status: 200; body: BffLoginResponse }
  | { status: 202; body: TotpLoginChallengeResponse | SmsChallengeResponse }
  | HttpErrorResponse
> {
  if (Array.isArray(ctx.config.auth.strategies) && !isStrategyEnabled(ctx.config.auth, 'local')) {
    throw new NotFoundError('Local authentication is not enabled', 'LOCAL_AUTH_DISABLED');
  }

  const ipAddress = request.requestInfo.ipAddress ?? request.requestInfo.ip;
  const { userAgent } = request.requestInfo;
  const metrics = getMetricsCollector();
  const provider = 'password';
  const deviceId = readDeviceIdHeader(request);

  try {
    metrics.recordLoginAttempt(provider);

    // Verify CAPTCHA token if enabled
    if (isCaptchaRequired(ctx.config.auth)) {
      const captchaToken = body.captchaToken ?? '';
      const captchaResult = await verifyCaptchaToken(ctx.config.auth, captchaToken, ipAddress);
      if (!captchaResult.success) {
        metrics.recordLoginFailure(provider);
        throw new BadRequestError('CAPTCHA verification failed', 'CAPTCHA_VERIFICATION_FAILED');
      }
    }

    const { identifier, password } = body;
    // One value governs the cookie's life AND the token family's expiry, so
    // the browser and the server cannot disagree about this session.
    const spanDays = sessionSpanDays(body.rememberMe);
    const result = await authenticateUser(
      ctx.db,
      ctx.repos,
      ctx.config.auth,
      identifier,
      password,
      ctx.log,
      ipAddress,
      userAgent,
      (userId) => {
        // Log success - errors are already logged by the service
        ctx.log.info({ userId }, 'Password hash upgraded');
      },
      ctx.errorTracker,
      deviceId,
      spanDays,
    );

    // TOTP challenge — user must verify 2FA code before getting tokens
    if (isTotpChallenge(result)) {
      return {
        status: HTTP_STATUS.ACCEPTED,
        body: {
          requiresTotp: true,
          challengeToken: result.challengeToken,
          message: result.message,
        },
      };
    }

    // SMS challenge — user must verify SMS code before getting tokens
    if (isSmsChallenge(result)) {
      return {
        status: HTTP_STATUS.ACCEPTED,
        body: {
          requiresSms: true,
          challengeToken: result.challengeToken,
          message: result.message,
        },
      };
    }

    // Login successful
    metrics.recordLoginSuccess(provider);

    try {
      await revokeOlderSessionsForLoginDevice(
        ctx,
        result.user.id,
        result.sessionFamilyId,
        deviceId,
        ipAddress,
        userAgent,
      );
    } catch (error: unknown) {
      ctx.log.warn({ err: error }, 'Failed to clean up older same-device sessions');
    }

    // Enforce max concurrent sessions: evict oldest if limit reached
    const maxSessions = ctx.config.auth.sessions?.maxConcurrentSessions ?? 10;
    const activeFamilies = await ctx.repos.refreshTokens.findActiveFamilies(result.user.id);
    if (activeFamilies.length >= maxSessions) {
      // Sort by creation date ascending, revoke oldest
      const sorted = [...activeFamilies].sort(
        (a, b) => a.familyCreatedAt.getTime() - b.familyCreatedAt.getTime(),
      );
      const toEvict = sorted.slice(0, activeFamilies.length - maxSessions + 1);
      for (const family of toEvict) {
        await ctx.repos.refreshTokens.revokeFamily(family.familyId, 'Session limit exceeded');
      }
      ctx.log.info(
        { userId: result.user.id, evicted: toEvict.length },
        'Evicted oldest sessions due to max concurrent session limit',
      );
    }

    // Device fingerprint-based detection using trusted_devices table.
    // Prefer the browser's stable device id so IP changes do not create duplicate devices.
    const fingerprint =
      deviceId !== undefined
        ? generateStableDeviceFingerprint(deviceId)
        : generateDeviceFingerprint(`ip:${ipAddress}`, userAgent ?? '');
    const isNewDevice = !(await isKnownDevice(ctx.repos, result.user.id, fingerprint));

    try {
      await recordDeviceAccess(ctx.repos, result.user.id, fingerprint, ipAddress, userAgent ?? '');
    } catch (err: unknown) {
      ctx.log.warn({ err }, 'Failed to record device access');
    }

    // B2C default: every user owns a personal tenant. Idempotent — provisions on
    // first login and back-fills existing accounts without a bulk migration.
    try {
      await ensurePersonalTenant(
        ctx.repos,
        result.user,
        makeTenantSchemaProvisioner(ctx.config.tenancy?.mode ?? 'shared-rls', ctx.db),
      );
    } catch (err: unknown) {
      ctx.log.warn({ err, userId: result.user.id }, 'Failed to ensure personal tenant');
    }

    if (isNewDevice) {
      ctx.log.info({ userId: result.user.id, ipAddress, userAgent }, 'New device login detected');
      // Fire-and-forget: log security event for new device
      logNewDeviceLogin(ctx.db, result.user.id, result.user.email, ipAddress, userAgent).catch(
        (err: unknown) => {
          ctx.log.warn({ err }, 'Failed to log new device login event');
        },
      );

      // Fire-and-forget: send "Was this you?" new login alert email
      sendNewLoginAlert(ctx.email, ctx.emailTemplates, {
        email: result.user.email,
        ipAddress,
        userAgent,
        timestamp: new Date(),
      }).catch((err: unknown) => {
        ctx.log.warn({ err, email: result.user.email }, 'Failed to send new login alert email');
      });

      // Fire-and-forget: alert admins/moderators of the unusual new-device sign-in
      void notifyAdmins(
        { repos: ctx.repos, log: ctx.log },
        {
          type: 'new_device_login',
          subject: {
            userId: result.user.id,
            email: result.user.email,
            ipAddress,
          },
        },
      );
    }

    // Set refresh token as HTTP-only cookie
    setRefreshTokenCookie(reply, result.refreshToken, ctx.config.auth, spanDays);


    // Fire-and-forget security audit entry so the admin audit log reflects logins.
    record(
      { auditEvents: ctx.repos.auditEvents },
      {
        actorId: result.user.id,
        action: 'user.login',
        resource: 'session',
        resourceId: result.sessionFamilyId ?? result.user.id,
        category: 'security',
        metadata: { provider, isNewDevice },
        ipAddress,
        userAgent: userAgent ?? null,
      },
    ).catch(() => {});

    ctx.log.debug(
      {
        userId: result.user.id,
        hasToken: typeof result.accessToken === 'string' && result.accessToken.length > 0,
        hasUser: true,
        isNewDevice,
      },
      'Login response constructed',
    );

    return {
      status: HTTP_STATUS.OK,
      body: {
        user: result.user,
        isNewDevice,
      },
    };
  } catch (error) {
    metrics.recordLoginFailure(provider);
    // Fire-and-forget: alert admins/moderators when an account is locked out
    if (error instanceof AccountLockedError) {
      void notifyAdmins(
        { repos: ctx.repos, log: ctx.log },
        {
          type: 'account_locked',
          subject: {
            email: body.identifier,
            ipAddress,
          },
        },
      );
    }
    // Auto-resend verification email when login blocked by unverified email
    if (error instanceof EmailNotVerifiedError) {
      const baseUrl = ctx.config.server.appBaseUrl;
      resendVerificationEmail(
        ctx.db,
        ctx.repos,
        ctx.email,
        ctx.emailTemplates,
        error.email,
        baseUrl,
      ).catch((err: unknown) => {
        ctx.log.warn({ err, email: error.email }, 'Failed to resend verification email on login');
      });
    }
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
