// main/modules/identity/contract/events.test.ts
import { describe, expect, it } from 'vitest';

import { identityEvents } from './events';

describe('identityEvents', () => {
  it('declares identity.session.revoked, identity.user.registered, identity.account.alerted, and apikey events', () => {
    expect(identityEvents.sessionRevoked.name).toBe('identity.session.revoked');
    expect(identityEvents.sessionRevoked.audit).toEqual({
      category: 'security',
      severity: 'info',
    });
    expect(identityEvents.userRegistered.name).toBe('identity.user.registered');
    expect(identityEvents.accountAlerted.notify?.kind).toBe('identity.account_alert');
    expect(identityEvents.apiKeyCreated.name).toBe('identity.apikey.created');
    expect(identityEvents.apiKeyRevoked.name).toBe('identity.apikey.revoked');
  });

  it('declares admin security audit events for force-logout, hard-ban, and soft-delete', () => {
    expect(identityEvents.userForceLoggedOut.name).toBe('identity.user.force_logged_out');
    expect(identityEvents.userForceLoggedOut.audit).toEqual({
      category: 'security',
      severity: 'warn',
    });
    expect(
      identityEvents.userForceLoggedOut.payload.parse({
        userId: 'u-1',
        email: 'u1@example.com',
        adminUserId: 'admin-1',
        reason: 'compromised device',
        revokedSessions: 2,
      }),
    ).toEqual({
      userId: 'u-1',
      email: 'u1@example.com',
      adminUserId: 'admin-1',
      reason: 'compromised device',
      revokedSessions: 2,
    });

    expect(identityEvents.userHardBanned.name).toBe('identity.user.hard_banned');
    expect(identityEvents.userHardBanned.audit).toEqual({
      category: 'security',
      severity: 'critical',
    });
    expect(
      identityEvents.userHardBanned.payload.parse({
        userId: 'u-1',
        email: 'u1@example.com',
        adminUserId: 'admin-1',
        reason: 'fraud',
        gracePeriodEnds: '2026-02-01T00:00:00.000Z',
      }),
    ).toMatchObject({ userId: 'u-1', reason: 'fraud' });

    expect(identityEvents.userSoftDeleted.name).toBe('identity.user.soft_deleted');
    expect(identityEvents.userSoftDeleted.audit).toEqual({
      category: 'security',
      severity: 'critical',
    });
    expect(
      identityEvents.userSoftDeleted.payload.parse({
        userId: 'u-1',
        email: 'u1@example.com',
        adminUserId: 'admin-1',
        reason: 'gdpr request',
      }),
    ).toMatchObject({ userId: 'u-1', reason: 'gdpr request' });
  });

  it('rejects empty strings, negative counts, unknown alert types, and injected fields across all event payloads', () => {
    expect(identityEvents.sessionRevoked.payload.safeParse({ userId: '' }).success).toBe(false);
    expect(identityEvents.sessionRevoked.payload.safeParse(null).success).toBe(false);
    expect(
      identityEvents.sessionRevoked.payload.safeParse({ userId: 'u-1', injected: true }).success,
    ).toBe(false);
    expect(
      identityEvents.accountAlerted.payload.safeParse({ alertType: 'unknown_type' }).success,
    ).toBe(false);
    expect(identityEvents.userRegistered.payload.safeParse({}).success).toBe(false);
    expect(
      identityEvents.apiKeyCreated.payload.safeParse({
        keyId: 'k-1',
        userId: 'u-1',
        keyPrefix: 'bslt_abc',
        token: 'secret',
      }).success,
    ).toBe(false);
    expect(
      identityEvents.userForceLoggedOut.payload.safeParse({
        userId: 'u-1',
        email: 'u1@example.com',
        adminUserId: 'admin-1',
        reason: '',
        revokedSessions: -1,
      }).success,
    ).toBe(false);
    expect(
      identityEvents.userHardBanned.payload.safeParse({
        userId: 'u-1',
        email: 'u1@example.com',
        adminUserId: 'admin-1',
        reason: 'fraud',
        gracePeriodEnds: 'not-iso',
      }).success,
    ).toBe(false);
    expect(
      identityEvents.userSoftDeleted.payload.safeParse({
        userId: '',
        email: 'u1@example.com',
        adminUserId: 'admin-1',
        reason: 'gdpr',
      }).success,
    ).toBe(false);
  });
});
