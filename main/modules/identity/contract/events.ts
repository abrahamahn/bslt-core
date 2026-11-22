// main/modules/identity/contract/events.ts
import { event } from '@bslt/contract';
import {
  enumOf,
  isoDateTimeSchema,
  number,
  object,
  optional,
  string,
  type Infer,
} from '@bslt/schema';

const sessionRevokedPayloadSchema = object({
  userId: string({ min: 1 }),
  sessionId: optional(string({ min: 1 })),
});

export type SessionRevokedPayload = Infer<typeof sessionRevokedPayloadSchema>;

const accountAlertTypeSchema = enumOf([
  'user_signup',
  'account_deactivated',
  'deletion_requested',
  'account_reactivated',
  'password_changed',
  'password_reset',
  'new_device_login',
  'account_locked',
] as const);

const accountAlertPayloadSchema = object({
  alertType: accountAlertTypeSchema,
  subjectUserId: optional(string({ min: 1 })),
  subjectEmail: optional(string({ min: 1 })),
  subjectUsername: optional(string({ min: 1 })),
  ipAddress: optional(string({ min: 1 })),
});

export type AccountAlertPayload = Infer<typeof accountAlertPayloadSchema>;

const userRegisteredPayloadSchema = object({
  userId: string({ min: 1 }),
  email: string({ min: 1 }),
  username: optional(string({ min: 1 })),
  firstName: optional(string({ min: 1 })),
});

export type UserRegisteredPayload = Infer<typeof userRegisteredPayloadSchema>;

const apiKeyCreatedPayloadSchema = object({
  keyId: string({ min: 1 }),
  userId: string({ min: 1 }),
  keyPrefix: string({ min: 1 }),
});

const apiKeyRevokedPayloadSchema = object({
  keyId: string({ min: 1 }),
  userId: string({ min: 1 }),
});

const userForceLoggedOutPayloadSchema = object({
  userId: string({ min: 1 }),
  email: string({ min: 1 }),
  adminUserId: string({ min: 1 }),
  reason: string({ min: 1 }),
  revokedSessions: number({ int: true, min: 0 }),
});

const userHardBannedPayloadSchema = object({
  userId: string({ min: 1 }),
  email: string({ min: 1 }),
  adminUserId: string({ min: 1 }),
  reason: string({ min: 1 }),
  gracePeriodEnds: isoDateTimeSchema,
});

const userSoftDeletedPayloadSchema = object({
  userId: string({ min: 1 }),
  email: string({ min: 1 }),
  adminUserId: string({ min: 1 }),
  reason: string({ min: 1 }),
});

const oauthLinkedPayloadSchema = object({
  userId: string({ min: 1 }),
  provider: string({ min: 1 }),
  providerEmail: optional(string({ min: 1 })),
});

const oauthUnlinkedPayloadSchema = object({
  userId: string({ min: 1 }),
  provider: string({ min: 1 }),
});

export const identityEvents = {
  userRegistered: event('identity.user.registered', userRegisteredPayloadSchema, {
    audit: { category: 'security', severity: 'info' },
    analytics: 'identity.user.registered',
  }),
  sessionRevoked: event('identity.session.revoked', sessionRevokedPayloadSchema, {
    audit: { category: 'security', severity: 'info' },
  }),
  accountAlerted: event('identity.account.alerted', accountAlertPayloadSchema, {
    audit: { category: 'security', severity: 'warn' },
    notify: {
      kind: 'identity.account_alert',
      recipients: () => ['role:admin', 'role:moderator'],
      level: 'warning',
      category: 'security',
      channels: ['in_app'],
      title: 'Account activity alert',
    },
  }),
  apiKeyCreated: event('identity.apikey.created', apiKeyCreatedPayloadSchema, {
    audit: { category: 'security', severity: 'info' },
  }),
  apiKeyRevoked: event('identity.apikey.revoked', apiKeyRevokedPayloadSchema, {
    audit: { category: 'security', severity: 'info' },
  }),
  userForceLoggedOut: event('identity.user.force_logged_out', userForceLoggedOutPayloadSchema, {
    audit: { category: 'security', severity: 'warn' },
  }),
  userHardBanned: event('identity.user.hard_banned', userHardBannedPayloadSchema, {
    audit: { category: 'security', severity: 'critical' },
  }),
  userSoftDeleted: event('identity.user.soft_deleted', userSoftDeletedPayloadSchema, {
    audit: { category: 'security', severity: 'critical' },
  }),
  oauthLinked: event('identity.oauth.linked', oauthLinkedPayloadSchema, {
    audit: { category: 'security', severity: 'info' },
  }),
  oauthUnlinked: event('identity.oauth.unlinked', oauthUnlinkedPayloadSchema, {
    audit: { category: 'security', severity: 'info' },
  }),
} as const;
