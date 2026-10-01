// main/server/core/src/users/service.ts
/**
 * User Service
 *
 * Pure business logic for user operations.
 * No HTTP awareness - returns domain objects or throws errors.
 *
 * @module service
 */

import { type UserRole } from '@bslt/shared/core/users';
import { toISODateOnly } from '@bslt/shared/helpers';

import type { UserRepository } from '@bslt/db/repositories';

// ============================================================================
// Types
// ============================================================================

/**
 * Domain user object returned from service functions.
 * Excludes sensitive fields like passwordHash.
 */
export interface User {
  /** User's unique identifier */
  id: string;
  /** User's email address */
  email: string;
  /** User's unique username — null for users without one */
  username: string | null;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** URL to user's avatar image */
  avatarUrl: string | null;
  /** User's role (user, admin, moderator) */
  role: UserRole;
  /** Whether user's email is verified */
  emailVerified: boolean;
  /** User's phone number */
  phone: string | null;
  /** Whether phone is verified */
  phoneVerified: boolean | null;
  /** Date of birth (ISO date string) */
  dateOfBirth: string | null;
  /** Gender (free text) */
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
  /** Date when the user was created */
  createdAt: Date;
  /** Date when the user was last updated */
  updatedAt: Date;
  /** When the account was deactivated; null while active */
  deactivatedAt?: Date | null;
  /** When account deletion was requested; null otherwise */
  deletedAt?: Date | null;
  /** When the deletion grace period ends; null otherwise */
  deletionGracePeriodEnds?: Date | null;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get a user by their ID.
 * Returns null if user not found.
 *
 * @param userRepo - User repository instance
 * @param userId - ID of the user to fetch
 * @returns User domain object or null if not found
 * @complexity O(1) - single database lookup
 */
export async function getUserById(userRepo: UserRepository, userId: string): Promise<User | null> {
  const user = await userRepo.findById(userId);

  if (user === null) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    emailVerified: user.emailVerified,
    phone: user.phone ?? null,
    phoneVerified: user.phoneVerified,
    dateOfBirth: toISODateOnly(user.dateOfBirth),
    gender: user.gender ?? null,
    bio: user.bio ?? null,
    city: user.city ?? null,
    state: user.state ?? null,
    country: user.country ?? null,
    language: user.language ?? null,
    website: user.website ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deactivatedAt: user.deactivatedAt,
    deletedAt: user.deletedAt,
    deletionGracePeriodEnds: user.deletionGracePeriodEnds,
  };
}
