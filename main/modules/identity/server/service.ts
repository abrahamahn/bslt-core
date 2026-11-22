// main/modules/identity/server/service.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { uuidSchema, type UserId } from '@bslt/schema';

import {
  HARD_BAN_GRACE_DAYS,
  PROFILE_COMPLETENESS_FIELDS,
  RESERVED_USERNAMES,
  calculateDeletionGracePeriodEnd,
  canDeactivate,
  canReactivate,
  canRequestDeletion,
  getAccountStatus,
  getNextUsernameChangeDate,
  isUsernameChangeCooldownActive,
  validatePassword,
  type AccountLifecycleFields,
  type AccountLifecycleResponse,
  type AdminCreateUserRequest,
  type AdminForceLogoutResponse,
  type AdminHardBanResponse,
  type AdminUpdateUserRequest,
  type AdminUser,
  type AdminUserListFilters,
  type AdminUserListResponse,
  type AdminUserSearchResponse,
  type ApiKey,
  type CreateApiKeyRequest,
  type CreatedApiKey,
  type DeviceItem,
  type ProfileCompletenessResponse,
  type Session,
  type SudoRequest,
  type SudoResponse,
  type TrustDeviceResponse,
  type UpdateProfileRequest,
  type UpdateUsernameResponse,
  type User,
  type UserRole,
} from '../contract';

import {
  DEFAULT_ARGON2_CONFIG,
  canonicalizeEmail,
  createAccessToken,
  createAuthEmailTemplates,
  createRefreshToken,
  createSudoToken,
  generateSecureToken,
  getRefreshTokenExpiry,
  hashPassword,
  hasPassword,
  invalidateLiveness,
  normalizeEmail,
  parseUserAgentDeviceInfo,
  verifyPassword,
  verifyPasswordSafe,
  type Argon2Config,
  type AuthEmailTemplates,
} from './crypto';
import { verifyTotpCode } from './mfa';
import { anonymizedUserFields, filterSoftDeletedFromResults } from './retention';

import type {
  ApiKeyAuthRecord,
  ApiKeyRecord,
  DbAdminUserListFilters,
  IdentityApiKeyRepository,
  IdentityRepository,
  RefreshTokenFamilyView,
  UpdateUser,
  User as DbUser,
} from './repository';

export const API_KEY_TOKEN_PREFIX = 'bslt_';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const PASSWORD_RESET_EXPIRY_HOURS = 24;
const UUID_EXACT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type ServiceResult<T, E extends string = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: E; readonly message: string };

interface IdentityEmailSender {
  (options: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string | undefined;
  }): Promise<{ readonly success: boolean; readonly error?: string | undefined }>;
}

// ============================================================================
// 1. API Keys
// ============================================================================

export interface ApiKeyIdentity {
  readonly userId: string;
  readonly email: string;
  readonly role: 'user' | 'moderator' | 'admin';
  readonly tokenVersion: number;
  readonly lockedUntil: Date | null;
  readonly lockReason: string | null;
  readonly emailVerified?: boolean | undefined;
}

export interface AuthenticateApiKeyDeps {
  readonly findAuthRecordByTokenHash: (tokenHash: string) => Promise<ApiKeyAuthRecord | null>;
  readonly touchLastUsed: (id: string) => Promise<void>;
  readonly findUserById: (id: string) => Promise<{
    readonly id: string;
    readonly email: string;
    readonly role: 'user' | 'moderator' | 'admin';
    readonly tokenVersion: number;
    readonly lockedUntil: Date | null;
    readonly lockReason: string | null;
    readonly emailVerified?: boolean | undefined;
  } | null>;
  readonly now?: (() => Date) | undefined;
  readonly onTouchError?: ((error: unknown) => void) | undefined;
}

interface GeneratedApiKey {
  readonly token: string;
  readonly tokenHash: string;
  readonly keyPrefix: string;
  readonly last4: string;
}

