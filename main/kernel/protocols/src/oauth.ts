// main/kernel/protocols/src/oauth.ts
/**
 * Owned OAuth 2.0 + Apple OIDC protocol implementation built strictly on
 * `node:crypto` and standard `fetch` (restructure plan §13 B3 & §18.1).
 *
 * Covers authorization URL construction, RFC 6749 authorization-code and
 * refresh-token exchanges, provider user-info normalization, Apple ES256
 * client-secret JWT signing (DER-to-raw P-256), and Apple RS256 JWK `id_token`
 * verification with a 1-hour public-key cache.
 */
import { createPrivateKey, createPublicKey, createVerify, sign } from 'node:crypto';

type OAuthProviderName = 'google' | 'github' | 'apple';

export interface OAuthUserInfo {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly emailVerified: boolean;
  readonly picture?: string | undefined;
}

export interface OAuthTokenResponse {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly expiresAt?: Date | undefined;
  readonly tokenType: string;
  readonly scope?: string | undefined;
  readonly idToken?: string | undefined;
}

export interface OAuthProviderClient {
  readonly provider: OAuthProviderName;
  getAuthorizationUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenResponse>;
  getUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}

interface AppleProviderConfig {
  readonly clientId: string;
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKey: string;
}

export interface OAuthRefreshedTokens {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly expiresAt?: Date | undefined;
}

export class OAuthProtocolError extends Error {
  public readonly provider: string;
  public readonly reason: string;

  constructor(message: string, provider: string, reason: string) {
    super(message);
    this.name = 'OAuthProtocolError';
    this.provider = provider;
    this.reason = reason;
  }
}

// ============================================================================
// Constants
// ============================================================================

const KEYS_CACHE_TTL_MS = 60 * 60 * 1000;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_SCOPES = ['email', 'profile', 'openid'];

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USERINFO_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';
const GITHUB_SCOPES = ['user:email', 'read:user'];

const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_SCOPES = ['email', 'name'];

const REFRESH_TOKEN_ENDPOINTS: Readonly<Record<string, string>> = {
  google: GOOGLE_TOKEN_URL,
  github: GITHUB_TOKEN_URL,
};

// ============================================================================
// Google
// ============================================================================

interface GoogleTokenWire {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly token_type: string;
  readonly scope?: string;
  readonly id_token?: string;
}

interface GoogleUserInfoWire {
  readonly id: string;
  readonly email: string;
  readonly verified_email: boolean;
  readonly name: string;
  readonly picture?: string;
}

export function createGoogleProvider(
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch = fetch,
): OAuthProviderClient {
  return {
    provider: 'google',

    getAuthorizationUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
      });
      return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });

      const response = await fetchFn(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OAuthProtocolError(
          `Failed to exchange code: ${error}`,
          'google',
          'TOKEN_EXCHANGE_FAILED',
        );
      }

      const data = (await response.json()) as GoogleTokenWire;
      return {
        accessToken: data.access_token,
        ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
        ...(data.scope !== undefined ? { scope: data.scope } : {}),
      };
    },

    async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
      const response = await fetchFn(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OAuthProtocolError(
          `Failed to get user info: ${error}`,
          'google',
          'USERINFO_FAILED',
        );
      }

      const data = (await response.json()) as GoogleUserInfoWire;
      return {
        id: data.id,
        email: data.email,
        name: data.name !== '' ? data.name : null,
        emailVerified: data.verified_email,
        ...(data.picture !== undefined && data.picture !== '' ? { picture: data.picture } : {}),
      };
    },
  };
}

// ============================================================================
// GitHub
// ============================================================================

