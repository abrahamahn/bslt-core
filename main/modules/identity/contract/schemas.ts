// main/modules/identity/contract/schemas.ts
import {
  array,
  boolean,
  describe,
  emailSchema,
  enumOf,
  isoDateTimeSchema,
  json,
  literal,
  makeSchema,
  nullable,
  number,
  object,
  optional,
  passwordSchema,
  record,
  refine,
  SchemaValidationError,
  string,
  union,
  urlSchema,
  userIdSchema,
  uuidSchema,
  type Infer,
  type Schema,
  type UserId,
} from '@bslt/schema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ============================================================================
// 1. Roles, Constants & Username Policy
// ============================================================================

const USER_ROLES = ['admin', 'moderator', 'user'] as const;
const userRoleSchema = enumOf(USER_ROLES, 'role');
export type UserRole = Infer<typeof userRoleSchema>;

export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

export const USER_STATUSES = ['active', 'locked', 'unverified'] as const;
const userStatusSchema = enumOf(USER_STATUSES, 'status');
export type UserStatus = Infer<typeof userStatusSchema>;

export const RESERVED_USERNAMES = [
  'admin',
  'administrator',
  'support',
  'system',
  'help',
  'root',
  'mod',
  'moderator',
  'staff',
  'team',
  'official',
  'info',
  'security',
  'abuse',
  'postmaster',
  'webmaster',
  'noreply',
  'null',
  'undefined',
  'api',
  'www',
  'mail',
  'ftp',
] as const;

const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;
export const HARD_BAN_GRACE_DAYS = 7;
export const HARD_DELETE_DAYS = 30;
export const SESSIONS_RETENTION_DAYS = 30;

const USERNAME_REGEX = /^[a-z][a-z0-9_]{1,29}$/u;

/**
 * Canonical username policy: trims, lowercases, enforces `[a-z][a-z0-9_]{1,29}`,
 * and rejects reserved names.
 */
export const usernameSchema: Schema<string> = makeSchema<string>(
  (data: unknown) => {
    if (typeof data !== 'string') {
      throw new SchemaValidationError('username must be a string');
    }
    const username = data.trim().toLowerCase();
    if (!USERNAME_REGEX.test(username)) {
      throw new SchemaValidationError(
        'Username must be 2-30 characters, start with a letter, and contain only lowercase letters, numbers, and underscores',
      );
    }
    if ((RESERVED_USERNAMES as readonly string[]).includes(username)) {
      throw new SchemaValidationError('This username is reserved');
    }
    return username;
  },
  { kind: 'string', trim: true, min: 2, max: 30, pattern: USERNAME_REGEX.source },
);

export function isUsernameChangeCooldownActive(
  lastChange: Date | null,
  now: Date = new Date(),
): boolean {
  if (lastChange === null) return false;
  const cooldownEnd = new Date(lastChange.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * MS_PER_DAY);
  return now < cooldownEnd;
}

export function getNextUsernameChangeDate(lastChange: Date | null, now: Date = new Date()): Date {
  if (lastChange === null) return now;
  return new Date(lastChange.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * MS_PER_DAY);
}

// ============================================================================
// 2. API Key Schemas
// ============================================================================

/** Maximum lifetime a caller may request for a new API key (10 years). */
export const API_KEY_MAX_EXPIRY_DAYS = 3650;

const API_KEY_SCOPE_PATTERN = /^[a-z][a-z0-9:_-]{1,63}$/u;

const apiKeyScopeSchema = refine(
  string({ label: 'scope', min: 2, max: 64, trim: true }),
  (value) => API_KEY_SCOPE_PATTERN.test(value),
  'Scope must start with a letter and contain only lowercase letters, digits, ":", "_", or "-"',
);

