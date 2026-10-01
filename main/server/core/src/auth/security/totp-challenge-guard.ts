// main/server/core/src/auth/security/totp-challenge-guard.ts
/**
 * Burned-TOTP-challenge tracker.
 *
 * A TOTP login challenge is a stateless 5-minute JWT, so there is nothing on it
 * to revoke: once minted, it stays valid until it expires no matter how many
 * wrong codes are thrown at it. The per-account rate limit (`totpVerify`, 5/min)
 * caps the guessing RATE, but "invalidate the token after the limit is hit" is a
 * second, deliberate step — a client that trips the limit should be sent back to
 * the password step, not left to keep hammering the same token once the minute
 * rolls over.
 *
 * This holds the small set of challenge ids (`jti`) that have been burned, each
 * with the expiry of the challenge it belongs to, so a burned id costs nothing
 * to remember beyond the token's own 5-minute life. It is in-memory, matching
 * the `AuthRateLimiter` it sits beside; a process restart only means a burned
 * challenge is honoured again until it expires — which the rate limit still
 * covers. A multi-instance deployment needs both moved behind a shared store.
 */

/** jti → the instant its underlying challenge expires (ms epoch). */
const burned = new Map<string, number>();

/** Drop entries whose challenge has already expired, so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [jti, expiresAt] of burned) {
    if (expiresAt <= now) burned.delete(jti);
  }
}

/**
 * Mark a challenge as spent. Further verification with the same token is refused
 * until it expires.
 *
 * @param jti - The challenge token's unique id
 * @param ttlMs - How long the challenge itself lives, so the record self-expires with it
 */
export function burnChallenge(jti: string, ttlMs: number): void {
  const now = Date.now();
  sweep(now);
  burned.set(jti, now + Math.max(0, ttlMs));
}

/** Whether this challenge has been burned and is still within its lifetime. */
export function isChallengeBurned(jti: string): boolean {
  const expiresAt = burned.get(jti);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    burned.delete(jti);
    return false;
  }
  return true;
}

/** Test-only: clear all burned challenges. */
export function resetBurnedChallenges(): void {
  burned.clear();
}
