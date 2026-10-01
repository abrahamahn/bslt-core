// main/server/core/src/auth/security/events/oauth.ts

import { logSecurityEvent } from './core';

import type { DbClient } from '@bslt/db/client';

export async function logOAuthLoginSuccessEvent(
  db: DbClient,
  userId: string,
  email: string,
  provider: string,
  isNewUser: boolean,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: isNewUser ? 'oauth_account_created' : 'oauth_login_success',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      provider,
      isNewUser,
      reason: isNewUser ? `New account created via ${provider}` : `Logged in via ${provider}`,
    },
  });
}

export async function logOAuthLoginFailureEvent(
  db: DbClient,
  provider: string,
  reason: string,
  email?: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    email,
    eventType: 'oauth_login_failure',
    severity: 'medium',
    ipAddress,
    userAgent,
    metadata: {
      provider,
      reason,
    },
  });
}

export async function logOAuthLinkSuccessEvent(
  db: DbClient,
  userId: string,
  email: string,
  provider: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'oauth_link_success',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      provider,
      reason: `Linked ${provider} account`,
    },
  });
}

export async function logOAuthLinkFailureEvent(
  db: DbClient,
  userId: string,
  email: string,
  provider: string,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'oauth_link_failure',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      provider,
      reason,
    },
  });
}

export async function logOAuthUnlinkSuccessEvent(
  db: DbClient,
  userId: string,
  email: string,
  provider: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'oauth_unlink_success',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      provider,
      reason: `Unlinked ${provider} account`,
    },
  });
}

export async function logOAuthUnlinkFailureEvent(
  db: DbClient,
  userId: string,
  email: string,
  provider: string,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    userId,
    email,
    eventType: 'oauth_unlink_failure',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      provider,
      reason,
    },
  });
}