export function hashApiKeyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const token = `${API_KEY_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  return {
    token,
    tokenHash: hashApiKeyToken(token),
    keyPrefix: token.slice(0, API_KEY_TOKEN_PREFIX.length + 6),
    last4: token.slice(-4),
  };
}

function toApiKeyDto(record: ApiKeyRecord): ApiKey {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    last4: record.last4,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listApiKeysForOwner(
  ownerId: string,
  repo: IdentityApiKeyRepository,
): Promise<ApiKey[]> {
  const records = await repo.listApiKeysByOwner(ownerId);
  return records.map(toApiKeyDto);
}

export async function createApiKeyForOwner(
  ownerId: string,
  input: CreateApiKeyRequest,
  repo: IdentityApiKeyRepository,
  now: Date = new Date(),
): Promise<CreatedApiKey> {
  const generated = generateApiKey();
  const expiresAt =
    input.expiresInDays === undefined || input.expiresInDays === null
      ? null
      : new Date(now.getTime() + input.expiresInDays * MS_PER_DAY);

  const record = await repo.insertApiKey({
    userId: ownerId,
    name: input.name,
    tokenHash: generated.tokenHash,
    keyPrefix: generated.keyPrefix,
    last4: generated.last4,
    expiresAt,
  });

  return { ...toApiKeyDto(record), token: generated.token };
}

export async function deleteApiKeyForOwner(
  ownerId: string,
  id: string,
  repo: IdentityApiKeyRepository,
): Promise<ApiKey | null> {
  if (!uuidSchema.safeParse(id).success) {
    return null;
  }
  const record = await repo.deleteApiKeyForOwner(ownerId, id);
  return record !== null ? toApiKeyDto(record) : null;
}

export async function authenticateApiKey(
  token: string,
  deps: AuthenticateApiKeyDeps,
): Promise<ApiKeyIdentity | null> {
  if (!token.startsWith(API_KEY_TOKEN_PREFIX)) return null;

  const record = await deps.findAuthRecordByTokenHash(hashApiKeyToken(token));
  if (record === null) return null;

  const nowMs = deps.now !== undefined ? deps.now().getTime() : Date.now();
  if (record.expiresAt !== null && record.expiresAt.getTime() <= nowMs) {
    return null;
  }

  const user = await deps.findUserById(record.userId);
  if (user === null) return null;

  void deps.touchLastUsed(record.id).catch((err: unknown) => {
    deps.onTouchError?.(err);
  });

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
    lockedUntil: user.lockedUntil,
    lockReason: user.lockReason,
    ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified } : {}),
  };
}

// ============================================================================
// 2. Canonical User & AdminUser DTO Mappers
// ============================================================================

function formatIsoDateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return value.length >= 10 ? value.slice(0, 10) : value;
}

export function toUserDto(user: DbUser): User {
  return {
    id: user.id as UserId,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    emailVerified: user.emailVerified,
    phone: user.phone ?? null,
    phoneVerified: user.phoneVerified ?? null,
    dateOfBirth: formatIsoDateOnly(user.dateOfBirth),
    gender: user.gender ?? null,
    bio: user.bio ?? null,
    city: user.city ?? null,
    state: user.state ?? null,
    country: user.country ?? null,
    language: user.language ?? null,
    website: user.website ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    deactivatedAt: user.deactivatedAt != null ? user.deactivatedAt.toISOString() : null,
    deletedAt: user.deletedAt != null ? user.deletedAt.toISOString() : null,
    deletionGracePeriodEnds:
      user.deletionGracePeriodEnds != null ? user.deletionGracePeriodEnds.toISOString() : null,
  };
}

export function toAdminUserDto(user: DbUser): AdminUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    emailVerified: user.emailVerified,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    lockReason: user.lockReason ?? null,
    failedLoginAttempts: user.failedLoginAttempts,
    phone: user.phone ?? null,
    phoneVerified: user.phoneVerified ?? false,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function computeProfileCompleteness(user: object): ProfileCompletenessResponse {
  const missingFields: string[] = [];
  const record = user as Record<string, unknown>;
  for (const field of PROFILE_COMPLETENESS_FIELDS) {
    const value = record[field];
    if (value === null || value === undefined || value === '') {
      missingFields.push(field);
    }
  }
  const totalFields = PROFILE_COMPLETENESS_FIELDS.length;
  const filledFields = totalFields - missingFields.length;
  const percentage = Math.round((filledFields / totalFields) * 100);
  return { percentage, missingFields };
}

async function findValidUuidUser(
  repo: Pick<IdentityRepository, 'findUserById'>,
  userId: string,
): Promise<DbUser | null> {
  if (!uuidSchema.safeParse(userId).success) {
    return null;
  }
  return repo.findUserById(userId);
}

// ============================================================================
// 3. Refresh Token Families & Session Operations
// ============================================================================

export async function revokeTokenFamilyInRepo(
  repo: Pick<
    IdentityRepository,
    'stampRefreshFamilyRevoked' | 'deleteRefreshTokensByFamily' | 'revokeUserSessionById'
  >,
  familyId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  await repo.stampRefreshFamilyRevoked(familyId, reason, now);
  await repo.deleteRefreshTokensByFamily(familyId);
  await repo.revokeUserSessionById(familyId, now);
}

export async function revokeAllUserTokensInRepo(
  repo: Pick<
    IdentityRepository,
    'stampAllUserRefreshFamiliesRevoked' | 'deleteRefreshTokensByUserId' | 'revokeAllUserSessions'
  >,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await repo.stampAllUserRefreshFamiliesRevoked(userId, 'User logged out from all devices', now);
  await repo.deleteRefreshTokensByUserId(userId);
  await repo.revokeAllUserSessions(userId, now);
}

export async function createRefreshTokenFamilyInRepo(
  repo: Pick<IdentityRepository, 'insertRefreshToken' | 'insertUserSession'>,
  userId: string,
  expiryDays: number = 7,
  sessionMeta?: { ipAddress?: string; userAgent?: string; deviceId?: string },
  now: Date = new Date(),
): Promise<{ familyId: string; token: string }> {
  const familyId = randomUUID();
  const token = createRefreshToken();
  await repo.insertRefreshToken({
    userId,
    familyId,
    token,
    expiresAt: getRefreshTokenExpiry(expiryDays, now),
    familyIpAddress: sessionMeta?.ipAddress ?? null,
    familyUserAgent: sessionMeta?.userAgent ?? null,
    familyCreatedAt: now,
  });

  const deviceInfo = parseUserAgentDeviceInfo(sessionMeta?.userAgent);
  await repo.insertUserSession({
    id: familyId,
    userId,
    ipAddress: sessionMeta?.ipAddress ?? null,
    userAgent: sessionMeta?.userAgent ?? null,
    deviceName: deviceInfo.deviceName,
    deviceType: deviceInfo.deviceType,
    deviceId: sessionMeta?.deviceId ?? null,
    lastActiveAt: now,
    createdAt: now,
  });

  return { familyId, token };
}

function normalizeDeviceValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function getSessionDeviceKey(family: RefreshTokenFamilyView): string {
  const deviceId = normalizeDeviceValue(family.deviceId);
  if (deviceId !== null) return `device:${deviceId}`;

  const ipAddress = normalizeDeviceValue(family.ipAddress) ?? 'unknown-ip';
  const userAgent = normalizeDeviceValue(family.userAgent)?.toLowerCase() ?? 'unknown-agent';
  if (ipAddress === 'unknown-ip' && userAgent === 'unknown-agent') {
    return `family:${family.familyId}`;
  }
  return `legacy:${ipAddress}:${userAgent}`;
}

function getDateTime(value: Date): number {
  const time = value.getTime();
  return Number.isFinite(time) ? time : 0;
}

function chooseDeviceSession(
  current: RefreshTokenFamilyView,
  next: RefreshTokenFamilyView,
  currentFamilyId?: string,
): RefreshTokenFamilyView {
  if (next.familyId === currentFamilyId) return next;
  if (current.familyId === currentFamilyId) return current;
  return getDateTime(next.familyCreatedAt) > getDateTime(current.familyCreatedAt) ? next : current;
}

function groupFamiliesByDevice(
  families: readonly RefreshTokenFamilyView[],
  currentFamilyId?: string,
): RefreshTokenFamilyView[] {
  const familiesByDevice = new Map<string, RefreshTokenFamilyView>();
  for (const family of families) {
    const key = getSessionDeviceKey(family);
    const existing = familiesByDevice.get(key);
    familiesByDevice.set(
      key,
      existing === undefined ? family : chooseDeviceSession(existing, family, currentFamilyId),
    );
  }

  return Array.from(familiesByDevice.values()).sort((a, b) => {
    if (a.familyId === currentFamilyId) return -1;
    if (b.familyId === currentFamilyId) return 1;
    return getDateTime(b.familyCreatedAt) - getDateTime(a.familyCreatedAt);
  });
}

export async function listSessionsForUser(
  repo: Pick<IdentityRepository, 'findActiveTokenFamilies'>,
  userId: string,
  currentFamilyId?: string,
): Promise<Session[]> {
  const families = await repo.findActiveTokenFamilies(userId);
  const visible = groupFamiliesByDevice(families, currentFamilyId);
  return visible.map((family) => ({
    id: family.familyId,
    createdAt: family.familyCreatedAt.toISOString(),
    expiresAt: family.latestExpiresAt.toISOString(),
    lastUsedAt: family.familyCreatedAt.toISOString(),
    device: family.userAgent,
    ipAddress: family.ipAddress,
    userAgent: family.userAgent,
    isCurrent: family.familyId === currentFamilyId,
  }));
}

export async function revokeSessionForUser(
  repo: Pick<
    IdentityRepository,
    | 'findTokenFamilyById'
    | 'stampRefreshFamilyRevoked'
    | 'deleteRefreshTokensByFamily'
    | 'revokeUserSessionById'
  >,
  userId: string,
  sessionId: string,
  currentFamilyId?: string,
  now: Date = new Date(),
): Promise<ServiceResult<{ success: true }, 'SESSION_NOT_FOUND'>> {
  if (sessionId === currentFamilyId) {
    return {
      ok: false,
      code: 'SESSION_NOT_FOUND',
      message: 'Cannot revoke current session. Use logout instead.',
    };
  }
  if (!uuidSchema.safeParse(sessionId).success) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' };
  }
  const family = await repo.findTokenFamilyById(sessionId);
  if (family?.userId !== userId) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' };
  }
  if (family.familyRevokedAt === null) {
    await revokeTokenFamilyInRepo(repo, sessionId, 'User revoked session', now);
  }
  return { ok: true, value: { success: true } };
}

export async function revokeAllSessionsForUser(
  repo: Pick<
    IdentityRepository,
    | 'incrementUserTokenVersion'
    | 'findActiveTokenFamilies'
    | 'stampRefreshFamilyRevoked'
    | 'deleteRefreshTokensByFamily'
    | 'revokeUserSessionById'
  >,
  userId: string,
  currentFamilyId?: string,
  now: Date = new Date(),
): Promise<number> {
  await repo.incrementUserTokenVersion(userId);
  invalidateLiveness(userId);

  const families = await repo.findActiveTokenFamilies(userId);
  const toRevoke = families.filter((f) => f.familyId !== currentFamilyId);
  for (const family of toRevoke) {
    await revokeTokenFamilyInRepo(repo, family.familyId, 'User logged out from all devices', now);
  }
  return toRevoke.length;
}

// ============================================================================
// 4. Self-Service Profile, Username, Password & Lifecycle
// ============================================================================

export async function getMeProfile(
  repo: Pick<IdentityRepository, 'findUserById'>,
  userId: string,
): Promise<ServiceResult<User, 'USER_NOT_FOUND'>> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return { ok: true, value: toUserDto(user) };
}

export async function getUserProfileCompleteness(
  repo: Pick<IdentityRepository, 'findUserById'>,
  userId: string,
): Promise<ServiceResult<ProfileCompletenessResponse, 'USER_NOT_FOUND'>> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return { ok: true, value: computeProfileCompleteness(user) };
}

export async function updateUserProfile(
  repo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  userId: string,
  data: UpdateProfileRequest,
  systemRepo: Pick<IdentityRepository, 'findUserByUsername'>,
): Promise<ServiceResult<User, 'USER_NOT_FOUND' | 'PROFILE_USERNAME_TAKEN'>> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  const updatePayload: UpdateUser = {};
  if ('username' in data && data.username !== undefined) {
    if (data.username !== null && data.username !== user.username) {
      const existing = await systemRepo.findUserByUsername(data.username);
      if (existing !== null && existing.id !== userId) {
        return {
          ok: false,
          code: 'PROFILE_USERNAME_TAKEN',
          message: 'Username is already taken',
        };
      }
    }
    updatePayload.username = data.username;
  }
  if (data.firstName !== undefined) updatePayload.firstName = data.firstName;
  if (data.lastName !== undefined) updatePayload.lastName = data.lastName;
  if ('phone' in data && data.phone !== undefined) {
    updatePayload.phone = data.phone;
    if (data.phone !== user.phone) {
      updatePayload.phoneVerified = false;
    }
  }
  if ('dateOfBirth' in data && data.dateOfBirth !== undefined) {
    updatePayload.dateOfBirth = data.dateOfBirth !== null ? new Date(data.dateOfBirth) : null;
  }
  if ('gender' in data && data.gender !== undefined) updatePayload.gender = data.gender;
  if ('bio' in data && data.bio !== undefined) updatePayload.bio = data.bio;
  if ('city' in data && data.city !== undefined) updatePayload.city = data.city;
  if ('state' in data && data.state !== undefined) updatePayload.state = data.state;
  if ('country' in data && data.country !== undefined) updatePayload.country = data.country;
  if ('language' in data && data.language !== undefined) updatePayload.language = data.language;
  if ('website' in data && data.website !== undefined) updatePayload.website = data.website;

  if (Object.keys(updatePayload).length > 0) {
    const updated = await repo.updateUser(userId, updatePayload);
    if (updated === null) {
      return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
    }
    return { ok: true, value: toUserDto(updated) };
  }

  return { ok: true, value: toUserDto(user) };
}

export async function updateUsernameForUser(
  repo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  userId: string,
  newUsername: string,
  systemRepo: Pick<IdentityRepository, 'findUserByUsername'>,
  now: Date = new Date(),
): Promise<
  ServiceResult<
    UpdateUsernameResponse,
    | 'USER_NOT_FOUND'
    | 'USERNAME_COOLDOWN_ACTIVE'
    | 'USERNAME_RESERVED'
    | 'USERNAME_UNCHANGED'
    | 'USERNAME_TAKEN'
  >
> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  const lastChange = user.lastUsernameChange ?? null;
  if (isUsernameChangeCooldownActive(lastChange, now)) {
    const nextAllowed = getNextUsernameChangeDate(lastChange, now);
    return {
      ok: false,
      code: 'USERNAME_COOLDOWN_ACTIVE',
      message: `Username can only be changed once every 30 days. Next change allowed at ${nextAllowed.toISOString()}`,
    };
  }

  if ((RESERVED_USERNAMES as readonly string[]).includes(newUsername)) {
    return { ok: false, code: 'USERNAME_RESERVED', message: 'This username is reserved' };
  }

  if (newUsername === user.username) {
    return {
      ok: false,
      code: 'USERNAME_UNCHANGED',
      message: 'New username is the same as current username',
    };
  }

  const existing = await systemRepo.findUserByUsername(newUsername);
  if (existing !== null && existing.id !== userId) {
    return { ok: false, code: 'USERNAME_TAKEN', message: 'Username is already taken' };
  }

  const updated = await repo.updateUser(userId, {
    username: newUsername,
    lastUsernameChange: now,
  });
  if (updated === null || updated.username === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  return {
    ok: true,
    value: {
      username: updated.username,
      nextChangeAllowedAt: getNextUsernameChangeDate(now, now).toISOString(),
    },
  };
}

export async function changeUserPassword(
  repo: Pick<
    IdentityRepository,
    | 'findUserById'
    | 'updateUser'
    | 'stampAllUserRefreshFamiliesRevoked'
    | 'deleteRefreshTokensByUserId'
    | 'revokeAllUserSessions'
  >,
  userId: string,
  currentPassword: string,
  newPassword: string,
  argon2Config: Argon2Config = DEFAULT_ARGON2_CONFIG,
  now: Date = new Date(),
): Promise<
  ServiceResult<
    { readonly email: string; readonly username: string | null },
    'USER_NOT_FOUND' | 'PASSWORD_NOT_SET' | 'INVALID_PASSWORD' | 'WEAK_PASSWORD'
  >
> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  if (!hasPassword(user.passwordHash)) {
    return {
      ok: false,
      code: 'PASSWORD_NOT_SET',
      message:
        'Cannot change password for accounts without a password. Please use "Set Password" instead.',
    };
  }

  const isValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isValid) {
    return { ok: false, code: 'INVALID_PASSWORD', message: 'Current password is incorrect' };
  }

  const validation = validatePassword(
    newPassword,
    [user.email, user.username, user.firstName, user.lastName].filter(
      (s): s is string => s !== null && s !== '',
    ),
  );
  if (!validation.isValid) {
    return {
      ok: false,
      code: 'WEAK_PASSWORD',
      message: validation.errors.join('; ') || 'Password does not meet strength requirements',
    };
  }

  const newHash = await hashPassword(newPassword, argon2Config);
  await repo.updateUser(userId, { passwordHash: newHash });
  await revokeAllUserTokensInRepo(repo, userId, now);

  return { ok: true, value: { email: user.email, username: user.username } };
}

function toLifecycleFields(user: {
  deactivatedAt: Date | null;
  deletedAt: Date | null;
  deletionGracePeriodEnds: Date | null;
}): AccountLifecycleFields {
  return {
    deactivatedAt: user.deactivatedAt,
    deletedAt: user.deletedAt,
    deletionGracePeriodEnds: user.deletionGracePeriodEnds,
  };
}

export async function deactivateUserAccount(
  repo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  userId: string,
  now: Date = new Date(),
): Promise<
  ServiceResult<
    AccountLifecycleResponse & { readonly email: string; readonly username: string | null },
    'USER_NOT_FOUND' | 'LIFECYCLE_TRANSITION_INVALID'
  >
> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  const fields = toLifecycleFields(user);
  if (!canDeactivate(fields)) {
    const currentStatus = getAccountStatus(fields);
    return {
      ok: false,
      code: 'LIFECYCLE_TRANSITION_INVALID',
      message: `Account cannot be deactivated (current status: ${currentStatus})`,
    };
  }

  const updated = await repo.updateUser(userId, { deactivatedAt: now });
  if (updated === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return {
    ok: true,
    value: {
      message: 'Account has been deactivated',
      status: 'deactivated',
      email: user.email,
      username: user.username,
    },
  };
}

export async function requestUserDeletion(
  repo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  userId: string,
  now: Date = new Date(),
): Promise<
  ServiceResult<
    AccountLifecycleResponse & { readonly email: string; readonly username: string | null },
    'USER_NOT_FOUND' | 'LIFECYCLE_TRANSITION_INVALID'
  >
> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  const fields = toLifecycleFields(user);
  if (!canRequestDeletion(fields)) {
    return {
      ok: false,
      code: 'LIFECYCLE_TRANSITION_INVALID',
      message: 'Account deletion has already been requested',
    };
  }

  const gracePeriodEnds = calculateDeletionGracePeriodEnd(now);
  const updated = await repo.updateUser(userId, {
    deletedAt: now,
    deletionGracePeriodEnds: gracePeriodEnds,
  });
  if (updated === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return {
    ok: true,
    value: {
      message: 'Account deletion requested. You have 30 days to reactivate.',
      status: 'pending_deletion',
      deletionGracePeriodEnds: gracePeriodEnds.toISOString(),
      email: user.email,
      username: user.username,
    },
  };
}

export async function reactivateUserAccount(
  repo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  userId: string,
  now: Date = new Date(),
): Promise<
  ServiceResult<
    AccountLifecycleResponse & { readonly email: string; readonly username: string | null },
    'USER_NOT_FOUND' | 'LIFECYCLE_TRANSITION_INVALID'
  >
> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  const fields = toLifecycleFields(user);
  if (!canReactivate(fields, now)) {
    const currentStatus = getAccountStatus(fields);
    return {
      ok: false,
      code: 'LIFECYCLE_TRANSITION_INVALID',
      message:
        currentStatus === 'active'
          ? 'Account is already active'
          : 'Account cannot be reactivated (grace period has expired)',
    };
  }

  const updated = await repo.updateUser(userId, {
    deactivatedAt: null,
    deletedAt: null,
    deletionGracePeriodEnds: null,
  });
  if (updated === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return {
    ok: true,
    value: {
      message: 'Account has been reactivated',
      status: 'active',
      email: user.email,
      username: user.username,
    },
  };
}

// ============================================================================
// 5. Administrative User Operations & Transactional Emails
// ============================================================================

function mapSortByToColumn(
  sortBy?: string,
): 'email' | 'username' | 'first_name' | 'last_name' | 'created_at' | 'updated_at' {
  switch (sortBy) {
    case 'email':
      return 'email';
    case 'username':
      return 'username';
    case 'firstName':
      return 'first_name';
    case 'lastName':
      return 'last_name';
    case 'createdAt':
      return 'created_at';
    case 'updatedAt':
      return 'updated_at';
    case undefined:
    default:
      return 'created_at';
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function formatLockDuration(lockedUntil: Date): string {
  const permanentThreshold = new Date('2090-01-01T00:00:00.000Z');
  return lockedUntil > permanentThreshold ? 'permanently' : `until ${lockedUntil.toISOString()}`;
}

async function sendAccountLockedEmail(
  sendEmail: IdentityEmailSender,
  email: string,
  reason: string,
  lockedUntil: Date,
): Promise<void> {
  const duration = formatLockDuration(lockedUntil);
  await sendEmail({
    to: email,
    subject: 'Your account has been locked',
    html: [
      '<h2>Account Locked</h2>',
      `<p>Your account has been locked ${duration}.</p>`,
      `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>`,
      '<p>If you believe this is a mistake, please contact support.</p>',
    ].join('\n'),
    text: [
      'Account Locked',
      '',
      `Your account has been locked ${duration}.`,
      `Reason: ${reason}`,
      '',
      'If you believe this is a mistake, please contact support.',
    ].join('\n'),
  });
}

async function sendAccountUnlockedEmail(
  sendEmail: IdentityEmailSender,
  email: string,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Your account has been unlocked',
    html: [
      '<h2>Account Unlocked</h2>',
      '<p>Your account has been unlocked. You can now log in normally.</p>',
    ].join('\n'),
    text: [
      'Account Unlocked',
      '',
      'Your account has been unlocked. You can now log in normally.',
    ].join('\n'),
  });
}

async function sendHardBanEmail(
  sendEmail: IdentityEmailSender,
  email: string,
  reason: string,
  gracePeriodEnds: Date,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Your account has been permanently suspended',
    html: [
      '<h2>Account Permanently Suspended</h2>',
      '<p>Your account has been permanently suspended and is scheduled for deletion.</p>',
      `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>`,
      `<p>Your data will be permanently deleted after ${gracePeriodEnds.toISOString()}.</p>`,
      '<p>If you believe this is a mistake, please contact support immediately.</p>',
    ].join('\n'),
    text: [
      'Account Permanently Suspended',
      '',
      'Your account has been permanently suspended and is scheduled for deletion.',
      `Reason: ${reason}`,
      `Your data will be permanently deleted after ${gracePeriodEnds.toISOString()}.`,
      '',
      'If you believe this is a mistake, please contact support immediately.',
    ].join('\n'),
  });
}

export async function sendUserInviteEmail(
  sendEmail: IdentityEmailSender,
  email: string,
  appBaseUrl: string,
): Promise<void> {
  const signInUrl = `${appBaseUrl}/auth/login`;
  await sendEmail({
    to: email,
    subject: 'You have been invited to create an account',
    html: [
      '<h2>Welcome</h2>',
      '<p>An administrator has created an account for you.</p>',
      `<p>To get started, go to the <a href="${escapeHtml(signInUrl)}">sign-in page</a> and choose`,
      ' <strong>Forgot password</strong> to set your password.</p>',
    ].join('\n'),
    text: [
      'Welcome',
      '',
      'An administrator has created an account for you.',
      `To get started, visit ${signInUrl} and choose "Forgot password" to set your password.`,
    ].join('\n'),
  });
}

export async function adminListUsers(
  repo: Pick<IdentityRepository, 'listUsersWithFilters'>,
  filters: AdminUserListFilters,
): Promise<AdminUserListResponse> {
  const dbFilters: DbAdminUserListFilters = {
    sortBy: mapSortByToColumn(filters.sortBy),
    sortOrder: filters.sortOrder ?? 'desc',
    page: filters.page ?? 1,
    limit: filters.limit ?? 20,
  };
  if (filters.search !== undefined) dbFilters.search = filters.search;
  if (filters.role !== undefined) dbFilters.role = filters.role;
  if (filters.status !== undefined) dbFilters.status = filters.status;
  if (filters.plan !== undefined) dbFilters.plan = filters.plan;

  const result = await repo.listUsersWithFilters(dbFilters);
  const activeOnly = filterSoftDeletedFromResults(result);
  const limit = activeOnly.limit ?? filters.limit ?? 20;

  return {
    data: activeOnly.data.map(toAdminUserDto),
    total: activeOnly.total,
    page: activeOnly.page ?? filters.page ?? 1,
    limit,
    totalPages: activeOnly.totalPages ?? Math.max(1, Math.ceil(activeOnly.total / limit)),
    hasNext: activeOnly.hasNext ?? false,
    hasPrev: activeOnly.hasPrev ?? false,
  };
}

export async function adminSearchUsers(
  repo: Pick<IdentityRepository, 'findUserById' | 'listUsersWithFilters'>,
  query: string,
  options: { readonly limit?: number; readonly offset?: number } = {},
): Promise<AdminUserSearchResponse> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;

  if (UUID_EXACT_REGEX.test(query)) {
    const user = await repo.findUserById(query);
    if (user !== null && user.deletedAt == null) {
      return { users: [toAdminUserDto(user)], total: 1, limit, offset };
    }
    return { users: [], total: 0, limit, offset };
  }

  const result = await repo.listUsersWithFilters({ search: query, page, limit });
  return {
    users: result.data.map(toAdminUserDto),
    total: result.total,
    limit,
    offset,
  };
}

export async function adminGetUser(
  repo: Pick<IdentityRepository, 'findUserById'>,
  userId: string,
): Promise<ServiceResult<AdminUser, 'USER_NOT_FOUND'>> {
  const user = await findValidUuidUser(repo, userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return { ok: true, value: toAdminUserDto(user) };
}

export async function adminUpdateUser(
  repo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  userId: string,
  data: AdminUpdateUserRequest,
): Promise<ServiceResult<AdminUser, 'USER_NOT_FOUND'>> {
  const existing = await findValidUuidUser(repo, userId);
  if (existing === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  const updateData: { firstName?: string; lastName?: string; role?: UserRole } = {};
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.role !== undefined) updateData.role = data.role;

  const updated = await repo.updateUser(userId, updateData);
  if (updated === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  if (updateData.role !== undefined) {
    invalidateLiveness(userId);
  }

  return { ok: true, value: toAdminUserDto(updated) };
}

export async function adminLockUser(
  repo: Pick<IdentityRepository, 'findUserById' | 'lockUserAccount'>,
  userId: string,
  reason: string,
  durationMinutes?: number,
  options?: {
    readonly sendEmail?: IdentityEmailSender | undefined;
    readonly onEmailError?: ((error: unknown) => void) | undefined;
    readonly now?: Date | undefined;
  },
): Promise<ServiceResult<AdminUser, 'USER_NOT_FOUND'>> {
  const existing = await findValidUuidUser(repo, userId);
  if (existing === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  const baseNow = options?.now ?? new Date();
  const lockedUntil =
    durationMinutes !== undefined
      ? new Date(baseNow.getTime() + durationMinutes * 60 * 1000)
      : new Date('2099-12-31T23:59:59.999Z');

  await repo.lockUserAccount(userId, lockedUntil, reason);
  invalidateLiveness(userId);

  if (options?.sendEmail !== undefined) {
    sendAccountLockedEmail(options.sendEmail, existing.email, reason, lockedUntil).catch(
      (err: unknown) => {
        options.onEmailError?.(err);
      },
    );
  }

  const updated = await repo.findUserById(userId);
  if (updated === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return { ok: true, value: toAdminUserDto(updated) };
}

export async function adminUnlockUser(
  repo: Pick<IdentityRepository, 'findUserById' | 'unlockUserAccount'>,
  userId: string,
  options?: {
    readonly sendEmail?: IdentityEmailSender | undefined;
    readonly onEmailError?: ((error: unknown) => void) | undefined;
  },
): Promise<ServiceResult<AdminUser, 'USER_NOT_FOUND'>> {
  const existing = await findValidUuidUser(repo, userId);
  if (existing === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  await repo.unlockUserAccount(userId);
  invalidateLiveness(userId);

  if (options?.sendEmail !== undefined) {
    sendAccountUnlockedEmail(options.sendEmail, existing.email).catch((err: unknown) => {
      options.onEmailError?.(err);
    });
  }

  const updated = await repo.findUserById(userId);
  if (updated === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  return { ok: true, value: toAdminUserDto(updated) };
}

export async function adminForceLogoutUser(
  repo: Pick<
    IdentityRepository,
    | 'findUserById'
    | 'findActiveTokenFamilies'
    | 'stampAllUserRefreshFamiliesRevoked'
    | 'deleteRefreshTokensByUserId'
    | 'revokeAllUserSessions'
  >,
  userId: string,
  now: Date = new Date(),
): Promise<ServiceResult<AdminForceLogoutResponse & { readonly email: string }, 'USER_NOT_FOUND'>> {
  const existing = await findValidUuidUser(repo, userId);
  if (existing === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  const activeFamilies = await repo.findActiveTokenFamilies(userId);
  const revokedSessions = activeFamilies.length;
  await revokeAllUserTokensInRepo(repo, userId, now);
  invalidateLiveness(userId);

  return {
    ok: true,
    value: {
      message: 'All active sessions for the user have been revoked',
      revokedSessions,
      email: existing.email,
    },
  };
}

export async function adminHardBanUser(
  repo: Pick<
    IdentityRepository,
    | 'findUserById'
    | 'lockUserAccount'
    | 'updateUser'
    | 'stampAllUserRefreshFamiliesRevoked'
    | 'deleteRefreshTokensByUserId'
    | 'revokeAllUserSessions'
  >,
  userId: string,
  reason: string,
  options?: {
    readonly cancelSubscriptions?: ((bannedUserId: string) => Promise<boolean>) | undefined;
    readonly onCancelError?: ((error: unknown) => void) | undefined;
    readonly sendEmail?: IdentityEmailSender | undefined;
    readonly onEmailError?: ((error: unknown) => void) | undefined;
    readonly now?: Date | undefined;
  },
): Promise<ServiceResult<AdminHardBanResponse & { readonly email: string }, 'USER_NOT_FOUND'>> {
  const existing = await findValidUuidUser(repo, userId);
  if (existing === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  const now = options?.now ?? new Date();
  await revokeAllUserTokensInRepo(repo, userId, now);

  let subscriptionsCancelled = false;
  if (options?.cancelSubscriptions !== undefined) {
    try {
      subscriptionsCancelled = await options.cancelSubscriptions(userId);
    } catch (err: unknown) {
      subscriptionsCancelled = false;
      options.onCancelError?.(err);
    }
  }

  const deletedAt = new Date(now.getTime() + HARD_BAN_GRACE_DAYS * MS_PER_DAY);
  const permanentLockDate = new Date('2099-12-31T23:59:59.999Z');
  await repo.lockUserAccount(userId, permanentLockDate, reason);
  await repo.updateUser(userId, {
    deletedAt,
    deletionGracePeriodEnds: deletedAt,
  });
  invalidateLiveness(userId);

  if (options?.sendEmail !== undefined) {
    sendHardBanEmail(options.sendEmail, existing.email, reason, deletedAt).catch((err: unknown) => {
      options.onEmailError?.(err);
    });
  }

  return {
    ok: true,
    value: {
      message: 'User has been permanently banned',
      gracePeriodEnds: deletedAt.toISOString(),
      subscriptionsCancelled,
      email: existing.email,
    },
  };
}

export async function adminSoftDeleteUser(
  repo: Pick<
    IdentityRepository,
    | 'findUserById'
    | 'updateUser'
    | 'stampAllUserRefreshFamiliesRevoked'
    | 'deleteRefreshTokensByUserId'
    | 'revokeAllUserSessions'
  >,
  userId: string,
  now: Date = new Date(),
): Promise<
  ServiceResult<
    { readonly message: string; readonly email: string; readonly alreadyDeleted: boolean },
    'USER_NOT_FOUND'
  >
> {
  const existing = await findValidUuidUser(repo, userId);
  if (existing === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }
  if (existing.deletedAt != null) {
    return {
      ok: true,
      value: {
        message: 'User is already deleted',
        email: existing.email,
        alreadyDeleted: true,
      },
    };
  }

  await revokeAllUserTokensInRepo(repo, userId, now);
  await repo.updateUser(userId, {
    deletedAt: now,
    deletionGracePeriodEnds: now,
    ...anonymizedUserFields(userId),
  });
  invalidateLiveness(userId);

  return {
    ok: true,
    value: {
      message: 'User has been deleted and anonymized',
      email: existing.email,
      alreadyDeleted: false,
    },
  };
}

export async function adminCreateInvitedUser(
  repo: Pick<IdentityRepository, 'findUserByEmail' | 'createUser'>,
  input: AdminCreateUserRequest,
  argon2Config: Argon2Config = DEFAULT_ARGON2_CONFIG,
  now: Date = new Date(),
): Promise<ServiceResult<AdminUser, 'USER_ALREADY_EXISTS'>> {
  const canonical = canonicalizeEmail(input.email);
  const existing = await repo.findUserByEmail(canonical);
  if (existing !== null) {
    return {
      ok: false,
      code: 'USER_ALREADY_EXISTS',
      message: 'A user with this email already exists',
    };
  }

  const { plain } = generateSecureToken();
  const passwordHash = await hashPassword(plain, argon2Config);

  const created = await repo.createUser({
    email: normalizeEmail(input.email),
    canonicalEmail: canonical,
    username: input.username ?? null,
    firstName: input.firstName,
    lastName: input.lastName,
    passwordHash,
    role: input.role ?? 'user',
    emailVerified: true,
    emailVerifiedAt: now,
  });

  return { ok: true, value: toAdminUserDto(created) };
}

export async function requestPasswordResetInRepo(
  repo: Pick<
    IdentityRepository,
    'findUserByEmail' | 'invalidateUnusedAuthTokens' | 'insertPasswordResetToken'
  >,
  sendEmail: IdentityEmailSender,
  email: string,
  appBaseUrl: string,
  emailTemplates: AuthEmailTemplates = createAuthEmailTemplates(),
  now: Date = new Date(),
): Promise<void> {
  const canonical = canonicalizeEmail(email);
  const user = await repo.findUserByEmail(canonical);
  if (user === null) {
    return;
  }

  const { plain, hash } = generateSecureToken();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRY_HOURS * MS_PER_HOUR);

  await repo.invalidateUnusedAuthTokens('password_reset', user.id, now);
  await repo.insertPasswordResetToken(user.id, hash, expiresAt);

  const resetUrl = `${appBaseUrl}/auth/reset-password?token=${plain}`;
  const template = emailTemplates.passwordReset(resetUrl);
  const sent = await sendEmail({
    to: user.email,
    subject: template.subject,
    text: template.text ?? '',
    html: template.html ?? '',
  });
  if (!sent.success) {
    throw new Error(sent.error ?? 'Failed to send password reset email');
  }
}

// ============================================================================
// 7. Canonical Session Issuance, Sudo Elevation & Trusted Devices
// ============================================================================

const SECONDS_PER_DAY = 86_400;

export interface RefreshCookieConfig {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: 'strict' | 'lax' | 'none';
  readonly path: string;
}

export interface IssueSessionOptions {
  readonly jwtSecret: string;
  readonly accessTokenExpiry: string;
  readonly refreshExpiryDays: number;
  readonly cookie: RefreshCookieConfig;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly deviceId?: string | null | undefined;
  readonly isNewDevice?: boolean | undefined;
  readonly now?: Date | undefined;
}

export interface IssuedSession {
  readonly token: string;
  readonly refreshToken: string;
  readonly familyId: string;
  readonly cookieOptions: {
    readonly httpOnly: boolean;
    readonly secure: boolean;
    readonly sameSite: 'strict' | 'lax' | 'none';
    readonly path: string;
    readonly maxAge: number;
  };
  readonly user: User;
  readonly isNewDevice?: boolean | undefined;
}

export async function issueSession(
  repo: Pick<IdentityRepository, 'insertRefreshToken' | 'insertUserSession'>,
  user: DbUser,
  options: IssueSessionOptions,
): Promise<IssuedSession> {
  const now = options.now ?? new Date();
  const sessionMeta: { ipAddress?: string; userAgent?: string; deviceId?: string } = {};
  if (options.ipAddress !== undefined && options.ipAddress !== null && options.ipAddress !== '') {
    sessionMeta.ipAddress = options.ipAddress;
  }
  if (options.userAgent !== undefined && options.userAgent !== null && options.userAgent !== '') {
    sessionMeta.userAgent = options.userAgent;
  }
  if (options.deviceId !== undefined && options.deviceId !== null && options.deviceId !== '') {
    sessionMeta.deviceId = options.deviceId;
  }

  const { familyId, token: refreshToken } = await createRefreshTokenFamilyInRepo(
    repo,
    user.id,
    options.refreshExpiryDays,
    sessionMeta,
    now,
  );

  const token = createAccessToken(
    user.id,
    user.email,
    user.role,
    options.jwtSecret,
    options.accessTokenExpiry,
    user.tokenVersion,
  );

  const cookieOptions = {
    httpOnly: options.cookie.httpOnly,
    secure: options.cookie.secure,
    sameSite: options.cookie.sameSite,
    path: options.cookie.path,
    maxAge: Math.round(options.refreshExpiryDays * SECONDS_PER_DAY),
  };

  return {
    token,
    refreshToken,
    familyId,
    cookieOptions,
    user: toUserDto(user),
    ...(options.isNewDevice !== undefined ? { isNewDevice: options.isNewDevice } : {}),
  };
}

export async function elevateSudoInRepo(
  repo: Pick<IdentityRepository, 'findUserById'>,
  userId: string,
  input: SudoRequest,
  options: {
    readonly jwtSecret: string;
    readonly encryptionKey: string;
    readonly totpWindow: number;
    readonly argon2Config?: Argon2Config | undefined;
    readonly now?: Date | undefined;
  },
): Promise<
  ServiceResult<
    SudoResponse,
    | 'USER_NOT_FOUND'
    | 'INVALID_CREDENTIALS'
    | 'SUDO_CREDENTIAL_REQUIRED'
    | 'TOTP_NOT_ENABLED'
    | 'TOTP_NOT_CONFIGURED'
    | 'TOTP_INVALID_CODE'
  >
> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found' };
  }

  if (input.password !== undefined) {
    const valid = await verifyPasswordSafe(
      input.password,
      user.passwordHash,
      options.argon2Config ?? DEFAULT_ARGON2_CONFIG,
    );
    if (!valid) {
      return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' };
    }
  } else if (input.totpCode !== undefined) {
    if (!user.totpEnabled) {
      return {
        ok: false,
        code: 'TOTP_NOT_ENABLED',
        message: 'TOTP is not enabled for this account',
      };
    }
    if (user.totpSecret === null) {
      return { ok: false, code: 'TOTP_NOT_CONFIGURED', message: 'TOTP is not configured' };
    }
    const valid = verifyTotpCode(
      user.totpSecret,
      input.totpCode,
      options.totpWindow,
      options.encryptionKey,
    );
    if (!valid) {
      return { ok: false, code: 'TOTP_INVALID_CODE', message: 'Invalid TOTP code' };
    }
  } else {
    return {
      ok: false,
      code: 'SUDO_CREDENTIAL_REQUIRED',
      message: 'Either password or totpCode is required',
    };
  }

  return {
    ok: true,
    value: createSudoToken(userId, options.jwtSecret, undefined, options.now),
  };
}

export async function invalidateAllUserSessionsInRepo(
  repo: Pick<
    IdentityRepository,
    | 'incrementUserTokenVersion'
    | 'stampAllUserRefreshFamiliesRevoked'
    | 'deleteRefreshTokensByUserId'
    | 'revokeAllUserSessions'
  >,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await repo.incrementUserTokenVersion(userId);
  invalidateLiveness(userId);
  await revokeAllUserTokensInRepo(repo, userId, now);
}

function toDeviceItemDto(device: {
  readonly id: string;
  readonly deviceFingerprint: string;
  readonly label: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly trustedAt: Date | null;
  readonly createdAt: Date;
}): DeviceItem {
  return {
    id: device.id,
    deviceFingerprint: device.deviceFingerprint,
    label: device.label,
    ipAddress: device.ipAddress,
    userAgent: device.userAgent,
    firstSeenAt: device.firstSeenAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
    trusted: device.trustedAt !== null,
    createdAt: device.createdAt.toISOString(),
  };
}

export async function listDevicesForUser(
  repo: Pick<IdentityRepository, 'listTrustedDevicesByUser'>,
  userId: string,
): Promise<DeviceItem[]> {
  const devices = await repo.listTrustedDevicesByUser(userId);
  return devices.map(toDeviceItemDto);
}

export async function trustDeviceForUser(
  repo: Pick<IdentityRepository, 'findTrustedDeviceById' | 'markDeviceTrusted'>,
  userId: string,
  deviceId: string,
  now: Date = new Date(),
): Promise<ServiceResult<TrustDeviceResponse, 'DEVICE_NOT_FOUND'>> {
  const device = await repo.findTrustedDeviceById(deviceId);
  if (device?.userId !== userId) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }
  const updated = await repo.markDeviceTrusted(deviceId, now);
  if (updated === null) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }
  return { ok: true, value: { device: toDeviceItemDto(updated) } };
}

export async function revokeDeviceForUser(
  repo: Pick<IdentityRepository, 'findTrustedDeviceById' | 'revokeTrustedDevice'>,
  userId: string,
  deviceId: string,
): Promise<ServiceResult<{ readonly message: string }, 'DEVICE_NOT_FOUND'>> {
  const device = await repo.findTrustedDeviceById(deviceId);
  if (device?.userId !== userId) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }
  const revoked = await repo.revokeTrustedDevice(deviceId);
  if (!revoked) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'Device not found' };
  }
  return { ok: true, value: { message: 'Device revoked successfully' } };
}
