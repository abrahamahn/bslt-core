// main/kernel/realtime/src/tickets.test.ts
import { describe, expect, it } from 'vitest';

import { createTicketStore, signChannelGrant, verifyChannelGrant } from './tickets';

const SECRET = 'realtime-ticket-hmac-secret-minimum-32-chars!';

describe('Single-use WS tickets and server-signed channel grants', () => {
  it('issues and redeems a valid ticket exactly once', () => {
    const store = createTicketStore({ ttlMs: 30_000 });
    const issued = store.issueTicket(
      SECRET,
      { userId: 'user-1', role: 'user', sessionId: 'sess-1', orgId: 'org-1' },
      1_700_000_000_000,
    );

    const redeemed = store.redeemTicket(SECRET, issued.ticket, 1_700_000_005_000);
    expect(redeemed).toEqual({
      userId: 'user-1',
      role: 'user',
      sessionId: 'sess-1',
      orgId: 'org-1',
    });

    // Replay of the same single-use ticket must fail closed!
    expect(store.redeemTicket(SECRET, issued.ticket, 1_700_000_006_000)).toBeNull();
  });

  it('rejects expired tickets, wrong secrets, tampered payloads, and malformed strings', () => {
    const store = createTicketStore({ ttlMs: 10_000 });
    const { ticket } = store.issueTicket(
      SECRET,
      { userId: 'user-1', role: 'user', sessionId: null, orgId: null },
      1_700_000_000_000,
    );

    // Expired
    expect(store.redeemTicket(SECRET, ticket, 1_700_000_010_001)).toBeNull();

    // Wrong secret
    const fresh = store.issueTicket(
      SECRET,
      { userId: 'user-1', role: 'user', sessionId: null, orgId: null },
      1_700_000_000_000,
    );
    expect(
      store.redeemTicket('wrong-secret-00000000000000000000', fresh.ticket, 1_700_000_001_000),
    ).toBeNull();

    // Tampered payload segment
    const [payloadPart, sigPart] = fresh.ticket.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ u: 'admin-99', r: 'admin', n: 'nonce', exp: 1_700_999_999_000 }),
      'utf8',
    ).toString('base64url');
    expect(
      store.redeemTicket(SECRET, `${forgedPayload}.${sigPart ?? ''}`, 1_700_000_001_000),
    ).toBeNull();
    expect(
      store.redeemTicket(SECRET, `${payloadPart ?? ''}.bad-sig`, 1_700_000_001_000),
    ).toBeNull();
    expect(store.redeemTicket(SECRET, 'garbage', 1_700_000_001_000)).toBeNull();
    expect(store.redeemTicket(SECRET, '', 1_700_000_001_000)).toBeNull();
  });

  it('signs and verifies channel grants bound to viewerKey, channel, and expiry', () => {
    const grant = signChannelGrant(SECRET, {
      viewerKey: 'user:user-1',
      channel: 'record:notifications:user-1',
      expiresAtMs: 1_700_000_060_000,
    });

    expect(
      verifyChannelGrant(SECRET, grant, {
        viewerKey: 'user:user-1',
        channel: 'record:notifications:user-1',
        nowMs: 1_700_000_030_000,
      }),
    ).toBe(true);

    // Channel swap fails closed
    expect(
      verifyChannelGrant(SECRET, grant, {
        viewerKey: 'user:user-1',
        channel: 'record:notifications:user-2',
        nowMs: 1_700_000_030_000,
      }),
    ).toBe(false);

    // Viewer swap fails closed
    expect(
      verifyChannelGrant(SECRET, grant, {
        viewerKey: 'user:user-2',
        channel: 'record:notifications:user-1',
        nowMs: 1_700_000_030_000,
      }),
    ).toBe(false);

    // Expired grant fails closed
    expect(
      verifyChannelGrant(SECRET, grant, {
        viewerKey: 'user:user-1',
        channel: 'record:notifications:user-1',
        nowMs: 1_700_000_060_001,
      }),
    ).toBe(false);

    // Tampered grant fails closed
    expect(
      verifyChannelGrant(SECRET, `${grant}x`, {
        viewerKey: 'user:user-1',
        channel: 'record:notifications:user-1',
        nowMs: 1_700_000_030_000,
      }),
    ).toBe(false);
  });
});
