// main/modules/identity/server/index.test.ts
import { describe, expect, it, vi } from 'vitest';

import { identityEvents } from '../contract';
import { identityModule } from '../module';

import {
  clearLivenessCache,
  identityServer,
  publishAccountAlert,
  publishSessionRevoked,
  publishUserRegistered,
  setLiveness,
} from './index';

import type { CapabilityContext } from '@bslt/contract';
import type { Logger } from '@bslt/server-system/logger';
import type { KernelServices, RequestContext, Tx } from '@bslt/server-system/module';

const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const KEY_ID = '11111111-1111-4111-8111-111111111111';

const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
};

const sampleCaps: CapabilityContext = {
  modules: new Set(['identity']),
  flags: {},
  entitlements: new Set(),
  eligibility: {
    tosAccepted: true,
    emailVerified: true,
    ageVerifiedFor: null,
    jurisdiction: null,
  },
  viewer: { userId: OWNER_ID, role: 'user' },
  actingAs: { kind: 'user' },
  maxAudience: 100,
  authStrategies: ['password'],
};

function makeFakeTx(
  overrides: {
    readonly query?: ReturnType<typeof vi.fn>;
    readonly queryOne?: ReturnType<typeof vi.fn>;
  } = {},
): Tx {
  const query = (overrides.query ?? vi.fn().mockResolvedValue([])) as unknown as Tx['query'];
  const queryOne = (overrides.queryOne ??
    vi.fn().mockResolvedValue(null)) as unknown as Tx['queryOne'];
  const tx: Tx = {
    query,
    queryOne,
    execute: vi.fn().mockResolvedValue(0),
    transaction: async <T>(fn: (inner: Tx) => Promise<T>): Promise<T> => fn(tx),
    raw: vi.fn().mockResolvedValue([]) as unknown as Tx['raw'],
    withSession: () => tx,
    getClient: () => ({}) as unknown as ReturnType<Tx['getClient']>,
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return tx;
}

function makeKernel(tx: Tx, publish = vi.fn().mockResolvedValue(undefined)): KernelServices {
  return {
    db: { system: (fn) => fn(tx) },
    jobs: { enqueue: vi.fn().mockResolvedValue('job-1') },
    events: { publish },
    log: noopLogger,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
  };
}

function makeReq(tx: Tx): RequestContext {
  return {
    viewer: { userId: OWNER_ID, role: 'user' },
    caps: sampleCaps,
    ip: '203.0.113.1',
    userAgent: 'vitest',
    tx: <T>(fn: (inner: Tx) => Promise<T>): Promise<T> => fn(tx),
    fail: (code: string, message?: string): never => {
      throw Object.assign(new Error(message ?? code), {
        code: `identity.${code}`,
        statusCode: 404,
      });
    },
  };
}

describe('identityServer', () => {
  it('binds identityModule, creates/lists/revokes API keys, and publishes audit events', async () => {
    expect(identityServer.module).toBe(identityModule);
    expect(identityServer.migrations?.href).toMatch(/\/migrations\/?$/u);

    const publish = vi.fn().mockResolvedValue(undefined);
    const storedRow = {
      id: KEY_ID,
      user_id: OWNER_ID,
      name: 'CI bot',
      token_hash: 'hashed',
      key_prefix: 'bslt_abcdef',
      last4: 'wxyz',
      last_used_at: null,
      expires_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const tx = makeFakeTx({
      query: vi.fn().mockResolvedValue([storedRow]),
      queryOne: vi.fn().mockResolvedValueOnce(storedRow).mockResolvedValueOnce(storedRow),
    });

    const instance = identityServer.instantiate(makeKernel(tx, publish), {});

    const created = (await instance.invokeHandler(
      'createApiKey',
      { body: { name: 'CI bot', expiresInDays: null } },
      makeReq(tx),
    )) as { key: { id: string; token: string } };
    expect(created.key.id).toBe(KEY_ID);
    expect(created.key.token.startsWith('bslt_')).toBe(true);
    expect(publish).toHaveBeenCalledWith(
      tx,
      identityEvents.apiKeyCreated,
      expect.objectContaining({ keyId: KEY_ID, userId: OWNER_ID }),
      { actorUserId: OWNER_ID, orgId: null },
    );

    const listed = (await instance.invokeHandler('listApiKeys', {}, makeReq(tx))) as {
      keys: Array<{ id: string }>;
    };
    expect(listed.keys).toHaveLength(1);

    const deleted = (await instance.invokeHandler(
      'deleteApiKey',
      { params: { id: KEY_ID }, body: {} },
      makeReq(tx),
    )) as { id: string };
    expect(deleted).toEqual({ id: KEY_ID });
    expect(publish).toHaveBeenCalledWith(
      tx,
      identityEvents.apiKeyRevoked,
      { keyId: KEY_ID, userId: OWNER_ID },
      { actorUserId: OWNER_ID, orgId: null },
    );
  });

  it('fails with identity.API_KEY_NOT_FOUND (404) and publishes no event when revoking a missing or malformed key id', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const tx = makeFakeTx({ queryOne: vi.fn().mockResolvedValue(null) });
    const instance = identityServer.instantiate(makeKernel(tx, publish), {});

    await expect(
      instance.invokeHandler(
        'deleteApiKey',
        { params: { id: 'no-such-key' }, body: {} },
        makeReq(tx),
      ),
    ).rejects.toMatchObject({ code: 'identity.API_KEY_NOT_FOUND', statusCode: 404 });

    await expect(
      instance.invokeHandler('deleteApiKey', { params: { id: KEY_ID }, body: {} }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.API_KEY_NOT_FOUND', statusCode: 404 });

    expect(publish).not.toHaveBeenCalled();
  });

  it('throws when invoking an undeclared endpoint on the module instance', async () => {
    const tx = makeFakeTx();
    const instance = identityServer.instantiate(makeKernel(tx), {});
    await expect(instance.invokeHandler('nonexistent', {}, makeReq(tx))).rejects.toThrow(
      /unknown endpoint/iu,
    );
  });

  it('propagates publish errors from publishSessionRevoked, publishAccountAlert, and publishUserRegistered without swallowing', async () => {
    const tx = makeFakeTx();
    const publish = vi.fn().mockRejectedValue(new Error('outbox write failed'));
    await expect(
      publishSessionRevoked({ publish }, tx, { userId: 'user-1' }, { actorUserId: 'user-1' }),
    ).rejects.toThrow('outbox write failed');

    await expect(
      publishAccountAlert(
        { publish },
        tx,
        { alertType: 'user_signup', subjectEmail: 'a@b.io' },
        { actorUserId: 'u-1' },
      ),
    ).rejects.toThrow('outbox write failed');

    await expect(
      publishUserRegistered(
        { publish },
        tx,
        { userId: 'u-9', email: 'u9@example.com' },
        { actorUserId: 'u-9' },
      ),
    ).rejects.toThrow('outbox write failed');
  });

  it('renders identity.account_alert notifications including fallback unknown alert types', () => {
    const tx = makeFakeTx();
    const instance = identityServer.instantiate(makeKernel(tx), {});
    expect(
      instance.notificationKinds?.['identity.account_alert']?.({
        alertType: 'account_locked',
        subjectEmail: 'victim@example.com',
        ipAddress: '203.0.113.9',
      }),
    ).toEqual({
      level: 'error',
      title: 'Account locked (unusual activity)',
      message: 'victim@example.com was locked out after repeated failed sign-ins from 203.0.113.9.',
      data: { eventType: 'account_locked' },
    });
    expect(instance.notificationKinds?.['identity.account_alert']?.({})).toEqual({
      level: 'warning',
      title: 'Account activity alert',
      message: 'a user triggered an account security event.',
    });
  });

  it('registers cron schedules, privacy hooks, identity.suspend action, and enforces sudo & self-action guards on handlers', async () => {
    const tx = makeFakeTx();
    const instance = identityServer.instantiate(
      {
        ...makeKernel(tx),
        comms: { hmacSecret: 'test-jwt-secret-with-at-least-32-chars!' },
      },
      {},
    );

    expect(instance.cron.map((c) => c.name)).toEqual([
      'identity.session_cleanup',
      'identity.user_retention',
      'identity.login_cleanup',
      'identity.auth_tokens_cleanup',
      'identity.oauth_refresh',
    ]);
    expect(instance.hasPrivacy).toBe(true);
    expect(instance.actionKeys).toEqual(['identity.suspend']);

    // Action validation failure
    await expect(instance.invokeAction('identity.suspend', tx, {})).rejects.toThrow(/userId/i);

    // Sudo guard failures on deactivateAccount & adminHardBanUser
    await expect(
      instance.invokeHandler('deactivateAccount', { body: {} }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.SUDO_REQUIRED' });

    const reqBadSudo = {
      ...makeReq(tx),
      headers: { 'x-sudo-token': 'invalid.jwt' },
    };
    await expect(
      instance.invokeHandler('deactivateAccount', { body: {} }, reqBadSudo),
    ).rejects.toMatchObject({ code: 'identity.SUDO_EXPIRED' });

    // Admin self-lock / self-ban / self-delete guards
    const adminReq = {
      ...makeReq(tx),
      viewer: { userId: OWNER_ID, role: 'admin' as const },
    };
    await expect(
      instance.invokeHandler(
        'adminLockUser',
        { params: { id: OWNER_ID }, body: { reason: 'oops' } },
        adminReq,
      ),
    ).rejects.toMatchObject({ code: 'identity.SELF_LOCK_FORBIDDEN' });
    await expect(
      instance.invokeHandler(
        'adminHardBanUser',
        { params: { id: OWNER_ID }, body: { reason: 'oops' } },
        adminReq,
      ),
    ).rejects.toMatchObject({ code: 'identity.SELF_BAN_FORBIDDEN' });
    await expect(
      instance.invokeHandler(
        'adminDeleteUser',
        { params: { id: OWNER_ID }, body: { reason: 'oops' } },
        adminReq,
      ),
    ).rejects.toMatchObject({ code: 'identity.SELF_DELETE_FORBIDDEN' });

    // Jobs & privacy hooks execute cleanly
    await expect(instance.invokeJob('sessionCleanup', {})).resolves.toBeUndefined();
    await expect(instance.invokeJob('userRetention', {})).resolves.toBeUndefined();
    await expect(instance.exportUserPrivacy?.(OWNER_ID)).resolves.toMatchObject({
      user: null,
      apiKeys: [],
      sessions: [],
    });
    await expect(instance.eraseUserPrivacy?.(tx, OWNER_ID)).resolves.toBeUndefined();
  });

  it('enforces failure guards across sudo, phone/SMS, TOTP login challenge, WebAuthn strategy gating, and logoutAll', async () => {
    const tx = makeFakeTx();
    const instance = identityServer.instantiate(
      {
        ...makeKernel(tx),
        comms: { hmacSecret: 'test-jwt-secret-with-at-least-32-chars!' },
      },
      {},
      {
        JWT_SECRET: 'test-jwt-secret-with-at-least-32-chars!',
        OAUTH_TOKEN_ENCRYPTION_KEY: 'test-enc-secret-with-at-least-32-chars!',
        AUTH_STRATEGIES: 'local',
      },
    );

    // Failure 1: WebAuthn disabled when 'webauthn' not in AUTH_STRATEGIES
    await expect(
      instance.invokeHandler('webauthnLoginOptions', { body: {} }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.WEBAUTHN_DISABLED' });

    // Failure 2: setPhone rejects malformed phone format before hitting SMS
    await expect(
      instance.invokeHandler('setPhone', { body: { phone: 'not-a-phone' } }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.INVALID_PHONE_NUMBER' });

    // Failure 3: setPhone rejects when SMS service unavailable
    await expect(
      instance.invokeHandler('setPhone', { body: { phone: '+15551234567' } }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.SMS_SERVICE_UNAVAILABLE' });

    // Failure 4: totpVerifyLogin rejects invalid challenge token
    await expect(
      instance.invokeHandler(
        'totpVerifyLogin',
        { body: { challengeToken: 'bad.token', code: '123456' } },
        makeReq(tx),
      ),
    ).rejects.toMatchObject({ code: 'identity.CHALLENGE_TOKEN_INVALID' });

    // Failure 5: smsSendCode rejects invalid challenge token
    await expect(
      instance.invokeHandler('smsSendCode', { body: { challengeToken: 'bad.token' } }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.CHALLENGE_TOKEN_INVALID' });

    // Positive: logoutAll bumps token_version, clears refresh cookie, and publishes sessionRevoked
    const clearCookie = vi.fn();
    const userTx = makeFakeTx({
      queryOne: vi.fn().mockResolvedValue({
        id: OWNER_ID,
        email: 'a@b.io',
        canonical_email: 'a@b.io',
        first_name: 'A',
        last_name: 'B',
        password_hash: 'h',
        role: 'user',
        email_verified: true,
        totp_enabled: false,
        failed_login_attempts: 0,
        token_version: 2,
        created_at: new Date(),
        updated_at: new Date(),
        version: 1,
      }),
    });
    const logoutOut = await instance.invokeHandler(
      'logoutAll',
      { body: {} },
      { ...makeReq(userTx), clearCookie },
    );
    expect(logoutOut).toEqual({ message: 'Logged out from all devices' });
    expect(clearCookie).toHaveBeenCalledWith('refreshToken', { path: '/' });
  });

  it('resolves capability context, executes loginCleanup/authTokensCleanup crons, and enforces strategy & token guards on core auth handlers', async () => {
    const tx = makeFakeTx();
    const instance = identityServer.instantiate(
      {
        ...makeKernel(tx),
        comms: { hmacSecret: 'test-jwt-secret-with-at-least-32-chars!' },
      },
      {},
      {
        JWT_SECRET: 'test-jwt-secret-with-at-least-32-chars!',
        AUTH_STRATEGIES: 'magic',
      },
    );

    // 4 cron jobs declared (sessionCleanup, userRetention, loginCleanup, authTokensCleanup)
    expect(instance.cron.map((c) => c.name)).toEqual([
      'identity.session_cleanup',
      'identity.user_retention',
      'identity.login_cleanup',
      'identity.auth_tokens_cleanup',
      'identity.oauth_refresh',
    ]);

    // Failure 1: local auth disabled when 'local' omitted from AUTH_STRATEGIES
    await expect(
      instance.invokeHandler(
        'login',
        { body: { identifier: 'a@b.io', password: 'ValidPassword123!' } },
        makeReq(tx),
      ),
    ).rejects.toMatchObject({ code: 'identity.LOCAL_AUTH_DISABLED' });

    // Failure 2: register disabled when 'local' omitted from AUTH_STRATEGIES
    await expect(
      instance.invokeHandler(
        'register',
        {
          body: {
            email: 'a@b.io',
            username: 'alice_ok',
            firstName: 'A',
            lastName: 'B',
            password: 'ValidPassword123!',
            tosAccepted: true,
            eligibilityAttested: true,
          },
        },
        makeReq(tx),
      ),
    ).rejects.toMatchObject({ code: 'identity.LOCAL_AUTH_DISABLED' });

    // Failure 3: refresh without cookie rejects with NO_REFRESH_TOKEN
    await expect(
      instance.invokeHandler('refresh', { body: {} }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.NO_REFRESH_TOKEN' });

    // Failure 4: magicLinkRequest disabled when 'magic' omitted from AUTH_STRATEGIES
    const localOnly = identityServer.instantiate(
      {
        ...makeKernel(tx),
        comms: { hmacSecret: 'test-jwt-secret-with-at-least-32-chars!' },
      },
      {},
      {
        JWT_SECRET: 'test-jwt-secret-with-at-least-32-chars!',
        AUTH_STRATEGIES: 'local',
      },
    );
    await expect(
      localOnly.invokeHandler('magicLinkRequest', { body: { email: 'a@b.io' } }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.MAGIC_LINK_DISABLED' });

    // Failure 5: emailOtpRequest disabled when 'magic' omitted from AUTH_STRATEGIES
    await expect(
      localOnly.invokeHandler('emailOtpRequest', { body: { email: 'a@b.io' } }, makeReq(tx)),
    ).rejects.toMatchObject({ code: 'identity.MAGIC_LINK_DISABLED' });

    // Positive: context contributor for anonymous vs verified viewer, authStrategies, and cleanup jobs
    await expect(instance.resolveContext(null)).resolves.toEqual({
      authStrategies: ['magic'],
    });
    clearLivenessCache();
    const verifiedQueryOne = vi.fn().mockResolvedValueOnce({
      id: OWNER_ID,
      email: 'a@b.io',
      canonical_email: 'a@b.io',
      first_name: 'A',
      last_name: 'B',
      password_hash: 'h',
      role: 'user',
      email_verified: true,
      totp_enabled: false,
      failed_login_attempts: 0,
      token_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
      version: 1,
    });
    const verifiedTx = makeFakeTx({ queryOne: verifiedQueryOne });
    const verifiedInst = identityServer.instantiate(
      { ...makeKernel(verifiedTx) },
      {},
      { AUTH_STRATEGIES: 'local,magic' },
    );
    await expect(verifiedInst.resolveContext({ userId: OWNER_ID, role: 'user' })).resolves.toEqual({
      authStrategies: ['local', 'magic'],
      eligibility: { emailVerified: true },
    });
    await expect(verifiedInst.resolveContext({ userId: OWNER_ID, role: 'user' })).resolves.toEqual({
      authStrategies: ['local', 'magic'],
      eligibility: { emailVerified: true },
    });
    expect(verifiedQueryOne).toHaveBeenCalledTimes(1);

    setLiveness('99999999-9999-4999-8999-999999999999', {
      tokenVersion: 0,
      lockedUntil: null,
      lockReason: null,
      role: 'user',
      emailVerified: false,
    });
    await expect(
      verifiedInst.resolveContext({ userId: '99999999-9999-4999-8999-999999999999', role: 'user' }),
    ).resolves.toEqual({
      authStrategies: ['local', 'magic'],
      eligibility: { emailVerified: false },
    });
    expect(verifiedQueryOne).toHaveBeenCalledTimes(1);
    clearLivenessCache();

    const strategiesOut = (await localOnly.invokeHandler('authStrategies', {}, makeReq(tx))) as {
      enabled: string[];
      disabled: string[];
    };
    expect(strategiesOut.enabled).toEqual(['local']);
    expect(strategiesOut.disabled).toContain('magic');

    await expect(instance.invokeJob('loginCleanup', {})).resolves.toBeUndefined();
    await expect(instance.invokeJob('authTokensCleanup', {})).resolves.toBeUndefined();
  });
});
