// main/server/core/src/auth/security/events/types.ts

import type { DbClient } from '@bslt/db/client';

export type SecurityEventType =
  | 'token_reuse_detected'
  | 'token_family_revoked'
  | 'account_locked'
  | 'account_unlocked'
  | 'suspicious_login'
  | 'new_device_login'
  | 'device_trusted'
  | 'device_revoked'
  | 'password_changed'
  | 'email_changed'
  | 'magic_link_requested'
  | 'magic_link_verified'
  | 'magic_link_failed'
  | 'email_otp_requested'
  | 'email_otp_verified'
  | 'email_otp_failed'
  | 'oauth_login_success'
  | 'oauth_login_failure'
  | 'oauth_account_created'
  | 'oauth_link_success'
  | 'oauth_link_failure'
  | 'oauth_unlink_success'
  | 'oauth_unlink_failure';

export type SecurityEventSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEventMetadata {
  familyId?: string;
  tokenCount?: number;
  reason?: string;
  adminUserId?: string;
  previousEmail?: string;
  [key: string]: unknown;
}

export interface LogSecurityEventParams {
  db: DbClient;
  userId?: string | undefined;
  email?: string | undefined;
  eventType: SecurityEventType;
  severity: SecurityEventSeverity;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  metadata?: SecurityEventMetadata | undefined;
}
