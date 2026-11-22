// main/modules/identity/server/repository.ts
import {
  and,
  deleteFrom,
  eq,
  gt,
  gte,
  inArray,
  insert,
  isNotNull,
  isNull,
  lt,
  select,
  selectCount,
  toCamelCase,
  toSnakeCase,
  update,
  type QueryResult,
} from '@bslt/db';

import { canonicalizeEmail } from './crypto';
import {
  IDENTITY_API_KEYS_TABLE,
  IDENTITY_AUTH_TOKENS_COLUMNS,
  IDENTITY_AUTH_TOKENS_TABLE,
  IDENTITY_CREDENTIALS_COLUMNS,
  IDENTITY_CREDENTIALS_TABLE,
  IDENTITY_LOCKOUTS_COLUMNS,
  IDENTITY_LOCKOUTS_TABLE,
  IDENTITY_LOGIN_ATTEMPTS_TABLE,
  IDENTITY_MFA_BACKUP_CODES_TABLE,
  IDENTITY_MFA_SMS_CODES_TABLE,
  IDENTITY_OAUTH_ACCOUNTS_COLUMNS,
  IDENTITY_OAUTH_ACCOUNTS_TABLE,
  IDENTITY_PASSKEYS_COLUMNS,
  IDENTITY_PASSKEYS_TABLE,
  IDENTITY_PROFILES_COLUMNS,
  IDENTITY_PROFILES_TABLE,
  IDENTITY_REFRESH_TOKENS_COLUMNS,
  IDENTITY_REFRESH_TOKENS_TABLE,
  IDENTITY_SESSIONS_COLUMNS,
  IDENTITY_SESSIONS_TABLE,
  IDENTITY_TRUSTED_DEVICES_COLUMNS,
  IDENTITY_TRUSTED_DEVICES_TABLE,
  IDENTITY_USERS_COLUMNS,
  IDENTITY_USERS_TABLE,
  type IdentityAuthTokensInsert,
  type IdentityAuthTokensRow,
  type IdentityCredentialsInsert,
  type IdentityCredentialsRow,
  type IdentityCredentialsUpdate,
  type IdentityLockoutsInsert,
  type IdentityLockoutsRow,
  type IdentityLockoutsUpdate,
  type IdentityOauthAccountsInsert,
  type IdentityOauthAccountsRow,
  type IdentityOauthAccountsUpdate,
  type IdentityPasskeysInsert,
  type IdentityPasskeysRow,
  type IdentityProfilesInsert,
  type IdentityProfilesRow,
  type IdentityProfilesUpdate,
  type IdentityRefreshTokensInsert,
  type IdentityRefreshTokensRow,
  type IdentitySessionsInsert,
  type IdentitySessionsRow,
  type IdentitySessionsUpdate,
  type IdentityTrustedDevicesInsert,
  type IdentityTrustedDevicesRow,
  type IdentityUserRoleEnum,
  type IdentityUsersInsert,
  type IdentityUsersRow,
  type IdentityUsersUpdate,
} from './generated/rows';

import type { UserStatus } from '../contract';

// ============================================================================
// Domain Record Types (derived from generated identity_* rows)
// ============================================================================

type UserRole = IdentityUserRoleEnum;

export type User = IdentityUsersRow &
  Omit<IdentityCredentialsRow, 'userId' | 'updatedAt'> &
  Omit<IdentityLockoutsRow, 'userId' | 'updatedAt'> &
  Omit<IdentityProfilesRow, 'userId' | 'updatedAt'>;

type NewUser = IdentityUsersInsert &
  Omit<IdentityCredentialsInsert, 'userId' | 'updatedAt'> &
  Omit<IdentityLockoutsInsert, 'userId' | 'updatedAt'> &
  Omit<IdentityProfilesInsert, 'userId' | 'updatedAt' | 'firstName' | 'lastName'> & {
    firstName: string;
    lastName: string;
  };

export type UpdateUser = Omit<IdentityUsersUpdate, 'id' | 'createdAt'> &
  Omit<IdentityCredentialsUpdate, 'userId' | 'updatedAt'> &
  Omit<IdentityLockoutsUpdate, 'userId' | 'updatedAt'> &
  Omit<IdentityProfilesUpdate, 'userId' | 'updatedAt'>;

export const COMPOSITE_USER_COLUMNS = {
  ...IDENTITY_USERS_COLUMNS,
  passwordHash: IDENTITY_CREDENTIALS_COLUMNS.passwordHash,
  totpSecret: IDENTITY_CREDENTIALS_COLUMNS.totpSecret,
  totpEnabled: IDENTITY_CREDENTIALS_COLUMNS.totpEnabled,
  failedLoginAttempts: IDENTITY_LOCKOUTS_COLUMNS.failedLoginAttempts,
  lockedUntil: IDENTITY_LOCKOUTS_COLUMNS.lockedUntil,
  lockReason: IDENTITY_LOCKOUTS_COLUMNS.lockReason,
  firstName: IDENTITY_PROFILES_COLUMNS.firstName,
  lastName: IDENTITY_PROFILES_COLUMNS.lastName,
  avatarUrl: IDENTITY_PROFILES_COLUMNS.avatarUrl,
  bio: IDENTITY_PROFILES_COLUMNS.bio,
  website: IDENTITY_PROFILES_COLUMNS.website,
  language: IDENTITY_PROFILES_COLUMNS.language,
  city: IDENTITY_PROFILES_COLUMNS.city,
  state: IDENTITY_PROFILES_COLUMNS.state,
  country: IDENTITY_PROFILES_COLUMNS.country,
  dateOfBirth: IDENTITY_PROFILES_COLUMNS.dateOfBirth,
  gender: IDENTITY_PROFILES_COLUMNS.gender,
} as const;

type RefreshToken = IdentityRefreshTokensRow;
type NewRefreshToken = Omit<
  IdentityRefreshTokensInsert,
  'familyRevokedAt' | 'familyRevokeReason' | 'rotatedAt'
>;

export interface RefreshTokenFamilyView {
  familyId: string;
  userId: string;
  deviceId?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  familyCreatedAt: Date;
  familyRevokedAt: Date | null;
  familyRevokeReason: string | null;
  latestExpiresAt: Date;
}

type UserSession = Omit<IdentitySessionsRow, 'version' | 'deviceName' | 'deviceType'> & {
  deviceName?: string | null;
  deviceType?: string | null;
};
type NewUserSession = Omit<IdentitySessionsInsert, 'version'>;
type UpdateUserSession = Pick<
  IdentitySessionsUpdate,
  'lastActiveAt' | 'deviceName' | 'deviceType' | 'revokedAt'
>;

type AuthTokenType = IdentityAuthTokensRow['type'];
type AuthToken = Omit<IdentityAuthTokensRow, 'metadata'> & {
  metadata: Record<string, unknown>;
};
type NewAuthToken = Omit<IdentityAuthTokensInsert, 'metadata'> & {
  metadata?: Record<string, unknown>;
};

type TrustedDevice = Omit<IdentityTrustedDevicesRow, 'version'>;
type NewTrustedDevice = Omit<IdentityTrustedDevicesInsert, 'version'>;

type WebauthnCredential = Omit<IdentityPasskeysRow, 'version'>;
type NewWebauthnCredential = Omit<IdentityPasskeysInsert, 'version'>;

export type OAuthConnection = Omit<IdentityOauthAccountsRow, 'version'>;
type NewOAuthConnection = Omit<IdentityOauthAccountsInsert, 'version'>;
type UpdateOAuthConnection = Pick<
  IdentityOauthAccountsUpdate,
  'providerEmail' | 'accessToken' | 'refreshToken' | 'expiresAt' | 'updatedAt'
>;

// ============================================================================
// SQL Constants & Projections
// ============================================================================

export const ANONYMIZED_EMAIL_DOMAIN = 'anonymized.invalid';

const IS_ANONYMIZED_SQL = `"email" = 'deleted-' || "id"::text || '@${ANONYMIZED_EMAIL_DOMAIN}'`;

const DUE_FOR_ANONYMIZATION_SQL =
  `"deleted_at" IS NOT NULL` +
  ` AND COALESCE("deletion_grace_period_ends", "deleted_at") <= now()` +
  ` AND NOT (${IS_ANONYMIZED_SQL})`;

function dueForPurgeSql(param: string): string {
  return (
    `"deleted_at" IS NOT NULL` +
    ` AND "deleted_at" < now() - make_interval(days => ${param}::int)` +
    ` AND (${IS_ANONYMIZED_SQL})`
  );
}

const AFTER_CURSOR_SQL = `($1::uuid IS NULL OR "id" > $1::uuid)`;

const BILLING_RESTRICTING_TABLES = [
  'billing_subscriptions',
  'billing_payment_methods',
  'billing_customer_mappings',
  'billing_invoices',
] as const;

const ORG_HAS_BILLING_SQL = BILLING_RESTRICTING_TABLES.map(
  (table) => `EXISTS (SELECT 1 FROM "${table}" b WHERE b."org_id" = t."id")`,
).join(' OR ');

const USER_HAS_BILLING_SQL = `EXISTS (SELECT 1 FROM "orgs" t WHERE t."owner_id" = $1 AND (${ORG_HAS_BILLING_SQL}))`;

const TENANT_SHARED_SQL = [
  `EXISTS (SELECT 1 FROM "orgs_members" m WHERE m."org_id" = t."id" AND m."user_id" <> $1)`,
  ORG_HAS_BILLING_SQL,
].join(' OR ');

