// main/server/core/src/auth/routes/factors.ts
/**
 * Factor Route Entries
 *
 * TOTP and SMS challenge routes.
 */

import {
  smsChallengeRequestSchema,
  smsVerifyRequestSchema,
  totpLoginVerifyRequestSchema,
  totpVerifyRequestSchema,
  type SmsChallengeRequest,
  type SmsVerifyRequest,
  type TotpLoginVerifyRequest,
  type TotpVerifyRequest,
} from '@bslt/shared/core/auth';
import { emptyBodySchema } from '@bslt/shared/system';

import {
  handleBackupCodesRegenerate,
  handleBackupCodesStatus,
  handleSendSmsCode,
  handleTotpDisable,
  handleTotpEnable,
  handleTotpLoginVerify,
  handleTotpSetup,
  handleTotpStatus,
  handleVerifySmsCode,
} from '../handlers';

import { authProtectedRoute, authPublicRoute, defineAuthRouteEntries } from './helpers';

export const factorRouteEntries = defineAuthRouteEntries([
  [
    'auth/totp/setup',
    authProtectedRoute(
      'POST',
      (ctx, _body, request) => handleTotpSetup(ctx, undefined, request),
      [],
      emptyBodySchema,
      { summary: 'Setup TOTP 2FA', tags: ['Auth', 'TOTP'] },
    ),
  ],

  [
    'auth/totp/enable',
    authProtectedRoute<TotpVerifyRequest>(
      'POST',
      handleTotpEnable,
      'user',
      totpVerifyRequestSchema,
      { summary: 'Enable TOTP 2FA', tags: ['Auth', 'TOTP'] },
    ),
  ],

  [
    'auth/totp/disable',
    authProtectedRoute<TotpVerifyRequest>(
      'POST',
      handleTotpDisable,
      'user',
      totpVerifyRequestSchema,
      { summary: 'Disable TOTP 2FA', tags: ['Auth', 'TOTP'] },
    ),
  ],

  [
    'auth/totp/status',
    authProtectedRoute(
      'GET',
      (ctx, _body, request) => handleTotpStatus(ctx, undefined, request),
      [],
      undefined,
      { summary: 'Get TOTP status', tags: ['Auth', 'TOTP'] },
    ),
  ],

  [
    'auth/backup-codes/status',
    authProtectedRoute(
      'GET',
      (ctx, _body, request) => handleBackupCodesStatus(ctx, undefined, request),
      [],
      undefined,
      { summary: 'Get TOTP backup code status', tags: ['Auth', 'TOTP'] },
    ),
  ],

  [
    'auth/backup-codes/regenerate',
    authProtectedRoute<TotpVerifyRequest>(
      'POST',
      handleBackupCodesRegenerate,
      'user',
      totpVerifyRequestSchema,
      { summary: 'Regenerate TOTP backup codes', tags: ['Auth', 'TOTP'] },
    ),
  ],

  [
    'auth/totp/verify-login',
    authPublicRoute<TotpLoginVerifyRequest>(
      'POST',
      handleTotpLoginVerify,
      totpLoginVerifyRequestSchema,
      { summary: 'Verify TOTP login challenge', tags: ['Auth', 'TOTP'] },
    ),
  ],

  [
    'auth/sms/send',
    authPublicRoute<SmsChallengeRequest>('POST', handleSendSmsCode, smsChallengeRequestSchema, {
      summary: 'Send SMS verification code',
      tags: ['Auth', 'SMS'],
    }),
  ],

  [
    'auth/sms/verify',
    authPublicRoute<SmsVerifyRequest>('POST', handleVerifySmsCode, smsVerifyRequestSchema, {
      summary: 'Verify SMS code',
      tags: ['Auth', 'SMS'],
    }),
  ],
]);
