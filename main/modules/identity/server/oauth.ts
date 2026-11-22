// main/modules/identity/server/oauth.ts
/**
 * Identity OAuth 2.0 + Apple OIDC Service & Cron Refresh
 *
 * Wraps `@bslt/protocols/oauth` with AES-256-GCM state sealing, signup
 * eligibility/ToS consent enforcement, encrypted token persistence, session
 * issuance, account linking/unlinking, and periodic refresh-token rotation.
 */
import { randomBytes } from 'node:crypto';

import {
  OAuthProtocolError,
  createAppleProvider,
  createGitHubProvider,
  createGoogleProvider,
  createKakaoProvider,
  extractAppleUserFromIdToken,
  refreshOAuthProviderToken,
  type OAuthProviderClient,
  type OAuthRefreshedTokens,
  type OAuthTokenResponse,
  type OAuthUserInfo,
} from '@bslt/protocols/oauth';

import {
  OAUTH_PROVIDERS,
  type OAuthCallbackQuery,
  type OAuthConnectionItem,
  type OAuthProvider,
  type User as ContractUser,
} from '../contract';

import {
  ConsentedUserRefusalError,
  createConsentedUserInRepo,
  generateUniqueUsernameInRepo,
  splitFullName,
  type SignupComplianceHooks,
} from './auth-flows';
import { canonicalizeEmail, decryptToken, encryptToken, normalizeEmail } from './crypto';
import { issueSession, type IssuedSession, type RefreshCookieConfig } from './service';

import type { IdentityRepository, User } from './repository';
import type { Tx } from '@bslt/server-system/module';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_WINDOW_MS = 60 * 60 * 1000;

interface OAuthStandardProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
}

interface OAuthAppleProviderConfig {
  readonly clientId: string;
  readonly callbackUrl: string;
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKey: string;
}

export interface OAuthProvidersMap {
  readonly google?: OAuthStandardProviderConfig | undefined;
  readonly github?: OAuthStandardProviderConfig | undefined;
  readonly kakao?: OAuthStandardProviderConfig | undefined;
  readonly apple?: OAuthAppleProviderConfig | undefined;
}

export interface OAuthServiceConfig {
  readonly appBaseUrl: string;
  readonly stateEncryptionKey: string;
  readonly tokenEncryptionKey: string;
  readonly jwtSecret: string;
  readonly accessTokenExpiry: string;
  readonly refreshExpiryDays: number;
  readonly cookie: RefreshCookieConfig;
  readonly enabledStrategies: ReadonlySet<string> | null;
  readonly providers: OAuthProvidersMap;
}

interface OAuthState {
  readonly state: string;
  readonly provider: OAuthProvider;
  readonly redirectUri: string;
  readonly isLinking: boolean;
  readonly userId?: string | undefined;
  readonly eligibilityAttested?: boolean | undefined;
  readonly tosAccepted?: boolean | undefined;
  readonly createdAt: number;
}

interface OAuthRefreshResult {
  readonly total: number;
  readonly refreshed: number;
  readonly failed: number;
}

export function parseOAuthInitiateFlags(query: {
  readonly attested?: string | undefined;
  readonly consented?: string | undefined;
}): {
  readonly eligibilityAttested: boolean;
  readonly tosAccepted: boolean;
} {
  return {
    eligibilityAttested: query.attested === 'true',
    tosAccepted: query.consented === 'true',
  };
}

export function createOAuthState(options: {
  readonly provider: OAuthProvider;
  readonly redirectUri: string;
  readonly isLinking: boolean;
  readonly userId?: string | undefined;
  readonly eligibilityAttested?: boolean | undefined;
  readonly tosAccepted?: boolean | undefined;
  readonly nowMs?: number | undefined;
}): OAuthState {
  return {
    state: randomBytes(32).toString('hex'),
    provider: options.provider,
    redirectUri: options.redirectUri,
    isLinking: options.isLinking,
    ...(options.userId !== undefined ? { userId: options.userId } : {}),
    ...(options.eligibilityAttested !== undefined
      ? { eligibilityAttested: options.eligibilityAttested }
      : {}),
    ...(options.tosAccepted !== undefined ? { tosAccepted: options.tosAccepted } : {}),
    createdAt: options.nowMs ?? Date.now(),
  };
}