const COMPOSITE_USER_FROM = `
  FROM ${IDENTITY_USERS_TABLE} u
  LEFT JOIN ${IDENTITY_CREDENTIALS_TABLE} c ON c.user_id = u.id
  LEFT JOIN ${IDENTITY_LOCKOUTS_TABLE} l ON l.user_id = u.id
  LEFT JOIN ${IDENTITY_PROFILES_TABLE} p ON p.user_id = u.id
`.trim();

const COMPOSITE_USER_SELECT = `
  SELECT
    u.id,
    u.email,
    u.canonical_email,
    u.username,
    COALESCE(c.password_hash, '') AS password_hash,
    p.avatar_url,
    u.role,
    u.email_verified,
    u.email_verified_at,
    c.totp_secret,
    COALESCE(c.totp_enabled, false) AS totp_enabled,
    COALESCE(p.first_name, '') AS first_name,
    COALESCE(p.last_name, '') AS last_name,
    p.bio,
    p.website,
    p.language,
    p.city,
    p.state,
    p.country,
    u.phone,
    u.phone_verified,
    p.date_of_birth,
    p.gender,
    u.last_username_change,
    COALESCE(l.failed_login_attempts, 0) AS failed_login_attempts,
    l.locked_until,
    l.lock_reason,
    u.token_version,
    u.deactivated_at,
    u.deleted_at,
    u.deletion_grace_period_ends,
    u.created_at,
    u.updated_at,
    u.version,
    u.eligibility_attested_at,
    u.eligibility_attestation_version
  ${COMPOSITE_USER_FROM}
`.trim();

const FAMILY_PROJECTION = `
  SELECT DISTINCT ON (rt.family_id)
    rt.family_id,
    rt.user_id,
    us.device_id,
    rt.family_ip_address   AS ip_address,
    rt.family_user_agent   AS user_agent,
    rt.family_created_at,
    rt.family_revoked_at,
    rt.family_revoke_reason,
    MAX(rt.expires_at) OVER (PARTITION BY rt.family_id) AS latest_expires_at
  FROM ${IDENTITY_REFRESH_TOKENS_TABLE} rt
  LEFT JOIN ${IDENTITY_SESSIONS_TABLE} us ON us.id = rt.family_id
`.trim();

export interface DbQueryClient {
  query<T = Record<string, unknown>>(sql: QueryResult): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: QueryResult): Promise<T | null>;
  execute?(sql: QueryResult): Promise<number>;
  raw?<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly last4: string;
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewApiKeyRecord {
  readonly userId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly keyPrefix: string;
  readonly last4: string;
  readonly expiresAt: Date | null;
}

export interface ApiKeyAuthRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date | null;
}

export interface DbAdminUserListFilters {
  search?: string | undefined;
  role?: UserRole | undefined;
  status?: UserStatus | undefined;
  plan?: string | undefined;
  sortBy?:
    'email' | 'username' | 'first_name' | 'last_name' | 'created_at' | 'updated_at' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

interface PaginatedUsers<T> {
  readonly data: T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface IdentityApiKeyRepository {
  listApiKeysByOwner(ownerId: string): Promise<ApiKeyRecord[]>;
  insertApiKey(data: NewApiKeyRecord): Promise<ApiKeyRecord>;
  deleteApiKeyForOwner(ownerId: string, id: string): Promise<ApiKeyRecord | null>;
  findApiKeyAuthByTokenHash(tokenHash: string): Promise<ApiKeyAuthRecord | null>;
  touchApiKeyLastUsed(id: string, now?: Date): Promise<void>;
}

export interface IdentityRepository extends IdentityApiKeyRepository {
  deleteApiKeysByOwner(ownerId: string): Promise<number>;

  // Users
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserByUsername(username: string): Promise<User | null>;
  createUser(data: NewUser): Promise<User>;
  updateUser(id: string, data: UpdateUser): Promise<User | null>;
  listUsersWithFilters(filters: DbAdminUserListFilters): Promise<PaginatedUsers<User>>;
  findActiveUsersByRoles(roles: readonly UserRole[]): Promise<User[]>;
  lockUserAccount(userId: string, lockedUntil: Date, reason: string): Promise<void>;
  unlockUserAccount(userId: string): Promise<void>;
  incrementUserTokenVersion(userId: string): Promise<number>;

  // Refresh tokens & families
  findRefreshTokenByValue(token: string): Promise<RefreshToken | null>;
  findValidRefreshToken(token: string, now?: Date): Promise<RefreshToken | null>;
  findActiveRefreshTokenInFamily(familyId: string, now?: Date): Promise<RefreshToken | null>;
  insertRefreshToken(data: NewRefreshToken): Promise<void>;
  deleteRefreshTokenByValue(token: string): Promise<boolean>;
  markRefreshTokenRotated(id: string, now?: Date): Promise<number>;
  stampRefreshFamilyRevoked(familyId: string, reason: string, now?: Date): Promise<number>;
  deleteRefreshTokensByFamily(familyId: string): Promise<number>;
  stampAllUserRefreshFamiliesRevoked(userId: string, reason: string, now?: Date): Promise<number>;
  deleteRefreshTokensByUserId(userId: string): Promise<number>;
  deleteExpiredRefreshTokens(now?: Date): Promise<number>;
  findActiveTokenFamilies(userId: string): Promise<RefreshTokenFamilyView[]>;
  findTokenFamilyById(familyId: string): Promise<RefreshTokenFamilyView | null>;

  // User sessions
  insertUserSession(data: NewUserSession): Promise<void>;
  findUserSessionById(id: string): Promise<UserSession | null>;
  findActiveUserSessions(userId: string): Promise<UserSession[]>;
  updateUserSession(id: string, data: UpdateUserSession): Promise<UserSession | null>;
  touchUserSession(id: string, now?: Date): Promise<void>;
  revokeUserSessionById(id: string, now?: Date): Promise<void>;
  revokeAllUserSessions(userId: string, now?: Date): Promise<number>;
  deleteUserSessionsByUserId(userId: string): Promise<number>;
  deleteRevokedSessionsBefore(cutoffIso: string): Promise<number>;

  // Auth tokens (unified)
  insertAuthToken(data: NewAuthToken): Promise<AuthToken>;
  findAuthTokenByHash(type: AuthTokenType, tokenHash: string): Promise<AuthToken | null>;
  findValidAuthTokenByHash(
    type: AuthTokenType,
    tokenHash: string,
    now?: Date,
  ): Promise<AuthToken | null>;
  findActiveAuthTokenByEmail(
    type: AuthTokenType,
    email: string,
    now?: Date,
  ): Promise<AuthToken | null>;
  consumeValidAuthTokenByHash(
    type: AuthTokenType,
    tokenHash: string,
    now?: Date,
  ): Promise<AuthToken | null>;
  consumeAuthTokenById(id: string, now?: Date): Promise<AuthToken | null>;
  updateAuthTokenMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  invalidateUnusedAuthTokens(type: AuthTokenType, userId: string, now?: Date): Promise<void>;
  invalidateActiveAuthTokensByEmail(
    type: AuthTokenType,
    email: string,
    now?: Date,
  ): Promise<number>;
  countRecentAuthTokensByEmail(email: string, since: Date, type?: AuthTokenType): Promise<number>;
  countRecentAuthTokensByIp(ipAddress: string, since: Date, type?: AuthTokenType): Promise<number>;
  deleteExpiredAuthTokens(now?: Date): Promise<number>;
  insertPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;

  // Login attempts & lockout
  insertLoginAttempt(data: {
    readonly email: string;
    readonly success: boolean;
    readonly ipAddress?: string | null | undefined;
    readonly userAgent?: string | null | undefined;
    readonly failureReason?: string | null | undefined;
  }): Promise<void>;
  countRecentFailedLoginAttempts(email: string, windowStart: Date): Promise<number>;
  findMostRecentFailedLoginAttemptAt(email: string, windowStart: Date): Promise<Date | null>;
  deleteLoginAttemptsOlderThan(cutoffIso: string): Promise<number>;

  // Retention & unverified cleanup
  selectDueAnonymizationBatch(cursor: string | null, batchSize: number): Promise<string[]>;
  anonymizeDueUserRow(userId: string, fields: UpdateUser): Promise<number>;
  selectDuePurgeBatch(
    cursor: string | null,
    retentionDays: number,
    batchSize: number,
  ): Promise<string[]>;
  lockDuePurgeUserForUpdate(userId: string, retentionDays: number): Promise<boolean>;
  userOwnsBillingOrg(userId: string): Promise<boolean>;
  listOwnedOrgsShareStatus(
    userId: string,
  ): Promise<ReadonlyArray<{ readonly id: string; readonly shared: boolean }>>;
  deleteUnsharedOwnedOrg(userId: string, orgId: string): Promise<number>;
  hardDeleteUserById(userId: string): Promise<number>;
  findUnverifiedUsersBefore(cutoff: Date): Promise<ReadonlyArray<{ readonly id: string }>>;
  countOAuthConnectionsByUserId(userId: string): Promise<number>;
  countActiveSessionsByUserId(userId: string): Promise<number>;

  // Trusted devices
  listTrustedDevicesByUser(userId: string): Promise<TrustedDevice[]>;
  findTrustedDeviceById(id: string): Promise<TrustedDevice | null>;
  findTrustedDeviceByFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<TrustedDevice | null>;
  upsertTrustedDeviceAccess(data: NewTrustedDevice): Promise<TrustedDevice>;
  markDeviceTrusted(id: string, now?: Date): Promise<TrustedDevice | null>;
  revokeTrustedDevice(id: string): Promise<boolean>;

