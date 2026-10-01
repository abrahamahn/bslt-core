// main/client/api/src/api/login-response.ts
/**
 * Login response normalization and parsing for the web BFF flow.
 */

import { totpLoginChallengeResponseSchema } from '@bslt/shared/core/auth';
import { userSchema } from '@bslt/shared/core/users';

import type {
  LoginSuccessResponse,
  SmsLoginChallengeResponse,
  TotpLoginChallengeResponse,
} from '@bslt/shared/core/auth';
import type { User } from '@bslt/shared/core/users';

type LoginResponse = LoginSuccessResponse | TotpLoginChallengeResponse | SmsLoginChallengeResponse;
const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getField(candidate: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in candidate) return candidate[key];
  }
  return undefined;
}

function parseRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function parseNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return parseBoolean(value, false);
}

function parseDateTimeString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRole(candidate: Record<string, unknown>): User['role'] | null {
  const value = getField(candidate, 'role');
  const normalized = typeof value === 'string' ? value.toLowerCase() : 'user';
  return normalized === 'user' || normalized === 'admin' || normalized === 'moderator'
    ? normalized
    : null;
}

function normalizeLoginUser(value: unknown): User | null {
  const parsedUser = userSchema.safeParse(value);
  if (parsedUser.success) return parsedUser.data;
  if (!isRecord(value)) return null;

  const id = parseRequiredString(getField(value, 'id', 'userId', 'user_id'));
  const email = parseRequiredString(getField(value, 'email', 'emailAddress', 'email_address'));
  const role = parseRole(value);
  const createdAt =
    parseDateTimeString(getField(value, 'createdAt', 'created_at')) ?? FALLBACK_TIMESTAMP;
  const updatedAt =
    parseDateTimeString(getField(value, 'updatedAt', 'updated_at')) ?? FALLBACK_TIMESTAMP;

  if (id === null || email === null || role === null) {
    return null;
  }

  return {
    id: id as User['id'],
    email,
    username: parseNullableString(getField(value, 'username')),
    firstName: parseString(getField(value, 'firstName', 'first_name', 'givenName', 'given_name')),
    lastName: parseString(getField(value, 'lastName', 'last_name', 'familyName', 'family_name')),
    avatarUrl: parseNullableString(getField(value, 'avatarUrl', 'avatar_url')),
    role,
    emailVerified: parseBoolean(getField(value, 'emailVerified', 'email_verified'), true),
    phone: parseNullableString(getField(value, 'phone')),
    phoneVerified: parseNullableBoolean(getField(value, 'phoneVerified', 'phone_verified')),
    dateOfBirth: parseNullableString(getField(value, 'dateOfBirth', 'date_of_birth')),
    gender: parseNullableString(getField(value, 'gender')),
    bio: parseNullableString(getField(value, 'bio')),
    city: parseNullableString(getField(value, 'city')),
    state: parseNullableString(getField(value, 'state')),
    country: parseNullableString(getField(value, 'country')),
    language: parseNullableString(getField(value, 'language')),
    website: parseNullableString(getField(value, 'website')),
    createdAt,
    updatedAt,
  };
}

export function parseUserResponse(value: unknown): User {
  const user = normalizeLoginUser(value);
  if (user !== null) return user;

  throw new Error(`Invalid user response shape (${describeLoginUser(value)})`);
}

function describeLoginUser(value: unknown): string {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return `userKeys=${keys.length > 0 ? keys.join(',') : '(none)'}`;
  }

  return `userType=${typeof value}`;
}

function parseSmsChallenge(
  candidate: Record<string, unknown> | null,
): SmsLoginChallengeResponse | null {
  if (
    isRecord(candidate) &&
    candidate['requiresSms'] === true &&
    typeof candidate['challengeToken'] === 'string' &&
    typeof candidate['message'] === 'string'
  ) {
    return {
      requiresSms: true,
      challengeToken: candidate['challengeToken'],
      message: candidate['message'],
    };
  }
  return null;
}

function parseBffAuth(candidate: Record<string, unknown> | null): LoginSuccessResponse | null {
  if (!isRecord(candidate)) return null;
  if ('token' in candidate || 'accessToken' in candidate) return null;

  const user = normalizeLoginUser(candidate['user']);
  if (user === null) return null;

  return {
    user,
    ...(typeof candidate['isNewDevice'] === 'boolean'
      ? { isNewDevice: candidate['isNewDevice'] }
      : {}),
  };
}

export function parseLoginResponse(value: unknown): LoginResponse {
  const raw = isRecord(value) ? value : null;
  const bffAuth = parseBffAuth(raw);
  if (bffAuth !== null) return bffAuth;

  const totpResult = totpLoginChallengeResponseSchema.safeParse(raw);
  if (totpResult.success) return totpResult.data;

  const smsResult = parseSmsChallenge(raw);
  if (smsResult !== null) return smsResult;

  const preview =
    raw !== null
      ? `keys=${Object.keys(raw).join(',')}${
          'user' in raw ? `; ${describeLoginUser(raw['user'])}` : ''
        }`
      : `type=${typeof value}`;
  throw new Error(`Invalid login response shape (${preview})`);
}
