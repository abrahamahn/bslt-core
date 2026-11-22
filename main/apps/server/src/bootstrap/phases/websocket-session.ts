// main/apps/server/src/bootstrap/phases/websocket-session.ts
/**
 * Session liveness for WebSocket connections.
 *
 * The realtime package verifies a socket's JWT signature itself but cannot know
 * whether the session behind it still stands; that needs the users table. This
 * is the same live check the HTTP auth guard runs — token version current,
 * account not locked, user still present — handed to the realtime package as
 * its `verifySession`, which runs it at connect and on every recheck and closes
 * the socket when it rejects.
 *
 * It imports nothing from `@bslt/realtime`, so it compiles whether or not that
 * optional capability is installed.
 */

import { assertUserActive } from '@bslt/identity/server';

import type { TokenClaims } from '@bslt/realtime';

/** The user fields the live check reads; `Repositories['users']` satisfies this. */
interface SessionUserLookup {
  findById(id: string): Promise<{
    tokenVersion: number;
    lockedUntil: Date | null;
    lockReason: string | null;
  } | null>;
}

/**
 * Build the WebSocket session check over the users repository.
 *
 * @param users - Repository used to read the user's current token version and lock state
 * @returns Function that resolves while the session is live and rejects once it is not
 * @complexity O(1) per call: one user lookup
 */
export function createWebSocketSessionVerifier(
  users: SessionUserLookup,
): (claims: TokenClaims) => Promise<void> {
  return (claims) =>
    assertUserActive(
      (id) => users.findById(id),
      claims.userId,
      undefined,
      typeof claims['tokenVersion'] === 'number' ? claims['tokenVersion'] : undefined,
    );
}
