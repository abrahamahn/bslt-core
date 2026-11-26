// main/kernel/protocols/src/oauth.test.ts
import { createPublicKey, createSign, generateKeyPairSync, verify } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAuthProtocolError,
  clearAppleKeysCache,
  createAppleProvider,
  createGitHubProvider,
  createGoogleProvider,
  createOidcClient,
  discoverOidcProvider,
  extractAppleUserFromIdToken,
  generatePkcePair,
  refreshOAuthProviderToken,
  validateOidcIssuerUrl,
  type OidcClient,
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

describe('Generic Enterprise OIDC protocol (@bslt/protocols/oauth)', () => {
  const ISSUER = 'https://acme.okta.com/oauth2/default';
  const CLIENT_ID = 'oidc-client-123';
  const CLIENT_SECRET = 'oidc-secret-xyz';

  function buildOidcDiscovery() {
    return {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/v1/authorize`,
      token_endpoint: `${ISSUER}/v1/token`,
      jwks_uri: `${ISSUER}/v1/keys`,
      userinfo_endpoint: `${ISSUER}/v1/userinfo`,
    };
  }

  function signOidcRsaToken(
    payload: Record<string, unknown>,
    header: Record<string, unknown> = { alg: 'RS256', kid: 'oidc-rsa-1', typ: 'JWT' },
  ): string {
    const h = base64urlJson(header);
    const p = base64urlJson(payload);
    const signer = createSign('RSA-SHA256');
    signer.update(`${h}.${p}`);
    const sig = signer
      .sign(rsaKeys.privateKey)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `${h}.${p}.${sig}`;
  }

  function buildOidcRsaJwk(kid: string) {
    const jwk = rsaKeys.publicKey.export({ format: 'jwk' });
    return { ...jwk, kid, use: 'sig', alg: 'RS256' };
  }

  function buildOidcEcJwk(kid: string) {
    const jwk = ecKeys.publicKey.export({ format: 'jwk' });
    return { ...jwk, kid, use: 'sig', alg: 'ES256' };
  }

  it('rejects non-HTTPS, private/loopback, credentialed, and query-bearing issuer URLs', () => {
    for (const bad of [
      '',
      'not-a-url',
      'http://acme.okta.com',
      'https://localhost/oauth2',
      'https://127.0.0.1/oauth2',
      'https://169.254.169.254/latest',
      'https://10.0.0.5/oauth2',
      'https://user:pass@acme.okta.com',
      'https://acme.okta.com?foo=bar',
      'https://idp.internal/oauth2',
    ]) {
      expect(() => validateOidcIssuerUrl(bad)).toThrow(OAuthProtocolError);
    }
    expect(validateOidcIssuerUrl('https://acme.okta.com/oauth2/default/')).toBe(ISSUER);
  });

  it('generates RFC 7636 S256 PKCE verifier/challenge pairs and rejects tampered or mismatched ID tokens', async () => {
    const pkce = generatePkcePair();
    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallenge.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);

    const now = 1_800_000_000;
    const basePayload = {
      iss: ISSUER,
      sub: 'okta-sub-1',
      aud: CLIENT_ID,
      exp: now + 600,
      iat: now,
      nonce: 'nonce-abc',
      email: 'alice@acme.com',
      email_verified: true,
      name: 'Alice Admin',
    };

    const fetchFn = vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Promise.resolve(jsonResponse(buildOidcDiscovery()));
      }
      if (url.endsWith('/v1/keys')) {
        return Promise.resolve(
          jsonResponse({ keys: [buildOidcRsaJwk('oidc-rsa-1'), buildOidcEcJwk('oidc-ec-1')] }),
        );
      }
      return Promise.resolve(textResponse('not found', 404));
    });

    const client: OidcClient = createOidcClient(
      { issuerUrl: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      fetchFn,
    );

    // Unsupported alg (none / HS256) rejected
    const noneToken = `${base64urlJson({ alg: 'none', kid: 'oidc-rsa-1' })}.${base64urlJson(basePayload)}.`;
    await expect(client.verifyIdToken({ idToken: noneToken, nowSeconds: now })).rejects.toThrow(
      /Unsupported OIDC id_token algorithm/u,
    );

    // Tampered signature rejected
    const validToken = signOidcRsaToken(basePayload);
    const tampered = `${validToken.slice(0, -4)}AAAA`;
    await expect(client.verifyIdToken({ idToken: tampered, nowSeconds: now })).rejects.toThrow(
      /Invalid OIDC id_token signature/u,
    );

    // Wrong issuer rejected
    await expect(
      client.verifyIdToken({
        idToken: signOidcRsaToken({ ...basePayload, iss: 'https://evil.example' }),
        nowSeconds: now,
      }),
    ).rejects.toThrow(/issuer mismatch/u);

    // Wrong audience rejected
    await expect(
      client.verifyIdToken({
        idToken: signOidcRsaToken({ ...basePayload, aud: 'wrong-client' }),
        nowSeconds: now,
      }),
    ).rejects.toThrow(/audience mismatch/u);

    // Expired token rejected
    await expect(
      client.verifyIdToken({
        idToken: signOidcRsaToken({ ...basePayload, exp: now - 10 }),
        nowSeconds: now,
      }),
    ).rejects.toThrow(/expired/u);

    // Nonce mismatch rejected
    await expect(
      client.verifyIdToken({
        idToken: validToken,
        expectedNonce: 'different-nonce',
        nowSeconds: now,
      }),
    ).rejects.toThrow(/nonce mismatch/u);

    // Valid token succeeds
    const verified = await client.verifyIdToken({
      idToken: validToken,
      expectedNonce: 'nonce-abc',
      nowSeconds: now,
    });
    expect(verified).toEqual({
      sub: 'okta-sub-1',
      email: 'alice@acme.com',
      emailVerified: true,
      name: 'Alice Admin',
    });
  });

  it('discovers OIDC metadata, builds PKCE authorize URL, exchanges code, and falls back to userinfo when email omitted', async () => {
    const now = 1_800_000_000;
    const idTokenWithoutEmail = signOidcRsaToken({
      iss: ISSUER,
      sub: 'entra-sub-7',
      aud: [CLIENT_ID, 'other-aud'],
      exp: now + 600,
      iat: now,
      nonce: 'n-77',
    });

    let capturedTokenBody = '';
    const fetchFn = vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Promise.resolve(jsonResponse(buildOidcDiscovery()));
      }
      if (url.endsWith('/v1/token')) {
        capturedTokenBody = typeof init?.body === 'string' ? init.body : '';
        return Promise.resolve(
          jsonResponse({
            access_token: 'oidc-access-1',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: idTokenWithoutEmail,
          }),
        );
      }
      if (url.endsWith('/v1/keys')) {
        return Promise.resolve(jsonResponse({ keys: [buildOidcRsaJwk('oidc-rsa-1')] }));
      }
      if (url.endsWith('/v1/userinfo')) {
        return Promise.resolve(
          jsonResponse({
            email: 'bob@acme.com',
            email_verified: true,
            name: 'Bob Enterprise',
            picture: 'https://cdn.acme.com/bob.png',
          }),
        );
      }
      return Promise.resolve(textResponse('not found', 404));
    });

    const doc = await discoverOidcProvider(ISSUER, fetchFn);
    expect(doc.authorizationEndpoint).toBe(`${ISSUER}/v1/authorize`);

    const client: OidcClient = createOidcClient(
      { issuerUrl: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      fetchFn,
    );
    const pkce = generatePkcePair();
    const authUrl = await client.getAuthorizationUrl({
      state: 'sealed-state',
      nonce: 'n-77',
      redirectUri: 'https://app.bslt.dev/api/auth/sso/oidc/callback',
      codeChallenge: pkce.codeChallenge,
      loginHint: 'bob@acme.com',
    });
    const parsedUrl = new URL(authUrl);
    expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsedUrl.searchParams.get('code_challenge')).toBe(pkce.codeChallenge);
    expect(parsedUrl.searchParams.get('login_hint')).toBe('bob@acme.com');

    const result = await client.authenticateCode({
      code: 'auth-code-9',
      redirectUri: 'https://app.bslt.dev/api/auth/sso/oidc/callback',
      codeVerifier: pkce.codeVerifier,
      expectedNonce: 'n-77',
      nowSeconds: now,
    });
    expect(new URLSearchParams(capturedTokenBody).get('code_verifier')).toBe(pkce.codeVerifier);
    expect(result.user).toEqual({
      sub: 'entra-sub-7',
      email: 'bob@acme.com',
      emailVerified: true,
      name: 'Bob Enterprise',
      picture: 'https://cdn.acme.com/bob.png',
    });
  });
});
