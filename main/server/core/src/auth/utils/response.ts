// main/server/core/src/auth/utils/response.ts
/**
 * Authentication response utilities
 *
 * @module utils/response
 */

import { type AppRole } from '@bslt/shared/core/auth';
import { toISODateOnly, trimToNull } from '@bslt/shared/helpers';

import type { UserId } from '@bslt/shared/schema';

function normalizeNullableUrl(value: string | null | undefined): string | null {
  const normalized = trimToNull(value);
  if (normalized === null) return null;
  try {
    const parsed = new URL(normalized);
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Standard user object returned in authentication responses.
 * Uses branded `UserId` to match the domain `User` type from `@bslt/shared`.
 */
export interface AuthUser {
  /** User's unique identifier (branded) */
  id: UserId;
  /** User's email address */
  email: string;
  /** User's unique username — null for users without one (e.g. new OAuth users) */
  username: string | null;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** URL to user's avatar image */
  avatarUrl: string | null;
  /** User's role in the system */
  role: AppRole;
  /** Whether user's email is verified */
  emailVerified: boolean;
  /** User's phone number */
  phone: string | null;
  /** Whether user's phone is verified */
  phoneVerified: boolean | null;
  /** User's date of birth as ISO date string */
  dateOfBirth: string | null;
  /** User's gender */
  gender: string | null;
  /** User's bio/about text */
  bio: string | null;
  /** User's city */
  city: string | null;
  /** User's state/province */
  state: string | null;
  /** User's country */
  country: string | null;
  /** User's preferred language */
  language: string | null;
  /** User's website URL */
  website: string | null;
  /** ISO 8601 string of when the user was created */
  createdAt: string;
  /** ISO 8601 string of when the user was last updated */
  updatedAt: string;
  /** ISO 8601 timestamp when the account was deactivated; null while active */
  deactivatedAt: string | null;
  /** ISO 8601 timestamp when account deletion was requested; null otherwise */
  deletedAt: string | null;
  /** ISO 8601 timestamp when the deletion grace period ends; null otherwise */
  deletionGracePeriodEnds: string | null;
}

/**
 * Standard authentication response format.
 * Returned after successful login, registration, or token refresh.
 */
export interface AuthResponseData {
  /** JWT access token */
  accessToken: string;
  /** Opaque refresh token */
  refreshToken: string;
  /** Authenticated user data */
  user: AuthUser;
}

/** Loosely-typed user row accepted by the serializers (DB rows or domain users). */
export interface AuthUserInput {
  id: string;
  email: string;
  username: string | null;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  role: AppRole;
  emailVerified: boolean;
  phone?: string | null;
  phoneVerified?: boolean | null;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  bio?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  language?: string | null;
  website?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deactivatedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  deletionGracePeriodEnds?: Date | string | null;
}

/** Normalizes a nullable Date|string lifecycle timestamp into an ISO string or null. */
function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

/**
 * Normalizes a DB/domain user row into the public `AuthUser` shape returned by
 * the API (trimmed nullable text, ISO date strings, branded id).
 *
 * @complexity O(1)
 */
export function toAuthUser(user: AuthUserInput): AuthUser {
  const createdAt =
    typeof user.createdAt === 'string' ? user.createdAt : user.createdAt.toISOString();
  const updatedAt =
    typeof user.updatedAt === 'string' ? user.updatedAt : user.updatedAt.toISOString();
  const dateOfBirthRaw = user.dateOfBirth ?? null;
  const dateOfBirth =
    typeof dateOfBirthRaw === 'string' ? dateOfBirthRaw : toISODateOnly(dateOfBirthRaw);

  return {
    id: user.id as UserId,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: normalizeNullableUrl(user.avatarUrl),
    role: user.role,
    emailVerified: user.emailVerified,
    phone: trimToNull(user.phone),
    phoneVerified: user.phoneVerified ?? null,
    dateOfBirth,
    gender: trimToNull(user.gender),
    bio: trimToNull(user.bio),
    city: trimToNull(user.city),
    state: trimToNull(user.state),
    country: trimToNull(user.country),
    language: trimToNull(user.language),
    website: trimToNull(user.website),
    createdAt,
    updatedAt,
    deactivatedAt: toIsoOrNull(user.deactivatedAt),
    deletedAt: toIsoOrNull(user.deletedAt),
    deletionGracePeriodEnds: toIsoOrNull(user.deletionGracePeriodEnds),
  };
}

/**
 * Creates a standardized authentication response object.
 *
 * This encapsulates the common pattern of returning access token,
 * refresh token, and user information after successful authentication.
 *
 * @param accessToken - The JWT access token
 * @param refreshToken - The refresh token
 * @param user - The authenticated user data
 * @returns Standardized authentication response
 * @complexity O(1)
 */
export function createAuthResponse(
  accessToken: string,
  refreshToken: string,
  user: AuthUserInput,
): AuthResponseData {
  return { accessToken, refreshToken, user: toAuthUser(user) };
}