  // TOTP & backup codes
  getUserTotpState(
    userId: string,
  ): Promise<{ readonly totpSecret: string | null; readonly totpEnabled: boolean } | null>;
  setUserTotpSetup(userId: string, encryptedSecret: string): Promise<void>;
  setUserTotpEnabled(userId: string, enabled: boolean, clearSecret?: boolean): Promise<void>;
  compareAndSwapUserTotpSecret(
    userId: string,
    expectedOldSecret: string,
    encryptedNewSecret: string,
  ): Promise<void>;
  getBackupCodesCounts(
    userId: string,
  ): Promise<{ readonly remaining: number; readonly total: number }>;
  listUnusedBackupCodes(
    userId: string,
  ): Promise<ReadonlyArray<{ readonly id: string; readonly codeHash: string }>>;
  claimUnusedBackupCode(id: string): Promise<boolean>;
  replaceUserBackupCodes(userId: string, codeHashes: readonly string[]): Promise<void>;
  deleteUserBackupCodes(userId: string): Promise<void>;

  // Phone & SMS verification codes
  countRecentSmsCodes(
    userId: string,
    windowHours: number,
  ): Promise<{ readonly count: number; readonly oldestCreatedAt: Date | null }>;
  invalidatePendingSmsCodes(userId: string): Promise<void>;
  insertSmsVerificationCode(data: {
    readonly userId: string;
    readonly phone: string;
    readonly codeHash: string;
    readonly expiresAt: Date;
  }): Promise<void>;
  findPendingSmsCode(userId: string): Promise<{
    readonly id: string;
    readonly codeHash: string;
    readonly attempts: number;
    readonly expiresAt: Date;
  } | null>;
  incrementSmsCodeAttempts(id: string): Promise<void>;
  markSmsCodeVerified(id: string): Promise<void>;
  findLatestVerifiedSmsPhone(userId: string): Promise<string | null>;
  setUserVerifiedPhone(userId: string, phone: string): Promise<void>;
  clearUserPhone(userId: string): Promise<void>;

  // WebAuthn credentials
  createWebauthnCredential(data: NewWebauthnCredential): Promise<WebauthnCredential>;
  listWebauthnCredentialsByUser(userId: string): Promise<WebauthnCredential[]>;
  findWebauthnCredentialByCredentialId(credentialId: string): Promise<WebauthnCredential | null>;
  updateWebauthnCredentialCounter(id: string, counter: number, now?: Date): Promise<void>;
  renameWebauthnCredential(id: string, name: string): Promise<void>;
  deleteWebauthnCredential(id: string): Promise<void>;

  // OAuth connections
  findOAuthByProviderUserId(
    provider: string,
    providerUserId: string,
  ): Promise<OAuthConnection | null>;
  findOAuthByUserIdAndProvider(userId: string, provider: string): Promise<OAuthConnection | null>;
  listOAuthByUserId(userId: string): Promise<OAuthConnection[]>;
  findExpiringOAuthConnections(before: Date): Promise<OAuthConnection[]>;
  insertOAuthConnection(data: NewOAuthConnection): Promise<OAuthConnection>;
  updateOAuthConnection(id: string, data: UpdateOAuthConnection): Promise<OAuthConnection | null>;
  deleteOAuthByUserIdAndProvider(userId: string, provider: string): Promise<boolean>;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

function escapeLike(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/%/gu, '\\%').replace(/_/gu, '\\_');
}

function transformApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    name: String(row['name']),
    keyPrefix: String(row['key_prefix']),
    last4: String(row['last4']),
    lastUsedAt: toNullableDate(row['last_used_at']),
    expiresAt: toNullableDate(row['expires_at']),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

function transformUser(row: Record<string, unknown>): User {
  const camel = toCamelCase<Partial<User>>(row, COMPOSITE_USER_COLUMNS);
  return {
    id: camel.id ?? '',
    email: camel.email ?? '',
    canonicalEmail: camel.canonicalEmail ?? camel.email ?? '',
    username: camel.username ?? null,
    passwordHash: camel.passwordHash ?? '',
    avatarUrl: camel.avatarUrl ?? null,
    role: camel.role ?? 'user',
    emailVerified: Boolean(camel.emailVerified),
    emailVerifiedAt: camel.emailVerifiedAt ?? null,
    totpSecret: camel.totpSecret ?? null,
    totpEnabled: Boolean(camel.totpEnabled),
    firstName: camel.firstName ?? '',
    lastName: camel.lastName ?? '',
    bio: camel.bio ?? null,
    website: camel.website ?? null,
    language: camel.language ?? null,
    city: camel.city ?? null,
    state: camel.state ?? null,
    country: camel.country ?? null,
    phone: camel.phone ?? null,
    phoneVerified: camel.phoneVerified ?? null,
    dateOfBirth: camel.dateOfBirth ?? null,
    gender: camel.gender ?? null,
    lastUsernameChange: camel.lastUsernameChange ?? null,
    failedLoginAttempts: camel.failedLoginAttempts ?? 0,
    lockedUntil: camel.lockedUntil ?? null,
    lockReason: camel.lockReason ?? null,
    tokenVersion: camel.tokenVersion ?? 0,
    deactivatedAt: camel.deactivatedAt ?? null,
    deletedAt: camel.deletedAt ?? null,
    deletionGracePeriodEnds: camel.deletionGracePeriodEnds ?? null,
    createdAt: toDate(camel.createdAt ?? new Date(0)),
    updatedAt: toDate(camel.updatedAt ?? camel.createdAt ?? new Date(0)),
    version: camel.version ?? 1,
    eligibilityAttestedAt: camel.eligibilityAttestedAt ?? null,
    eligibilityAttestationVersion: camel.eligibilityAttestationVersion ?? null,
  };
}

function transformSession(row: Record<string, unknown>): UserSession {
  return toCamelCase<UserSession>(row, IDENTITY_SESSIONS_COLUMNS);
}

function transformRefreshToken(row: Record<string, unknown>): RefreshToken {
  return toCamelCase<RefreshToken>(row, IDENTITY_REFRESH_TOKENS_COLUMNS);
}

function transformFamilyView(row: Record<string, unknown>): RefreshTokenFamilyView {
  return toCamelCase<RefreshTokenFamilyView>(row);
}

function transformTrustedDevice(row: Record<string, unknown>): TrustedDevice {
  return toCamelCase<TrustedDevice>(row, IDENTITY_TRUSTED_DEVICES_COLUMNS);
}

function transformWebauthnCredential(row: Record<string, unknown>): WebauthnCredential {
  return toCamelCase<WebauthnCredential>(row, IDENTITY_PASSKEYS_COLUMNS);
}

function transformAuthToken(row: Record<string, unknown>): AuthToken {
  return toCamelCase<AuthToken>(row, IDENTITY_AUTH_TOKENS_COLUMNS);
}

const CREDENTIAL_FAILURE_REASONS = ['USER_NOT_FOUND', 'PASSWORD_MISMATCH'] as const;

function withCanonicalEmail<T extends NewUser | UpdateUser>(data: T): T {
  if (data.email === undefined || data.email === '') return data;
  if (data.canonicalEmail !== undefined && data.canonicalEmail !== '') return data;
  return { ...data, canonicalEmail: canonicalizeEmail(data.email) };
}

function pickTableColumns(
  data: object,
  columnMap: Readonly<Record<string, string>>,
  excluded?: ReadonlySet<string>,
): Record<string, unknown> {
  const record = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [camelKey, snakeCol] of Object.entries(columnMap)) {
    if (excluded?.has(snakeCol) === true) continue;
    const value = record[camelKey];
    if (value !== undefined) {
      out[snakeCol] = value;
    }
  }
  return out;
}

const NON_USER_UPDATE_COLS = new Set(['id', 'created_at']);
const NON_CHILD_PATCH_COLS = new Set(['user_id', 'updated_at']);

function buildCompositeUserFilterSql(filters: DbAdminUserListFilters): {
  readonly whereSql: string;
  readonly values: unknown[];
} {
  const clauses: string[] = ['u.deleted_at IS NULL'];
  const values: unknown[] = [];
  const param = (val: unknown): string => {
    values.push(val);
    return `$${String(values.length)}`;
  };

  if (filters.search !== undefined && filters.search !== '') {
    const p = param(`%${escapeLike(filters.search)}%`);
    clauses.push(
      `(u.email ILIKE ${p} ESCAPE '\\' OR u.username ILIKE ${p} ESCAPE '\\' OR COALESCE(p.first_name, '') ILIKE ${p} ESCAPE '\\' OR COALESCE(p.last_name, '') ILIKE ${p} ESCAPE '\\')`,
    );
  }

  if (filters.role !== undefined) {
    clauses.push(`u.role = ${param(filters.role)}`);
  }

  if (filters.plan !== undefined && filters.plan !== '') {
    clauses.push(
      `EXISTS (SELECT 1 FROM orgs_members m INNER JOIN billing_subscriptions s ON s.org_id = m.org_id WHERE m.user_id = u.id AND s.plan_id = ${param(filters.plan)} AND s.status IN ('active', 'trialing', 'past_due'))`,
    );
  }

  if (filters.status !== undefined) {
    switch (filters.status) {
      case 'locked':
        clauses.push(`(l.locked_until IS NOT NULL AND l.locked_until > ${param(new Date())})`);
        break;
      case 'unverified':
        clauses.push('u.email_verified = false');
        break;
      case 'active':
        clauses.push(
          '(u.email_verified = true AND (l.locked_until IS NULL OR l.locked_until <= NOW()))',
        );
        break;
    }
  }

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    values,
  };
}

