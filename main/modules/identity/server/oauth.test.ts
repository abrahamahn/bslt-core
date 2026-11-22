// main/modules/identity/server/oauth.test.ts
import { describe, expect, it, vi } from 'vitest';

import { OAuthProtocolError, type OAuthProviderClient } from '@bslt/protocols/oauth';

import { decryptToken, encryptToken } from './crypto';
import {
  createOAuthState,
  decodeOAuthState,
  encodeOAuthState,
  getConnectedOAuthProvidersInRepo,
  getEnabledOAuthProviders,
  getOAuthAuthorizationUrl,
  handleOAuthCallbackInRepo,
  parseOAuthInitiateFlags,
  refreshExpiringOAuthTokensInRepo,
  unlinkOAuthAccountInRepo,
  type OAuthServiceConfig,
} from './oauth';

import type { IdentityRepository, OAuthConnection, User } from './repository';

const NOW = new Date('2026-07-01T12:00:00.000Z');
const STATE_SECRET = 'test-cookie-secret-that-is-32-chars!';
const TOKEN_KEY = 'test-oauth-encryption-key-32-chars!!';
const JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars!!';

function makeConfig(overrides: Partial<OAuthServiceConfig> = {}): OAuthServiceConfig {
  return {
    appBaseUrl: 'https://app.example.com',
    stateEncryptionKey: STATE_SECRET,
    tokenEncryptionKey: TOKEN_KEY,
    jwtSecret: JWT_SECRET,
    accessTokenExpiry: '15m',
    refreshExpiryDays: 7,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    },
    enabledStrategies: new Set(['local', 'google', 'github', 'apple']),
    providers: {
      google: {
        clientId: 'google-id',
        clientSecret: 'google-secret',
        callbackUrl: 'https://app.example.com/api/auth/oauth/google/callback',
      },
      github: {
        clientId: 'gh-id',
        clientSecret: 'gh-secret',
        callbackUrl: '/api/auth/oauth/github/callback',
      },
      apple: {
        clientId: 'com.example.app',
        callbackUrl: 'https://app.example.com/api/auth/oauth/apple/callback',
        teamId: 'TEAM1',
        keyId: 'KEY1',
        privateKey: 'pem',
      },
    },
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'ada@example.com',
    canonicalEmail: 'ada@example.com',
    username: 'ada',
    firstName: 'Ada',
    lastName: 'Lovelace',
    avatarUrl: null,
    role: 'user',
    passwordHash: '$argon2id$v=19$m=1024,t=2,p=1$hash',
    emailVerified: true,
    emailVerifiedAt: NOW,
    lockedUntil: null,
    lockReason: null,
    failedLoginAttempts: 0,
    totpSecret: null,
    totpEnabled: false,
    phone: null,
    phoneVerified: null,
    dateOfBirth: null,
    gender: null,
    bio: null,
    city: null,
    state: null,
    country: null,
    language: null,
    website: null,
    lastUsernameChange: null,
    deactivatedAt: null,
    deletedAt: null,
    deletionGracePeriodEnds: null,
    eligibilityAttestedAt: NOW,
    eligibilityAttestationVersion: '2026-07-01.v1',
    tokenVersion: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeOAuthConn(overrides: Partial<OAuthConnection> = {}): OAuthConnection {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    userId: '00000000-0000-4000-8000-000000000001',
    provider: 'google',
    providerUserId: 'google-u-1',
    providerEmail: 'ada@example.com',
    accessToken: encryptToken('old-access', TOKEN_KEY),
    refreshToken: encryptToken('old-refresh', STATE_SECRET),
    expiresAt: new Date(NOW.getTime() + 10 * 60_000),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMockClient(
  provider: 'google' | 'github' | 'kakao' | 'apple' = 'google',
  overrides: Partial<OAuthProviderClient> = {},
): OAuthProviderClient {
  return {
    provider,
    getAuthorizationUrl: (state, redirectUri) =>
      `https://${provider}.example/auth?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: () =>
      Promise.resolve({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresAt: new Date(NOW.getTime() + 3600_000),
        tokenType: 'Bearer',
      }),
    getUserInfo: () =>
      Promise.resolve({
        id: 'prov-u-1',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        emailVerified: true,
      }),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IdentityRepository> = {}): IdentityRepository {
  return {
    findOAuthByProviderUserId: vi.fn().mockResolvedValue(null),
    findOAuthByUserIdAndProvider: vi.fn().mockResolvedValue(null),
    listOAuthByUserId: vi.fn().mockResolvedValue([]),
    findExpiringOAuthConnections: vi.fn().mockResolvedValue([]),
    insertOAuthConnection: vi
      .fn()
      .mockImplementation((d) => Promise.resolve(makeOAuthConn({ ...d, id: 'conn-new' }))),
    updateOAuthConnection: vi.fn().mockResolvedValue(makeOAuthConn()),
    deleteOAuthByUserIdAndProvider: vi.fn().mockResolvedValue(true),
    findUserById: vi.fn().mockResolvedValue(makeUser()),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserByUsername: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockImplementation((d) =>
      Promise.resolve(
        makeUser({
          id: '00000000-0000-4000-8000-000000000002',
          email: d.email,
          canonicalEmail: d.canonicalEmail,
          username: d.username ?? 'ada',
        }),
      ),
    ),
    insertRefreshToken: vi.fn().mockResolvedValue(undefined),
    insertUserSession: vi.fn().mockResolvedValue(undefined),
    findTrustedDeviceByFingerprint: vi.fn().mockResolvedValue(null),
    upsertTrustedDeviceAccess: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as IdentityRepository;
}

describe('identity OAuth service & state security', () => {
  // ==========================================================================
  // Failure / Refusal Assertions (>= 60%)
  // ==========================================================================

  it('rejects tampered, wrong-key, or expired OAuth state payloads', () => {
    const valid = createOAuthState({
      provider: 'google',
      redirectUri: 'https://app.example.com/cb',
      isLinking: false,
      nowMs: NOW.getTime(),
    });
    const encoded = encodeOAuthState(valid, STATE_SECRET);

    expect(decodeOAuthState('corrupted-state', STATE_SECRET, NOW.getTime())).toEqual({
      ok: false,
      code: 'OAUTH_STATE_MISMATCH',
    });
    expect(decodeOAuthState(encoded, 'wrong-cookie-secret-32-chars-long!', NOW.getTime())).toEqual({
      ok: false,
      code: 'OAUTH_STATE_MISMATCH',
    });
    // 11 minutes later (> 10 minute OAuth state TTL)
    expect(decodeOAuthState(encoded, STATE_SECRET, NOW.getTime() + 11 * 60_000)).toEqual({
      ok: false,
      code: 'OAUTH_STATE_MISMATCH',
    });
  });

  it('treats non-literal query flags on initiate as false', () => {
    expect(parseOAuthInitiateFlags({})).toEqual({
      eligibilityAttested: false,
      tosAccepted: false,
    });
    expect(parseOAuthInitiateFlags({ attested: '1', consented: 'TRUE' })).toEqual({
      eligibilityAttested: false,
      tosAccepted: false,
    });
    expect(parseOAuthInitiateFlags({ attested: 'yes', consented: 'on' })).toEqual({
      eligibilityAttested: false,
      tosAccepted: false,
    });
  });

  it('refuses getOAuthAuthorizationUrl when strategy is disabled, provider is unconfigured, or Apple lacks keys', () => {
    const cfg = makeConfig();
    expect(
      getOAuthAuthorizationUrl({
        provider: 'kakao',
        config: cfg,
        isLinking: false,
      }),
    ).toMatchObject({ ok: false, code: 'OAUTH_NOT_CONFIGURED' });

    const incompleteApple = makeConfig({
      providers: {
        apple: {
          clientId: 'com.example.app',
          callbackUrl: '/cb',
          teamId: '',
          keyId: '',
          privateKey: '',
        },
      },
    });
    expect(
      getOAuthAuthorizationUrl({
        provider: 'apple',
        config: incompleteApple,
        isLinking: false,
      }),
    ).toMatchObject({ ok: false, code: 'OAUTH_NOT_CONFIGURED' });
  });

  it('refuses handleOAuthCallbackInRepo on provider error, missing code/state, or cross-provider state mismatch', async () => {
    const cfg = makeConfig();
    const repo = makeRepo();

    const providerErr = await handleOAuthCallbackInRepo({
      repo,
      config: cfg,
      provider: 'google',
      query: { error: 'access_denied', error_description: 'User cancelled' },
      now: NOW,
    });
    expect(providerErr).toEqual({
      ok: false,
      code: 'OAUTH_FAILED',
      message: 'User cancelled',
    });

    const missingParams = await handleOAuthCallbackInRepo({
      repo,
      config: cfg,
      provider: 'google',
      query: { code: 'only-code' },
      now: NOW,
    });
    expect(missingParams).toMatchObject({ ok: false, code: 'OAUTH_FAILED' });

    const googleState = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/cb',
        isLinking: false,
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );
    const crossProvider = await handleOAuthCallbackInRepo({
      repo,
      config: cfg,
      provider: 'github',
      query: { code: 'c1', state: googleState },
      now: NOW,
    });
    expect(crossProvider).toMatchObject({ ok: false, code: 'OAUTH_STATE_MISMATCH' });
  });

  it('refuses callback when Apple returns no id_token or provider exchange throws OAuthProtocolError', async () => {
    const cfg = makeConfig();
    const repo = makeRepo();
    const appleState = encodeOAuthState(
      createOAuthState({
        provider: 'apple',
        redirectUri: 'https://app.example.com/api/auth/oauth/apple/callback',
        isLinking: false,
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );

    const noIdToken = await handleOAuthCallbackInRepo({
      repo,
      config: cfg,
      provider: 'apple',
      query: { code: 'c1', state: appleState },
      clientFactory: () =>
        makeMockClient('apple', {
          exchangeCode: () => Promise.resolve({ accessToken: 'a', tokenType: 'Bearer' }),
        }),
      now: NOW,
    });
    expect(noIdToken).toMatchObject({ ok: false, code: 'OAUTH_FAILED' });

    const googleState = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/api/auth/oauth/google/callback',
        isLinking: false,
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );
    const protoFail = await handleOAuthCallbackInRepo({
      repo,
      config: cfg,
      provider: 'google',
      query: { code: 'bad', state: googleState },
      clientFactory: () =>
        makeMockClient('google', {
          exchangeCode: () =>
            Promise.reject(
              new OAuthProtocolError('invalid_grant', 'google', 'TOKEN_EXCHANGE_FAILED'),
            ),
        }),
      now: NOW,
    });
    expect(protoFail).toMatchObject({ ok: false, code: 'OAUTH_FAILED' });
  });

  it('refuses OAuth signup when email belongs to an existing unlinked account or consent/attestation was omitted', async () => {
    const cfg = makeConfig();

    const stateWithConsent = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/api/auth/oauth/google/callback',
        isLinking: false,
        eligibilityAttested: true,
        tosAccepted: true,
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );
    const existingEmailRepo = makeRepo({
      findUserByEmail: vi.fn().mockResolvedValue(makeUser()),
    });
    const emailConflict = await handleOAuthCallbackInRepo({
      repo: existingEmailRepo,
      config: cfg,
      provider: 'google',
      query: { code: 'c', state: stateWithConsent },
      clientFactory: () => makeMockClient('google'),
      now: NOW,
    });
    expect(emailConflict).toMatchObject({ ok: false, code: 'OAUTH_EMAIL_EXISTS' });

    const stateNoAttest = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/api/auth/oauth/google/callback',
        isLinking: false,
        eligibilityAttested: false,
        tosAccepted: true,
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );
    const noAttest = await handleOAuthCallbackInRepo({
      repo: makeRepo(),
      config: cfg,
      provider: 'google',
      query: { code: 'c', state: stateNoAttest },
      clientFactory: () => makeMockClient('google'),
      now: NOW,
    });
    expect(noAttest).toMatchObject({ ok: false, code: 'ELIGIBILITY_ATTESTATION_REQUIRED' });

    const stateNoConsent = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/api/auth/oauth/google/callback',
        isLinking: false,
        eligibilityAttested: true,
        tosAccepted: false,
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );
    const noConsent = await handleOAuthCallbackInRepo({
      repo: makeRepo(),
      config: cfg,
      provider: 'google',
      query: { code: 'c', state: stateNoConsent },
      clientFactory: () => makeMockClient('google'),
      peekAgreements: () => Promise.resolve([{ id: 'doc-tos' }]),
      now: NOW,
    });
    expect(noConsent).toMatchObject({ ok: false, code: 'SIGNUP_CONSENT_REQUIRED' });
  });

  it('refuses OAuth link collisions and unlink lockout of the sole auth method', async () => {
    const cfg = makeConfig();
    const linkState = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/api/auth/oauth/google/callback',
        isLinking: true,
        userId: 'u-1',
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );

    const alreadyLinked = await handleOAuthCallbackInRepo({
      repo: makeRepo({
        findOAuthByUserIdAndProvider: vi.fn().mockResolvedValue(makeOAuthConn()),
      }),
      config: cfg,
      provider: 'google',
      query: { code: 'c', state: linkState },
      clientFactory: () => makeMockClient('google'),
      now: NOW,
    });
    expect(alreadyLinked).toMatchObject({ ok: false, code: 'OAUTH_ALREADY_LINKED' });

    const linkedOther = await handleOAuthCallbackInRepo({
      repo: makeRepo({
        findOAuthByProviderUserId: vi.fn().mockResolvedValue(makeOAuthConn({ userId: 'u-other' })),
      }),
      config: cfg,
      provider: 'google',
      query: { code: 'c', state: linkState },
      clientFactory: () => makeMockClient('google'),
      now: NOW,
    });
    expect(linkedOther).toMatchObject({ ok: false, code: 'OAUTH_LINKED_TO_OTHER' });

    const notLinked = await unlinkOAuthAccountInRepo(makeRepo(), 'u-1', 'google');
    expect(notLinked).toMatchObject({ ok: false, code: 'OAUTH_CONNECTION_NOT_FOUND' });

    const onlyAuthRepo = makeRepo({
      findOAuthByUserIdAndProvider: vi.fn().mockResolvedValue(makeOAuthConn()),
      listOAuthByUserId: vi.fn().mockResolvedValue([makeOAuthConn()]),
      findUserById: vi.fn().mockResolvedValue(makeUser({ passwordHash: 'oauth:google:none' })),
    });
    const soleAuth = await unlinkOAuthAccountInRepo(onlyAuthRepo, 'u-1', 'google');
    expect(soleAuth).toMatchObject({ ok: false, code: 'CANNOT_UNLINK_ONLY_AUTH' });
  });

  it('counts decryption, config, and provider failures in refreshExpiringOAuthTokensInRepo without throwing', async () => {
    const cfg = makeConfig();
    const repo = makeRepo({
      findExpiringOAuthConnections: vi.fn().mockResolvedValue([
        makeOAuthConn({ id: 'bad-cipher', refreshToken: 'not-valid-ciphertext' }),
        makeOAuthConn({
          id: 'unconfigured-kakao',
          provider: 'kakao',
          refreshToken: encryptToken('rt-k', STATE_SECRET),
        }),
        makeOAuthConn({
          id: 'null-refresh',
          provider: 'google',
          refreshToken: encryptToken('rt-g', STATE_SECRET),
        }),
      ]),
    });

    const summary = await refreshExpiringOAuthTokensInRepo({
      repo,
      config: cfg,
      now: NOW,
      refreshTokenFn: () => Promise.resolve(null),
    });
    expect(summary).toEqual({ total: 3, refreshed: 0, failed: 3 });
  });

  // ==========================================================================
  // Happy Paths
  // ==========================================================================

  it('creates new consented user, logs in returning user, links, lists, unlinks, and refreshes tokens', async () => {
    const cfg = makeConfig();
    expect(getEnabledOAuthProviders(cfg)).toEqual(['google', 'github', 'apple']);

    const flags = parseOAuthInitiateFlags({ attested: 'true', consented: 'true' });
    const initRes = getOAuthAuthorizationUrl({
      provider: 'github',
      config: cfg,
      isLinking: false,
      eligibilityAttested: flags.eligibilityAttested,
      tosAccepted: flags.tosAccepted,
      clientFactory: () => makeMockClient('github'),
      nowMs: NOW.getTime(),
    });
    expect(initRes.ok).toBe(true);
    if (!initRes.ok) return;
    expect(initRes.url).toContain(
      encodeURIComponent('https://app.example.com/api/auth/oauth/github/callback'),
    );

    // 1. New user signup
    const insertConn = vi.fn().mockResolvedValue(makeOAuthConn({ provider: 'github' }));
    const recordConsents = vi.fn().mockResolvedValue(undefined);
    const signupRepo = makeRepo({ insertOAuthConnection: insertConn });
    const signupRes = await handleOAuthCallbackInRepo({
      repo: signupRepo,
      config: cfg,
      provider: 'github',
      query: { code: 'gh-code', state: initRes.state },
      clientFactory: () => makeMockClient('github'),
      peekAgreements: () => Promise.resolve([{ id: 'doc-1' }]),
      recordConsents,
      now: NOW,
    });
    expect(signupRes.ok).toBe(true);
    if (signupRes.ok && !signupRes.isLinking) {
      expect(signupRes.isNewUser).toBe(true);
      expect(signupRes.user.email).toBe('ada@example.com');
    }
    expect(recordConsents).toHaveBeenCalledTimes(1);
    const storedToken = (insertConn.mock.calls[0]?.[0] as { accessToken: string }).accessToken;
    expect(decryptToken(storedToken, TOKEN_KEY)).toBe('fresh-access');

    // 2. Existing user login (no consent flags needed)
    const returningState = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/api/auth/oauth/google/callback',
        isLinking: false,
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );
    const returningRepo = makeRepo({
      findOAuthByProviderUserId: vi.fn().mockResolvedValue(makeOAuthConn()),
    });
    const loginRes = await handleOAuthCallbackInRepo({
      repo: returningRepo,
      config: cfg,
      provider: 'google',
      query: { code: 'g-code', state: returningState },
      clientFactory: () => makeMockClient('google'),
      now: NOW,
    });
    expect(loginRes.ok).toBe(true);
    if (loginRes.ok && !loginRes.isLinking) {
      expect(loginRes.isNewUser).toBe(false);
    }

    // 3. Link + list + unlink + refresh
    const linkState = encodeOAuthState(
      createOAuthState({
        provider: 'google',
        redirectUri: 'https://app.example.com/api/auth/oauth/google/callback',
        isLinking: true,
        userId: '00000000-0000-4000-8000-000000000001',
        nowMs: NOW.getTime(),
      }),
      STATE_SECRET,
    );
    const linkRes = await handleOAuthCallbackInRepo({
      repo: makeRepo(),
      config: cfg,
      provider: 'google',
      query: { code: 'g-link', state: linkState },
      clientFactory: () => makeMockClient('google'),
      now: NOW,
    });
    expect(linkRes).toEqual({
      ok: true,
      isLinking: true,
      linked: true,
      provider: 'google',
      userId: '00000000-0000-4000-8000-000000000001',
      providerEmail: 'ada@example.com',
    });

    const listRepo = makeRepo({
      listOAuthByUserId: vi.fn().mockResolvedValue([makeOAuthConn()]),
      findOAuthByUserIdAndProvider: vi.fn().mockResolvedValue(makeOAuthConn()),
    });
    const listed = await getConnectedOAuthProvidersInRepo(listRepo, 'u-1');
    expect(listed).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000099',
        provider: 'google',
        providerEmail: 'ada@example.com',
        connectedAt: NOW.toISOString(),
      },
    ]);
    expect(await unlinkOAuthAccountInRepo(listRepo, 'u-1', 'google')).toEqual({ ok: true });

    const refreshRepo = makeRepo({
      findExpiringOAuthConnections: vi.fn().mockResolvedValue([makeOAuthConn()]),
    });
    const refreshSummary = await refreshExpiringOAuthTokensInRepo({
      repo: refreshRepo,
      config: cfg,
      now: NOW,
      refreshTokenFn: () =>
        Promise.resolve({
          accessToken: 'rotated-access',
          refreshToken: 'rotated-refresh',
          expiresAt: new Date(NOW.getTime() + 7200_000),
        }),
    });
    expect(refreshSummary).toEqual({ total: 1, refreshed: 1, failed: 0 });
  });
});