export function encodeOAuthState(state: OAuthState, encryptionKey: string): string {
  return encryptToken(JSON.stringify(state), encryptionKey);
}

export function decodeOAuthState(
  encoded: string,
  encryptionKey: string,
  nowMs: number = Date.now(),
):
  | { readonly ok: true; readonly state: OAuthState }
  | { readonly ok: false; readonly code: 'OAUTH_STATE_MISMATCH' } {
  try {
    const raw: unknown = JSON.parse(decryptToken(encoded, encryptionKey));
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, code: 'OAUTH_STATE_MISMATCH' };
    }
    const parsed = raw as Partial<OAuthState>;
    if (
      typeof parsed.provider !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      nowMs - parsed.createdAt > OAUTH_STATE_TTL_MS
    ) {
      return { ok: false, code: 'OAUTH_STATE_MISMATCH' };
    }
    return { ok: true, state: parsed as OAuthState };
  } catch {
    return { ok: false, code: 'OAUTH_STATE_MISMATCH' };
  }
}

function isStrategyAllowed(config: OAuthServiceConfig, provider: OAuthProvider): boolean {
  return config.enabledStrategies === null || config.enabledStrategies.has(provider);
}

function resolveCallbackUrl(appBaseUrl: string, callbackUrl: string): string {
  if (callbackUrl.startsWith('http://') || callbackUrl.startsWith('https://')) {
    return callbackUrl;
  }
  const normalizedBase = appBaseUrl.endsWith('/') ? appBaseUrl.slice(0, -1) : appBaseUrl;
  const normalizedPath = callbackUrl.startsWith('/') ? callbackUrl : `/${callbackUrl}`;
  return `${normalizedBase}${normalizedPath}`;
}

function createProviderClientFromConfig(
  provider: OAuthProvider,
  config: OAuthServiceConfig,
):
  | { readonly ok: true; readonly client: OAuthProviderClient; readonly redirectUri: string }
  | {
      readonly ok: false;
      readonly code: 'OAUTH_NOT_CONFIGURED';
      readonly message: string;
    } {
  if (!isStrategyAllowed(config, provider)) {
    return {
      ok: false,
      code: 'OAUTH_NOT_CONFIGURED',
      message: `OAuth provider ${provider} is not enabled`,
    };
  }

  switch (provider) {
    case 'google': {
      const p = config.providers.google;
      if (p === undefined || p.clientId === '' || p.clientSecret === '') {
        return {
          ok: false,
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'OAuth provider google is not configured',
        };
      }
      return {
        ok: true,
        client: createGoogleProvider(p.clientId, p.clientSecret),
        redirectUri: resolveCallbackUrl(config.appBaseUrl, p.callbackUrl),
      };
    }
    case 'github': {
      const p = config.providers.github;
      if (p === undefined || p.clientId === '' || p.clientSecret === '') {
        return {
          ok: false,
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'OAuth provider github is not configured',
        };
      }
      return {
        ok: true,
        client: createGitHubProvider(p.clientId, p.clientSecret),
        redirectUri: resolveCallbackUrl(config.appBaseUrl, p.callbackUrl),
      };
    }
    case 'kakao': {
      const p = config.providers.kakao;
      if (p === undefined || p.clientId === '') {
        return {
          ok: false,
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'OAuth provider kakao is not configured',
        };
      }
      return {
        ok: true,
        client: createKakaoProvider(p.clientId, p.clientSecret),
        redirectUri: resolveCallbackUrl(config.appBaseUrl, p.callbackUrl),
      };
    }
    case 'apple': {
      const p = config.providers.apple;
      if (
        p === undefined ||
        p.clientId === '' ||
        p.teamId === '' ||
        p.keyId === '' ||
        p.privateKey === ''
      ) {
        return {
          ok: false,
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'OAuth provider apple is not configured',
        };
      }
      return {
        ok: true,
        client: createAppleProvider({
          clientId: p.clientId,
          teamId: p.teamId,
          keyId: p.keyId,
          privateKey: p.privateKey,
        }),
        redirectUri: resolveCallbackUrl(config.appBaseUrl, p.callbackUrl),
      };
    }
  }
}

export function getEnabledOAuthProviders(config: OAuthServiceConfig): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((provider) => createProviderClientFromConfig(provider, config).ok);
}