function resolveUserSortExpr(sortBy: NonNullable<DbAdminUserListFilters['sortBy']>): string {
  switch (sortBy) {
    case 'first_name':
      return "COALESCE(p.first_name, '')";
    case 'last_name':
      return "COALESCE(p.last_name, '')";
    case 'email':
      return 'u.email';
    case 'username':
      return 'u.username';
    case 'updated_at':
      return 'u.updated_at';
    case 'created_at':
      return 'u.created_at';
  }
}

async function execCount(db: DbQueryClient, sql: QueryResult): Promise<number> {
  if (typeof db.execute === 'function') {
    return db.execute(sql);
  }
  const rows = await db.query(sql);
  return rows.length;
}

async function execRaw<T = Record<string, unknown>>(
  db: DbQueryClient,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  if (typeof db.raw === 'function') {
    return db.raw<T>(text, values);
  }
  return db.query<T>({ text, values });
}

async function upsertChildTable(
  db: DbQueryClient,
  table: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;
  const cols = ['user_id', ...entries.map(([col]) => col)];
  const values: unknown[] = [userId, ...entries.map(([, val]) => val)];
  const placeholders = values.map((_, idx) => `$${String(idx + 1)}`).join(', ');
  const assignments = entries.map(([col]) => `${col} = EXCLUDED.${col}`).join(', ');
  await execCount(db, {
    text: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (user_id) DO UPDATE SET ${assignments}`,
    values,
  });
}

export function identityRepository(db: DbQueryClient): IdentityRepository {
  return {
    // -------------------------------------------------------------------------
    // API Keys
    // -------------------------------------------------------------------------
    async listApiKeysByOwner(ownerId: string): Promise<ApiKeyRecord[]> {
      const results = await db.query(
        select(IDENTITY_API_KEYS_TABLE)
          .where(eq('user_id', ownerId))
          .orderBy('created_at', 'desc')
          .toSql(),
      );
      return results.map(transformApiKey);
    },

    async insertApiKey(data: NewApiKeyRecord): Promise<ApiKeyRecord> {
      const result = await db.queryOne(
        insert(IDENTITY_API_KEYS_TABLE)
          .values({
            user_id: data.userId,
            name: data.name,
            token_hash: data.tokenHash,
            key_prefix: data.keyPrefix,
            last4: data.last4,
            expires_at: data.expiresAt,
          })
          .returningAll()
          .toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create API key');
      }
      return transformApiKey(result);
    },

    async deleteApiKeyForOwner(ownerId: string, id: string): Promise<ApiKeyRecord | null> {
      const result = await db.queryOne(
        deleteFrom(IDENTITY_API_KEYS_TABLE)
          .where(and(eq('id', id), eq('user_id', ownerId)))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transformApiKey(result) : null;
    },

    async findApiKeyAuthByTokenHash(tokenHash: string): Promise<ApiKeyAuthRecord | null> {
      const result = await db.queryOne(
        select(IDENTITY_API_KEYS_TABLE).where(eq('token_hash', tokenHash)).limit(1).toSql(),
      );
      if (result === null) return null;
      return {
        id: String(result['id']),
        userId: String(result['user_id']),
        expiresAt: toNullableDate(result['expires_at']),
      };
    },

    async touchApiKeyLastUsed(id: string, now: Date = new Date()): Promise<void> {
      await db.queryOne(
        update(IDENTITY_API_KEYS_TABLE)
          .set({ last_used_at: now, updated_at: now })
          .where(eq('id', id))
          .returningAll()
          .toSql(),
      );
    },

    async deleteApiKeysByOwner(ownerId: string): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_API_KEYS_TABLE).where(eq('user_id', ownerId)).toSql(),
      );
    },

    // -------------------------------------------------------------------------
    // Users (composite over identity_users, credentials, lockouts, profiles)
    // -------------------------------------------------------------------------
    async findUserById(id: string): Promise<User | null> {
      const result = await db.queryOne({
        text: `${COMPOSITE_USER_SELECT} WHERE u.id = $1`,
        values: [id],
      });
      return result != null ? transformUser(result) : null;
    },

    async findUserByEmail(email: string): Promise<User | null> {
      const canonical = canonicalizeEmail(email);
      const result = await db.queryOne({
        text: `${COMPOSITE_USER_SELECT} WHERE u.canonical_email = $1`,
        values: [canonical],
      });
      return result != null ? transformUser(result) : null;
    },

    async findUserByUsername(username: string): Promise<User | null> {
      const result = await db.queryOne({
        text: `${COMPOSITE_USER_SELECT} WHERE u.username = $1`,
        values: [username.toLowerCase()],
      });
      return result != null ? transformUser(result) : null;
    },

    async createUser(data: NewUser): Promise<User> {
      const normalized = withCanonicalEmail(data);
      const usersSnake = pickTableColumns(normalized, IDENTITY_USERS_COLUMNS);
      const createdUserRow = await db.queryOne(
        insert(IDENTITY_USERS_TABLE).values(usersSnake).returningAll().toSql(),
      );
      if (createdUserRow === null) {
        throw new Error('Failed to create user');
      }

      const userId = String(createdUserRow['id']);
      const credsSnake: Record<string, unknown> = {
        user_id: userId,
        password_hash: normalized.passwordHash,
        ...pickTableColumns(normalized, IDENTITY_CREDENTIALS_COLUMNS, NON_CHILD_PATCH_COLS),
      };
      const profilesSnake: Record<string, unknown> = {
        user_id: userId,
        ...pickTableColumns(normalized, IDENTITY_PROFILES_COLUMNS, NON_CHILD_PATCH_COLS),
      };
      const lockoutsSnake: Record<string, unknown> = {
        user_id: userId,
        ...pickTableColumns(normalized, IDENTITY_LOCKOUTS_COLUMNS, NON_CHILD_PATCH_COLS),
      };

      await execCount(db, insert(IDENTITY_CREDENTIALS_TABLE).values(credsSnake).toSql());
      await execCount(db, insert(IDENTITY_PROFILES_TABLE).values(profilesSnake).toSql());
      await execCount(db, insert(IDENTITY_LOCKOUTS_TABLE).values(lockoutsSnake).toSql());

      return transformUser({
        ...credsSnake,
        ...profilesSnake,
        ...lockoutsSnake,
        ...createdUserRow,
      });
    },

    async updateUser(id: string, data: UpdateUser): Promise<User | null> {
      const normalized = withCanonicalEmail(data);
      const usersPatch = pickTableColumns(normalized, IDENTITY_USERS_COLUMNS, NON_USER_UPDATE_COLS);
      const credsPatch = pickTableColumns(
        normalized,
        IDENTITY_CREDENTIALS_COLUMNS,
        NON_CHILD_PATCH_COLS,
      );
      const profilesPatch = pickTableColumns(
        normalized,
        IDENTITY_PROFILES_COLUMNS,
        NON_CHILD_PATCH_COLS,
      );
      const lockoutsPatch = pickTableColumns(
        normalized,
        IDENTITY_LOCKOUTS_COLUMNS,
        NON_CHILD_PATCH_COLS,
      );

      const effectiveUsersPatch =
        Object.keys(usersPatch).length > 0 ? usersPatch : { updated_at: new Date() };

      const updatedUserRow = await db.queryOne(
        update(IDENTITY_USERS_TABLE)
          .set(effectiveUsersPatch)
          .where(eq('id', id))
          .returningAll()
          .toSql(),
      );
      if (updatedUserRow === null) {
        return null;
      }

      if (Object.keys(credsPatch).length > 0) {
        if ('password_hash' in credsPatch) {
          await upsertChildTable(db, IDENTITY_CREDENTIALS_TABLE, id, credsPatch);
        } else {
          await execCount(
            db,
            update(IDENTITY_CREDENTIALS_TABLE).set(credsPatch).where(eq('user_id', id)).toSql(),
          );
        }
      }
      await upsertChildTable(db, IDENTITY_PROFILES_TABLE, id, profilesPatch);
      await upsertChildTable(db, IDENTITY_LOCKOUTS_TABLE, id, lockoutsPatch);

      const reloaded = await db.queryOne({
        text: `${COMPOSITE_USER_SELECT} WHERE u.id = $1`,
        values: [id],
      });
      if (reloaded !== null) {
        return transformUser(reloaded);
      }
      return transformUser({
        ...updatedUserRow,
        ...credsPatch,
        ...profilesPatch,
        ...lockoutsPatch,
      });
    },

    async listUsersWithFilters(filters: DbAdminUserListFilters): Promise<PaginatedUsers<User>> {
      const page = filters.page ?? 1;
      const limit = filters.limit ?? 20;
      const sortBy = filters.sortBy ?? 'created_at';
      const sortOrder = (filters.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      const offset = (page - 1) * limit;
      const { whereSql, values } = buildCompositeUserFilterSql(filters);
      const sortExpr = resolveUserSortExpr(sortBy);

      const limitIdx = values.length + 1;
      const offsetIdx = values.length + 2;
      const rows = await db.query({
        text: `${COMPOSITE_USER_SELECT} ${whereSql} ORDER BY ${sortExpr} ${sortOrder} LIMIT $${String(limitIdx)} OFFSET $${String(offsetIdx)}`,
        values: [...values, limit, offset],
      });
      const countRow = await db.queryOne({
        text: `SELECT COUNT(*)::int AS count ${COMPOSITE_USER_FROM} ${whereSql}`,
        values,
      });
      const total = countRow !== null ? Number(countRow['count']) : 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      return {
        data: rows.map(transformUser),
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };
    },

    async findActiveUsersByRoles(roles: readonly UserRole[]): Promise<User[]> {
      if (roles.length === 0) return [];
      const rows = await db.query({
        text: `${COMPOSITE_USER_SELECT} WHERE u.role::text = ANY($1::text[]) AND u.deleted_at IS NULL AND u.deactivated_at IS NULL`,
        values: [[...roles]],
      });
      return rows.map(transformUser);
    },

    async lockUserAccount(userId: string, lockedUntil: Date, reason: string): Promise<void> {
      await upsertChildTable(db, IDENTITY_LOCKOUTS_TABLE, userId, {
        locked_until: lockedUntil,
        lock_reason: reason,
      });
    },

    async unlockUserAccount(userId: string): Promise<void> {
      await upsertChildTable(db, IDENTITY_LOCKOUTS_TABLE, userId, {
        locked_until: null,
        lock_reason: null,
        failed_login_attempts: 0,
      });
    },

    async incrementUserTokenVersion(userId: string): Promise<number> {
      const result = await db.queryOne(
        update(IDENTITY_USERS_TABLE)
          .increment('token_version', 1)
          .where(eq('id', userId))
          .returningAll()
          .toSql(),
      );
      if (result === null) {
        throw new Error('User not found');
      }
      return Number(result['token_version'] ?? 0);
    },

    // -------------------------------------------------------------------------
    // Refresh Tokens & Families
    // -------------------------------------------------------------------------
    async findRefreshTokenByValue(token: string): Promise<RefreshToken | null> {
      const result = await db.queryOne(
        select(IDENTITY_REFRESH_TOKENS_TABLE).where(eq('token', token)).toSql(),
      );
      return result !== null ? transformRefreshToken(result) : null;
    },

    async findValidRefreshToken(
      token: string,
      now: Date = new Date(),
    ): Promise<RefreshToken | null> {
      const result = await db.queryOne(
        select(IDENTITY_REFRESH_TOKENS_TABLE)
          .where(and(eq('token', token), gt('expires_at', now)))
          .limit(1)
          .toSql(),
      );
      return result !== null ? transformRefreshToken(result) : null;
    },

    async findActiveRefreshTokenInFamily(
      familyId: string,
      now: Date = new Date(),
    ): Promise<RefreshToken | null> {
      const result = await db.queryOne(
        select(IDENTITY_REFRESH_TOKENS_TABLE)
          .where(and(eq('family_id', familyId), isNull('rotated_at'), gt('expires_at', now)))
          .limit(1)
          .toSql(),
      );
      return result !== null ? transformRefreshToken(result) : null;
    },

    async insertRefreshToken(data: NewRefreshToken): Promise<void> {
      const snakeData = toSnakeCase(data, IDENTITY_REFRESH_TOKENS_COLUMNS);
      await execCount(db, insert(IDENTITY_REFRESH_TOKENS_TABLE).values(snakeData).toSql());
    },

    async deleteRefreshTokenByValue(token: string): Promise<boolean> {
      const count = await execCount(
        db,
        deleteFrom(IDENTITY_REFRESH_TOKENS_TABLE).where(eq('token', token)).toSql(),
      );
      return count > 0;
    },

    async markRefreshTokenRotated(id: string, now: Date = new Date()): Promise<number> {
      return execCount(
        db,
        update(IDENTITY_REFRESH_TOKENS_TABLE)
          .set({ rotated_at: now })
          .where(and(eq('id', id), isNull('rotated_at')))
          .toSql(),
      );
    },

    async stampRefreshFamilyRevoked(
      familyId: string,
      reason: string,
      now: Date = new Date(),
    ): Promise<number> {
      return execCount(
        db,
        update(IDENTITY_REFRESH_TOKENS_TABLE)
          .set({ family_revoked_at: now, family_revoke_reason: reason })
          .where(eq('family_id', familyId))
          .toSql(),
      );
    },

    async deleteRefreshTokensByFamily(familyId: string): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_REFRESH_TOKENS_TABLE).where(eq('family_id', familyId)).toSql(),
      );
    },

    async stampAllUserRefreshFamiliesRevoked(
      userId: string,
      reason: string,
      now: Date = new Date(),
    ): Promise<number> {
      return execCount(
        db,
        update(IDENTITY_REFRESH_TOKENS_TABLE)
          .set({ family_revoked_at: now, family_revoke_reason: reason })
          .where(eq('user_id', userId))
          .toSql(),
      );
    },

    async deleteRefreshTokensByUserId(userId: string): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_REFRESH_TOKENS_TABLE).where(eq('user_id', userId)).toSql(),
      );
    },

    async deleteExpiredRefreshTokens(now: Date = new Date()): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_REFRESH_TOKENS_TABLE).where(lt('expires_at', now)).toSql(),
      );
    },

    async findActiveTokenFamilies(userId: string): Promise<RefreshTokenFamilyView[]> {
      const rows = await execRaw(
        db,
        `${FAMILY_PROJECTION} WHERE rt.user_id = $1 AND rt.family_revoked_at IS NULL ORDER BY rt.family_id, rt.family_created_at DESC`,
        [userId],
      );
      return rows.map(transformFamilyView);
    },

    async findTokenFamilyById(familyId: string): Promise<RefreshTokenFamilyView | null> {
      const rows = await execRaw(
        db,
        `${FAMILY_PROJECTION} WHERE rt.family_id = $1 ORDER BY rt.family_id, rt.family_created_at DESC LIMIT 1`,
        [familyId],
      );
      return rows[0] !== undefined ? transformFamilyView(rows[0]) : null;
    },

    // -------------------------------------------------------------------------
    // User Sessions
    // -------------------------------------------------------------------------
    async insertUserSession(data: NewUserSession): Promise<void> {
      const snakeData = toSnakeCase(data, IDENTITY_SESSIONS_COLUMNS);
      await execCount(db, insert(IDENTITY_SESSIONS_TABLE).values(snakeData).toSql());
    },

    async findUserSessionById(id: string): Promise<UserSession | null> {
      const result = await db.queryOne(
        select(IDENTITY_SESSIONS_TABLE).where(eq('id', id)).limit(1).toSql(),
      );
      return result !== null ? transformSession(result) : null;
    },

    async findActiveUserSessions(userId: string): Promise<UserSession[]> {
      const rows = await db.query(
        select(IDENTITY_SESSIONS_TABLE)
          .where(and(eq('user_id', userId), isNull('revoked_at')))
          .orderBy('last_active_at', 'desc')
          .toSql(),
      );
      return rows.map(transformSession);
    },

    async updateUserSession(id: string, data: UpdateUserSession): Promise<UserSession | null> {
      const snakeData = toSnakeCase(data, IDENTITY_SESSIONS_COLUMNS);
      const result = await db.queryOne(
        update(IDENTITY_SESSIONS_TABLE).set(snakeData).where(eq('id', id)).returningAll().toSql(),
      );
      return result !== null ? transformSession(result) : null;
    },

    async touchUserSession(id: string, now: Date = new Date()): Promise<void> {
      await execCount(
        db,
        update(IDENTITY_SESSIONS_TABLE).set({ last_active_at: now }).where(eq('id', id)).toSql(),
      );
    },

    async revokeUserSessionById(id: string, now: Date = new Date()): Promise<void> {
      await execCount(
        db,
        update(IDENTITY_SESSIONS_TABLE).set({ revoked_at: now }).where(eq('id', id)).toSql(),
      );
    },

    async revokeAllUserSessions(userId: string, now: Date = new Date()): Promise<number> {
      return execCount(
        db,
        update(IDENTITY_SESSIONS_TABLE)
          .set({ revoked_at: now })
          .where(eq('user_id', userId))
          .toSql(),
      );
    },

    async deleteUserSessionsByUserId(userId: string): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_SESSIONS_TABLE).where(eq('user_id', userId)).toSql(),
      );
    },

    async deleteRevokedSessionsBefore(cutoffIso: string): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_SESSIONS_TABLE)
          .where(and(isNotNull('revoked_at'), lt('revoked_at', cutoffIso)))
          .toSql(),
      );
    },

    // -------------------------------------------------------------------------
    // Auth Tokens (Unified) & Login Attempts
    // -------------------------------------------------------------------------
    async insertAuthToken(data: NewAuthToken): Promise<AuthToken> {
      const snakeData = toSnakeCase(data, IDENTITY_AUTH_TOKENS_COLUMNS);
      const result = await db.queryOne(
        insert(IDENTITY_AUTH_TOKENS_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create auth token');
      }
      return transformAuthToken(result);
    },

    async findAuthTokenByHash(type: AuthTokenType, tokenHash: string): Promise<AuthToken | null> {
      const result = await db.queryOne(
        select(IDENTITY_AUTH_TOKENS_TABLE)
          .where(and(eq('type', type), eq('token_hash', tokenHash)))
          .toSql(),
      );
      return result !== null ? transformAuthToken(result) : null;
    },

    async findValidAuthTokenByHash(
      type: AuthTokenType,
      tokenHash: string,
      now: Date = new Date(),
    ): Promise<AuthToken | null> {
      const result = await db.queryOne(
        select(IDENTITY_AUTH_TOKENS_TABLE)
          .where(
            and(
              eq('type', type),
              eq('token_hash', tokenHash),
              isNull('used_at'),
              gt('expires_at', now),
            ),
          )
          .limit(1)
          .toSql(),
      );
      return result !== null ? transformAuthToken(result) : null;
    },

    async findActiveAuthTokenByEmail(
      type: AuthTokenType,
      email: string,
      now: Date = new Date(),
    ): Promise<AuthToken | null> {
      const result = await db.queryOne(
        select(IDENTITY_AUTH_TOKENS_TABLE)
          .where(
            and(eq('type', type), eq('email', email), isNull('used_at'), gt('expires_at', now)),
          )
          .orderBy('created_at', 'desc')
          .limit(1)
          .toSql(),
      );
      return result !== null ? transformAuthToken(result) : null;
    },

    async consumeValidAuthTokenByHash(
      type: AuthTokenType,
      tokenHash: string,
      now: Date = new Date(),
    ): Promise<AuthToken | null> {
      const rows = await db.query(
        update(IDENTITY_AUTH_TOKENS_TABLE)
          .set({ used_at: now })
          .where(
            and(
              eq('token_hash', tokenHash),
              eq('type', type),
              gt('expires_at', now),
              isNull('used_at'),
            ),
          )
          .returningAll()
          .toSql(),
      );
      return rows[0] !== undefined ? transformAuthToken(rows[0]) : null;
    },

    async consumeAuthTokenById(id: string, now: Date = new Date()): Promise<AuthToken | null> {
      const rows = await db.query(
        update(IDENTITY_AUTH_TOKENS_TABLE)
          .set({ used_at: now })
          .where(and(eq('id', id), isNull('used_at')))
          .returningAll()
          .toSql(),
      );
      return rows[0] !== undefined ? transformAuthToken(rows[0]) : null;
    },

    async updateAuthTokenMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
      await execCount(
        db,
        update(IDENTITY_AUTH_TOKENS_TABLE).set({ metadata }).where(eq('id', id)).toSql(),
      );
    },

    async invalidateUnusedAuthTokens(
      type: AuthTokenType,
      userId: string,
      now: Date = new Date(),
    ): Promise<void> {
      await execCount(
        db,
        update(IDENTITY_AUTH_TOKENS_TABLE)
          .set({ used_at: now })
          .where(and(eq('type', type), eq('user_id', userId), isNull('used_at')))
          .toSql(),
      );
    },

    async invalidateActiveAuthTokensByEmail(
      type: AuthTokenType,
      email: string,
      now: Date = new Date(),
    ): Promise<number> {
      return execCount(
        db,
        update(IDENTITY_AUTH_TOKENS_TABLE)
          .set({ used_at: now })
          .where(and(eq('type', type), eq('email', email), isNull('used_at')))
          .toSql(),
      );
    },

    async countRecentAuthTokensByEmail(
      email: string,
      since: Date,
      type: AuthTokenType = 'magic_link',
    ): Promise<number> {
      const result = await db.queryOne(
        selectCount(IDENTITY_AUTH_TOKENS_TABLE)
          .where(and(eq('type', type), eq('email', email), gt('created_at', since)))
          .toSql(),
      );
      const count = result?.['count'];
      return typeof count === 'number' ? count : Number(count ?? 0);
    },

    async countRecentAuthTokensByIp(
      ipAddress: string,
      since: Date,
      type: AuthTokenType = 'magic_link',
    ): Promise<number> {
      const result = await db.queryOne(
        selectCount(IDENTITY_AUTH_TOKENS_TABLE)
          .where(and(eq('type', type), eq('ip_address', ipAddress), gt('created_at', since)))
          .toSql(),
      );
      const count = result?.['count'];
      return typeof count === 'number' ? count : Number(count ?? 0);
    },

    async deleteExpiredAuthTokens(now: Date = new Date()): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_AUTH_TOKENS_TABLE).where(lt('expires_at', now)).toSql(),
      );
    },

    async insertPasswordResetToken(
      userId: string,
      tokenHash: string,
      expiresAt: Date,
    ): Promise<void> {
      await execCount(
        db,
        insert(IDENTITY_AUTH_TOKENS_TABLE)
          .values({
            type: 'password_reset',
            user_id: userId,
            token_hash: tokenHash,
            expires_at: expiresAt,
          })
          .toSql(),
      );
    },

    async insertLoginAttempt(data: {
      readonly email: string;
      readonly success: boolean;
      readonly ipAddress?: string | null | undefined;
      readonly userAgent?: string | null | undefined;
      readonly failureReason?: string | null | undefined;
    }): Promise<void> {
      await execCount(
        db,
        insert(IDENTITY_LOGIN_ATTEMPTS_TABLE)
          .values({
            email: data.email,
            success: data.success,
            ip_address: data.ipAddress != null && data.ipAddress !== '' ? data.ipAddress : null,
            user_agent: data.userAgent != null && data.userAgent !== '' ? data.userAgent : null,
            failure_reason:
              data.failureReason != null && data.failureReason !== '' ? data.failureReason : null,
          })
          .toSql(),
      );
    },

    async countRecentFailedLoginAttempts(email: string, windowStart: Date): Promise<number> {
      const result = await db.queryOne(
        selectCount(IDENTITY_LOGIN_ATTEMPTS_TABLE)
          .where(
            and(
              eq('email', email),
              eq('success', false),
              inArray('failure_reason', CREDENTIAL_FAILURE_REASONS),
              gte('created_at', windowStart),
            ),
          )
          .toSql(),
      );
      const count = result?.['count'];
      return typeof count === 'number' ? count : Number(count ?? 0);
    },

    async findMostRecentFailedLoginAttemptAt(
      email: string,
      windowStart: Date,
    ): Promise<Date | null> {
      const row = await db.queryOne(
        select(IDENTITY_LOGIN_ATTEMPTS_TABLE)
          .columns('created_at')
          .where(
            and(
              eq('email', email),
              eq('success', false),
              inArray('failure_reason', CREDENTIAL_FAILURE_REASONS),
              gte('created_at', windowStart),
            ),
          )
          .orderBy('created_at', 'desc')
          .limit(1)
          .toSql(),
      );
      const rawCreatedAt = row?.['created_at'];
      if (rawCreatedAt === null || rawCreatedAt === undefined) return null;
      const parsed = toDate(rawCreatedAt);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    },

    async deleteLoginAttemptsOlderThan(cutoffIso: string): Promise<number> {
      return execCount(
        db,
        deleteFrom(IDENTITY_LOGIN_ATTEMPTS_TABLE).where(lt('created_at', cutoffIso)).toSql(),
      );
    },

    // -------------------------------------------------------------------------
    // Retention & Unverified Cleanup
    // -------------------------------------------------------------------------
    async selectDueAnonymizationBatch(cursor: string | null, batchSize: number): Promise<string[]> {
      const rows = await execRaw<{ id: string }>(
        db,
        `SELECT "id" FROM "${IDENTITY_USERS_TABLE}"
          WHERE ${DUE_FOR_ANONYMIZATION_SQL} AND ${AFTER_CURSOR_SQL}
          ORDER BY "id"
          LIMIT $2`,
        [cursor, batchSize],
      );
      return rows.map((r) => r.id);
    },

    async anonymizeDueUserRow(userId: string, fields: UpdateUser): Promise<number> {
      const normalized = withCanonicalEmail(fields);
      const email = normalized.email ?? `deleted-${userId}@${ANONYMIZED_EMAIL_DOMAIN}`;
      const canonicalEmail = normalized.canonicalEmail ?? email;
      return execCount(db, {
        text: `WITH updated_user AS (
                 UPDATE ${IDENTITY_USERS_TABLE} SET
                   email = $2,
                   canonical_email = $3,
                   username = $4,
                   phone = $5,
                   phone_verified = $6
                 WHERE id = $1 AND ${DUE_FOR_ANONYMIZATION_SQL}
                 RETURNING id
               ),
               upserted_profile AS (
                 INSERT INTO ${IDENTITY_PROFILES_TABLE} (
                   user_id, first_name, last_name, avatar_url, bio, website,
                   language, city, state, country, date_of_birth, gender
                 )
                 SELECT id, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
                 FROM updated_user
                 ON CONFLICT (user_id) DO UPDATE SET
                   first_name = EXCLUDED.first_name,
                   last_name = EXCLUDED.last_name,
                   avatar_url = EXCLUDED.avatar_url,
                   bio = EXCLUDED.bio,
                   website = EXCLUDED.website,
                   language = EXCLUDED.language,
                   city = EXCLUDED.city,
                   state = EXCLUDED.state,
                   country = EXCLUDED.country,
                   date_of_birth = EXCLUDED.date_of_birth,
                   gender = EXCLUDED.gender
               ),
               upserted_lockout AS (
                 INSERT INTO ${IDENTITY_LOCKOUTS_TABLE} (user_id, lock_reason)
                 SELECT id, $18 FROM updated_user
                 ON CONFLICT (user_id) DO UPDATE SET
                   lock_reason = EXCLUDED.lock_reason
               )
               SELECT id FROM updated_user`,
        values: [
          userId,
          email,
          canonicalEmail,
          normalized.username ?? null,
          normalized.phone ?? null,
          normalized.phoneVerified ?? null,
          normalized.firstName ?? 'Deleted',
          normalized.lastName ?? 'User',
          normalized.avatarUrl ?? null,
          normalized.bio ?? null,
          normalized.website ?? null,
          normalized.language ?? null,
          normalized.city ?? null,
          normalized.state ?? null,
          normalized.country ?? null,
          normalized.dateOfBirth ?? null,
          normalized.gender ?? null,
          normalized.lockReason ?? null,
        ],
      });
    },

    async selectDuePurgeBatch(
      cursor: string | null,
      retentionDays: number,
      batchSize: number,
    ): Promise<string[]> {
      const rows = await execRaw<{ id: string }>(
        db,
        `SELECT "id" FROM "${IDENTITY_USERS_TABLE}"
          WHERE ${dueForPurgeSql('$2')} AND ${AFTER_CURSOR_SQL}
          ORDER BY "id"
          LIMIT $3`,
        [cursor, retentionDays, batchSize],
      );
      return rows.map((r) => r.id);
    },

    async lockDuePurgeUserForUpdate(userId: string, retentionDays: number): Promise<boolean> {
      const rows = await execRaw<{ id: string }>(
        db,
        `SELECT "id" FROM "${IDENTITY_USERS_TABLE}" WHERE "id" = $1 AND ${dueForPurgeSql('$2')} FOR UPDATE`,
        [userId, retentionDays],
      );
      return rows.length > 0;
    },

    async userOwnsBillingOrg(userId: string): Promise<boolean> {
      const rows = await execRaw<{ kept: boolean }>(
        db,
        `SELECT (${USER_HAS_BILLING_SQL}) AS "kept"`,
        [userId],
      );
      return rows[0]?.kept === true;
    },

    async listOwnedOrgsShareStatus(
      userId: string,
    ): Promise<ReadonlyArray<{ readonly id: string; readonly shared: boolean }>> {
      return execRaw<{ id: string; shared: boolean }>(
        db,
        `SELECT t."id", (${TENANT_SHARED_SQL}) AS "shared"
           FROM "orgs" t
          WHERE t."owner_id" = $1
          ORDER BY t."id"`,
        [userId],
      );
    },

    async deleteUnsharedOwnedOrg(userId: string, orgId: string): Promise<number> {
      return execCount(db, {
        text: `DELETE FROM orgs t
                WHERE t."id" = $2 AND t."owner_id" = $1
                  AND NOT (${TENANT_SHARED_SQL})`,
        values: [userId, orgId],
      });
    },

    async hardDeleteUserById(userId: string): Promise<number> {
      return execCount(db, {
        text: `DELETE FROM ${IDENTITY_USERS_TABLE} WHERE "id" = $1`,
        values: [userId],
      });
    },

    async findUnverifiedUsersBefore(cutoff: Date): Promise<ReadonlyArray<{ readonly id: string }>> {
      const rows = await db.query(
        select(IDENTITY_USERS_TABLE)
          .where(
            and(isNull('email_verified_at'), eq('email_verified', false), lt('created_at', cutoff)),
          )
          .toSql(),
      );
      return rows.map((r) => ({ id: String(r['id']) }));
    },

    async countOAuthConnectionsByUserId(userId: string): Promise<number> {
      const row = await db.queryOne(
        selectCount(IDENTITY_OAUTH_ACCOUNTS_TABLE).where(eq('user_id', userId)).toSql(),
      );
      return row !== null ? Number(row['count']) : 0;
    },

    async countActiveSessionsByUserId(userId: string): Promise<number> {
      const row = await db.queryOne(
        selectCount(IDENTITY_SESSIONS_TABLE)
          .where(and(eq('user_id', userId), isNull('revoked_at')))
          .toSql(),
      );
      return row !== null ? Number(row['count']) : 0;
    },

    // -------------------------------------------------------------------------
    // Trusted Devices
    // -------------------------------------------------------------------------
    async listTrustedDevicesByUser(userId: string): Promise<TrustedDevice[]> {
      const rows = await db.query(
        select(IDENTITY_TRUSTED_DEVICES_TABLE)
          .where(eq('user_id', userId))
          .orderBy('last_seen_at', 'desc')
          .toSql(),
      );
      return rows.map(transformTrustedDevice);
    },

    async findTrustedDeviceById(id: string): Promise<TrustedDevice | null> {
      const result = await db.queryOne(
        select(IDENTITY_TRUSTED_DEVICES_TABLE).where(eq('id', id)).toSql(),
      );
      return result !== null ? transformTrustedDevice(result) : null;
    },

    async findTrustedDeviceByFingerprint(
      userId: string,
      fingerprint: string,
    ): Promise<TrustedDevice | null> {
      const result = await db.queryOne(
        select(IDENTITY_TRUSTED_DEVICES_TABLE)
          .where(and(eq('user_id', userId), eq('device_fingerprint', fingerprint)))
          .toSql(),
      );
      return result !== null ? transformTrustedDevice(result) : null;
    },

    async upsertTrustedDeviceAccess(data: NewTrustedDevice): Promise<TrustedDevice> {
      const snakeData = toSnakeCase(data, IDENTITY_TRUSTED_DEVICES_COLUMNS);
      const result = await db.queryOne(
        insert(IDENTITY_TRUSTED_DEVICES_TABLE)
          .values(snakeData)
          .onConflictDoUpdate(
            ['user_id', 'device_fingerprint'],
            ['last_seen_at', 'ip_address', 'user_agent'],
          )
          .returningAll()
          .toSql(),
      );
      if (result === null) {
        throw new Error('Failed to upsert trusted device');
      }
      return transformTrustedDevice(result);
    },

    async markDeviceTrusted(id: string, now: Date = new Date()): Promise<TrustedDevice | null> {
      const result = await db.queryOne(
        update(IDENTITY_TRUSTED_DEVICES_TABLE)
          .set({ trusted_at: now })
          .where(eq('id', id))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transformTrustedDevice(result) : null;
    },

    async revokeTrustedDevice(id: string): Promise<boolean> {
      const count = await execCount(
        db,
        deleteFrom(IDENTITY_TRUSTED_DEVICES_TABLE).where(eq('id', id)).toSql(),
      );
      return count > 0;
    },

    // -------------------------------------------------------------------------
    // TOTP & Backup Codes
    // -------------------------------------------------------------------------
    async getUserTotpState(
      userId: string,
    ): Promise<{ readonly totpSecret: string | null; readonly totpEnabled: boolean } | null> {
      const rows = await execRaw<{ totp_secret: string | null; totp_enabled: boolean }>(
        db,
        `SELECT c.totp_secret, COALESCE(c.totp_enabled, false) AS totp_enabled
           FROM ${IDENTITY_USERS_TABLE} u
           LEFT JOIN ${IDENTITY_CREDENTIALS_TABLE} c ON c.user_id = u.id
          WHERE u.id = $1`,
        [userId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        totpSecret: row.totp_secret ?? null,
        totpEnabled: row.totp_enabled,
      };
    },

    async setUserTotpSetup(userId: string, encryptedSecret: string): Promise<void> {
      await execCount(db, {
        text: `INSERT INTO ${IDENTITY_CREDENTIALS_TABLE} (user_id, password_hash, totp_secret, totp_enabled)
               VALUES ($2, '', $1, false)
               ON CONFLICT (user_id) DO UPDATE SET totp_secret = EXCLUDED.totp_secret, totp_enabled = false, updated_at = now()`,
        values: [encryptedSecret, userId],
      });
    },

    async setUserTotpEnabled(
      userId: string,
      enabled: boolean,
      clearSecret: boolean = false,
    ): Promise<void> {
      if (clearSecret) {
        await execCount(db, {
          text: `UPDATE ${IDENTITY_CREDENTIALS_TABLE} SET totp_enabled = $1, totp_secret = NULL, updated_at = now() WHERE user_id = $2`,
          values: [enabled, userId],
        });
      } else {
        await execCount(db, {
          text: `UPDATE ${IDENTITY_CREDENTIALS_TABLE} SET totp_enabled = $1, updated_at = now() WHERE user_id = $2`,
          values: [enabled, userId],
        });
      }
    },

    async compareAndSwapUserTotpSecret(
      userId: string,
      expectedOldSecret: string,
      encryptedNewSecret: string,
    ): Promise<void> {
      await execCount(db, {
        text: `UPDATE ${IDENTITY_CREDENTIALS_TABLE} SET totp_secret = $1, updated_at = now() WHERE user_id = $2 AND totp_secret = $3`,
        values: [encryptedNewSecret, userId, expectedOldSecret],
      });
    },

    async getBackupCodesCounts(
      userId: string,
    ): Promise<{ readonly remaining: number; readonly total: number }> {
      const rows = await execRaw<{ remaining: number | string; total: number | string }>(
        db,
        `SELECT COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining, COUNT(*)::int AS total FROM ${IDENTITY_MFA_BACKUP_CODES_TABLE} WHERE user_id = $1`,
        [userId],
      );
      const row = rows[0];
      return {
        remaining: Number(row?.remaining ?? 0),
        total: Number(row?.total ?? 0),
      };
    },

    async listUnusedBackupCodes(
      userId: string,
    ): Promise<ReadonlyArray<{ readonly id: string; readonly codeHash: string }>> {
      const rows = await execRaw<{ id: string; code_hash: string }>(
        db,
        `SELECT id, code_hash FROM ${IDENTITY_MFA_BACKUP_CODES_TABLE} WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      return rows.map((r) => ({ id: r.id, codeHash: r.code_hash }));
    },

    async claimUnusedBackupCode(id: string): Promise<boolean> {
      const claimed = await execRaw<{ id: string }>(
        db,
        `UPDATE ${IDENTITY_MFA_BACKUP_CODES_TABLE} SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`,
        [id],
      );
      return claimed.length > 0;
    },

    async replaceUserBackupCodes(userId: string, codeHashes: readonly string[]): Promise<void> {
      await execCount(db, {
        text: `DELETE FROM ${IDENTITY_MFA_BACKUP_CODES_TABLE} WHERE user_id = $1`,
        values: [userId],
      });
      for (const codeHash of codeHashes) {
        await execCount(db, {
          text: `INSERT INTO ${IDENTITY_MFA_BACKUP_CODES_TABLE} (user_id, code_hash) VALUES ($1, $2)`,
          values: [userId, codeHash],
        });
      }
    },

    async deleteUserBackupCodes(userId: string): Promise<void> {
      await execCount(db, {
        text: `DELETE FROM ${IDENTITY_MFA_BACKUP_CODES_TABLE} WHERE user_id = $1`,
        values: [userId],
      });
    },

    // -------------------------------------------------------------------------
    // Phone & SMS Verification Codes
    // -------------------------------------------------------------------------
    async countRecentSmsCodes(
      userId: string,
      windowHours: number,
    ): Promise<{ readonly count: number; readonly oldestCreatedAt: Date | null }> {
      const countRows = await execRaw<{ count: string }>(
        db,
        `SELECT COUNT(*)::text AS count FROM ${IDENTITY_MFA_SMS_CODES_TABLE} WHERE user_id = $1 AND created_at > NOW() - make_interval(hours => $2::int)`,
        [userId, windowHours],
      );
      const count = parseInt(countRows[0]?.count ?? '0', 10);
      if (count === 0) {
        return { count: 0, oldestCreatedAt: null };
      }
      const oldestRows = await execRaw<{ created_at: Date }>(
        db,
        `SELECT created_at FROM ${IDENTITY_MFA_SMS_CODES_TABLE} WHERE user_id = $1 AND created_at > NOW() - make_interval(hours => $2::int) ORDER BY created_at ASC LIMIT 1`,
        [userId, windowHours],
      );
      const oldest = oldestRows[0]?.created_at;
      return {
        count,
        oldestCreatedAt: oldest !== undefined ? toDate(oldest) : null,
      };
    },

    async invalidatePendingSmsCodes(userId: string): Promise<void> {
      await execCount(db, {
        text: `UPDATE ${IDENTITY_MFA_SMS_CODES_TABLE} SET verified = true WHERE user_id = $1 AND verified = false AND expires_at > NOW()`,
        values: [userId],
      });
    },

    async insertSmsVerificationCode(data: {
      readonly userId: string;
      readonly phone: string;
      readonly codeHash: string;
      readonly expiresAt: Date;
    }): Promise<void> {
      await execCount(db, {
        text: `INSERT INTO ${IDENTITY_MFA_SMS_CODES_TABLE} (user_id, phone, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        values: [data.userId, data.phone, data.codeHash, data.expiresAt],
      });
    },

    async findPendingSmsCode(userId: string): Promise<{
      readonly id: string;
      readonly codeHash: string;
      readonly attempts: number;
      readonly expiresAt: Date;
    } | null> {
      const rows = await execRaw<{
        id: string;
        code_hash: string;
        attempts: number;
        expires_at: Date;
      }>(
        db,
        `SELECT id, code_hash, attempts, expires_at FROM ${IDENTITY_MFA_SMS_CODES_TABLE} WHERE user_id = $1 AND verified = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        codeHash: row.code_hash,
        attempts: row.attempts,
        expiresAt: toDate(row.expires_at),
      };
    },

    async incrementSmsCodeAttempts(id: string): Promise<void> {
      await execCount(db, {
        text: `UPDATE ${IDENTITY_MFA_SMS_CODES_TABLE} SET attempts = attempts + 1 WHERE id = $1`,
        values: [id],
      });
    },

    async markSmsCodeVerified(id: string): Promise<void> {
      await execCount(db, {
        text: `UPDATE ${IDENTITY_MFA_SMS_CODES_TABLE} SET verified = true WHERE id = $1`,
        values: [id],
      });
    },

    async findLatestVerifiedSmsPhone(userId: string): Promise<string | null> {
      const rows = await execRaw<{ phone: string }>(
        db,
        `SELECT phone FROM ${IDENTITY_MFA_SMS_CODES_TABLE} WHERE user_id = $1 AND verified = true ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      return rows[0]?.phone ?? null;
    },

    async setUserVerifiedPhone(userId: string, phone: string): Promise<void> {
      await execCount(db, {
        text: `UPDATE ${IDENTITY_USERS_TABLE} SET phone = $1, phone_verified = true, updated_at = NOW() WHERE id = $2`,
        values: [phone, userId],
      });
    },

    async clearUserPhone(userId: string): Promise<void> {
      await execCount(db, {
        text: `UPDATE ${IDENTITY_USERS_TABLE} SET phone = NULL, phone_verified = NULL, updated_at = NOW() WHERE id = $1`,
        values: [userId],
      });
    },

    // -------------------------------------------------------------------------
    // WebAuthn Credentials
    // -------------------------------------------------------------------------
    async createWebauthnCredential(data: NewWebauthnCredential): Promise<WebauthnCredential> {
      const snakeData = toSnakeCase(data, IDENTITY_PASSKEYS_COLUMNS);
      const result = await db.queryOne(
        insert(IDENTITY_PASSKEYS_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create WebAuthn credential');
      }
      return transformWebauthnCredential(result);
    },

    async listWebauthnCredentialsByUser(userId: string): Promise<WebauthnCredential[]> {
      const rows = await db.query(
        select(IDENTITY_PASSKEYS_TABLE)
          .where(eq('user_id', userId))
          .orderBy('created_at', 'desc')
          .toSql(),
      );
      return rows.map(transformWebauthnCredential);
    },

    async findWebauthnCredentialByCredentialId(
      credentialId: string,
    ): Promise<WebauthnCredential | null> {
      const result = await db.queryOne(
        select(IDENTITY_PASSKEYS_TABLE).where(eq('credential_id', credentialId)).toSql(),
      );
      return result !== null ? transformWebauthnCredential(result) : null;
    },

    async updateWebauthnCredentialCounter(
      id: string,
      counter: number,
      now: Date = new Date(),
    ): Promise<void> {
      await execCount(
        db,
        update(IDENTITY_PASSKEYS_TABLE)
          .set({ counter, last_used_at: now })
          .where(eq('id', id))
          .toSql(),
      );
    },

    async renameWebauthnCredential(id: string, name: string): Promise<void> {
      await execCount(
        db,
        update(IDENTITY_PASSKEYS_TABLE).set({ name }).where(eq('id', id)).toSql(),
      );
    },

    async deleteWebauthnCredential(id: string): Promise<void> {
      await execCount(db, deleteFrom(IDENTITY_PASSKEYS_TABLE).where(eq('id', id)).toSql());
    },

    // -------------------------------------------------------------------------
    // OAuth Connections
    // -------------------------------------------------------------------------
    async findOAuthByProviderUserId(
      provider: string,
      providerUserId: string,
    ): Promise<OAuthConnection | null> {
      const result = await db.queryOne(
        select(IDENTITY_OAUTH_ACCOUNTS_TABLE)
          .where(and(eq('provider', provider), eq('provider_user_id', providerUserId)))
          .toSql(),
      );
      return result !== null
        ? toCamelCase<OAuthConnection>(result, IDENTITY_OAUTH_ACCOUNTS_COLUMNS)
        : null;
    },

    async findOAuthByUserIdAndProvider(
      userId: string,
      provider: string,
    ): Promise<OAuthConnection | null> {
      const result = await db.queryOne(
        select(IDENTITY_OAUTH_ACCOUNTS_TABLE)
          .where(and(eq('user_id', userId), eq('provider', provider)))
          .toSql(),
      );
      return result !== null
        ? toCamelCase<OAuthConnection>(result, IDENTITY_OAUTH_ACCOUNTS_COLUMNS)
        : null;
    },

    async listOAuthByUserId(userId: string): Promise<OAuthConnection[]> {
      const rows = await db.query(
        select(IDENTITY_OAUTH_ACCOUNTS_TABLE)
          .where(eq('user_id', userId))
          .orderBy('created_at', 'desc')
          .toSql(),
      );
      return rows.map((row) => toCamelCase<OAuthConnection>(row, IDENTITY_OAUTH_ACCOUNTS_COLUMNS));
    },

    async findExpiringOAuthConnections(before: Date): Promise<OAuthConnection[]> {
      const rows = await db.query(
        select(IDENTITY_OAUTH_ACCOUNTS_TABLE)
          .where(and(lt('expires_at', before), isNotNull('refresh_token')))
          .toSql(),
      );
      return rows.map((row) => toCamelCase<OAuthConnection>(row, IDENTITY_OAUTH_ACCOUNTS_COLUMNS));
    },

    async insertOAuthConnection(data: NewOAuthConnection): Promise<OAuthConnection> {
      const snakeData = toSnakeCase(data, IDENTITY_OAUTH_ACCOUNTS_COLUMNS);
      const result = await db.queryOne(
        insert(IDENTITY_OAUTH_ACCOUNTS_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create OAuth connection');
      }
      return toCamelCase<OAuthConnection>(result, IDENTITY_OAUTH_ACCOUNTS_COLUMNS);
    },

    async updateOAuthConnection(
      id: string,
      data: UpdateOAuthConnection,
    ): Promise<OAuthConnection | null> {
      const snakeData = toSnakeCase(data, IDENTITY_OAUTH_ACCOUNTS_COLUMNS);
      const result = await db.queryOne(
        update(IDENTITY_OAUTH_ACCOUNTS_TABLE)
          .set(snakeData)
          .where(eq('id', id))
          .returningAll()
          .toSql(),
      );
      return result !== null
        ? toCamelCase<OAuthConnection>(result, IDENTITY_OAUTH_ACCOUNTS_COLUMNS)
        : null;
    },

    async deleteOAuthByUserIdAndProvider(userId: string, provider: string): Promise<boolean> {
      const count = await execCount(
        db,
        deleteFrom(IDENTITY_OAUTH_ACCOUNTS_TABLE)
          .where(and(eq('user_id', userId), eq('provider', provider)))
          .toSql(),
      );
      return count > 0;
    },
  };
}
