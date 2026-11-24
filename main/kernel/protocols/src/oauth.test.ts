// main/kernel/protocols/src/oauth.test.ts
import { createPublicKey, createSign, generateKeyPairSync, verify } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAuthProtocolError,
  clearAppleKeysCache,
  createAppleProvider,
  createGitHubProvider,
  createGoogleProvider,
  extractAppleUserFromIdToken,
  refreshOAuthProviderToken,
} from './oauth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function base64urlJson(data: unknown): string {
  return Buffer.from(JSON.stringify(data))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

const rsaKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ecKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });

function buildRsaJwk(kid: string): {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
} {
  const exported = rsaKeys.publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  return {
    kty: 'RSA',
    kid,
    use: 'sig',
    alg: 'RS256',
    n: exported.n,
    e: exported.e,
  };
}

function signAppleIdToken(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'apple-key-1' },
  privateKey = rsaKeys.privateKey,
): string {
  const unsigned = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer
    .sign(privateKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${unsigned}.${sig}`;
}

describe('@bslt/protocols/oauth', () => {
  beforeEach(() => {
    clearAppleKeysCache();
  });

  // ==========================================================================
  // Failure / Adversarial Cases (>= 60% of assertions)
  // ==========================================================================

  it('rejects Google code exchange when token endpoint returns non-2xx HTTP status', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(textResponse('invalid_grant', 400)));
    const google = createGoogleProvider('g-id', 'g-secret', fetchFn);

    await expect(google.exchangeCode('bad-code', 'https://app.test/cb')).rejects.toMatchObject({
      name: 'OAuthProtocolError',
      provider: 'google',
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
  });

  it('rejects Google getUserInfo when userinfo endpoint returns 401', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(textResponse('invalid_token', 401)));
    const google = createGoogleProvider('g-id', 'g-secret', fetchFn);

    await expect(google.getUserInfo('expired-token')).rejects.toMatchObject({
      provider: 'google',
      reason: 'USERINFO_FAILED',
    });
  });

  it('rejects GitHub code exchange when 200 JSON payload contains OAuth error field', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.',
        }),
      ),
    );
    const github = createGitHubProvider('gh-id', 'gh-secret', fetchFn);

    await expect(github.exchangeCode('bad', 'https://app.test/cb')).rejects.toMatchObject({
      provider: 'github',
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
  });

  it('rejects GitHub getUserInfo when neither /user nor /user/emails exposes an email', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 42,
          login: 'octocat',
          name: 'Octo Cat',
          email: null,
          avatar_url: 'https://avatars.example/octo.png',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ email: '', primary: false, verified: false, visibility: null }]),
      );
    const github = createGitHubProvider('gh-id', 'gh-secret', fetchFn);

    await expect(github.getUserInfo('gh-token')).rejects.toMatchObject({
      provider: 'github',
      reason: 'NO_EMAIL',
    });
  });

  it('rejects Apple id_token with malformed format, non-RS256 alg, or unknown kid', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ keys: [buildRsaJwk('apple-key-1')] })),
    );

    await expect(
      extractAppleUserFromIdToken('not-a-jwt', 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      provider: 'apple',
      reason: 'INVALID_ID_TOKEN',
    });

    const wrongAlg = signAppleIdToken(
      {
        iss: 'https://appleid.apple.com',
        aud: 'com.bslt.app',
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        sub: 'apple-sub',
        email: 'ada@example.com',
      },
      { alg: 'HS256', kid: 'apple-key-1' },
    );
    await expect(
      extractAppleUserFromIdToken(wrongAlg, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      provider: 'apple',
      reason: 'INVALID_ALGORITHM',
    });

    const unknownKid = signAppleIdToken(
      {
        iss: 'https://appleid.apple.com',
        aud: 'com.bslt.app',
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        sub: 'apple-sub',
        email: 'ada@example.com',
      },
      { alg: 'RS256', kid: 'rotated-out-kid' },
    );
    await expect(
      extractAppleUserFromIdToken(unknownKid, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      provider: 'apple',
      reason: 'KEY_NOT_FOUND',
    });
  });

  it('rejects Apple id_token with forged signature', async () => {
    const otherRsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ keys: [buildRsaJwk('apple-key-1')] })),
    );
    const forged = signAppleIdToken(
      {
        iss: 'https://appleid.apple.com',
        aud: 'com.bslt.app',
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        sub: 'apple-sub',
        email: 'ada@example.com',
      },
      { alg: 'RS256', kid: 'apple-key-1' },
      otherRsa.privateKey,
    );

    await expect(
      extractAppleUserFromIdToken(forged, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      provider: 'apple',
      reason: 'INVALID_SIGNATURE',
    });
  });

  it('rejects Apple id_token with wrong issuer, wrong audience, expired exp, future iat, or missing email', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ keys: [buildRsaJwk('apple-key-1')] })),
    );
    const now = Math.floor(Date.now() / 1000);

    const badIss = signAppleIdToken({
      iss: 'https://evil.example.com',
      aud: 'com.bslt.app',
      exp: now + 300,
      iat: now,
      sub: 'u1',
      email: 'u1@example.com',
    });
    await expect(
      extractAppleUserFromIdToken(badIss, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      reason: 'INVALID_ISSUER',
    });

    const badAud = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'com.other.app',
      exp: now + 300,
      iat: now,
      sub: 'u1',
      email: 'u1@example.com',
    });
    await expect(
      extractAppleUserFromIdToken(badAud, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      reason: 'INVALID_AUDIENCE',
    });

    const expired = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'com.bslt.app',
      exp: now - 10,
      iat: now - 100,
      sub: 'u1',
      email: 'u1@example.com',
    });
    await expect(
      extractAppleUserFromIdToken(expired, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      reason: 'TOKEN_EXPIRED',
    });

    const futureIat = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'com.bslt.app',
      exp: now + 3600,
      iat: now + 600,
      sub: 'u1',
      email: 'u1@example.com',
    });
    await expect(
      extractAppleUserFromIdToken(futureIat, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      reason: 'INVALID_IAT',
    });

    const noEmail = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'com.bslt.app',
      exp: now + 300,
      iat: now,
      sub: 'u1',
    });
    await expect(
      extractAppleUserFromIdToken(noEmail, 'com.bslt.app', fetchFn),
    ).rejects.toMatchObject({
      reason: 'NO_EMAIL',
    });
  });

  it('returns null from refreshOAuthProviderToken on unsupported provider, HTTP failure, or missing access_token', async () => {
    const unsupported = await refreshOAuthProviderToken('apple', 'rt-1');
    expect(unsupported).toBeNull();

    const httpFail = await refreshOAuthProviderToken('google', 'rt-1', {
      fetchFn: vi.fn<typeof fetch>(() => Promise.resolve(textResponse('bad', 400))),
    });
    expect(httpFail).toBeNull();

    const missingToken = await refreshOAuthProviderToken('github', 'rt-1', {
      fetchFn: vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ error: 'expired' }))),
    });
    expect(missingToken).toBeNull();
  });

  // ==========================================================================
  // Happy-Path Protocol Vectors
  // ==========================================================================

  it('builds Google authorization URL, exchanges code, and parses userinfo', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'g-access',
          refresh_token: 'g-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'email profile openid',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'g-123',
          email: 'ada@example.com',
          verified_email: true,
          name: 'Ada Lovelace',
          picture: 'https://lh3.example/ada.png',
        }),
      );

    const google = createGoogleProvider('g-client', 'g-secret', fetchFn);
    const authUrl = new URL(google.getAuthorizationUrl('state-xyz', 'https://app.test/cb'));
    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(authUrl.searchParams.get('client_id')).toBe('g-client');
    expect(authUrl.searchParams.get('state')).toBe('state-xyz');
    expect(authUrl.searchParams.get('access_type')).toBe('offline');

    const tokens = await google.exchangeCode('code-1', 'https://app.test/cb');
    expect(tokens.accessToken).toBe('g-access');
    expect(tokens.refreshToken).toBe('g-refresh');
    expect(tokens.expiresAt).toBeInstanceOf(Date);

    const info = await google.getUserInfo(tokens.accessToken);
    expect(info).toEqual({
      id: 'g-123',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      emailVerified: true,
      picture: 'https://lh3.example/ada.png',
    });
  });

  it('selects primary verified GitHub email', async () => {
    const ghFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 77,
          login: 'adalovelace',
          name: 'Ada',
          email: 'unverified@example.com',
          avatar_url: 'https://avatars.example/ada.png',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { email: 'secondary@example.com', primary: false, verified: true, visibility: null },
          { email: 'primary@example.com', primary: true, verified: true, visibility: 'public' },
        ]),
      );
    const github = createGitHubProvider('gh-client', 'gh-secret', ghFetch);
    const ghUser = await github.getUserInfo('gh-access');
    expect(ghUser).toEqual({
      id: '77',
      email: 'primary@example.com',
      name: 'Ada',
      emailVerified: true,
      picture: 'https://avatars.example/ada.png',
    });
  });

  it('signs ES256 raw R||S client_secret JWT for Apple and verifies RS256 JWK id_token with key caching', async () => {
    const privatePem = ecKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const publicPem = ecKeys.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const now = Math.floor(Date.now() / 1000);
    const validIdToken = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'com.bslt.app',
      exp: now + 600,
      iat: now,
      sub: 'apple-user-99',
      email: 'apple@example.com',
      email_verified: 'true',
    });

    let capturedBody = '';
    const fetchFn = vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/auth/token')) {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return Promise.resolve(
          jsonResponse({
            access_token: 'apple-access',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'apple-refresh',
            id_token: validIdToken,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ keys: [buildRsaJwk('apple-key-1')] }));
    });

    const apple = createAppleProvider(
      {
        clientId: 'com.bslt.app',
        teamId: 'TEAM123456',
        keyId: 'KEY987654',
        privateKey: privatePem,
      },
      fetchFn,
    );

    const tokens = await apple.exchangeCode('apple-code', 'https://app.test/apple/cb');
    expect(tokens.idToken).toBe(validIdToken);

    const params = new URLSearchParams(capturedBody);
    const clientSecretJwt = params.get('client_secret') ?? '';
    const [h, p, s] = clientSecretJwt.split('.');
    expect(h).toBeDefined();
    expect(p).toBeDefined();
    expect(s).toBeDefined();
    const rawSig = Buffer.from(
      `${s ?? ''}${'='.repeat((4 - ((s ?? '').length % 4)) % 4)}`
        .replace(/-/g, '+')
        .replace(/_/g, '/'),
      'base64',
    );
    expect(rawSig.length).toBe(64);
    const signatureValid = verify(
      'sha256',
      Buffer.from(`${h ?? ''}.${p ?? ''}`),
      { key: createPublicKey(publicPem), dsaEncoding: 'ieee-p1363' },
      rawSig,
    );
    expect(signatureValid).toBe(true);

    const first = await extractAppleUserFromIdToken(validIdToken, 'com.bslt.app', fetchFn);
    const second = await extractAppleUserFromIdToken(validIdToken, 'com.bslt.app', fetchFn);
    expect(first).toEqual({
      id: 'apple-user-99',
      email: 'apple@example.com',
      name: null,
      emailVerified: true,
    });
    expect(second).toEqual(first);
    // Token endpoint called once + keys endpoint called once (second call hit cache)
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(new OAuthProtocolError('msg', 'apple', 'TEST')).toBeInstanceOf(Error);
  });

  it('refreshes expiring OAuth token via refreshOAuthProviderToken', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 1800,
        }),
      ),
    );
    const refreshed = await refreshOAuthProviderToken('google', 'old-refresh', {
      clientId: 'g-id',
      clientSecret: 'g-secret',
      fetchFn,
    });
    expect(refreshed?.accessToken).toBe('new-access');
    expect(refreshed?.refreshToken).toBe('new-refresh');
    expect(refreshed?.expiresAt).toBeInstanceOf(Date);
  });
});