export function getOAuthAuthorizationUrl(options: {
  readonly provider: OAuthProvider;
  readonly config: OAuthServiceConfig;
  readonly isLinking: boolean;
  readonly userId?: string | undefined;
  readonly eligibilityAttested?: boolean | undefined;
  readonly tosAccepted?: boolean | undefined;
  readonly clientFactory?: ((provider: OAuthProvider) => OAuthProviderClient) | undefined;
  readonly nowMs?: number | undefined;
}):
  | { readonly ok: true; readonly url: string; readonly state: string }
  | { readonly ok: false; readonly code: 'OAUTH_NOT_CONFIGURED'; readonly message: string } {
  const resolved = createProviderClientFromConfig(options.provider, options.config);
  if (!resolved.ok) {
    return resolved;
  }

  const client =
    options.clientFactory !== undefined ? options.clientFactory(options.provider) : resolved.client;
  const stateObj = createOAuthState({
    provider: options.provider,
    redirectUri: resolved.redirectUri,
    isLinking: options.isLinking,
    userId: options.userId,
    eligibilityAttested: options.eligibilityAttested,
    tosAccepted: options.tosAccepted,
    nowMs: options.nowMs,
  });
  const encodedState = encodeOAuthState(stateObj, options.config.stateEncryptionKey);
  const url = client.getAuthorizationUrl(encodedState, resolved.redirectUri);
  return { ok: true, url, state: encodedState };
}

type OAuthCallbackOutcome =
  | {
      readonly ok: true;
      readonly isLinking: true;
      readonly linked: boolean;
      readonly provider: OAuthProvider;
      readonly userId: string;
      readonly providerEmail: string;
    }
  | {
      readonly ok: true;
      readonly isLinking: false;
      readonly token: string;
      readonly user: ContractUser;
      readonly isNewUser: boolean;
      readonly issued: IssuedSession;
      readonly createdUser?: User | undefined;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'OAUTH_NOT_CONFIGURED'
        | 'OAUTH_FAILED'
        | 'OAUTH_STATE_MISMATCH'
        | 'OAUTH_EMAIL_EXISTS'
        | 'OAUTH_ALREADY_LINKED'
        | 'OAUTH_LINKED_TO_OTHER'
        | 'SIGNUP_CONSENT_REQUIRED'
        | 'ELIGIBILITY_ATTESTATION_REQUIRED';
      readonly message: string;
      readonly details?: Readonly<Record<string, unknown>> | undefined;
    };

