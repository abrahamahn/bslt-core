// main/modules/identity/server/retention.ts
import { HARD_DELETE_DAYS } from '../contract';

import {
  ANONYMIZED_EMAIL_DOMAIN,
  identityRepository,
  type UpdateUser,
  type User,
} from './repository';

import type { DbClient } from '@bslt/db';
import type { Logger } from '@bslt/server-system/logger';

export { ANONYMIZED_EMAIL_DOMAIN };

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_UNVERIFIED_EXPIRY_DAYS = 7;
const FOREIGN_KEY_VIOLATION = '23503';

// ============================================================================
// 1. Soft-Delete & Anonymization Predicates / Builders
// ============================================================================

export function isUserDeleted(user: Pick<User, 'deletedAt'>): boolean {
  return user.deletedAt != null;
}

export function filterDeletedUsers<T extends Pick<User, 'deletedAt'>>(users: readonly T[]): T[] {
  return users.filter((user) => !isUserDeleted(user));
}

export interface PaginatedUsersResult<T extends Pick<User, 'deletedAt'>> {
  data: T[];
  total: number;
  page?: number | undefined;
  limit?: number | undefined;
  hasNext?: boolean | undefined;
  hasPrev?: boolean | undefined;
  totalPages?: number | undefined;
}

export function filterSoftDeletedFromResults<T extends Pick<User, 'deletedAt'>>(
  result: PaginatedUsersResult<T>,
): PaginatedUsersResult<T> {
  const activeUsers = result.data.filter((user) => !isUserDeleted(user));
  const removedCount = result.data.length - activeUsers.length;
  return {
    ...result,
    data: activeUsers,
    total: Math.max(0, result.total - removedCount),
  };
}

export function anonymizedEmailFor(userId: string): string {
  return `deleted-${userId}@${ANONYMIZED_EMAIL_DOMAIN}`;
}

export function isAnonymizedUser(user: Pick<User, 'id' | 'email'>): boolean {
  return user.email === anonymizedEmailFor(user.id);
}

export function isReservedAnonymizedEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return domain === ANONYMIZED_EMAIL_DOMAIN || domain.endsWith(`.${ANONYMIZED_EMAIL_DOMAIN}`);
}

export type AnonymizedUserFields = Required<
  Pick<
    UpdateUser,
    | 'email'
    | 'canonicalEmail'
    | 'username'
    | 'firstName'
    | 'lastName'
    | 'avatarUrl'
    | 'bio'
    | 'website'
    | 'language'
    | 'city'
    | 'state'
    | 'country'
    | 'phone'
    | 'phoneVerified'
    | 'dateOfBirth'
    | 'gender'
    | 'lockReason'
  >
>;

export function anonymizedUserFields(userId: string): AnonymizedUserFields {
  const email = anonymizedEmailFor(userId);
  return {
    email,
    canonicalEmail: email,
    username: null,
    firstName: 'Deleted',
    lastName: 'User',
    avatarUrl: null,
    bio: null,
    website: null,
    language: null,
    city: null,
    state: null,
    country: null,
    phone: null,
    phoneVerified: null,
    dateOfBirth: null,
    gender: null,
    lockReason: null,
  };
}

export const RETAINED_USER_FIELDS = [
  'id',
  'role',
  'passwordHash',
  'totpSecret',
  'totpEnabled',
  'tokenVersion',
  'emailVerified',
  'emailVerifiedAt',
  'lockedUntil',
  'failedLoginAttempts',
  'eligibilityAttestedAt',
  'eligibilityAttestationVersion',
  'lastUsernameChange',
  'deactivatedAt',
  'deletedAt',
  'deletionGracePeriodEnds',
  'createdAt',
  'updatedAt',
  'version',
] as const satisfies ReadonlyArray<keyof User>;

// ============================================================================
// 2. Anonymize, Purge & Unverified Sweeps
// ============================================================================

export interface AnonymizeResult {
  anonymizedCount: number;
  failedCount: number;
}

export interface HardDeleteResult {
  purgedCount: number;
  blockedCount: number;
  failedCount: number;
}

export interface CleanupResult {
  deletedCount: number;
}

export interface UserRetentionResult extends AnonymizeResult, HardDeleteResult {
  unverifiedDeletedCount: number;
}

interface BatchOptions {
  batchSize?: number;
}

class PurgeBlockedError extends Error {
  constructor() {
    super('The user, or a tenant it owns, gained a row that blocks the purge');
    this.name = 'PurgeBlockedError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function forEachKeysetBatch(
  fetchBatch: (cursor: string | null) => Promise<string[]>,
  batchSize: number,
  visit: (id: string) => Promise<void>,
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const batch = await fetchBatch(cursor);
    for (const id of batch) {
      await visit(id);
    }
    const last = batch[batch.length - 1];
    if (batch.length < batchSize || last === undefined) {
      return;
    }
    cursor = last;
  }
}

