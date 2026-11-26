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
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createVerify,
  randomBytes,
  sign,
  verify as cryptoVerify,
  type JsonWebKeyInput,
} from 'node:crypto';

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

// ============================================================================
// Generic Enterprise OIDC (Okta, Microsoft Entra ID, Google Workspace, OIDC)
// ============================================================================

interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly userinfoEndpoint?: string | undefined;
}

interface OidcClientConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes?: string | undefined;
}

interface OidcAuthenticatedUser {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly picture?: string | undefined;
}

export interface OidcClient {
  discover(): Promise<OidcDiscoveryDocument>;
  getAuthorizationUrl(params: {
    readonly state: string;
    readonly nonce: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly loginHint?: string | undefined;
  }): Promise<string>;
  exchangeCode(params: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }): Promise<OAuthTokenResponse>;
  verifyIdToken(params: {
    readonly idToken: string;
    readonly expectedNonce?: string | undefined;
    readonly nowSeconds?: number | undefined;
  }): Promise<OidcAuthenticatedUser>;
  authenticateCode(params: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
    readonly expectedNonce?: string | undefined;
    readonly nowSeconds?: number | undefined;
  }): Promise<{ readonly user: OidcAuthenticatedUser; readonly tokens: OAuthTokenResponse }>;
}

interface OidcJwk {
  readonly kid?: string;
  readonly kty?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
}

interface OidcJwtHeader {
  readonly alg?: string | undefined;
  readonly kid?: string | undefined;
}

interface OidcIdTokenPayload {
  readonly iss?: string | undefined;
  readonly sub?: string | undefined;
  readonly aud?: string | readonly string[] | undefined;
  readonly exp?: number | undefined;
  readonly iat?: number | undefined;
  readonly nonce?: string | undefined;
  readonly email?: string | undefined;
  readonly preferred_username?: string | undefined;
  readonly email_verified?: boolean | string | undefined;
  readonly name?: string | undefined;
  readonly given_name?: string | undefined;
  readonly family_name?: string | undefined;
  readonly picture?: string | undefined;
}

interface OidcDiscoveryWire {
  readonly issuer?: string | undefined;
  readonly authorization_endpoint?: string | undefined;
  readonly token_endpoint?: string | undefined;
  readonly jwks_uri?: string | undefined;
  readonly userinfo_endpoint?: string | undefined;
}

const OIDC_ALLOWED_ALGS = new Set(['RS256', 'RS384', 'RS512', 'ES256', 'ES384']);
const PRIVATE_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/iu,
  /\.local$/iu,
  /\.internal$/iu,
  /^127\./u,
  /^10\./u,
  /^192\.168\./u,
  /^169\.254\./u,
  /^0\./u,
  /^172\.(?:1[6-9]|2\d|3[0-1])\./u,
  /^\[?::1\]?$/u,
  /^\[?fc/iu,
  /^\[?fd/iu,
  /^\[?fe80:/iu,
];

const oidcDiscoveryCache = new Map<
  string,
  { readonly doc: OidcDiscoveryDocument; readonly expiresAt: number }
>();
const oidcJwksCache = new Map<
  string,
  { readonly keys: readonly OidcJwk[]; readonly expiresAt: number }
>();

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function isDisallowedOidcHost(hostname: string): boolean {
  const lowered = hostname.trim().toLowerCase();
  if (lowered === '') return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(lowered));
}

export function validateOidcIssuerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!URL.canParse(trimmed)) {
    throw new OAuthProtocolError('OIDC issuer URL is not a valid URL', 'oidc', 'INVALID_ISSUER');
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:') {
    throw new OAuthProtocolError('OIDC issuer URL must use https://', 'oidc', 'INVALID_ISSUER');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new OAuthProtocolError(
      'OIDC issuer URL must not include embedded credentials',
      'oidc',
      'INVALID_ISSUER',
    );
  }
  if (isDisallowedOidcHost(parsed.hostname)) {
    throw new OAuthProtocolError(
      'OIDC issuer URL must target a public HTTPS host',
      'oidc',
      'INVALID_ISSUER',
    );
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new OAuthProtocolError(
      'OIDC issuer URL must not contain query parameters or fragments',
      'oidc',
      'INVALID_ISSUER',
    );
  }
  return parsed.toString().replace(/\/+$/u, '');
}

function assertPublicHttpsEndpoint(rawUrl: unknown, fieldName: string): string {
  if (typeof rawUrl !== 'string' || !URL.canParse(rawUrl)) {
    throw new OAuthProtocolError(
      `OIDC discovery missing valid ${fieldName}`,
      'oidc',
      'DISCOVERY_FAILED',
    );
  }
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' || isDisallowedOidcHost(parsed.hostname)) {
    throw new OAuthProtocolError(
      `OIDC discovery ${fieldName} must be a public HTTPS URL`,
      'oidc',
      'DISCOVERY_FAILED',
    );
  }
  return parsed.toString();
}