export async function handleOAuthCallbackInRepo(options: {
  readonly repo: IdentityRepository;
  readonly tx?: Tx | undefined;
  readonly config: OAuthServiceConfig;
  readonly provider: OAuthProvider;
  readonly query: OAuthCallbackQuery;
  readonly clientFactory?: ((provider: OAuthProvider) => OAuthProviderClient) | undefined;
  readonly peekAgreements?: SignupComplianceHooks['peekAgreements'] | undefined;
  readonly recordConsents?: SignupComplianceHooks['recordConsents'] | undefined;
  readonly onUserCreatedInTx?: ((tx: Tx, newUser: User) => Promise<void>) | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly deviceId?: string | undefined;
  readonly now?: Date | undefined;
}): Promise<OAuthCallbackOutcome> {
  const now = options.now ?? new Date();
  const resolved = createProviderClientFromConfig(options.provider, options.config);
  if (!resolved.ok) {
    return resolved;
  }

  if (options.query.error !== undefined && options.query.error !== '') {
    return {
      ok: false,
      code: 'OAUTH_FAILED',
      message: options.query.error_description ?? options.query.error,
    };
  }

  if (
    options.query.code === undefined ||
    options.query.code === '' ||
    options.query.state === undefined ||
    options.query.state === ''
  ) {
    return {
      ok: false,
      code: 'OAUTH_FAILED',
      message: 'Missing code or state parameter',
    };
  }

  const decoded = decodeOAuthState(
    options.query.state,
    options.config.stateEncryptionKey,
    now.getTime(),
  );
  if (!decoded.ok || decoded.state.provider !== options.provider) {
    return {
      ok: false,
      code: 'OAUTH_STATE_MISMATCH',
      message: `OAuth state mismatch for provider ${options.provider}`,
    };
  }

  const client =
    options.clientFactory !== undefined ? options.clientFactory(options.provider) : resolved.client;

  let tokens: OAuthTokenResponse;
  let userInfo: OAuthUserInfo;
  try {
    tokens = await client.exchangeCode(options.query.code, resolved.redirectUri);
    if (options.provider === 'apple') {
      if (tokens.idToken === undefined || tokens.idToken === '') {
        return {
          ok: false,
          code: 'OAUTH_FAILED',
          message: 'Apple OAuth did not return id_token',
        };
      }
      if (options.clientFactory !== undefined) {
        userInfo = await client.getUserInfo(tokens.idToken);
      } else {
        const appleCfg = options.config.providers.apple;
        if (appleCfg === undefined) {
          return {
            ok: false,
            code: 'OAUTH_NOT_CONFIGURED',
            message: 'Apple OAuth not configured',
          };
        }
        userInfo = await extractAppleUserFromIdToken(tokens.idToken, appleCfg.clientId);
      }
    } else {
      userInfo = await client.getUserInfo(tokens.accessToken);
    }
  } catch (err: unknown) {
    if (err instanceof OAuthProtocolError) {
      return { ok: false, code: 'OAUTH_FAILED', message: err.message };
    }
    throw err;
  }

  const encryptionKey = options.config.tokenEncryptionKey;

  // 1. Account linking flow
  if (decoded.state.isLinking && decoded.state.userId !== undefined) {
    const linkUserId = decoded.state.userId;
    const [user, existingForUser, existingForProvider] = await Promise.all([
      options.repo.findUserById(linkUserId),
      options.repo.findOAuthByUserIdAndProvider(linkUserId, options.provider),
      options.repo.findOAuthByProviderUserId(options.provider, userInfo.id),
    ]);
    if (user === null) {
      return { ok: false, code: 'OAUTH_FAILED', message: 'User not found' };
    }
    if (existingForUser !== null) {
      return {
        ok: false,
        code: 'OAUTH_ALREADY_LINKED',
        message: `${options.provider} is already linked to your account`,
      };
    }
    if (existingForProvider !== null) {
      return {
        ok: false,
        code: 'OAUTH_LINKED_TO_OTHER',
        message: `This ${options.provider} account is already linked to another user`,
      };
    }
    await options.repo.insertOAuthConnection({
      userId: linkUserId,
      provider: options.provider,
      providerUserId: userInfo.id,
      providerEmail: userInfo.email,
      accessToken: encryptToken(tokens.accessToken, encryptionKey),
      refreshToken:
        tokens.refreshToken !== undefined ? encryptToken(tokens.refreshToken, encryptionKey) : null,
      expiresAt: tokens.expiresAt ?? null,
    });
    return {
      ok: true,
      isLinking: true,
      linked: true,
      provider: options.provider,
      userId: linkUserId,
      providerEmail: userInfo.email,
    };
  }

  // 2. Existing OAuth connection login
  const existingConnection = await options.repo.findOAuthByProviderUserId(
    options.provider,
    userInfo.id,
  );
  if (existingConnection !== null) {
    await options.repo.updateOAuthConnection(existingConnection.id, {
      accessToken: encryptToken(tokens.accessToken, encryptionKey),
      refreshToken:
        tokens.refreshToken !== undefined ? encryptToken(tokens.refreshToken, encryptionKey) : null,
      expiresAt: tokens.expiresAt ?? null,
      providerEmail: userInfo.email,
      updatedAt: now,
    });
    const existingUser = await options.repo.findUserById(existingConnection.userId);
    if (existingUser === null || existingUser.deletedAt !== null) {
      return { ok: false, code: 'OAUTH_FAILED', message: 'User not found' };
    }
    const issued = await issueSession(options.repo, existingUser, {
      jwtSecret: options.config.jwtSecret,
      accessTokenExpiry: options.config.accessTokenExpiry,
      refreshExpiryDays: options.config.refreshExpiryDays,
      cookie: options.config.cookie,
      ipAddress: options.ipAddress ?? undefined,
      userAgent: options.userAgent ?? undefined,
      deviceId: options.deviceId,
      now,
    });
    return {
      ok: true,
      isLinking: false,
      token: issued.token,
      user: issued.user,
      isNewUser: false,
      issued,
    };
  }

  // 3. New user creation (must not collide with existing email; requires consent & attestation)
  const normalizedEmail = normalizeEmail(userInfo.email);
  const canonicalEmail = canonicalizeEmail(userInfo.email);
  const collidingUser = await options.repo.findUserByEmail(canonicalEmail);
  if (collidingUser !== null) {
    return {
      ok: false,
      code: 'OAUTH_EMAIL_EXISTS',
      message: `An account with email ${userInfo.email} already exists. Please log in and link your ${options.provider} account.`,
    };
  }

  const username = await generateUniqueUsernameInRepo(options.repo, userInfo.email);
  const { firstName, lastName } = splitFullName(userInfo.name);
  const fakeTx = options.tx ?? ({} as Tx);

  let createdUser: User;
  try {
    createdUser = await createConsentedUserInRepo(
      options.repo,
      {
        email: normalizedEmail,
        canonicalEmail,
        username,
        firstName,
        lastName,
        passwordHash: `oauth:${options.provider}:${randomBytes(32).toString('hex')}`,
        role: 'user',
        emailVerified: userInfo.emailVerified,
        emailVerifiedAt: userInfo.emailVerified ? now : null,
      },
      {
        agreed: decoded.state.tosAccepted,
        attested: decoded.state.eligibilityAttested,
        ...(options.ipAddress !== undefined && options.ipAddress !== null
          ? { ipAddress: options.ipAddress }
          : {}),
        ...(options.userAgent !== undefined && options.userAgent !== null
          ? { userAgent: options.userAgent }
          : {}),
      },
      {
        peekAgreements: options.peekAgreements ?? (() => Promise.resolve([])),
        recordConsents: options.recordConsents ?? (() => Promise.resolve()),
      },
      fakeTx,
      now,
    );
  } catch (err: unknown) {
    if (err instanceof ConsentedUserRefusalError) {
      return {
        ok: false,
        code: err.code,
        message: err.message,
      };
    }
    throw err;
  }

  await options.repo.insertOAuthConnection({
    userId: createdUser.id,
    provider: options.provider,
    providerUserId: userInfo.id,
    providerEmail: userInfo.email,
    accessToken: encryptToken(tokens.accessToken, encryptionKey),
    refreshToken:
      tokens.refreshToken !== undefined ? encryptToken(tokens.refreshToken, encryptionKey) : null,
    expiresAt: tokens.expiresAt ?? null,
  });

  if (options.onUserCreatedInTx !== undefined && options.tx !== undefined) {
    await options.onUserCreatedInTx(options.tx, createdUser);
  }

  const issued = await issueSession(options.repo, createdUser, {
    jwtSecret: options.config.jwtSecret,
    accessTokenExpiry: options.config.accessTokenExpiry,
    refreshExpiryDays: options.config.refreshExpiryDays,
    cookie: options.config.cookie,
    ipAddress: options.ipAddress ?? undefined,
    userAgent: options.userAgent ?? undefined,
    deviceId: options.deviceId,
    now,
  });

  return {
    ok: true,
    isLinking: false,
    token: issued.token,
    user: issued.user,
    isNewUser: true,
    issued,
    createdUser,
  };
}

