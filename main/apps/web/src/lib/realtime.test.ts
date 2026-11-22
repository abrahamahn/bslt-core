// main/apps/web/src/lib/realtime.test.ts
/**
 * Browser realtime invalidation transport tests (§8.6 single-use WS tickets + grants).
 */

vi.mock('@bslt/client-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/client-engine')>();
  return {
    ...actual,
    requestRealtimeTicket: vi.fn(),
  };
});

vi.mock('#app/app/authToken', () => ({
  getAccessToken: vi.fn(),
}));

import { requestRealtimeTicket } from '@bslt/client-engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRealtimeForTests, subscribeToKey } from './realtime';

import type { SubscriptionKey } from '@bslt/contract';

import { getAccessToken } from '#app/app/authToken';

const KEY = 'record:notifications:user-1' as SubscriptionKey;

/** A WebSocket stand-in whose lifecycle the test drives by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(
    readonly url: string,
    readonly protocols: string[] = [],
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

function lastSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error('no socket was opened');
  return socket;
}

/** Let the connect() promise chain settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('realtime transport', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.mocked(requestRealtimeTicket).mockResolvedValue({
      ticket: 'ticket-123.sig',
      grants: { [KEY]: 'grant-abc' },
      expiresAt: Date.now() + 30_000,
      anonymous: false,
    });
    vi.mocked(getAccessToken).mockReturnValue('aaa.bbb.ccc');
    vi.stubGlobal(
      'WebSocket',
      Object.assign(FakeSocket, { OPEN: 1, CLOSED: 3 }) as unknown as typeof WebSocket,
    );
  });

  afterEach(() => {
    resetRealtimeForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests a single-use ticket from @bslt/client-engine and never leaks JWT in Sec-WebSocket-Protocol', async () => {
    subscribeToKey(KEY, vi.fn());
    await flush();

    expect(vi.mocked(requestRealtimeTicket)).toHaveBeenCalledTimes(1);
    const socket = lastSocket();
    expect(socket.url).toContain('/ws?ticket=ticket-123.sig');
    expect(socket.protocols).toEqual([]);

    socket.emit('open');
    expect(socket.sent.map((s) => JSON.parse(s) as unknown)).toEqual([
      { type: 'subscribe', key: KEY, grant: 'grant-abc' },
    ]);
  });

  it('invokes the handler on an update frame for that key', async () => {
    const handler = vi.fn();
    subscribeToKey(KEY, handler);
    await flush();

    const socket = lastSocket();
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ type: 'update', key: KEY, version: 7 }) });

    expect(handler).toHaveBeenCalledWith(KEY, 7);
  });

  it('ignores frames for keys nobody subscribed to', async () => {
    const handler = vi.fn();
    subscribeToKey(KEY, handler);
    await flush();

    const socket = lastSocket();
    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify({
        type: 'update',
        key: 'record:notifications:someone-else',
        version: 1,
      }),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a malformed frame without throwing or notifying handlers', async () => {
    const handler = vi.fn();
    subscribeToKey(KEY, handler);
    await flush();

    const socket = lastSocket();
    socket.emit('open');
    expect(() => {
      socket.emit('message', { data: 'not json' });
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('re-subscribes every key with its signed grant after a reconnect', async () => {
    subscribeToKey(KEY, vi.fn());
    await flush();

    const first = lastSocket();
    first.emit('open');
    first.sent.length = 0;
    first.emit('open');

    expect(first.sent.map((s) => JSON.parse(s) as unknown)).toEqual([
      { type: 'subscribe', key: KEY, grant: 'grant-abc' },
    ]);
  });

  it('shares one socket across subscribers and closes it when the last leaves', async () => {
    const stopA = subscribeToKey(KEY, vi.fn());
    const stopB = subscribeToKey(KEY, vi.fn());
    await flush();

    expect(FakeSocket.instances).toHaveLength(1);
    const socket = lastSocket();
    socket.emit('open');

    stopA();
    expect(socket.closed).toBe(false);

    stopB();
    expect(socket.closed).toBe(true);
  });

  it('does not throw or open a socket when ticket issuance fails', async () => {
    vi.mocked(requestRealtimeTicket).mockRejectedValue(new Error('unauthorized'));

    expect(() => subscribeToKey(KEY, vi.fn())).not.toThrow();
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('does not open a socket when ticket response has null ticket for signed-in viewer', async () => {
    vi.mocked(requestRealtimeTicket).mockResolvedValue({
      ticket: null,
      grants: {},
      expiresAt: Date.now() + 30_000,
      anonymous: true,
    });

    subscribeToKey(KEY, vi.fn());
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('does not request a ticket or open a socket with a malformed access token', async () => {
    vi.mocked(getAccessToken).mockReturnValue('bad-token');

    subscribeToKey(KEY, vi.fn());
    await flush();

    expect(vi.mocked(requestRealtimeTicket)).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('quarantines a policy-rejected or revoked session token instead of reconnecting with it', async () => {
    vi.useFakeTimers();
    subscribeToKey(KEY, vi.fn());
    await flush();

    const socket = lastSocket();
    socket.emit('open');
    socket.emit('close', new CloseEvent('close', { code: 1008, reason: 'Session revoked' }));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.mocked(requestRealtimeTicket)).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
