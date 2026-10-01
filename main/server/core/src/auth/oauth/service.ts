// main/server/core/src/auth/oauth/service.ts
/**
 * OAuth Service
 *
 * Business logic for OAuth authentication flows.
 * Handles provider management, account linking, and user creation.
 *
 * @module oauth/service
 */

import { randomBytes } from 'node:crypto';

import { insert } from '@bslt/db/builder';
import { OAUTH_CONNECTIONS_TABLE, type OAuthProvider, type UserRole } from '@bslt/db/schema';
import { withTransaction } from '@bslt/db/utils';
import { canonicalizeEmail, normalizeEmail, toISODateOnly } from '@bslt/shared/helpers';
import { ConflictError, NotFoundError } from '@bslt/shared/system';

import { insertConsentedUser } from '../consented-user';
import { EmailAlreadyExistsError, OAuthError, OAuthStateMismatchError } from '../errors';
import {
  createAccessToken,
  createRefreshTokenFamily,
  generateUniqueUsername,
  splitFullName,
} from '../utils';

import { getProviderClient } from './provider-client';
import { extractAppleUserFromIdToken } from './providers';
import { createOAuthState, decodeOAuthState, encodeOAuthState } from './state';
import { encryptToken } from './token-crypto';

import type { OAuthConnectionInfo, OAuthTokenResponse, OAuthUserInfo } from './types';
import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { UserId } from '@bslt/shared/schema';
import type { AuthConfig } from '@bslt/shared/system/config';

// ============================================================================
// Types
// ============================================================================

/**
 * OAuth authentication result.
 */
export interface OAuthAuthResult {
  /** JWT access token */
  accessToken: string;
  /** Opaque refresh token */
  refreshToken: string;
  /** Authenticated user data (matches domain User from @bslt/shared) */
  user: {
    id: UserId;
    email: string;
    username: string | null;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    role: UserRole;
    emailVerified: boolean;
    phone: string | null;
    phoneVerified: boolean | null;
    dateOfBirth: string | null;
    gender: string | null;
    bio: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    language: string | null;
    website: string | null;
    createdAt: string;
    updatedAt: string;
  };
  /** Whether this is a newly created user */
  isNewUser: boolean;
}

/**
 * OAuth callback result.
 */