export const apiKeySchema = object({
  id: uuidSchema,
  orgId: nullable(uuidSchema),
  scopes: array(string()),
  name: string({ min: 1, max: 100, trim: true }),
  keyPrefix: string({ min: 1 }),
  last4: string({ min: 1 }),
  lastUsedAt: nullable(isoDateTimeSchema),
  expiresAt: nullable(isoDateTimeSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type ApiKey = Infer<typeof apiKeySchema>;

export const createdApiKeySchema = object({
  id: uuidSchema,
  orgId: nullable(uuidSchema),
  scopes: array(string()),
  name: string({ min: 1, max: 100, trim: true }),
  keyPrefix: string({ min: 1 }),
  last4: string({ min: 1 }),
  lastUsedAt: nullable(isoDateTimeSchema),
  expiresAt: nullable(isoDateTimeSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  token: string({ min: 1 }),
});

export type CreatedApiKey = Infer<typeof createdApiKeySchema>;

export const createApiKeyRequestSchema = object({
  name: string({ min: 1, max: 100, trim: true }),
  expiresInDays: optional(nullable(number({ int: true, min: 1, max: API_KEY_MAX_EXPIRY_DAYS }))),
  scopes: optional(array(apiKeyScopeSchema, { max: 20 })),
  scopeToWorkspace: optional(boolean()),
});

export type CreateApiKeyRequest = Infer<typeof createApiKeyRequestSchema>;

export const apiKeysListResponseSchema = object({
  keys: array(apiKeySchema),
});

export type ApiKeysListResponse = Infer<typeof apiKeysListResponseSchema>;

export const createApiKeyResponseSchema = object({
  key: createdApiKeySchema,
});

export type CreateApiKeyResponse = Infer<typeof createApiKeyResponseSchema>;

export const deleteApiKeyResponseSchema = object({
  id: uuidSchema,
});

// ============================================================================
// 3. User Profile, Username & Completeness Schemas
// ============================================================================

export const userSchema = object({
  id: userIdSchema,
  email: emailSchema,
  username: nullable(string()),
  firstName: string(),
  lastName: string(),
  role: userRoleSchema,
  emailVerified: boolean(),
  phone: nullable(string()),
  phoneVerified: nullable(boolean()),
  dateOfBirth: nullable(string()),
  gender: nullable(string()),
  bio: optional(nullable(string())),
  city: optional(nullable(string())),
  state: optional(nullable(string())),
  country: optional(nullable(string())),
  language: optional(nullable(string())),
  website: optional(nullable(string())),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deactivatedAt: optional(nullable(isoDateTimeSchema)),
  deletedAt: optional(nullable(isoDateTimeSchema)),
  deletionGracePeriodEnds: optional(nullable(isoDateTimeSchema)),
});

export type User = {
  id: UserId;
  email: string;
  username: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean | null;
  dateOfBirth: string | null;
  gender: string | null;
  bio?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | null | undefined;
  language?: string | null | undefined;
  website?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
  deactivatedAt?: string | null | undefined;
  deletedAt?: string | null | undefined;
  deletionGracePeriodEnds?: string | null | undefined;
};

export const updateProfileRequestSchema = object({
  username: optional(nullable(string({ min: 2, max: 30, trim: true }))),
  firstName: optional(string({ min: 1, max: 100 })),
  lastName: optional(string({ min: 1, max: 100 })),
  email: optional(emailSchema),
  phone: optional(nullable(string())),
  dateOfBirth: optional(nullable(string())),
  gender: optional(nullable(string())),
  bio: optional(nullable(string({ max: 500 }))),
  city: optional(nullable(string({ max: 100 }))),
  state: optional(nullable(string({ max: 100 }))),
  country: optional(nullable(string({ max: 100 }))),
  language: optional(nullable(string({ max: 100 }))),
  website: optional(nullable(urlSchema)),
});

export type UpdateProfileRequest = Infer<typeof updateProfileRequestSchema>;

const PROFILE_FIELD_LABELS: Readonly<Record<string, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  bio: 'Bio',
  city: 'City',
  state: 'State',
  country: 'Country',
  language: 'Language',
  website: 'Website',
  phone: 'Phone',
};

export const PROFILE_COMPLETENESS_FIELDS: readonly string[] = Object.keys(PROFILE_FIELD_LABELS);

export const getProfileFieldLabel = (field: string): string => PROFILE_FIELD_LABELS[field] ?? field;

export const getUserDisplayName = (user: {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  username?: string | null | undefined;
}): string => {
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name.length > 0 ? name : (user.username?.trim() ?? '');
};

export const profileCompletenessResponseSchema = object({
  percentage: number(),
  missingFields: array(string()),
});

export type ProfileCompletenessResponse = Infer<typeof profileCompletenessResponseSchema>;

export const updateUsernameRequestSchema = object({
  username: usernameSchema,
});

export type UpdateUsernameRequest = Infer<typeof updateUsernameRequestSchema>;

export const updateUsernameResponseSchema = object({
  username: string({ min: 2 }),
  nextChangeAllowedAt: isoDateTimeSchema,
});

export type UpdateUsernameResponse = Infer<typeof updateUsernameResponseSchema>;

// ============================================================================
// 4. Password Change & Strength Validation
// ============================================================================

export const changePasswordRequestSchema = object({
  currentPassword: string({ min: 1 }),
  newPassword: passwordSchema,
});

export type ChangePasswordRequest = Infer<typeof changePasswordRequestSchema>;

export const changePasswordResponseSchema = object({
  success: boolean(),
  message: string(),
});

export type ChangePasswordResponse = Infer<typeof changePasswordResponseSchema>;

interface PasswordConfig {
  readonly minLength: number;
  readonly maxLength: number;
  readonly minScore: 0 | 1 | 2 | 3 | 4;
}

const DEFAULT_PASSWORD_CONFIG: PasswordConfig = {
  minLength: 8,
  maxLength: 64,
  minScore: 3,
};

const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'abc123',
  '111111',
  'password1',
  'iloveyou',
  'admin',
  'welcome',
  'monkey',
  'dragon',
  'master',
  'letmein',
  'login',
  'princess',
  'football',
  'shadow',
  'sunshine',
  'trustno1',
  'batman',
  'access',
  'hello',
  'charlie',
  'donald',
  '!@#$%^&*',
  'passw0rd',
  'qwerty123',
]);

const KEYBOARD_PATTERNS: readonly string[] = [
  'qwerty',
  'qwertz',
  'azerty',
  'asdf',
  'asdfgh',
  'zxcv',
  'zxcvbn',
  'qazwsx',
  '1qaz2wsx',
  '1234',
  '12345',
  '123456',
  '1234567',
  '12345678',
  '0987',
  '09876',
  '098765',
  '0987654',
  '09876543',
];

function hasRepeatedChars(password: string, minLength = 3): boolean {
  if (minLength <= 1) return password.length > 0;
  let runLength = 1;
  for (let i = 1; i < password.length; i++) {
    if (password.charCodeAt(i) === password.charCodeAt(i - 1)) {
      runLength++;
      if (runLength >= minLength) return true;
    } else {
      runLength = 1;
    }
  }
  return false;
}

function hasSequentialChars(password: string, minLength = 3): boolean {
  const lower = password.toLowerCase();
  for (let i = 0; i <= lower.length - minLength; i++) {
    let isSequence = true;
    let isReverseSequence = true;
    for (let j = 1; j < minLength; j++) {
      if (lower.charCodeAt(i + j) !== lower.charCodeAt(i + j - 1) + 1) isSequence = false;
      if (lower.charCodeAt(i + j) !== lower.charCodeAt(i + j - 1) - 1) isReverseSequence = false;
    }
    if (isSequence || isReverseSequence) return true;
  }
  return false;
}

function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  const normalized = lower
    .replace(/0/gu, 'o')
    .replace(/1/gu, 'i')
    .replace(/3/gu, 'e')
    .replace(/4/gu, 'a')
    .replace(/5/gu, 's')
    .replace(/7/gu, 't')
    .replace(/8/gu, 'b')
    .replace(/@/gu, 'a')
    .replace(/\$/gu, 's')
    .replace(/!/gu, 'i');
  if (COMMON_PASSWORDS.has(normalized)) return true;
  let trimIndex = lower.length;
  while (trimIndex > 0) {
    const code = lower.charCodeAt(trimIndex - 1);
    if (code < 48 || code > 57) break;
    trimIndex--;
  }
  const withoutTrailingNumbers = lower.slice(0, trimIndex);
  return withoutTrailingNumbers.length >= 4 && COMMON_PASSWORDS.has(withoutTrailingNumbers);
}