interface GitHubTokenWire {
  readonly access_token: string;
  readonly token_type: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface GitHubUserWire {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly avatar_url: string;
}

interface GitHubEmailWire {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export function createGitHubProvider(
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch = fetch,
): OAuthProviderClient {
  return {
    provider: 'github',

    getAuthorizationUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: GITHUB_SCOPES.join(' '),
        state,
        allow_signup: 'true',
      });
      return `${GITHUB_AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
      const response = await fetchFn(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OAuthProtocolError(
          `Failed to exchange code: ${error}`,
          'github',
          'TOKEN_EXCHANGE_FAILED',
        );
      }

      const data = (await response.json()) as GitHubTokenWire;
      if (data.error !== undefined && data.error !== '') {
        throw new OAuthProtocolError(
          `GitHub OAuth error: ${data.error_description ?? data.error}`,
          'github',
          'TOKEN_EXCHANGE_FAILED',
        );
      }

      return {
        accessToken: data.access_token,
        tokenType: data.token_type,
        ...(data.scope !== undefined ? { scope: data.scope } : {}),
      };
    },

    async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      const userResponse = await fetchFn(GITHUB_USERINFO_URL, { headers });
      if (!userResponse.ok) {
        const error = await userResponse.text();
        throw new OAuthProtocolError(
          `Failed to get user info: ${error}`,
          'github',
          'USERINFO_FAILED',
        );
      }

      const userData = (await userResponse.json()) as GitHubUserWire;
      const emailsResponse = await fetchFn(GITHUB_EMAILS_URL, { headers });

      let email = userData.email;
      let emailVerified = false;

      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as GitHubEmailWire[];
        const primaryVerified = emails.find((e) => e.primary && e.verified);
        if (primaryVerified !== undefined) {
          email = primaryVerified.email;
          emailVerified = true;
        } else {
          const anyVerified = emails.find((e) => e.verified);
          if (anyVerified !== undefined) {
            email = anyVerified.email;
            emailVerified = true;
          }
        }
      }

      if (email === null || email === '') {
        throw new OAuthProtocolError(
          'No email found on GitHub account. Please make your email public or add a verified email.',
          'github',
          'NO_EMAIL',
        );
      }

      return {
        id: String(userData.id),
        email,
        name: userData.name,
        emailVerified,
        ...(userData.avatar_url !== '' ? { picture: userData.avatar_url } : {}),
      };
    },
  };
}

// ============================================================================
// Apple (Sign in with Apple — ES256 client_secret + RS256 JWK id_token)
// ============================================================================

interface AppleTokenWire {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly id_token: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface AppleIdTokenPayload {
  readonly iss: string;
  readonly aud: string;
  readonly exp: number;
  readonly iat: number;
  readonly sub: string;
  readonly email?: string;
  readonly email_verified?: string | boolean;
}

interface AppleJwk {
  readonly kty: string;
  readonly kid: string;
  readonly use: string;
  readonly alg: string;
  readonly n: string;
  readonly e: string;
}

interface JwtHeader {
  readonly alg: string;
  readonly kid: string;
}

let appleKeysCache: { readonly keys: readonly AppleJwk[]; readonly fetchedAt: number } | null =
  null;

export function clearAppleKeysCache(): void {
  appleKeysCache = null;
}

function base64urlEncodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecodeBuffer(segment: string): Buffer {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(b64 + padding, 'base64');
}

function derEcdsaToRawP256(der: Buffer): Buffer {
  let offset = 2;
  if (der[offset] !== 0x02) {
    throw new Error('Invalid DER ECDSA signature (expected r integer tag)');
  }
  offset += 1;
  const rLen = der[offset] ?? 0;
  offset += 1;
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;

  if (der[offset] !== 0x02) {
    throw new Error('Invalid DER ECDSA signature (expected s integer tag)');
  }
  offset += 1;
  const sLen = der[offset] ?? 0;
  offset += 1;
  let s = der.subarray(offset, offset + sLen);

  if (r.length > 32) r = r.subarray(r.length - 32);
  if (s.length > 32) s = s.subarray(s.length - 32);

  const raw = Buffer.alloc(64);
  r.copy(raw, 32 - r.length);
  s.copy(raw, 64 - s.length);
  return raw;
}

function generateAppleClientSecret(config: AppleProviderConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 86400 * 180;
  const headerB64 = base64urlEncodeJson({
    alg: 'ES256',
    kid: config.keyId,
    typ: 'JWT',
  });
  const payloadB64 = base64urlEncodeJson({
    iss: config.teamId,
    iat: now,
    exp,
    aud: APPLE_ISSUER,
    sub: config.clientId,
  });
  const message = `${headerB64}.${payloadB64}`;
  const key = createPrivateKey({ key: config.privateKey, format: 'pem' });
  const derSignature = sign('sha256', Buffer.from(message), key);
  const signatureB64 = derEcdsaToRawP256(derSignature)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${message}.${signatureB64}`;
}

async function fetchApplePublicKeys(fetchFn: typeof fetch): Promise<readonly AppleJwk[]> {
  const now = Date.now();
  if (appleKeysCache !== null && now - appleKeysCache.fetchedAt < KEYS_CACHE_TTL_MS) {
    return appleKeysCache.keys;
  }

  const response = await fetchFn(APPLE_KEYS_URL);
  if (!response.ok) {
    throw new OAuthProtocolError(
      `Failed to fetch Apple public keys: ${String(response.status)}`,
      'apple',
      'KEYS_FETCH_FAILED',
    );
  }

  const data = (await response.json()) as { readonly keys: readonly AppleJwk[] };
  appleKeysCache = { keys: data.keys, fetchedAt: now };
  return data.keys;
}

function jwkToRsaPem(jwk: AppleJwk): string {
  const publicKey = createPublicKey({
    key: { kty: 'RSA', n: jwk.n, e: jwk.e },
    format: 'jwk',
  });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  if (typeof pem === 'string') {
    return pem;
  }
  throw new OAuthProtocolError(
    'Failed to convert JWK to PEM format',
    'apple',
    'JWK_CONVERSION_FAILED',
  );
}

function parseJwtParts(idToken: string): readonly [string, string, string] {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new OAuthProtocolError('Invalid id_token format', 'apple', 'INVALID_ID_TOKEN');
  }
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
}

