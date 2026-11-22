// main/kernel/realtime/src/hub.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createRealtimeHub, type HubSocket } from './hub';

function makeSocket(bufferedAmount = 0): HubSocket & {
  sent: Array<Record<string, unknown>>;
  closedWith: { code: number; reason: string } | null;
  bufferedAmount: number;
} {
  const sent: Array<Record<string, unknown>> = [];
  const sock = {
    readyState: 1,
    bufferedAmount,
    sent,
    closedWith: null as { code: number; reason: string } | null,
    send: vi.fn((raw: string) => {
      sent.push(JSON.parse(raw) as Record<string, unknown>);
    }),
    close: vi.fn((code = 1000, reason = '') => {
      sock.readyState = 3;
      sock.closedWith = { code, reason };
    }),
  };
  return sock;
}

describe('RealtimeHub (sequenced frames, invalidation, presence, slow-consumer & caps)', () => {
  it('delivers monotonic sequenced payload frames, bounded history replay, and invalidations', () => {
    const hub = createRealtimeHub({ maxHistoryPerChannel: 2 });
    const sock = makeSocket();

    expect(hub.subscribe('user:u1', sock)).toBe(true);
    const f1 = hub.publishFrame('user:u1', { kind: 'ping', n: 1 });
    const f2 = hub.publishFrame('user:u1', { kind: 'ping', n: 2 });
    const f3 = hub.publishFrame('user:u1', { kind: 'ping', n: 3 });

    expect([f1.seq, f2.seq, f3.seq]).toEqual([1, 2, 3]);
    expect(sock.sent).toHaveLength(3);
    expect(sock.sent[2]).toMatchObject({
      type: 'frame',
      channel: 'user:u1',
      seq: 3,
      payload: { kind: 'ping', n: 3 },
    });

    // Bounded ring buffer keeps last 2 frames (seq 2 and 3)
    const replayed = hub.replayFrames('user:u1', 0);
    expect(replayed.map((f) => f.seq)).toEqual([2, 3]);

    hub.publishInvalidation('user:u1', 42);
    expect(sock.sent[3]).toMatchObject({
      type: 'update',
      key: 'user:u1',
      version: 42,
    });
  });

  it('tracks channel presence across join, leave, and socket cleanup', () => {
    const hub = createRealtimeHub();
    const sockA = makeSocket();
    const sockB = makeSocket();

    hub.subscribe('public:status', sockA);
    hub.subscribe('public:status', sockB);

    hub.joinPresence('public:status', sockA, { id: 'u-a', metadata: { tab: 1 } });
    hub.joinPresence('public:status', sockB, { id: 'u-b' });

    expect(hub.getPresence('public:status').map((m) => m.id)).toEqual(['u-a', 'u-b']);

    hub.cleanupSocket(sockA);
    expect(hub.getPresence('public:status').map((m) => m.id)).toEqual(['u-b']);

    hub.leavePresence('public:status', sockB);
    expect(hub.getPresence('public:status')).toEqual([]);
  });

  it('closes slow consumers whose bufferedAmount exceeds maxBufferedBytes with 1008', () => {
    const hub = createRealtimeHub({ maxBufferedBytes: 1024 });
    const fast = makeSocket(0);
    const slow = makeSocket(2048);

    hub.subscribe('user:u1', fast);
    hub.subscribe('user:u1', slow);

    hub.publishFrame('user:u1', { text: 'burst' });

    expect(fast.sent).toHaveLength(1);
    expect(slow.sent).toHaveLength(0);
    expect(slow.closedWith).toEqual({ code: 1008, reason: 'Slow consumer' });
  });

  it('enforces maxSubscriptionsPerSocket and inbound message rate limits', () => {
    const hub = createRealtimeHub({
      maxSubscriptionsPerSocket: 2,
      maxMessagesPerWindow: 3,
      rateLimitWindowMs: 10_000,
    });
    const sock = makeSocket();

    expect(hub.subscribe('ch:1', sock)).toBe(true);
    expect(hub.subscribe('ch:2', sock)).toBe(true);
    expect(hub.subscribe('ch:3', sock)).toBe(false);

    expect(hub.allowInboundMessage(sock, 1000)).toBe(true);
    expect(hub.allowInboundMessage(sock, 1001)).toBe(true);
    expect(hub.allowInboundMessage(sock, 1002)).toBe(true);
    expect(hub.allowInboundMessage(sock, 1003)).toBe(false);
    expect(sock.closedWith).toEqual({ code: 1008, reason: 'Rate limit exceeded' });
  });
});