export async function unlinkOAuthAccountInRepo(
  repo: Pick<
    IdentityRepository,
    | 'findOAuthByUserIdAndProvider'
    | 'listOAuthByUserId'
    | 'findUserById'
    | 'deleteOAuthByUserIdAndProvider'
  >,
  userId: string,
  provider: OAuthProvider,
): Promise<
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'OAUTH_CONNECTION_NOT_FOUND' | 'CANNOT_UNLINK_ONLY_AUTH';
      readonly message: string;
    }
> {
  const [connection, user, connections] = await Promise.all([
    repo.findOAuthByUserIdAndProvider(userId, provider),
    repo.findUserById(userId),
    repo.listOAuthByUserId(userId),
  ]);

  if (connection === null || user === null) {
    return {
      ok: false,
      code: 'OAUTH_CONNECTION_NOT_FOUND',
      message: `${provider} is not linked to your account`,
    };
  }

  const userHasPassword = !user.passwordHash.startsWith('oauth:');
  if (connections.length === 1 && !userHasPassword) {
    return {
      ok: false,
      code: 'CANNOT_UNLINK_ONLY_AUTH',
      message:
        'Cannot unlink the only authentication method. Please set a password first or link another provider.',
    };
  }

  await repo.deleteOAuthByUserIdAndProvider(userId, provider);
  return { ok: true };
}

