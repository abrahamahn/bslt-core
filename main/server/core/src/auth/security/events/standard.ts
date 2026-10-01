// main/server/core/src/auth/security/events/standard.ts

import { logSecurityEvent } from './core';

import type { DbClient } from '@bslt/db/client';

export async function logTokenReuseEvent(
  db: DbClient,
  userId: string,
  email: string,
  familyId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'token_reuse_detected',
    severity: 'critical',
    ipAddress,
    userAgent,
    metadata: {
      familyId,
      reason: 'Refresh token used after rotation',
    },
  });
}

export async function logTokenFamilyRevokedEvent(
  db: DbClient,
  userId: string,
  email: string,
  familyId: string,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'token_family_revoked',
    severity: 'high',
    ipAddress,
    userAgent,
    metadata: {
      familyId,
      reason,
    },
  });
}

export async function logAccountLockedEvent(
  db: DbClient,
  email: string,
  failedAttempts: number,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    email,
    eventType: 'account_locked',
    severity: 'medium',
    ipAddress,
    userAgent,
    metadata: {
      failedAttempts,
      reason: 'Too many failed login attempts',
    },
  });
}

export async function logAccountUnlockedEvent(
  db: DbClient,
  userId: string,
  email: string,
  adminUserId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'account_unlocked',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      adminUserId,
      reason: 'Manually unlocked by admin',
    },
  });
}

export async function flagSuspiciousLogin(
  db: DbClient,
  userId: string,
  email: string,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'suspicious_login',
    severity: 'high',
    ipAddress,
    userAgent,
    metadata: { reason },
  });
}

export async function logNewDeviceLogin(
  db: DbClient,
  userId: string,
  email: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'new_device_login',
    severity: 'medium',
    ipAddress,
    userAgent,
    metadata: { reason: 'Login from unrecognized device' },
  });
}