export async function anonymizeExpiredUsers(
  db: DbClient,
  log: Logger,
  options: BatchOptions = {},
): Promise<AnonymizeResult> {
  const repo = identityRepository(db);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const result: AnonymizeResult = { anonymizedCount: 0, failedCount: 0 };

  await forEachKeysetBatch(
    (cursor) => repo.selectDueAnonymizationBatch(cursor, batchSize),
    batchSize,
    async (userId) => {
      try {
        const updated = await repo.anonymizeDueUserRow(userId, anonymizedUserFields(userId));
        if (updated > 0) {
          result.anonymizedCount++;
        }
      } catch (error) {
        result.failedCount++;
        log.error({ userId, error: errorMessage(error) }, 'Failed to anonymize a deleted user');
      }
    },
  );

  return result;
}

async function purgeSingleUser(
  db: DbClient,
  userId: string,
  retentionDays: number,
): Promise<'purged' | 'blocked' | 'skipped'> {
  return db.transaction(async (tx) => {
    const repo = identityRepository(tx);
    const due = await repo.lockDuePurgeUserForUpdate(userId, retentionDays);
    if (!due) {
      return 'skipped';
    }

    if (await repo.userOwnsBillingOrg(userId)) {
      return 'blocked';
    }

    const owned = await repo.listOwnedOrgsShareStatus(userId);
    if (owned.some((org) => org.shared)) {
      return 'blocked';
    }

    for (const org of owned) {
      const removed = await repo.deleteUnsharedOwnedOrg(userId, org.id);
      if (removed === 0) {
        throw new PurgeBlockedError();
      }
    }

    try {
      await repo.hardDeleteUserById(userId);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === FOREIGN_KEY_VIOLATION) {
        throw new PurgeBlockedError();
      }
      throw error;
    }

    return 'purged';
  });
}

export async function hardDeleteAnonymizedUsers(
  db: DbClient,
  log: Logger,
  options: BatchOptions & { retentionDays?: number } = {},
): Promise<HardDeleteResult> {
  const repo = identityRepository(db);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const retentionDays = options.retentionDays ?? HARD_DELETE_DAYS;
  const result: HardDeleteResult = { purgedCount: 0, blockedCount: 0, failedCount: 0 };

  await forEachKeysetBatch(
    (cursor) => repo.selectDuePurgeBatch(cursor, retentionDays, batchSize),
    batchSize,
    async (userId) => {
      try {
        const outcome = await purgeSingleUser(db, userId, retentionDays);
        if (outcome === 'purged') {
          result.purgedCount++;
        } else if (outcome === 'blocked') {
          result.blockedCount++;
          log.debug(
            { userId },
            "Purge blocked: the user has billing rows, or owns a tenant with other users' rows",
          );
        }
      } catch (error) {
        if (error instanceof PurgeBlockedError) {
          result.blockedCount++;
          return;
        }
        result.failedCount++;
        log.error({ userId, error: errorMessage(error) }, 'Failed to purge an anonymized user');
      }
    },
  );

  return result;
}

export async function cleanupUnverifiedUsers(
  db: DbClient,
  log: Logger,
  expiryDays: number = DEFAULT_UNVERIFIED_EXPIRY_DAYS,
): Promise<CleanupResult> {
  const repo = identityRepository(db);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - expiryDays);

  const candidates = await repo.findUnverifiedUsersBefore(cutoff);
  let deletedCount = 0;

  for (const user of candidates) {
    const oauthCount = await repo.countOAuthConnectionsByUserId(user.id);
    if (oauthCount > 0) {
      continue;
    }
    const sessionCount = await repo.countActiveSessionsByUserId(user.id);
    if (sessionCount > 0) {
      continue;
    }
    const deleted = await repo.hardDeleteUserById(user.id);
    if (deleted > 0) {
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    log.info({ deletedCount }, 'Unverified user cleanup completed');
  } else {
    log.debug('Unverified user cleanup: no users to clean up');
  }

  return { deletedCount };
}

export async function runUserRetention(db: DbClient, log: Logger): Promise<UserRetentionResult> {
  const result: UserRetentionResult = {
    anonymizedCount: 0,
    purgedCount: 0,
    blockedCount: 0,
    failedCount: 0,
    unverifiedDeletedCount: 0,
  };

  const steps: ReadonlyArray<readonly [step: string, run: () => Promise<void>]> = [
    [
      'anonymize',
      async () => {
        const anonymized = await anonymizeExpiredUsers(db, log);
        result.anonymizedCount += anonymized.anonymizedCount;
        result.failedCount += anonymized.failedCount;
      },
    ],
    [
      'purge',
      async () => {
        const purged = await hardDeleteAnonymizedUsers(db, log);
        result.purgedCount += purged.purgedCount;
        result.blockedCount += purged.blockedCount;
        result.failedCount += purged.failedCount;
      },
    ],
    [
      'unverified-cleanup',
      async () => {
        const cleaned = await cleanupUnverifiedUsers(db, log);
        result.unverifiedDeletedCount += cleaned.deletedCount;
      },
    ],
  ];

  for (const [step, run] of steps) {
    try {
      await run();
    } catch (error) {
      result.failedCount++;
      log.error({ step, error: errorMessage(error) }, 'User retention step failed');
    }
  }

  if (Object.values(result).some((count) => count > 0)) {
    log.info({ ...result }, 'User retention completed');
  } else {
    log.debug('User retention: nothing to do');
  }

  return result;
}