export function generatePkcePair(): {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
} {
  const codeVerifier = toBase64Url(randomBytes(32));
  const codeChallenge = toBase64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export async function discoverOidcProvider(
  issuerUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<OidcDiscoveryDocument> {
  const normalizedIssuer = validateOidcIssuerUrl(issuerUrl);
  const now = Date.now();
  if (fetchFn === fetch) {
    const cached = oidcDiscoveryCache.get(normalizedIssuer);
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.doc;
    }
  }

  const discoveryUrl = `${normalizedIssuer}/.well-known/openid-configuration`;
  const response = await fetchFn(discoveryUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new OAuthProtocolError(
      `Failed to fetch OIDC discovery document (${String(response.status)})`,
      'oidc',
      'DISCOVERY_FAILED',
    );
  }

  const wire = (await response.json()) as OidcDiscoveryWire;
  const issuer = typeof wire.issuer === 'string' ? wire.issuer.replace(/\/+$/u, '') : '';
  if (issuer === '' || issuer !== normalizedIssuer) {
    throw new OAuthProtocolError(
      `OIDC discovery issuer mismatch: expected ${normalizedIssuer}`,
      'oidc',
      'INVALID_ISSUER',
    );
  }

  const doc: OidcDiscoveryDocument = {
    issuer,
    authorizationEndpoint: assertPublicHttpsEndpoint(
      wire.authorization_endpoint,
      'authorization_endpoint',
    ),
    tokenEndpoint: assertPublicHttpsEndpoint(wire.token_endpoint, 'token_endpoint'),
    jwksUri: assertPublicHttpsEndpoint(wire.jwks_uri, 'jwks_uri'),
    ...(typeof wire.userinfo_endpoint === 'string' && wire.userinfo_endpoint !== ''
      ? { userinfoEndpoint: assertPublicHttpsEndpoint(wire.userinfo_endpoint, 'userinfo_endpoint') }
      : {}),
  };

  if (fetchFn === fetch) {
    oidcDiscoveryCache.set(normalizedIssuer, { doc, expiresAt: now + KEYS_CACHE_TTL_MS });
  }
  return doc;
}

async function fetchOidcJwks(
  jwksUri: string,
  fetchFn: typeof fetch,
  bypassCache = false,
): Promise<readonly OidcJwk[]> {
  const now = Date.now();
  if (!bypassCache && fetchFn === fetch) {
    const cached = oidcJwksCache.get(jwksUri);
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.keys;
    }
  }

  const response = await fetchFn(jwksUri, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new OAuthProtocolError(
      `Failed to fetch OIDC JWKS (${String(response.status)})`,
      'oidc',
      'JWKS_FETCH_FAILED',
    );
  }
  const body = (await response.json()) as { readonly keys?: unknown };
  const keys: readonly OidcJwk[] = Array.isArray(body.keys)
    ? (body.keys as readonly OidcJwk[])
    : [];
  if (fetchFn === fetch) {
    oidcJwksCache.set(jwksUri, { keys, expiresAt: now + KEYS_CACHE_TTL_MS });
  }
  return keys;
}

function hashAlgorithmForJwtAlg(alg: string): string {
  if (alg.endsWith('256')) return 'sha256';
  if (alg.endsWith('384')) return 'sha384';
  return 'sha512';
}

function verifyOidcJwtSignature(
  alg: string,
  signingInput: string,
  signatureBytes: Buffer,
  jwk: OidcJwk,
): boolean {
  const keyInput: JsonWebKeyInput['key'] = {
    ...(jwk.kty !== undefined ? { kty: jwk.kty } : {}),
    ...(jwk.n !== undefined ? { n: jwk.n } : {}),
    ...(jwk.e !== undefined ? { e: jwk.e } : {}),
    ...(jwk.crv !== undefined ? { crv: jwk.crv } : {}),
    ...(jwk.x !== undefined ? { x: jwk.x } : {}),
    ...(jwk.y !== undefined ? { y: jwk.y } : {}),
  };
  const publicKey = createPublicKey({ key: keyInput, format: 'jwk' });
  const hashAlg = hashAlgorithmForJwtAlg(alg);
  if (alg.startsWith('ES')) {
    return cryptoVerify(
      hashAlg,
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signatureBytes,
    );
  }
  return cryptoVerify(hashAlg, Buffer.from(signingInput), publicKey, signatureBytes);
}