async function verifyAndDecodeAppleIdToken(
  idToken: string,
  clientId: string,
  fetchFn: typeof fetch,
): Promise<AppleIdTokenPayload> {
  const [part0, part1, part2] = parseJwtParts(idToken);

  let header: JwtHeader;
  try {
    header = JSON.parse(base64urlDecodeBuffer(part0).toString('utf8')) as JwtHeader;
  } catch {
    throw new OAuthProtocolError('Failed to parse JWT header', 'apple', 'INVALID_ID_TOKEN');
  }

  if (header.alg !== 'RS256') {
    throw new OAuthProtocolError(
      `Unsupported algorithm: ${header.alg}. Expected RS256`,
      'apple',
      'INVALID_ALGORITHM',
    );
  }
  if (header.kid === '') {
    throw new OAuthProtocolError('Missing kid in JWT header', 'apple', 'MISSING_KID');
  }

  const keys = await fetchApplePublicKeys(fetchFn);
  const matchingKey = keys.find((k) => k.kid === header.kid);
  if (matchingKey === undefined) {
    throw new OAuthProtocolError(
      `No matching public key found for kid: ${header.kid}`,
      'apple',
      'KEY_NOT_FOUND',
    );
  }

  const pem = jwkToRsaPem(matchingKey);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${part0}.${part1}`);
  const isValid = verifier.verify(pem, base64urlDecodeBuffer(part2));
  if (!isValid) {
    throw new OAuthProtocolError('Invalid id_token signature', 'apple', 'INVALID_SIGNATURE');
  }

  let payload: AppleIdTokenPayload;
  try {
    payload = JSON.parse(base64urlDecodeBuffer(part1).toString('utf8')) as AppleIdTokenPayload;
  } catch {
    throw new OAuthProtocolError('Failed to decode id_token', 'apple', 'INVALID_ID_TOKEN');
  }

  if (payload.iss !== APPLE_ISSUER) {
    throw new OAuthProtocolError(
      `Invalid issuer: ${payload.iss}. Expected: ${APPLE_ISSUER}`,
      'apple',
      'INVALID_ISSUER',
    );
  }
  if (payload.aud !== clientId) {
    throw new OAuthProtocolError(
      `Invalid audience: ${payload.aud}. Expected: ${clientId}`,
      'apple',
      'INVALID_AUDIENCE',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new OAuthProtocolError('id_token has expired', 'apple', 'TOKEN_EXPIRED');
  }
  if (payload.iat > now + 300) {
    throw new OAuthProtocolError('id_token issued in the future', 'apple', 'INVALID_IAT');
  }

  return payload;
}

export async function extractAppleUserFromIdToken(
  idToken: string,
  clientId: string,
  fetchFn: typeof fetch = fetch,
): Promise<OAuthUserInfo> {
  const payload = await verifyAndDecodeAppleIdToken(idToken, clientId, fetchFn);
  if (payload.email === undefined || payload.email === '') {
    throw new OAuthProtocolError('No email found in Apple id_token', 'apple', 'NO_EMAIL');
  }
  return {
    id: payload.sub,
    email: payload.email,
    name: null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  };
}

export function createAppleProvider(
  config: AppleProviderConfig,
  fetchFn: typeof fetch = fetch,
): OAuthProviderClient {
  return {
    provider: 'apple',

    getAuthorizationUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: APPLE_SCOPES.join(' '),
        state,
        response_mode: 'form_post',
      });
      return `${APPLE_AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
      const clientSecret = generateAppleClientSecret(config);
      const params = new URLSearchParams({
        client_id: config.clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });

      const response = await fetchFn(APPLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new OAuthProtocolError(
          `Failed to exchange code: ${error}`,
          'apple',
          'TOKEN_EXCHANGE_FAILED',
        );
      }

      const data = (await response.json()) as AppleTokenWire;
      if (data.error !== undefined && data.error !== '') {
        throw new OAuthProtocolError(
          `Apple OAuth error: ${data.error_description ?? data.error}`,
          'apple',
          'TOKEN_EXCHANGE_FAILED',
        );
      }

      return {
        accessToken: data.access_token,
        ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
        idToken: data.id_token,
      };
    },

    getUserInfo(idToken: string): Promise<OAuthUserInfo> {
      return extractAppleUserFromIdToken(idToken, config.clientId, fetchFn);
    },
  };
}

// ============================================================================
// Refresh Token Grant
// ============================================================================

export async function refreshOAuthProviderToken(
  provider: string,
  refreshToken: string,
  options: {
    readonly clientId?: string | undefined;
    readonly clientSecret?: string | undefined;
    readonly fetchFn?: typeof fetch | undefined;
  } = {},
): Promise<OAuthRefreshedTokens | null> {
  const endpoint = REFRESH_TOKEN_ENDPOINTS[provider];
  if (endpoint === undefined) {
    return null;
  }

  const fetchFn = options.fetchFn ?? fetch;
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (options.clientId !== undefined && options.clientId !== '') {
    params.set('client_id', options.clientId);
  }
  if (options.clientSecret !== undefined && options.clientSecret !== '') {
    params.set('client_secret', options.clientSecret);
  }

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      readonly access_token?: string;
      readonly refresh_token?: string;
      readonly expires_in?: number;
    };
    if (data.access_token === undefined || data.access_token === '') {
      return null;
    }

    return {
      accessToken: data.access_token,
      ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
      ...(data.expires_in !== undefined
        ? { expiresAt: new Date(Date.now() + data.expires_in * 1000) }
        : {}),
    };
  } catch {
    return null;
  }
}