export interface OAuthCallbackResult {
  /** Authentication result if successful */
  auth?: OAuthAuthResult;
  /** True if this was a link operation */
  isLinking: boolean;
  /** True if account was linked (for link operations) */
  linked?: boolean;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Generate authorization URL for OAuth flow.
 *
 * @param provider - OAuth provider
 * @param config - Auth configuration
 * @param redirectUri - Callback URL
 * @param isLinking - Whether this is a link operation
 * @param userId - User ID if linking
 * @param eligibilityAttested - Signup eligibility confirmation from the sign-up
 *   surface; sealed into the encrypted state so it cannot be forged at the callback
 * @param tosAccepted - Consent to the published signup agreements; sealed into the
 *   encrypted state the same way
 * @returns URL and encoded state
 * @complexity O(1)
 */
export function getAuthorizationUrl(
  provider: OAuthProvider,
  config: AuthConfig,
  redirectUri: string,
  isLinking: boolean,
  userId?: string,
  eligibilityAttested?: boolean,
  tosAccepted?: boolean,
): { url: string; state: string } {
  const client = getProviderClient(provider, config);
  const stateObj = createOAuthState(
    provider,
    redirectUri,
    isLinking,
    userId,
    eligibilityAttested,
    tosAccepted,
  );
  const encodedState = encodeOAuthState(stateObj, config.cookie.secret);

  const url = client.getAuthorizationUrl(encodedState, redirectUri);

  return { url, state: encodedState };
}

/**
 * Handle OAuth callback - exchange code for tokens and authenticate/link user.
 *
 * @param db - Database client
 * @param repos - Repositories
 * @param config - Auth configuration
 * @param provider - OAuth provider
 * @param code - Authorization code
 * @param state - Encrypted OAuth state
 * @param redirectUri - Callback URL
 * @returns Callback result
 * @throws {OAuthStateMismatchError} If state validation fails
 * @complexity O(1) - constant database operations
 */
export async function handleOAuthCallback(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  provider: OAuthProvider,
  code: string,
  state: string,
  redirectUri: string,
): Promise<OAuthCallbackResult> {
  // Decode and validate state
  const stateObj = decodeOAuthState(state, config.cookie.secret);

  if (stateObj.provider !== provider) {
    throw new OAuthStateMismatchError(provider);
  }

  // Get provider client and exchange code
  const client = getProviderClient(provider, config);
  const tokens = await client.exchangeCode(code, redirectUri);

  // Get user info from provider
  let userInfo: OAuthUserInfo;
  if (provider === 'apple') {
    // Apple has no userinfo endpoint: identity comes from the OIDC id_token.
    if (tokens.idToken === undefined || tokens.idToken === '') {
      throw new OAuthError('Apple OAuth did not return id_token', 'apple', 'NO_ID_TOKEN');
    }
    // Narrowing for clientId (getProviderClient already threw if unconfigured).
    const appleConfig = config.oauth.apple;
    if (appleConfig == null) {
      throw new OAuthError('Apple OAuth not configured', 'apple', 'NOT_CONFIGURED');
    }
    // Verify signature and extract user info from id_token
    userInfo = await extractAppleUserFromIdToken(tokens.idToken, appleConfig.clientId);
  } else {
    userInfo = await client.getUserInfo(tokens.accessToken);
  }

  // Handle linking vs authentication
  if (stateObj.isLinking && stateObj.userId !== undefined) {
    await linkOAuthAccount(db, repos, config, stateObj.userId, provider, userInfo, tokens);
    return { isLinking: true, linked: true };
  }

  // Authenticate or create user
  const auth = await authenticateOrCreateWithOAuth(
    db,
    repos,
    config,
    provider,
    userInfo,
    tokens,
    stateObj.eligibilityAttested,
    stateObj.tosAccepted,
  );
  return { auth, isLinking: false };
}

/**
 * Authenticate existing user or create new user from OAuth.
 *
 * @param db - Database client
 * @param repos - Repositories
 * @param config - Auth configuration
 * @param provider - OAuth provider
 * @param userInfo - User info from provider
 * @param tokens - Token response from provider
 * @param eligibilityAttested - Eligibility confirmation carried in the encrypted state.
 *   Required only when this callback creates an account.
 * @param tosAccepted - Consent to the published signup agreements, carried in the
 *   encrypted state. Required only when this callback creates an account and
 *   agreements are published.
 * @returns Authentication result
 * @complexity O(1) - constant database operations
 */
async function authenticateOrCreateWithOAuth(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  provider: OAuthProvider,
  userInfo: OAuthUserInfo,
  tokens: OAuthTokenResponse,
  eligibilityAttested?: boolean,
  tosAccepted?: boolean,
): Promise<OAuthAuthResult> {
  const encryptionKey = config.oauthTokenEncryptionKey;
  const normalizedEmail = normalizeEmail(userInfo.email);
  const canonicalEmail = canonicalizeEmail(userInfo.email);

  // Check if OAuth connection already exists (using repository)
  const existingConnection = await repos.oauthConnections.findByProviderUserId(
    provider,
    userInfo.id,
  );

  if (existingConnection != null) {
    // Update tokens and return existing user (using repository)
    await repos.oauthConnections.update(existingConnection.id, {
      accessToken: encryptToken(tokens.accessToken, encryptionKey),
      refreshToken:
        tokens.refreshToken !== undefined ? encryptToken(tokens.refreshToken, encryptionKey) : null,
      expiresAt: tokens.expiresAt ?? null,
      providerEmail: userInfo.email,
      updatedAt: new Date(),
    });

    const user = await repos.users.findById(existingConnection.userId);

    if (user == null) {
      throw new NotFoundError('User not found');
    }

    // Create auth tokens
    const accessToken = createAccessToken(
      user.id,
      user.email,
      user.role,
      config.jwt.secret,
      config.jwt.accessTokenExpiry,
      user.tokenVersion,
    );

    const { token: refreshToken } = await createRefreshTokenFamily(
      db,
      user.id,
      config.refreshToken.expiryDays,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id as UserId,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl ?? null,
        role: user.role,
        emailVerified: user.emailVerified,
        phone: user.phone ?? null,
        phoneVerified: user.phoneVerified ?? null,
        dateOfBirth: toISODateOnly(user.dateOfBirth),
        gender: user.gender ?? null,
        bio: user.bio ?? null,
        city: user.city ?? null,
        state: user.state ?? null,
        country: user.country ?? null,
        language: user.language ?? null,
        website: user.website ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      isNewUser: false,
    };
  }

  // Check if email already exists (for a different user) - using repository
  const existingUser = await repos.users.findByEmail(canonicalEmail);

  if (existingUser != null) {
    // Email exists but no OAuth connection - user should link their account
    throw new EmailAlreadyExistsError(
      `An account with email ${userInfo.email} already exists. Please log in and link your ${provider} account.`,
    );
  }

  // Generate username and split name for new OAuth user
  const username = await generateUniqueUsername(repos, userInfo.email);
  const { firstName, lastName } = splitFullName(userInfo.name);

  // Create new user with OAuth connection.
  //
  // This is the ONLY point at which an OAuth sign-in creates an account, so it is
  // where the eligibility confirmation and the signup-agreement consent are
  // required. Both ride in the ENCRYPTED state (sealed with the cookie secret at
  // /auth/oauth/:provider?attested=true&consented=true), so a caller cannot
  // fabricate them by editing the callback URL. An existing user signing in never
  // reaches here and is never asked to re-confirm.
  const result = await withTransaction(db, async (tx) => {
    // Create user (verified if provider verified email) plus its consent rows
    const newUser = await insertConsentedUser(
      tx,
      repos,
      {
        email: normalizedEmail,
        canonical_email: canonicalEmail,
        username,
        first_name: firstName,
        last_name: lastName,
        // OAuth users don't have a password - generate a random unusable hash
        password_hash: `oauth:${provider}:${randomBytes(32).toString('hex')}`,
        role: 'user',
        email_verified: userInfo.emailVerified,
        email_verified_at: userInfo.emailVerified ? new Date() : null,
      },
      { agreed: tosAccepted, attested: eligibilityAttested },
    );

    // Create OAuth connection
    await tx.execute(
      insert(OAUTH_CONNECTIONS_TABLE)
        .values({
          user_id: newUser.id,
          provider,
          provider_user_id: userInfo.id,
          provider_email: userInfo.email,
          access_token: encryptToken(tokens.accessToken, encryptionKey),
          refresh_token:
            tokens.refreshToken !== undefined
              ? encryptToken(tokens.refreshToken, encryptionKey)
              : null,
          expires_at: tokens.expiresAt,
        })
        .toSql(),
    );

    // Create refresh token
    const { token: refreshToken } = await createRefreshTokenFamily(
      tx,
      newUser.id,
      config.refreshToken.expiryDays,
    );

    return { user: newUser, refreshToken };
  });

  // Create access token
  const accessToken = createAccessToken(
    result.user.id,
    result.user.email,
    result.user.role,
    config.jwt.secret,
    config.jwt.accessTokenExpiry,
    result.user.tokenVersion,
  );

  return {
    accessToken,
    refreshToken: result.refreshToken,
    user: {
      id: result.user.id as UserId,
      email: result.user.email,
      username: result.user.username,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      avatarUrl: result.user.avatarUrl ?? null,
      role: result.user.role,
      emailVerified: result.user.emailVerified,
      phone: result.user.phone ?? null,
      phoneVerified: result.user.phoneVerified ?? null,
      dateOfBirth: toISODateOnly(result.user.dateOfBirth),
      gender: result.user.gender ?? null,
      bio: result.user.bio ?? null,
      city: result.user.city ?? null,
      state: result.user.state ?? null,
      country: result.user.country ?? null,
      language: result.user.language ?? null,
      website: result.user.website ?? null,
      createdAt: result.user.createdAt.toISOString(),
      updatedAt: result.user.updatedAt.toISOString(),
    },
    isNewUser: true,
  };
}

/**
 * Link OAuth account to existing user.
 * Runs validation queries in parallel for performance.
 *
 * @param _db - Database client (unused)
 * @param repos - Repositories
 * @param config - Auth configuration
 * @param userId - User ID to link to
 * @param provider - OAuth provider
 * @param userInfo - User info from provider
 * @param tokens - Token response from provider
 * @throws {NotFoundError} If user not found
 * @throws {ConflictError} If provider already linked
 * @complexity O(1) - parallel validation queries
 */
export async function linkOAuthAccount(
  _db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  userId: string,
  provider: OAuthProvider,
  userInfo: OAuthUserInfo,
  tokens: OAuthTokenResponse,
): Promise<void> {
  const encryptionKey = config.oauthTokenEncryptionKey;

  // Run all validation queries in parallel (no dependencies between them) - using repositories
  const [user, existingConnection, otherConnection] = await Promise.all([
    // Check if user exists
    repos.users.findById(userId),
    // Check if this provider is already linked to this user
    repos.oauthConnections.findByUserIdAndProvider(userId, provider),
    // Check if this provider account is linked to another user
    repos.oauthConnections.findByProviderUserId(provider, userInfo.id),
  ]);

  if (user == null) {
    throw new NotFoundError('User not found');
  }

  if (existingConnection != null) {
    throw new ConflictError(
      `${provider} is already linked to your account`,
      'OAUTH_ALREADY_LINKED',
    );
  }

  if (otherConnection != null) {
    throw new ConflictError(
      `This ${provider} account is already linked to another user`,
      'OAUTH_LINKED_TO_OTHER',
    );
  }

  // Create OAuth connection (using repository)
  await repos.oauthConnections.create({
    userId,
    provider,
    providerUserId: userInfo.id,
    providerEmail: userInfo.email,
    accessToken: encryptToken(tokens.accessToken, encryptionKey),
    refreshToken:
      tokens.refreshToken !== undefined ? encryptToken(tokens.refreshToken, encryptionKey) : null,
    expiresAt: tokens.expiresAt ?? null,
  });
}

/**
 * Unlink OAuth account from user.
 * Runs validation queries in parallel for performance.
 *
 * @param _db - Database client (unused)
 * @param repos - Repositories
 * @param userId - User ID
 * @param provider - OAuth provider to unlink
 * @throws {NotFoundError} If connection or user not found
 * @throws {ConflictError} If this is the only auth method
 * @complexity O(1) - parallel validation queries
 */
export async function unlinkOAuthAccount(
  _db: DbClient,
  repos: Repositories,
  userId: string,
  provider: OAuthProvider,
): Promise<void> {
  // Run all validation queries in parallel (no dependencies between them) - using repositories
  const [connection, user, connections] = await Promise.all([
    // Check if connection exists
    repos.oauthConnections.findByUserIdAndProvider(userId, provider),
    // Get user to check passwordHash
    repos.users.findById(userId),
    // Count OAuth connections for this user
    repos.oauthConnections.findByUserId(userId),
  ]);

  if (connection == null) {
    throw new NotFoundError(`${provider} is not linked to your account`);
  }

  if (user == null) {
    throw new NotFoundError('User not found');
  }

  // Check if user has a password (not just oauth:provider:hash)
  const userHasPassword = !user.passwordHash.startsWith('oauth:');

  if (connections.length === 1 && !userHasPassword) {
    throw new ConflictError(
      'Cannot unlink the only authentication method. Please set a password first or link another provider.',
      'CANNOT_UNLINK_ONLY_AUTH',
    );
  }

  // Delete the connection (using repository)
  await repos.oauthConnections.deleteByUserIdAndProvider(userId, provider);
}

/**
 * Get user's connected OAuth providers.
 *
 * @param _db - Database client (unused)
 * @param repos - Repositories
 * @param userId - User ID
 * @returns Array of OAuth connection info
 * @complexity O(n) where n is the number of connections
 */
export async function getConnectedProviders(
  _db: DbClient,
  repos: Repositories,
  userId: string,
): Promise<OAuthConnectionInfo[]> {
  // Using repository
  const connections = await repos.oauthConnections.findByUserId(userId);

  return connections.map((conn) => ({
    id: conn.id,
    provider: conn.provider,
    providerEmail: conn.providerEmail,
    connectedAt: conn.createdAt,
  }));
}

/**
 * Find user by OAuth provider and provider user ID.
 *
 * @param _db - Database client (unused)
 * @param repos - Repositories
 * @param provider - OAuth provider
 * @param providerUserId - Provider-specific user ID
 * @returns User info or null
 * @complexity O(1)
 */
export async function findUserByOAuthProvider(
  _db: DbClient,
  repos: Repositories,
  provider: OAuthProvider,
  providerUserId: string,
): Promise<{ userId: string; email: string; canonicalEmail: string } | null> {
  // Using repositories (two queries instead of JOIN)
  const connection = await repos.oauthConnections.findByProviderUserId(provider, providerUserId);

  if (connection === null) {
    return null;
  }

  const user = await repos.users.findById(connection.userId);

  if (user === null) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    canonicalEmail: user.canonicalEmail,
  };
}