function containsUserInput(password: string, userInputs: readonly string[]): boolean {
  const lower = password.toLowerCase();
  return userInputs.some((input) => {
    const inputLower = input.toLowerCase();
    return inputLower.length >= 3 && lower.includes(inputLower);
  });
}

function formatCrackTime(entropy: number): string {
  const seconds = 2 ** entropy / 10_000 / 2;
  if (seconds < 1) return 'less than a second';
  if (seconds < 60) return `${String(Math.round(seconds))} seconds`;
  if (seconds < 3600) return `${String(Math.round(seconds / 60))} minutes`;
  if (seconds < 86_400) return `${String(Math.round(seconds / 3600))} hours`;
  if (seconds < 2_592_000) return `${String(Math.round(seconds / 86_400))} days`;
  if (seconds < 31_536_000) return `${String(Math.round(seconds / 2_592_000))} months`;
  if (seconds < 3_153_600_000) return `${String(Math.round(seconds / 31_536_000))} years`;
  return 'centuries';
}

interface PasswordValidationResult {
  readonly isValid: boolean;
  readonly score: number;
  readonly errors: string[];
  readonly feedback: {
    readonly warning: string;
    readonly suggestions: string[];
  };
  readonly crackTimeDisplay: string;
}

export function validatePassword(
  password: string,
  userInputs: readonly string[] = [],
  config: PasswordConfig = DEFAULT_PASSWORD_CONFIG,
): PasswordValidationResult {
  const errors: string[] = [];
  if (password.length < config.minLength) {
    errors.push(`Password must be at least ${String(config.minLength)} characters`);
  }
  if (password.length > config.maxLength) {
    errors.push(`Password must be at most ${String(config.maxLength)} characters`);
  }
  if (errors.length > 0) {
    return {
      isValid: false,
      score: 0,
      errors,
      feedback: { warning: '', suggestions: [] },
      crackTimeDisplay: 'instant',
    };
  }

  let charset = 0;
  if (/[a-z]/u.test(password)) charset += 26;
  if (/[A-Z]/u.test(password)) charset += 26;
  if (/[0-9]/u.test(password)) charset += 10;
  if (/[^a-zA-Z0-9]/u.test(password)) charset += 32;
  const entropy = password.length * Math.log2(charset !== 0 ? charset : 1);

  const isCommon = isCommonPassword(password);
  const hasRepeats = hasRepeatedChars(password);
  const hasSequence = hasSequentialChars(password);
  const hasKeyboard = KEYBOARD_PATTERNS.some((p) => password.toLowerCase().includes(p));
  const containsInput = containsUserInput(password, userInputs);

  let adjusted = entropy;
  if (isCommon) adjusted *= 0.1;
  if (hasRepeats) adjusted *= 0.7;
  if (hasSequence) adjusted *= 0.7;
  if (hasKeyboard) adjusted *= 0.5;
  if (containsInput) adjusted *= 0.5;

  const score: 0 | 1 | 2 | 3 | 4 =
    adjusted < 20 ? 0 : adjusted < 35 ? 1 : adjusted < 50 ? 2 : adjusted < 65 ? 3 : 4;

  const suggestions: string[] = [];
  let warning = '';
  if (isCommon) {
    warning = 'This is a commonly used password.';
    suggestions.push('Avoid common passwords');
  }
  if (containsInput) {
    if (warning === '') warning = 'This password contains personal information.';
    suggestions.push('Avoid using personal information in passwords');
  }
  if (hasKeyboard) {
    if (warning === '') warning = 'This password uses a keyboard pattern.';
    suggestions.push('Avoid keyboard patterns like "qwerty" or "asdf"');
  }
  if (hasSequence) {
    if (warning === '') warning = 'This password contains sequential characters.';
    suggestions.push('Avoid sequential characters like "abc" or "123"');
  }
  if (hasRepeats) {
    if (warning === '') warning = 'This password has repeated characters.';
    suggestions.push('Avoid repeated characters like "aaa"');
  }
  if (!/[A-Z]/u.test(password)) suggestions.push('Add uppercase letters');
  if (!/[a-z]/u.test(password)) suggestions.push('Add lowercase letters');
  if (!/[0-9]/u.test(password)) suggestions.push('Add numbers');
  if (!/[^a-zA-Z0-9]/u.test(password)) suggestions.push('Add symbols');
  if (password.length < 12) suggestions.push('Make the password longer');

  if (score < config.minScore) {
    errors.push(
      `Password is too weak (score: ${String(score)}/${String(config.minScore)} required)`,
    );
  }

  return {
    isValid: errors.length === 0,
    score,
    errors,
    feedback: { warning, suggestions: suggestions.slice(0, 3) },
    crackTimeDisplay: formatCrackTime(entropy),
  };
}

