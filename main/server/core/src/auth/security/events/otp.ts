// main/server/core/src/auth/security/events/otp.ts

import { logSecurityEvent } from './core';

import type { DbClient } from '@bslt/db/client';

export async function logEmailOtpRequestEvent(
  db: DbClient,
  email: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    email,
    eventType: 'email_otp_requested',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      reason: 'Email OTP login code requested',
    },
  });
}

export async function logEmailOtpVerifiedEvent(
  db: DbClient,
  userId: string,
  email: string,
  isNewUser: boolean,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'email_otp_verified',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      reason: 'Email OTP login code successfully verified',
      isNewUser,
    },
  });
}

export async function logEmailOtpFailedEvent(
  db: DbClient,
  email: string | undefined,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    email,
    eventType: 'email_otp_failed',
    severity: 'medium',
    ipAddress,
    userAgent,
    metadata: {
      reason,
    },
  });
}
