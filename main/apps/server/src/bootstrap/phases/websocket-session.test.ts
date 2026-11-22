// main/apps/server/src/bootstrap/phases/websocket-session.test.ts
/**
 * The WebSocket session check is what ends a socket when HTTP access ends.
 * Each refusal below is a way a socket used to outlive its session.
 */

import { describe, expect, it, vi } from 'vitest';

import { createWebSocketSessionVerifier } from './websocket-session';

const USER_ID = '11111111-1111-4111-8111-111111111111';

interface LivenessRow {
  tokenVersion: number;
  lockedUntil: Date | null;
  lockReason: string | null;
}

function usersReturning(row: LivenessRow | null) {
  return { findById: vi.fn((_id: string): Promise<LivenessRow | null> => Promise.resolve(row)) };
}

function claims(extra: Record<string, unknown> = {}) {
  return { userId: USER_ID, email: 'user@example.test', role: 'user' as const, ...extra };
}

const live: LivenessRow = { tokenVersion: 3, lockedUntil: null, lockReason: null };

describe('createWebSocketSessionVerifier', () => {
  it('accepts a live user whose token version is current', async () => {
    const users = usersReturning(live);

    await expect(
      createWebSocketSessionVerifier(users)(claims({ tokenVersion: 3 })),
    ).resolves.toBeUndefined();
    expect(users.findById).toHaveBeenCalledWith(USER_ID);
  });

  it('refuses a token issued before a token-version bump (log out everywhere, password change)', async () => {
    const verify = createWebSocketSessionVerifier(usersReturning({ ...live, tokenVersion: 4 }));

    await expect(verify(claims({ tokenVersion: 3 }))).rejects.toThrow('Token revoked');
  });

  it('refuses a locked account', async () => {
    const verify = createWebSocketSessionVerifier(
      usersReturning({ ...live, lockedUntil: new Date(Date.now() + 60_000), lockReason: 'abuse' }),
    );

    await expect(verify(claims({ tokenVersion: 3 }))).rejects.toThrow('Account locked');
  });

  it('refuses a user that no longer exists', async () => {
    const verify = createWebSocketSessionVerifier(usersReturning(null));

    await expect(verify(claims({ tokenVersion: 3 }))).rejects.toThrow('User not found');
  });

  it('fails closed when the lookup itself fails', async () => {
    const verify = createWebSocketSessionVerifier({
      findById: vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED'))),
    });

    await expect(verify(claims({ tokenVersion: 3 }))).rejects.toThrow('ECONNREFUSED');
  });

  it('still checks lock and existence for a token that carries no version claim', async () => {
    await expect(
      createWebSocketSessionVerifier(usersReturning(live))(claims()),
    ).resolves.toBeUndefined();
    await expect(createWebSocketSessionVerifier(usersReturning(null))(claims())).rejects.toThrow();
  });

  it('treats a non-numeric version claim as absent, exactly as the HTTP auth guard does', async () => {
    // A string claim is not a version: it is ignored (lock and existence are
    // still checked), never coerced into equality with the stored number.
    const verify = createWebSocketSessionVerifier(usersReturning({ ...live, tokenVersion: 4 }));

    await expect(verify(claims({ tokenVersion: '4' }))).resolves.toBeUndefined();
    await expect(verify(claims({ tokenVersion: 3 }))).rejects.toThrow('Token revoked');
  });
});