export function validatePasswordBasic(
  password: string,
  config: PasswordConfig = DEFAULT_PASSWORD_CONFIG,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < config.minLength) {
    errors.push(`Password must be at least ${String(config.minLength)} characters`);
  }
  if (password.length > config.maxLength) {
    errors.push(`Password must be at most ${String(config.maxLength)} characters`);
  }
  if (/^(.)\1+$/u.test(password)) {
    errors.push('Password cannot be all the same character');
  }
  if (/^(012|123|234|345|456|567|678|789|890)+$/u.test(password)) {
    errors.push('Password cannot be a simple sequence');
  }
  return { isValid: errors.length === 0, errors };
}

// ============================================================================
// 5. Session Schemas
// ============================================================================

export const sessionSchema = object({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema,
  device: nullable(string()),
  ipAddress: nullable(string()),
  userAgent: nullable(string()),
  isCurrent: boolean(),
});

export type Session = Infer<typeof sessionSchema>;

export const sessionsListResponseSchema = object({
  sessions: array(sessionSchema),
});

export type SessionsListResponse = Infer<typeof sessionsListResponseSchema>;

export const revokeSessionResponseSchema = object({
  success: boolean(),
});

export type RevokeSessionResponse = Infer<typeof revokeSessionResponseSchema>;

export const revokeAllSessionsResponseSchema = object({
  success: boolean(),
  revokedCount: number({ int: true, min: 0 }),
});

export type RevokeAllSessionsResponse = Infer<typeof revokeAllSessionsResponseSchema>;

// ============================================================================
// 6. Account Lifecycle Schemas & Pure State Transitions
// ============================================================================

const ACCOUNT_STATUSES = ['active', 'deactivated', 'pending_deletion'] as const;
const accountStatusSchema = enumOf(ACCOUNT_STATUSES, 'status');

export interface AccountLifecycleFields {
  readonly deactivatedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly deletionGracePeriodEnds: Date | null;
}

export const deactivateAccountRequestSchema = object({
  reason: optional(string({ max: 500 })),
});

export type DeactivateAccountRequest = Infer<typeof deactivateAccountRequestSchema>;

export const deleteAccountRequestSchema = object({
  reason: optional(string({ max: 500 })),
});

export type DeleteAccountRequest = Infer<typeof deleteAccountRequestSchema>;

export const accountLifecycleResponseSchema = object({
  message: string(),
  status: accountStatusSchema,
  deletionGracePeriodEnds: optional(isoDateTimeSchema),
});

export type AccountLifecycleResponse = Infer<typeof accountLifecycleResponseSchema>;

export function getAccountStatus(
  fields: AccountLifecycleFields,
): 'active' | 'deactivated' | 'pending_deletion' {
  if (fields.deletedAt !== null) return 'pending_deletion';
  if (fields.deactivatedAt !== null) return 'deactivated';
  return 'active';
}

export function calculateDeletionGracePeriodEnd(
  deletionDate: Date,
  gracePeriodDays: number = ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
): Date {
  return new Date(deletionDate.getTime() + gracePeriodDays * MS_PER_DAY);
}

function isWithinDeletionGracePeriod(
  fields: AccountLifecycleFields,
  now: Date = new Date(),
): boolean {
  if (fields.deletedAt === null || fields.deletionGracePeriodEnds === null) return false;
  return now < fields.deletionGracePeriodEnds;
}

export function canDeactivate(fields: AccountLifecycleFields): boolean {
  return getAccountStatus(fields) === 'active';
}

export function canRequestDeletion(fields: AccountLifecycleFields): boolean {
  const status = getAccountStatus(fields);
  return status === 'active' || status === 'deactivated';
}

export function canReactivate(fields: AccountLifecycleFields, now: Date = new Date()): boolean {
  const status = getAccountStatus(fields);
  if (status === 'deactivated') return true;
  if (status === 'pending_deletion') return isWithinDeletionGracePeriod(fields, now);
  return false;
}

// ============================================================================
// 7. Admin User Management Schemas
// ============================================================================

export const LOCKOUT_DURATION_MINUTES = {
  oneHour: 60,
  oneDay: 1440,
  sevenDays: 10_080,
  thirtyDays: 43_200,
} as const;

export const MAX_LOCKOUT_DURATION_MINUTES: number = Math.max(
  ...Object.values(LOCKOUT_DURATION_MINUTES),
);

export const ADMIN_LIST_MAX_OFFSET = 100_000;
const ADMIN_USER_SEARCH_DEFAULT_LIMIT = 20;
export const ADMIN_USER_SEARCH_MAX_LIMIT = 100;

