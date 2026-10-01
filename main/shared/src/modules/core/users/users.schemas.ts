// main/shared/src/modules/core/users/users.schemas.ts

/**
 * @file User Schemas
 * @description Schemas and types for user profiles, sessions, and settings.
 * @module Core/Users
 */

import { APP_ROLES } from '../../../constants/core';
import {
  createSchema,
  parseBoolean,
  parseNullable,
  parseNullableOptional,
  parseNumber,
  parseOptional,
  parseString,
} from '../../../schema';
import { userIdSchema } from '../../../schema/ids';
import { appRoleSchema } from '../auth/roles';
import { emailSchema, isoDateTimeSchema, passwordSchema } from '../schemas';

import type { Schema } from '../../../schema';
import type { UserId } from '../../../schema/ids';
import type { AppRole } from '../auth/roles';

// ============================================================================
// Shared Types
// ============================================================================

export const USER_ROLES = APP_ROLES;
export const userRoleSchema = appRoleSchema;
export type UserRole = AppRole;

// ============================================================================
// Types
// ============================================================================

/** Full user entity (API-facing, ISO date strings) */
export interface User {
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
  bio?: string | null | undefined;
  /** User's city */
  city?: string | null | undefined;
  /** User's state/province */
  state?: string | null | undefined;
  /** User's country */
  country?: string | null | undefined;
  /** User's preferred language */
  language?: string | null | undefined;
  /** User's website URL */
  website?: string | null | undefined;
  /** ISO 8601 string of when the user was created */
  createdAt: string;
  /** ISO 8601 string of when the user was last updated */
  updatedAt: string;
  /** ISO 8601 timestamp when the account was deactivated; null/absent while active */
  deactivatedAt?: string | null | undefined;
  /** ISO 8601 timestamp when account deletion was requested; null/absent otherwise */
  deletedAt?: string | null | undefined;
  /** ISO 8601 timestamp when the deletion grace period ends; null/absent otherwise */
  deletionGracePeriodEnds?: string | null | undefined;
}

/** Update profile request */
export interface UpdateProfileRequest {
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  phone?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
  gender?: string | null | undefined;
  bio?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | null | undefined;
  language?: string | null | undefined;
  website?: string | null | undefined;
}

/** Display labels for profile completeness fields, keyed by user field name. */
export const PROFILE_FIELD_LABELS: Readonly<Record<string, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  avatarUrl: 'Profile photo',
  bio: 'Bio',
  city: 'City',
  state: 'State',
  country: 'Country',
  language: 'Language',
  website: 'Website',
  phone: 'Phone',
};

/** User fields counted toward profile completeness. */
export const PROFILE_COMPLETENESS_FIELDS: readonly string[] = Object.keys(PROFILE_FIELD_LABELS);

/** Map a raw profile field name to its display label; falls back to the raw name. */
export const getProfileFieldLabel = (field: string): string => PROFILE_FIELD_LABELS[field] ?? field;

/** Full name from first/last name, falling back to username; empty string when neither is set. */
export const getUserDisplayName = (user: {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  username?: string | null | undefined;
}): string => {
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name.length > 0 ? name : (user.username?.trim() ?? '');
};

/** Profile completeness response */
export interface ProfileCompletenessResponse {
  /** Percentage of profile fields that are filled (0-100) */
  percentage: number;
  /** List of field names that are not yet filled */
  missingFields: string[];
}

/** Change password request */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Change password response */
export interface ChangePasswordResponse {
  success: boolean;
  message: string;
}

/** Avatar upload response */
export interface AvatarUploadResponse {
  avatarUrl: string;
}

/** Avatar upload request body after multipart parser normalization */
export interface AvatarUploadRequest {
  buffer: Uint8Array;
  mimetype: string;
  size?: number | undefined;
}

/** Avatar delete response */
export interface AvatarDeleteResponse {
  success: boolean;
}

/** Session entity */
export interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  device: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}

/** Sessions list response */
export interface SessionsListResponse {
  sessions: Session[];
}

/** Revoke session response */
export interface RevokeSessionResponse {
  success: boolean;
}

/** Revoke all sessions response */
export interface RevokeAllSessionsResponse {
  success: boolean;
  revokedCount: number;
}

// ============================================================================
// User & Profile Schemas
// ============================================================================

export const userSchema: Schema<User> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: userIdSchema.parse(obj['id']),
    email: emailSchema.parse(obj['email']),
    username: parseNullable(obj['username'], (v) => parseString(v, 'username')),
    firstName: parseString(obj['firstName'], 'firstName'),
    lastName: parseString(obj['lastName'], 'lastName'),
    avatarUrl: parseNullable(obj['avatarUrl'], (v) => parseString(v, 'avatarUrl', { url: true })),
    role: appRoleSchema.parse(obj['role']),
    emailVerified: parseBoolean(obj['emailVerified'], 'emailVerified'),
    phone: parseNullable(obj['phone'], (v) => parseString(v, 'phone')),
    phoneVerified: parseNullable(obj['phoneVerified'], (v) => parseBoolean(v, 'phoneVerified')),
    dateOfBirth: parseNullable(obj['dateOfBirth'], (v) => parseString(v, 'dateOfBirth')),
    gender: parseNullable(obj['gender'], (v) => parseString(v, 'gender')),
    bio: parseNullableOptional(obj['bio'], (v) => parseString(v, 'bio')),
    city: parseNullableOptional(obj['city'], (v) => parseString(v, 'city')),
    state: parseNullableOptional(obj['state'], (v) => parseString(v, 'state')),
    country: parseNullableOptional(obj['country'], (v) => parseString(v, 'country')),
    language: parseNullableOptional(obj['language'], (v) => parseString(v, 'language')),
    website: parseNullableOptional(obj['website'], (v) => parseString(v, 'website')),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
    deactivatedAt: parseNullableOptional(obj['deactivatedAt'], (v) => isoDateTimeSchema.parse(v)),
    deletedAt: parseNullableOptional(obj['deletedAt'], (v) => isoDateTimeSchema.parse(v)),
    deletionGracePeriodEnds: parseNullableOptional(obj['deletionGracePeriodEnds'], (v) =>
      isoDateTimeSchema.parse(v),
    ),
  };
});

