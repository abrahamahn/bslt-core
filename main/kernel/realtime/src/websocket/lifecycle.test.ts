// main/kernel/realtime/src/websocket/lifecycle.test.ts
import { EventEmitter } from 'node:events';

import { AUTH_CONSTANTS } from '@bslt/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTicketStore, signChannelGrant } from '../tickets';

import { registerWebSocket, type WebSocketDeps } from './lifecycle';
import { getWebSocketStats, resetStats } from './stats';

import type { WsConnection } from '@bslt/protocols/ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const { WS_CLOSE_POLICY_VIOLATION } = AUTH_CONSTANTS;
const JWT_SECRET = 'test-jwt-secret-minimum-32-chars-ok!';

const { mockValidateCsrfToken } = vi.hoisted(() => ({
  mockValidateCsrfToken: vi.fn(() => true),
}));

vi.mock('@bslt/server-system/security', () => ({
  validateCsrfToken: mockValidateCsrfToken,
}));

interface FakeWsConn {
  readyState: number;
  bufferedAmount: number;
  sent: string[];
  pingCount: number;
  terminated: boolean;
  closedWith: { code: number; reason: string } | null;
  emit(event: string, ...args: unknown[]): void;
  asWsConnection(): WsConnection;
}

function createFakeWsConn(): FakeWsConn {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const state: FakeWsConn = {
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    pingCount: 0,
    terminated: false,
    closedWith: null,
    emit(event: string, ...args: unknown[]): void {
      for (const fn of [...(listeners.get(event) ?? [])]) {
        fn(...args);
      }
    },
    asWsConnection(): WsConnection {
      const obj = {
        get readyState(): number {
          return state.readyState;
        },
        get bufferedAmount(): number {
          return state.bufferedAmount;
        },
        protocol: null,
        on(event: string, fn: (...args: unknown[]) => void) {
          let set = listeners.get(event);
          if (set === undefined) {
            set = new Set();
            listeners.set(event, set);
          }
          set.add(fn);
          return obj;
        },
        once(event: string, fn: (...args: unknown[]) => void) {
          const wrap = (...args: unknown[]): void => {
            listeners.get(event)?.delete(wrap);
            fn(...args);
          };
          let set = listeners.get(event);
          if (set === undefined) {
            set = new Set();
            listeners.set(event, set);
          }
          set.add(wrap);
          return obj;
        },
        send(data: string | Uint8Array): void {
          state.sent.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
        },
        ping(): void {
          state.pingCount += 1;
        },
        pong(): void {},
        close(code = 1000, reason = ''): void {
          if (state.readyState === 3) return;
          state.readyState = 3;
          state.closedWith = { code, reason };
          state.emit('close', code, reason);
        },
        terminate(): void {
          state.readyState = 3;
          state.terminated = true;
          state.emit('close', 1006, '');
        },
        feedInitialHead(): void {},
      };
      return obj as unknown as WsConnection;
    },
  };
  return state;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('WebSocket Lifecycle over @bslt/protocols/ws (Plan §8.6)', () => {
  let verifyTokenMock: ReturnType<typeof vi.fn>;
  let verifySessionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStats();
    mockValidateCsrfToken.mockReturnValue(true);
    verifyTokenMock = vi.fn(() => ({
      userId: 'cookie-user',
      role: 'user',
      sessionId: 'sess-cookie',
    }));
    verifySessionMock = vi.fn(() => Promise.resolve());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetStats();
  });

  function setupGateway(overrides: Partial<WebSocketDeps> = {}) {
    const serverEmitter = new EventEmitter();
    const ticketStore = createTicketStore({ ttlMs: 30_000 });
    const upgradedConns: FakeWsConn[] = [];

    const ctx: WebSocketDeps = {
      db: { queryOne: vi.fn().mockResolvedValue({ version: 9 }) },
      pubsub: {
        handleMessage: vi.fn(),
        cleanup: vi.fn(),
      },
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      config: {
        env: 'test',
        auth: {
          jwt: { secret: JWT_SECRET },
          cookie: { secret: 'cookie-secret-minimum-32-characters!!' },
        },
      },
      ticketStore,
      resolveTableName: (t) => (t === 'notifications' ? 'notifications' : undefined),
      ...overrides,
    };

    const gateway = registerWebSocket({ server: serverEmitter as never }, ctx, {
      verifyToken: verifyTokenMock,
      verifySession: verifySessionMock,
      upgradeImpl: () => {
        const fake = createFakeWsConn();
        upgradedConns.push(fake);
        return fake.asWsConnection();
      },
    });

    function triggerUpgrade(url: string, headers: Record<string, string | undefined> = {}) {
      const writes: string[] = [];
      let socketDestroyed = false;
      const rawSocket = {
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
        destroy: () => {
          socketDestroyed = true;
        },
      } as unknown as Duplex;

      serverEmitter.emit(
        'upgrade',
        {
          method: 'GET',
          url,
          headers: { host: 'localhost', ...headers },
        } as unknown as IncomingMessage,
        rawSocket,
        Buffer.alloc(0),
      );
      return {
        writes,
        get socketDestroyed(): boolean {
          return socketDestroyed;
        },
        conn: upgradedConns.at(-1),
      };
    }

    return { gateway, ctx, ticketStore, triggerUpgrade, upgradedConns };
  }

  it('authenticates via single-use ticket, authorizes declared channels, and rejects ticket replay', async () => {
    const { gateway, ctx, ticketStore, triggerUpgrade } = setupGateway();
    expect(getWebSocketStats().pluginRegistered).toBe(true);

    const { ticket } = ticketStore.issueTicket(JWT_SECRET, {
      userId: 'user-1',
      role: 'user',
      sessionId: 'sess-1',
      orgId: 'org-1',
    });

    const first = triggerUpgrade(`/ws?ticket=${encodeURIComponent(ticket)}`);
    expect(first.conn).toBeDefined();
    expect(getWebSocketStats().activeConnections).toBe(1);

    // Replay of the same single-use ticket must be rejected at upgrade with 403!
    const replay = triggerUpgrade(`/ws?ticket=${encodeURIComponent(ticket)}`);
    expect(replay.socketDestroyed).toBe(true);
    expect(replay.writes.join('')).toContain('403');

    // Authorized channel subscription succeeds; cross-user channel subscription is denied!
    const grant = signChannelGrant(JWT_SECRET, {
      viewerKey: 'user:user-1',
      channel: 'user:user-1',
      expiresAtMs: Date.now() + 60_000,
    });
    first.conn?.emit(
      'message',
      JSON.stringify({ type: 'subscribe', key: 'user:user-1', grant }),
      false,
    );
    first.conn?.emit(
      'message',
      JSON.stringify({ type: 'subscribe', key: 'user:other-user' }),
      false,
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(ctx.pubsub.handleMessage).toHaveBeenCalledTimes(1);

    // Session revocation immediately closes the user's open socket with 1008!
    expect(gateway.revokeUserSessions('user-1', 'sess-1')).toBe(1);
    expect(first.conn?.closedWith).toEqual({
      code: WS_CLOSE_POLICY_VIOLATION,
      reason: 'Session revoked',
    });
    expect(getWebSocketStats().activeConnections).toBe(0);
  });

  it('rejects the retired JWT-in-Sec-WebSocket-Protocol workaround with 400', () => {
    const { triggerUpgrade } = setupGateway();
    const res = triggerUpgrade('/ws?csrf=valid', {
      cookie: '_csrf=c',
      'sec-websocket-protocol': 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
    });
    expect(res.socketDestroyed).toBe(true);
    expect(res.writes.join('')).toContain('400');
  });

  it('rejects non-/ws paths, invalid CSRF on cookie upgrades, and unauthenticated upgrades without anonymous=1', () => {
    const { triggerUpgrade } = setupGateway();

    const wrongPath = triggerUpgrade('/other');
    expect(wrongPath.socketDestroyed).toBe(true);

    mockValidateCsrfToken.mockReturnValueOnce(false);
    const badCsrf = triggerUpgrade('/ws?csrf=bad', { cookie: '_csrf=c; accessToken=tok' });
    expect(badCsrf.socketDestroyed).toBe(true);
    expect(badCsrf.writes.join('')).toContain('403');

    const noAuth = triggerUpgrade('/ws?csrf=ok', { cookie: '_csrf=c' });
    expect(noAuth.conn?.closedWith).toEqual({
      code: WS_CLOSE_POLICY_VIOLATION,
      reason: 'Authentication required',
    });
  });

  it('supports anonymous=1 read-only sockets on anonymous-read channels while denying private channels', async () => {
    const { ctx, triggerUpgrade } = setupGateway();
    const anon = triggerUpgrade('/ws?anonymous=1');
    expect(anon.conn).toBeDefined();

    anon.conn?.emit('message', JSON.stringify({ type: 'subscribe', key: 'public:status' }), false);
    anon.conn?.emit('message', JSON.stringify({ type: 'subscribe', key: 'user:user-1' }), false);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(ctx.pubsub.handleMessage).toHaveBeenCalledTimes(1);
    expect(ctx.pubsub.handleMessage).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify({ type: 'subscribe', key: 'public:status' }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('drains open connections with 1012 Service restarting and rejects upgrades during drain', async () => {
    const { gateway, ticketStore, triggerUpgrade } = setupGateway();
    const { ticket } = ticketStore.issueTicket(JWT_SECRET, {
      userId: 'user-drain',
      role: 'user',
      sessionId: null,
      orgId: null,
    });
    const connected = triggerUpgrade(`/ws?ticket=${encodeURIComponent(ticket)}`);
    expect(connected.conn?.readyState).toBe(1);

    await gateway.drain(200);
    expect(connected.conn?.closedWith).toEqual({ code: 1012, reason: 'Service restarting' });

    const afterDrain = triggerUpgrade('/ws?anonymous=1');
    expect(afterDrain.socketDestroyed).toBe(true);
    expect(afterDrain.writes.join('')).toContain('503');
  });
});