export const adminUserSchema = object({
  id: uuidSchema,
  email: emailSchema,
  username: nullable(string()),
  firstName: string(),
  lastName: string(),
  role: userRoleSchema,
  emailVerified: boolean(),
  emailVerifiedAt: nullable(isoDateTimeSchema),
  lockedUntil: nullable(isoDateTimeSchema),
  lockReason: nullable(string()),
  failedLoginAttempts: number({ int: true }),
  phone: nullable(string()),
  phoneVerified: boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type AdminUser = Infer<typeof adminUserSchema>;

const adminUserSortBySchema = enumOf(
  ['email', 'username', 'firstName', 'lastName', 'createdAt', 'updatedAt'] as const,
  'sortBy',
);

const adminSortOrderSchema = enumOf(['asc', 'desc'] as const, 'sortOrder');

export const adminUserListFiltersSchema = object({
  search: optional(string({ max: 100 })),
  role: optional(userRoleSchema),
  status: optional(userStatusSchema),
  plan: optional(string({ max: 100 })),
  sortBy: optional(adminUserSortBySchema),
  sortOrder: optional(adminSortOrderSchema),
  page: optional(number({ coerce: true, int: true, min: 1 })),
  limit: optional(number({ coerce: true, int: true, min: 1, max: 100 })),
});

export type AdminUserListFilters = Infer<typeof adminUserListFiltersSchema>;

export const adminUserListResponseSchema = object({
  data: array(adminUserSchema),
  total: number({ int: true, min: 0 }),
  page: number({ int: true, min: 1 }),
  limit: number({ int: true, min: 1 }),
  totalPages: number({ int: true, min: 0 }),
  hasNext: boolean(),
  hasPrev: boolean(),
});

export type AdminUserListResponse = Infer<typeof adminUserListResponseSchema>;

const rawAdminUserSearchQuerySchema = object({
  q: string({ trim: true, min: 1, max: 100 }),
  limit: optional(number({ coerce: true, int: true, min: 1, max: ADMIN_USER_SEARCH_MAX_LIMIT })),
  offset: optional(number({ coerce: true, int: true, min: 0, max: ADMIN_LIST_MAX_OFFSET })),
});

export const adminUserSearchQuerySchema: Schema<{
  readonly q: string;
  readonly limit: number;
  readonly offset: number;
}> = makeSchema((data: unknown) => {
  const parsed = rawAdminUserSearchQuerySchema.parse(data);
  return {
    q: parsed.q,
    limit: parsed.limit ?? ADMIN_USER_SEARCH_DEFAULT_LIMIT,
    offset: parsed.offset ?? 0,
  };
}, describe(rawAdminUserSearchQuerySchema));

export const adminUserSearchResponseSchema = object({
  users: array(adminUserSchema),
  total: number({ int: true, min: 0 }),
  limit: number({ int: true, min: 1 }),
  offset: number({ int: true, min: 0 }),
});

export type AdminUserSearchResponse = Infer<typeof adminUserSearchResponseSchema>;

const rawAdminUpdateUserRequestSchema = object({
  firstName: optional(string({ min: 1, max: 50 })),
  lastName: optional(string({ max: 50 })),
  role: optional(userRoleSchema),
});

export const adminUpdateUserRequestSchema = refine(
  rawAdminUpdateUserRequestSchema,
  (val) => val.firstName !== undefined || val.lastName !== undefined || val.role !== undefined,
  'At least one field must be provided',
);

export type AdminUpdateUserRequest = Infer<typeof adminUpdateUserRequestSchema>;

export const adminLockUserRequestSchema = object({
  reason: string({ min: 1, max: 500 }),
  durationMinutes: optional(number({ int: true, min: 1, max: MAX_LOCKOUT_DURATION_MINUTES })),
});

export type AdminLockUserRequest = Infer<typeof adminLockUserRequestSchema>;

export const unlockAccountRequestSchema = object({
  reason: string({ min: 1, max: 500 }),
});

export const adminForceLogoutRequestSchema = object({
  reason: string({ min: 1, max: 500 }),
});

export const adminHardBanRequestSchema = object({
  reason: string({ min: 1, max: 500 }),
});

export type AdminHardBanRequest = Infer<typeof adminHardBanRequestSchema>;

export const adminHardBanResponseSchema = object({
  message: string(),
  gracePeriodEnds: isoDateTimeSchema,
  subscriptionsCancelled: boolean(),
});

export type AdminHardBanResponse = Infer<typeof adminHardBanResponseSchema>;

export const adminCreateUserRequestSchema = object({
  email: emailSchema,
  firstName: string({ min: 1, max: 100 }),
  lastName: string({ min: 1, max: 100 }),
  username: optional(usernameSchema),
  role: optional(userRoleSchema),
});

export type AdminCreateUserRequest = Infer<typeof adminCreateUserRequestSchema>;

export const adminDeleteUserRequestSchema = object({
  reason: string({ min: 1, max: 500 }),
});

export type AdminDeleteUserRequest = Infer<typeof adminDeleteUserRequestSchema>;

export const adminResetPasswordRequestSchema = object({
  reason: string({ min: 1, max: 500 }),
});

export interface AdminActionResponse {
  message: string;
  user?: AdminUser | undefined;
}

export const adminUpdateUserResponseSchema = object({
  message: string(),
  user: adminUserSchema,
});

export type AdminUpdateUserResponse = Infer<typeof adminUpdateUserResponseSchema>;

export type AdminLockUserResponse = AdminUpdateUserResponse;

export const adminForceLogoutResponseSchema = object({
  message: string(),
  revokedSessions: number({ int: true, min: 0 }),
});

export type AdminForceLogoutResponse = Infer<typeof adminForceLogoutResponseSchema>;

export const adminMessageResponseSchema = object({
  message: string(),
});

// ============================================================================
// 8. Sudo, Session Invalidation, Devices, Phone, SMS 2FA, TOTP & Passkeys
// ============================================================================

export const sudoRequestSchema = refine(
  object({
    password: optional(string()),
    totpCode: optional(string()),
  }),
  (data) => data.password !== undefined || data.totpCode !== undefined,
  'Either password or totpCode is required',
);

export type SudoRequest = Infer<typeof sudoRequestSchema>;

export const sudoResponseSchema = object({
  sudoToken: string({ min: 1 }),
  expiresAt: isoDateTimeSchema,
});

export type SudoResponse = Infer<typeof sudoResponseSchema>;

export const authResponseSchema = object({
  token: string({ min: 1 }),
  user: userSchema,
  isNewDevice: optional(boolean()),
});

export type AuthResponse = Infer<typeof authResponseSchema>;

export const logoutResponseSchema = object({
  message: string(),
});

export const invalidateSessionsResponseSchema = object({
  message: string(),
});

export const deviceItemSchema = object({
  id: string({ min: 1 }),
  deviceFingerprint: string({ min: 1 }),
  label: nullable(string()),
  ipAddress: nullable(string()),
  userAgent: nullable(string()),
  firstSeenAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  trusted: boolean(),
  createdAt: isoDateTimeSchema,
});

export type DeviceItem = Infer<typeof deviceItemSchema>;

export const deviceListResponseSchema = object({
  devices: array(deviceItemSchema),
});

export const trustDeviceResponseSchema = object({
  device: deviceItemSchema,
});

export type TrustDeviceResponse = Infer<typeof trustDeviceResponseSchema>;

export const setPhoneRequestSchema = object({
  phone: string({ min: 7, max: 30, trim: true }),
});

export const setPhoneResponseSchema = object({
  message: string(),
});

export const verifyPhoneRequestSchema = object({
  code: string({ min: 6, max: 20 }),
});

export const verifyPhoneResponseSchema = object({
  verified: boolean(),
});

export type VerifyPhoneResponse = Infer<typeof verifyPhoneResponseSchema>;

export const removePhoneResponseSchema = object({
  message: string(),
});

export const smsChallengeRequestSchema = object({
  challengeToken: string({ min: 1 }),
});

export const smsVerifyRequestSchema = object({
  challengeToken: string({ min: 1 }),
  code: string({ min: 6, max: 20 }),
});

export const totpSetupResponseSchema = object({
  secret: string({ min: 1 }),
  otpauthUrl: string({ min: 1 }),
  backupCodes: array(string({ min: 1 })),
});

export type TotpSetupResponse = Infer<typeof totpSetupResponseSchema>;

export const totpVerifyRequestSchema = object({
  code: string({ min: 6, max: 32 }),
});

export const totpVerifyResponseSchema = object({
  message: string(),
});

export const totpStatusResponseSchema = object({
  enabled: boolean(),
});

export type TotpStatusResponse = Infer<typeof totpStatusResponseSchema>;

export const backupCodesStatusResponseSchema = object({
  remaining: number({ int: true, min: 0 }),
  total: number({ int: true, min: 0 }),
});

export type BackupCodesStatusResponse = Infer<typeof backupCodesStatusResponseSchema>;

export const backupCodesRegenerateResponseSchema = object({
  backupCodes: array(string({ min: 1 })),
});

export type BackupCodesRegenerateResponse = Infer<typeof backupCodesRegenerateResponseSchema>;

export const totpLoginVerifyRequestSchema = object({
  challengeToken: string({ min: 1 }),
  code: string({ min: 6, max: 32 }),
});

export const totpLoginChallengeResponseSchema = object({
  requiresTotp: literal(true),
  challengeToken: string({ min: 1 }),
  message: string(),
});

export const webauthnOptionsResponseSchema = object({
  options: record(json()),
});

export type WebauthnOptionsResponse = Infer<typeof webauthnOptionsResponseSchema>;

export const webauthnRegisterVerifyRequestSchema = object({
  credential: record(optional(json())),
  name: optional(string({ min: 1, max: 64, trim: true })),
});

export type WebauthnRegisterVerifyRequest = Infer<typeof webauthnRegisterVerifyRequestSchema>;

export const webauthnRegisterVerifyResponseSchema = object({
  credentialId: string({ min: 1 }),
  message: string(),
});

export const webauthnLoginOptionsRequestSchema = object({
  email: optional(string()),
});

export const webauthnLoginVerifyRequestSchema = object({
  credential: record(optional(json())),
  sessionKey: string({ min: 1 }),
});

export type WebauthnLoginVerifyRequest = Infer<typeof webauthnLoginVerifyRequestSchema>;

export const renamePasskeyRequestSchema = object({
  name: string({ min: 1, max: 64, trim: true }),
});

export const passkeyListItemSchema = object({
  id: string({ min: 1 }),
  name: string(),
  deviceType: nullable(string()),
  backedUp: boolean(),
  createdAt: isoDateTimeSchema,
  lastUsedAt: nullable(isoDateTimeSchema),
});

export type PasskeyListItem = Infer<typeof passkeyListItemSchema>;

export const passkeyListResponseSchema = array(passkeyListItemSchema);

// ============================================================================
// 9. Signup Attestation, Session Span & Core Auth Schemas
// ============================================================================

export const SIGNUP_ATTESTATION_VERSION = '2026-07-15.v1';

export const SIGNUP_ATTESTATION_STATEMENT =
  'I am old enough to consent to these terms in my country (at least 13, or 16 in the EEA), I meet my jurisdiction’s requirements for holding an account, and I accept the Terms of Service.';

interface SignupAttestation {
  readonly version: string;
  readonly attestedAt: Date;
}

export function isAttestationConfirmed(value: unknown): value is true {
  return value === true;
}

export function createSignupAttestation(now: Date = new Date()): SignupAttestation {
  return { version: SIGNUP_ATTESTATION_VERSION, attestedAt: now };
}

export const REMEMBERED_SESSION_DAYS = 30;
export const DEFAULT_SESSION_DAYS = 0.5;
export const MAX_IDLE_MS: number = 7 * MS_PER_DAY;
export const LOGIN_ATTEMPTS_RETENTION_DAYS = 90;
const EMAIL_OTP_CODE_LENGTH = 6;

const EMAIL_OTP_CODE_REGEX = /^\d{6}$/u;

export const AUTH_STRATEGIES = ['local', 'magic', 'webauthn', 'google', 'github', 'apple'] as const;

export type AuthStrategy = (typeof AUTH_STRATEGIES)[number];

export function sessionSpanDays(rememberMe: boolean | undefined): number {
  return rememberMe === true ? REMEMBERED_SESSION_DAYS : DEFAULT_SESSION_DAYS;
}

export function sessionSpanDaysOf(createdAt: Date, expiresAt: Date): number {
  return (expiresAt.getTime() - createdAt.getTime()) / MS_PER_DAY;
}

export function sessionIdleWindowMs(spanDays: number): number {
  return Math.min(MAX_IDLE_MS, spanDays * MS_PER_DAY);
}

const registerStatusSchema = enumOf(
  ['pending_verification', 'verified'] as const,
  'register status',
);

export const registerRequestSchema = object({
  email: emailSchema,
  username: usernameSchema,
  firstName: string({ min: 1, max: 100, trim: true }),
  lastName: string({ min: 1, max: 100, trim: true }),
  password: passwordSchema,
  tosAccepted: boolean(),
  eligibilityAttested: boolean(),
  captchaToken: optional(string()),
});

export const registerResponseSchema = object({
  status: optional(registerStatusSchema),
  message: string(),
  email: emailSchema,
  emailSendFailed: optional(boolean()),
});

export type RegisterResponse = Infer<typeof registerResponseSchema>;

export const loginRequestSchema = object({
  identifier: string({ min: 1, trim: true }),
  password: passwordSchema,
  captchaToken: optional(string()),
  rememberMe: optional(boolean()),
});

export const bffLoginResponseSchema = object({
  user: userSchema,
  isNewDevice: optional(boolean()),
});

export const smsLoginChallengeResponseSchema = object({
  requiresSms: literal(true),
  challengeToken: string({ min: 1 }),
  message: string(),
});

export type SmsLoginChallengeResponse = Infer<typeof smsLoginChallengeResponseSchema>;
export type TotpLoginChallengeResponse = Infer<typeof totpLoginChallengeResponseSchema>;

export const loginResponseSchema = union([
  bffLoginResponseSchema,
  totpLoginChallengeResponseSchema,
  smsLoginChallengeResponseSchema,
] as const);

export const refreshResponseSchema = object({
  token: string({ min: 1 }),
});

export const authStrategiesResponseSchema = object({
  enabled: array(string({ min: 1 })),
  disabled: array(string({ min: 1 })),
});

export const emailVerificationRequestSchema = object({
  token: string({ min: 1 }),
});

export const emailVerificationResponseSchema = object({
  verified: boolean(),
  token: string({ min: 1 }),
  user: userSchema,
});

export const resendVerificationRequestSchema = object({
  email: emailSchema,
});

export const resendVerificationResponseSchema = object({
  message: string(),
});

export const forgotPasswordRequestSchema = object({
  email: emailSchema,
  captchaToken: optional(string()),
});

export const forgotPasswordResponseSchema = object({
  message: string(),
});

export const resetPasswordRequestSchema = object({
  token: string({ min: 1 }),
  password: passwordSchema,
});

export const resetPasswordResponseSchema = object({
  message: string(),
});

export const setPasswordRequestSchema = object({
  password: passwordSchema,
});

export const setPasswordResponseSchema = object({
  message: string(),
});

export const magicLinkRequestSchema = object({
  email: emailSchema,
});

export const magicLinkRequestResponseSchema = object({
  success: optional(boolean()),
  message: string(),
});

export const magicLinkVerifyRequestSchema = object({
  token: string({ min: 1 }),
  eligibilityAttested: optional(boolean()),
  tosAccepted: optional(boolean()),
});

export const magicLinkVerifyResponseSchema = object({
  token: string({ min: 1 }),
  user: userSchema,
});

export type MagicLinkVerifyResponse = Infer<typeof magicLinkVerifyResponseSchema>;

export const emailOtpRequestSchema = object({
  email: emailSchema,
});

export const emailOtpRequestResponseSchema = object({
  message: string(),
});

export const emailOtpVerifyRequestSchema = object({
  email: emailSchema,
  code: string({
    trim: true,
    length: EMAIL_OTP_CODE_LENGTH,
    pattern: EMAIL_OTP_CODE_REGEX,
    patternMessage: 'Code must be 6 digits',
  }),
  eligibilityAttested: optional(boolean()),
  tosAccepted: optional(boolean()),
});

export const emailOtpVerifyResponseSchema = object({
  token: string({ min: 1 }),
  user: userSchema,
  isNewUser: boolean(),
});

export type EmailOtpVerifyResponse = Infer<typeof emailOtpVerifyResponseSchema>;

export const completeOnboardingRequestSchema = object({
  firstName: string({ min: 1, max: 100, trim: true }),
  lastName: string({ min: 1, max: 100, trim: true }),
  username: usernameSchema,
  password: passwordSchema,
});

export type CompleteOnboardingRequest = Infer<typeof completeOnboardingRequestSchema>;

export const completeOnboardingResponseSchema = object({
  user: userSchema,
});

export const changeEmailRequestSchema = object({
  newEmail: emailSchema,
  password: passwordSchema,
});

export const changeEmailResponseSchema = object({
  success: optional(boolean()),
  message: string(),
});

export const confirmEmailChangeRequestSchema = object({
  token: string({ min: 1 }),
});

export const confirmEmailChangeResponseSchema = object({
  success: optional(boolean()),
  message: string(),
  email: emailSchema,
});

export const revertEmailChangeRequestSchema = object({
  token: string({ min: 1 }),
});

export const revertEmailChangeResponseSchema = object({
  message: string(),
  email: emailSchema,
});

export type RegisterRequest = Infer<typeof registerRequestSchema>;
export type LoginRequest = Infer<typeof loginRequestSchema>;
export type LoginSuccessResponse = Infer<typeof bffLoginResponseSchema>;
export type EmailVerificationRequest = Infer<typeof emailVerificationRequestSchema>;
export type EmailVerificationResponse = Infer<typeof emailVerificationResponseSchema>;
export type ResendVerificationRequest = Infer<typeof resendVerificationRequestSchema>;
export type ResendVerificationResponse = Infer<typeof resendVerificationResponseSchema>;
export type ForgotPasswordRequest = Infer<typeof forgotPasswordRequestSchema>;
export type ForgotPasswordResponse = Infer<typeof forgotPasswordResponseSchema>;
export type ResetPasswordRequest = Infer<typeof resetPasswordRequestSchema>;
export type ResetPasswordResponse = Infer<typeof resetPasswordResponseSchema>;
export type SetPasswordRequest = Infer<typeof setPasswordRequestSchema>;
export type SetPasswordResponse = Infer<typeof setPasswordResponseSchema>;
export type MagicLinkRequest = Infer<typeof magicLinkRequestSchema>;
export type MagicLinkRequestResponse = Infer<typeof magicLinkRequestResponseSchema>;
export type MagicLinkVerifyRequest = Infer<typeof magicLinkVerifyRequestSchema>;
export type EmailOtpRequest = Infer<typeof emailOtpRequestSchema>;
export type EmailOtpRequestResponse = Infer<typeof emailOtpRequestResponseSchema>;
export type EmailOtpVerifyRequest = Infer<typeof emailOtpVerifyRequestSchema>;
export type ChangeEmailRequest = Infer<typeof changeEmailRequestSchema>;
export type ChangeEmailResponse = Infer<typeof changeEmailResponseSchema>;
export type ConfirmEmailChangeRequest = Infer<typeof confirmEmailChangeRequestSchema>;
export type ConfirmEmailChangeResponse = Infer<typeof confirmEmailChangeResponseSchema>;
export type RevertEmailChangeRequest = Infer<typeof revertEmailChangeRequestSchema>;
export type RevertEmailChangeResponse = Infer<typeof revertEmailChangeResponseSchema>;

// ============================================================================
// 11. OAuth Schemas (Pure @bslt/schema Combinators)
// ============================================================================

export const OAUTH_PROVIDERS = ['google', 'github', 'apple'] as const;

const oauthProviderSchema = enumOf(OAUTH_PROVIDERS, 'provider');

export type OAuthProvider = Infer<typeof oauthProviderSchema>;

export const oauthInitiateQuerySchema = object({
  attested: optional(string()),
  consented: optional(string()),
  redirect_uri: optional(string()),
});

export const oauthInitiateResponseSchema = object({
  url: urlSchema,
});

export const oauthCallbackQuerySchema = object({
  code: optional(string()),
  state: optional(string()),
  error: optional(string()),
  error_description: optional(string()),
  error_uri: optional(string()),
  scope: optional(string()),
  iss: optional(string()),
  authuser: optional(string()),
  prompt: optional(string()),
  hd: optional(string()),
  user: optional(string()),
  session_state: optional(string()),
});

export type OAuthCallbackQuery = Infer<typeof oauthCallbackQuerySchema>;

const oauthAuthCallbackResponseSchema = object({
  token: string({ min: 1 }),
  user: userSchema,
  isNewUser: boolean(),
});

const oauthLinkCallbackResponseSchema = object({
  linked: boolean(),
  provider: oauthProviderSchema,
});

export const oauthCallbackResponseSchema = union([
  oauthAuthCallbackResponseSchema,
  oauthLinkCallbackResponseSchema,
]);

export const oauthLinkResponseSchema = object({
  url: urlSchema,
});

export const oauthUnlinkResponseSchema = object({
  message: string({ min: 1 }),
});

const oauthConnectionItemSchema = object({
  id: uuidSchema,
  provider: oauthProviderSchema,
  providerEmail: nullable(string()),
  connectedAt: isoDateTimeSchema,
});

export type OAuthConnectionItem = Infer<typeof oauthConnectionItemSchema>;

export const oauthConnectionsResponseSchema = object({
  connections: array(oauthConnectionItemSchema),
});

export const oauthEnabledProvidersResponseSchema = object({
  providers: array(oauthProviderSchema),
});