export async function getConnectedOAuthProvidersInRepo(
  repo: Pick<IdentityRepository, 'listOAuthByUserId'>,
  userId: string,
): Promise<OAuthConnectionItem[]> {
  const connections = await repo.listOAuthByUserId(userId);
  return connections.map((conn) => ({
    id: conn.id,
    provider: conn.provider,
    providerEmail: conn.providerEmail,
    connectedAt: conn.createdAt.toISOString(),
  }));
}

function decryptStoredOAuthToken(
  ciphertext: string,
  primaryKey: string,
  fallbackKey: string,
): string | null {
  try {
    return decryptToken(ciphertext, primaryKey);
  } catch {
    if (fallbackKey === primaryKey) {
      return null;
    }
    try {
      return decryptToken(ciphertext, fallbackKey);
    } catch {
      return null;
    }
  }
}

export async function refreshExpiringOAuthTokensInRepo(options: {
  readonly repo: Pick<IdentityRepository, 'findExpiringOAuthConnections' | 'updateOAuthConnection'>;
  readonly config: OAuthServiceConfig;
  readonly now?: Date | undefined;
  readonly refreshTokenFn?:
    | ((
        provider: string,
        refreshToken: string,
        creds: {
          readonly clientId?: string | undefined;
          readonly clientSecret?: string | undefined;
        },
      ) => Promise<OAuthRefreshedTokens | null>)
    | undefined;
  readonly onWarn?: ((ctx: Record<string, unknown>, msg: string) => void) | undefined;
  readonly onError?: ((ctx: Record<string, unknown>, msg: string) => void) | undefined;
}): Promise<OAuthRefreshResult> {
  const now = options.now ?? new Date();
  const threshold = new Date(now.getTime() + REFRESH_WINDOW_MS);
  const expiring = await options.repo.findExpiringOAuthConnections(threshold);
  if (expiring.length === 0) {
    return { total: 0, refreshed: 0, failed: 0 };
  }

  let refreshed = 0;
  let failed = 0;
  const refreshFn = options.refreshTokenFn ?? refreshOAuthProviderToken;

  for (const conn of expiring) {
    try {
      if (conn.refreshToken === null) {
        continue;
      }

      const plainRefreshToken = decryptStoredOAuthToken(
        conn.refreshToken,
        options.config.tokenEncryptionKey,
        options.config.stateEncryptionKey,
      );
      if (plainRefreshToken === null) {
        options.onWarn?.(
          { connectionId: conn.id, provider: conn.provider },
          'Failed to decrypt OAuth refresh token, skipping',
        );
        failed += 1;
        continue;
      }

      const providerName = conn.provider;
      const clientCheck = createProviderClientFromConfig(providerName, options.config);
      if (!clientCheck.ok) {
        options.onWarn?.(
          { connectionId: conn.id, provider: conn.provider },
          'OAuth provider not configured, skipping refresh',
        );
        failed += 1;
        continue;
      }

      const providerCreds =
        providerName === 'google'
          ? options.config.providers.google
          : providerName === 'github'
            ? options.config.providers.github
            : providerName === 'kakao'
              ? options.config.providers.kakao
              : undefined;

      const tokens = await refreshFn(conn.provider, plainRefreshToken, {
        clientId: providerCreds?.clientId,
        clientSecret: providerCreds?.clientSecret,
      });
      if (tokens === null) {
        options.onWarn?.(
          { connectionId: conn.id, provider: conn.provider },
          'Provider returned no tokens on refresh',
        );
        failed += 1;
        continue;
      }

      await options.repo.updateOAuthConnection(conn.id, {
        accessToken: encryptToken(tokens.accessToken, options.config.tokenEncryptionKey),
        expiresAt: tokens.expiresAt ?? null,
        updatedAt: now,
        ...(tokens.refreshToken !== undefined
          ? { refreshToken: encryptToken(tokens.refreshToken, options.config.tokenEncryptionKey) }
          : {}),
      });
      refreshed += 1;
    } catch (err: unknown) {
      options.onError?.(
        { err, connectionId: conn.id, provider: conn.provider },
        'Failed to refresh OAuth token',
      );
      failed += 1;
    }
  }

  return { total: expiring.length, refreshed, failed };
}