function matchesAudience(
  aud: string | readonly string[] | undefined,
  expectedAudience: string,
): boolean {
  if (typeof aud === 'string') return aud === expectedAudience;
  if (Array.isArray(aud)) return aud.includes(expectedAudience);
  return false;
}

function resolveOidcDisplayName(payload: OidcIdTokenPayload): string | null {
  if (typeof payload.name === 'string' && payload.name.trim() !== '') {
    return payload.name.trim();
  }
  const combined = [payload.given_name, payload.family_name]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim();
  return combined !== '' ? combined : null;
}

export function createOidcClient(
  config: OidcClientConfig,
  fetchFn: typeof fetch = fetch,
): OidcClient {
  const normalizedIssuer = validateOidcIssuerUrl(config.issuerUrl);
  const scopes =
    config.scopes !== undefined && config.scopes.trim() !== ''
      ? config.scopes.trim()
      : 'openid email profile';

  let cachedDocPromise: Promise<OidcDiscoveryDocument> | null = null;
  const discover = (): Promise<OidcDiscoveryDocument> => {
    cachedDocPromise ??= discoverOidcProvider(normalizedIssuer, fetchFn);
    return cachedDocPromise;
  };

  async function verifyIdToken(params: {
    readonly idToken: string;
    readonly expectedNonce?: string | undefined;
    readonly nowSeconds?: number | undefined;
  }): Promise<OidcAuthenticatedUser> {
    const doc = await discover();
    const parts = params.idToken.split('.');
    if (parts.length !== 3) {
      throw new OAuthProtocolError('Invalid OIDC id_token format', 'oidc', 'INVALID_ID_TOKEN');
    }
    const [part0, part1, part2] = [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];

    let header: OidcJwtHeader;
    try {
      header = JSON.parse(base64urlDecodeBuffer(part0).toString('utf8')) as OidcJwtHeader;
    } catch {
      throw new OAuthProtocolError('Invalid OIDC JWT header', 'oidc', 'INVALID_ID_TOKEN');
    }

    if (typeof header.alg !== 'string' || !OIDC_ALLOWED_ALGS.has(header.alg)) {
      const algLabel = typeof header.alg === 'string' ? header.alg : 'missing';
      throw new OAuthProtocolError(
        `Unsupported OIDC id_token algorithm: ${algLabel}`,
        'oidc',
        'INVALID_ALGORITHM',
      );
    }

    let keys = await fetchOidcJwks(doc.jwksUri, fetchFn, false);
    const findKey = (list: readonly OidcJwk[]): OidcJwk | undefined => {
      if (typeof header.kid === 'string' && header.kid !== '') {
        return list.find((k) => k.kid === header.kid);
      }
      return list.length === 1 ? list[0] : list.find((k) => k.use === 'sig');
    };
    let jwk = findKey(keys);
    if (jwk === undefined && fetchFn === fetch) {
      keys = await fetchOidcJwks(doc.jwksUri, fetchFn, true);
      jwk = findKey(keys);
    }
    if (jwk === undefined) {
      throw new OAuthProtocolError(
        `No matching JWKS key for kid: ${header.kid ?? '(none)'}`,
        'oidc',
        'KEY_NOT_FOUND',
      );
    }

    const sigValid = verifyOidcJwtSignature(
      header.alg,
      `${part0}.${part1}`,
      base64urlDecodeBuffer(part2),
      jwk,
    );
    if (!sigValid) {
      throw new OAuthProtocolError('Invalid OIDC id_token signature', 'oidc', 'INVALID_SIGNATURE');
    }

    let payload: OidcIdTokenPayload;
    try {
      payload = JSON.parse(base64urlDecodeBuffer(part1).toString('utf8')) as OidcIdTokenPayload;
    } catch {
      throw new OAuthProtocolError('Invalid OIDC id_token payload', 'oidc', 'INVALID_ID_TOKEN');
    }

    const claimIssuer = typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/u, '') : '';
    if (claimIssuer !== doc.issuer) {
      throw new OAuthProtocolError(
        `OIDC id_token issuer mismatch: got ${claimIssuer}`,
        'oidc',
        'INVALID_ISSUER',
      );
    }
    if (!matchesAudience(payload.aud, config.clientId)) {
      throw new OAuthProtocolError('OIDC id_token audience mismatch', 'oidc', 'INVALID_AUDIENCE');
    }

    const nowSec = params.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
      throw new OAuthProtocolError('OIDC id_token has expired', 'oidc', 'TOKEN_EXPIRED');
    }
    if (typeof payload.iat === 'number' && payload.iat > nowSec + 300) {
      throw new OAuthProtocolError('OIDC id_token issued in the future', 'oidc', 'INVALID_IAT');
    }
    if (
      params.expectedNonce !== undefined &&
      params.expectedNonce !== '' &&
      payload.nonce !== params.expectedNonce
    ) {
      throw new OAuthProtocolError('OIDC id_token nonce mismatch', 'oidc', 'NONCE_MISMATCH');
    }
    if (typeof payload.sub !== 'string' || payload.sub.trim() === '') {
      throw new OAuthProtocolError('OIDC id_token missing sub claim', 'oidc', 'INVALID_ID_TOKEN');
    }

    const rawEmail =
      typeof payload.email === 'string' && payload.email.includes('@')
        ? payload.email
        : typeof payload.preferred_username === 'string' && payload.preferred_username.includes('@')
          ? payload.preferred_username
          : '';

    return {
      sub: payload.sub,
      email: rawEmail,
      emailVerified:
        payload.email_verified === true ||
        payload.email_verified === 'true' ||
        (payload.email_verified === undefined && rawEmail !== ''),
      name: resolveOidcDisplayName(payload),
      ...(typeof payload.picture === 'string' && payload.picture !== ''
        ? { picture: payload.picture }
        : {}),
    };
  }

  async function exchangeCode(params: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }): Promise<OAuthTokenResponse> {
    const doc = await discover();
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: params.codeVerifier,
    });

    const response = await fetchFn(doc.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthProtocolError(
        `OIDC token exchange failed: ${errorText}`,
        'oidc',
        'TOKEN_EXCHANGE_FAILED',
      );
    }

    const wire = (await response.json()) as {
      readonly access_token?: string;
      readonly refresh_token?: string;
      readonly expires_in?: number;
      readonly token_type?: string;
      readonly scope?: string;
      readonly id_token?: string;
    };
    if (typeof wire.access_token !== 'string' || wire.access_token === '') {
      throw new OAuthProtocolError(
        'OIDC token response missing access_token',
        'oidc',
        'TOKEN_EXCHANGE_FAILED',
      );
    }
    return {
      accessToken: wire.access_token,
      ...(wire.refresh_token !== undefined ? { refreshToken: wire.refresh_token } : {}),
      ...(typeof wire.expires_in === 'number'
        ? { expiresAt: new Date(Date.now() + wire.expires_in * 1000) }
        : {}),
      tokenType: wire.token_type ?? 'Bearer',
      ...(wire.scope !== undefined ? { scope: wire.scope } : {}),
      ...(wire.id_token !== undefined ? { idToken: wire.id_token } : {}),
    };
  }

  return {
    discover,

    async getAuthorizationUrl(params): Promise<string> {
      const doc = await discover();
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: params.redirectUri,
        scope: scopes,
        state: params.state,
        nonce: params.nonce,
        code_challenge: params.codeChallenge,
        code_challenge_method: 'S256',
      });
      if (params.loginHint !== undefined && params.loginHint.trim() !== '') {
        query.set('login_hint', params.loginHint.trim());
      }
      return `${doc.authorizationEndpoint}?${query.toString()}`;
    },

    exchangeCode,
    verifyIdToken,

    async authenticateCode(params) {
      const tokens = await exchangeCode({
        code: params.code,
        redirectUri: params.redirectUri,
        codeVerifier: params.codeVerifier,
      });
      if (tokens.idToken === undefined || tokens.idToken === '') {
        throw new OAuthProtocolError('OIDC token response missing id_token', 'oidc', 'NO_ID_TOKEN');
      }
      let user = await verifyIdToken({
        idToken: tokens.idToken,
        expectedNonce: params.expectedNonce,
        nowSeconds: params.nowSeconds,
      });

      if (user.email === '') {
        const doc = await discover();
        if (doc.userinfoEndpoint !== undefined) {
          const uiRes = await fetchFn(doc.userinfoEndpoint, {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              Accept: 'application/json',
            },
          });
          if (uiRes.ok) {
            const uiData = (await uiRes.json()) as {
              readonly email?: string;
              readonly email_verified?: boolean;
              readonly name?: string;
              readonly picture?: string;
            };
            if (typeof uiData.email === 'string' && uiData.email.includes('@')) {
              user = {
                ...user,
                email: uiData.email,
                emailVerified: uiData.email_verified ?? user.emailVerified,
                name: user.name ?? (typeof uiData.name === 'string' ? uiData.name : null),
                ...(user.picture === undefined && typeof uiData.picture === 'string'
                  ? { picture: uiData.picture }
                  : {}),
              };
            }
          }
        }
      }

      if (user.email === '') {
        throw new OAuthProtocolError(
          'OIDC provider did not return an email address',
          'oidc',
          'NO_EMAIL',
        );
      }
      return { user, tokens };
    },
  };
}
