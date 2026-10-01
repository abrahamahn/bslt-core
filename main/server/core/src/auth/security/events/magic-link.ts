// main/server/core/src/auth/security/events/magic-link.ts

import { logSecurityEvent } from './core';

import type { DbClient } from '@bslt/db/client';

export async function logMagicLinkRequestEvent(
  db: DbClient,
  email: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    email,
    eventType: 'magic_link_requested',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      reason: 'Magic link authentication requested',
    },
  });
}

export async function logMagicLinkVerifiedEvent(
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
    eventType: 'magic_link_verified',
    severity: 'low',
    ipAddress,
    userAgent,
    metadata: {
      reason: 'Magic link successfully verified',
      isNewUser,
    },
  });
}

export async function logMagicLinkFailedEvent(
  db: DbClient,
  email: string | undefined,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logSecurityEvent({
    db,
    email,
    eventType: 'magic_link_failed',
    severity: 'medium',
    ipAddress,
    userAgent,
    metadata: {
      reason,
    },
  });
}
