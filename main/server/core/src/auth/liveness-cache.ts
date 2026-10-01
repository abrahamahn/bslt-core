// main/server/core/src/auth/liveness-cache.ts
/**
 * In-process TTL cache for the per-request auth "live check".
 *
 * The auth middleware verifies on every authenticated request that the user
 * is not suspended and that the token's version claim is current. Hitting the
 * users table for that on every request is the single hottest read in the
 * API, so the result is cached here briefly.
 *
 * Every mutation of the cached fields (token-version bump, lock/unlock,
 * hard ban, account deletion) MUST call {@link invalidateLiveness} so the
 * change takes effect immediately on this process. Other processes converge
 * within the TTL.
 *
 * @module liveness-cache
 */

/** Fields the live check reads from the user record. */
export interface LivenessRecord {
  tokenVersion: number;
  lockedUntil: Date | null;
  lockReason: string | null;
}

/**
 * Cache TTL. This is the upper bound on revocation latency for processes that
 * did not perform the mutation themselves: a lock or token-version bump is
 * enforced everywhere within 10 seconds, and same-tick on the mutating
 * process via invalidateLiveness().
 */
export const LIVENESS_TTL_MS = 10_000;

/** Hard cap on entries; the oldest insertion is evicted beyond this. */
const MAX_ENTRIES = 10_000;

interface CacheEntry {
  record: LivenessRecord;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Return the cached liveness record for a user, or null if absent/expired. */
export function getLiveness(userId: string): LivenessRecord | null {
  const entry = cache.get(userId);
  if (entry === undefined) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.record;
}

/** Cache a user's liveness fields for LIVENESS_TTL_MS. */
export function setLiveness(userId: string, record: LivenessRecord): void {
  // Delete-then-set keeps Map insertion order equal to write recency, so the
  // size-cap eviction below always removes the least recently written entry.
  cache.delete(userId);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(userId, { record, expiresAt: Date.now() + LIVENESS_TTL_MS });
}

/**
 * Drop a user's cached liveness record. Call this from every mutation that
 * must be enforced immediately: incrementTokenVersion, lockAccount,
 * unlockAccount, hard ban, and account deletion.
 */
export function invalidateLiveness(userId: string): void {
  cache.delete(userId);
}

/** Test hook: empty the cache. */
export function clearLivenessCache(): void {
  cache.clear();
}