export const updateProfileRequestSchema: Schema<UpdateProfileRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      firstName: parseOptional(obj['firstName'], (v) =>
        parseString(v, 'firstName', { min: 1, max: 100 }),
      ),
      lastName: parseOptional(obj['lastName'], (v) =>
        parseString(v, 'lastName', { min: 1, max: 100 }),
      ),
      email: parseOptional(obj['email'], (v) => emailSchema.parse(v)),
      phone: parseNullableOptional(obj['phone'], (v) => parseString(v, 'phone')),
      dateOfBirth: parseNullableOptional(obj['dateOfBirth'], (v) => parseString(v, 'dateOfBirth')),
      gender: parseNullableOptional(obj['gender'], (v) => parseString(v, 'gender')),
      bio: parseNullableOptional(obj['bio'], (v) => parseString(v, 'bio', { max: 500 })),
      city: parseNullableOptional(obj['city'], (v) => parseString(v, 'city', { max: 100 })),
      state: parseNullableOptional(obj['state'], (v) => parseString(v, 'state', { max: 100 })),
      country: parseNullableOptional(obj['country'], (v) =>
        parseString(v, 'country', { max: 100 }),
      ),
      language: parseNullableOptional(obj['language'], (v) =>
        parseString(v, 'language', { max: 100 }),
      ),
      website: parseNullableOptional(obj['website'], (v) =>
        parseString(v, 'website', { url: true }),
      ),
    };
  },
);

export const profileCompletenessResponseSchema: Schema<ProfileCompletenessResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      percentage: parseNumber(obj['percentage'], 'percentage'),
      missingFields: Array.isArray(obj['missingFields'])
        ? obj['missingFields'].map((item: unknown) => parseString(item, 'missingFields[]'))
        : ((): never => {
            throw new Error('missingFields must be an array');
          })(),
    };
  },
);

// ============================================================================
// Security & Password Schemas
// ============================================================================

export const changePasswordRequestSchema: Schema<ChangePasswordRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      currentPassword: parseString(obj['currentPassword'], 'currentPassword', { min: 1 }),
      newPassword: passwordSchema.parse(obj['newPassword']),
    };
  },
);

export const changePasswordResponseSchema: Schema<ChangePasswordResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      success: parseBoolean(obj['success'], 'success'),
      message: parseString(obj['message'], 'message'),
    };
  },
);

// ============================================================================
// Avatar Schemas
// ============================================================================

export const avatarUploadResponseSchema: Schema<AvatarUploadResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      avatarUrl: parseString(obj['avatarUrl'], 'avatarUrl'),
    };
  },
);

export const avatarUploadRequestSchema: Schema<AvatarUploadRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const rawBuffer = obj['buffer'];
    let buffer: Uint8Array;

    if (rawBuffer instanceof Uint8Array) {
      buffer = rawBuffer;
    } else if (
      Array.isArray(rawBuffer) &&
      rawBuffer.every((value) => typeof value === 'number' && value >= 0 && value <= 255)
    ) {
      buffer = Uint8Array.from(rawBuffer);
    } else {
      throw new Error('buffer must be a Uint8Array');
    }

    return {
      buffer,
      mimetype: parseString(obj['mimetype'], 'mimetype', { min: 1 }),
      size: parseOptional(obj['size'], (v) => parseNumber(v, 'size', { int: true, min: 0 })),
    };
  },
);

export const avatarDeleteResponseSchema: Schema<AvatarDeleteResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      success: parseBoolean(obj['success'], 'success'),
    };
  },
);

// ============================================================================
// Session Schemas
// ============================================================================

export const sessionSchema: Schema<Session> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: parseString(obj['id'], 'id', { uuid: true }),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    expiresAt: isoDateTimeSchema.parse(obj['expiresAt']),
    lastUsedAt: isoDateTimeSchema.parse(obj['lastUsedAt']),
    device: parseNullable(obj['device'], (v) => parseString(v, 'device')),
    ipAddress: parseNullable(obj['ipAddress'], (v) => parseString(v, 'ipAddress')),
    userAgent: parseNullable(obj['userAgent'], (v) => parseString(v, 'userAgent')),
    isCurrent: parseBoolean(obj['isCurrent'], 'isCurrent'),
  };
});

export const sessionsListResponseSchema: Schema<SessionsListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!Array.isArray(obj['sessions'])) {
      throw new Error('sessions must be an array');
    }
    const sessions = obj['sessions'].map((item: unknown) => sessionSchema.parse(item));

    return { sessions };
  },
);

export const revokeSessionResponseSchema: Schema<RevokeSessionResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      success: parseBoolean(obj['success'], 'success'),
    };
  },
);

export const revokeAllSessionsResponseSchema: Schema<RevokeAllSessionsResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      success: parseBoolean(obj['success'], 'success'),
      revokedCount: parseNumber(obj['revokedCount'], 'revokedCount'),
    };
  },
);
