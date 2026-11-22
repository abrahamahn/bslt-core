// tests/integration/api/websocket-auth.integration.test.ts
/**
 * WebSocket Authentication & Authorization Integration Tests (§8.6).
 *
 * Verifies the owned RFC 6455 gateway handshake, single-use WS tickets,
 * replay rejection, HttpOnly cookie + CSRF auth, explicit `?anonymous=1`
 * read-only mode, JWT-in-Sec-WebSocket-Protocol rejection, and immediate
 * session revocation (`revokeUserSessions`).
 */

import { EventEmitter } from 'node:events';

import { AUTH_CONSTANTS } from '@bslt/contract';
import {
  createTicketStore,
  registerWebSocket,
  resetStats,
  signChannelGrant,
  type WebSocketDeps,
} from '@bslt/realtime';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { WS_CLOSE_POLICY_VIOLATION } = AUTH_CONSTANTS;
const JWT_SECRET = 'test-jwt-secret-32chars-minimum!!';
const COOKIE_SECRET = 'test-cookie-secret-32chars-min!!';

const { mockVerifyToken, mockVerifySession, mockValidateCsrfToken } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn((): { userId: string; role?: string; sessionId?: string } => ({
    userId: 'auth-test-user',
    role: 'user',
    sessionId: 'sess-1',
  })),
  mockVerifySession: vi.fn((_claims: { userId: string }): Promise<void> => Promise.resolve()),
  mockValidateCsrfToken: vi.fn(() => true),
}));

vi.mock('@bslt/server-system/security', () => ({
  validateCsrfToken: mockValidateCsrfToken,
}));

class FakeWsConnection extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  readonly protocol: string | null;
  readonly sent: string[] = [];
  closeArgs: { code: number | undefined; reason: string | undefined } | null = null;
  terminated = false;

  constructor(protocol: string | null = null) {
    super();
    this.protocol = protocol;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {}

  pong(): void {}

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closeArgs = { code, reason };
    this.emit('close', code ?? 1005, reason ?? '');
  }

  terminate(): void {
    this.readyState = 3;
    this.terminated = true;
    this.emit('close', 1006, '');
  }
}

function createMockCtx(overrides: Partial<WebSocketDeps> = {}): WebSocketDeps {
  return {
    db: { queryOne: vi.fn().mockResolvedValue(null) },
    pubsub: {
      handleMessage: vi.fn(),
      cleanup: vi.fn(),
    },
    log: {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
    config: {
      env: 'test',
      auth: {
        jwt: { secret: JWT_SECRET },
        cookie: { secret: COOKIE_SECRET },
      },
    },
    ticketStore: createTicketStore(),
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

describe('WebSocket Authentication & Channel Authorization (§8.6)', () => {
  const createdConnections: FakeWsConnection[] = [];

  const upgradeImpl = vi.fn((req: { headers?: Record<string, string | string[] | undefined> }) => {
    const protoHeader = req.headers?.['sec-websocket-protocol'];
    const proto = typeof protoHeader === 'string' ? protoHeader : null;
    const conn = new FakeWsConnection(proto);
    createdConnections.push(conn);
    return conn as never;
  });

  beforeEach(() => {
    createdConnections.length = 0;
    vi.clearAllMocks();
    resetStats();
    mockVerifyToken.mockReset().mockReturnValue({
      userId: 'auth-test-user',
      role: 'user',
      sessionId: 'sess-1',
    });
    mockVerifySession.mockReset().mockResolvedValue(undefined);
    mockValidateCsrfToken.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStats();
  });

  function mount(ctx: WebSocketDeps = createMockCtx()) {
    const server = { server: new EventEmitter() };
    const gateway = registerWebSocket(server as never, ctx, {
      verifyToken: mockVerifyToken,
      verifySession: mockVerifySession,
      upgradeImpl: upgradeImpl as never,
    });
    const upgrade = (url: string, headers: Record<string, string | undefined> = {}) => {
      const rawSocket = { write: vi.fn(), destroy: vi.fn(), end: vi.fn(), on: vi.fn() };
      server.server.emit(
        'upgrade',
        { url, headers: { host: 'localhost', ...headers } },
        rawSocket,
        Buffer.alloc(0),
      );
      return rawSocket;
    };
    return { ctx, gateway, upgrade };
  }

  test('destroys raw socket without upgrading when path is not /ws', () => {
    const { upgrade } = mount();
    const rawSocket = upgrade('/other-path');

    expect(rawSocket.destroy).toHaveBeenCalledTimes(1);
    expect(createdConnections).toHaveLength(0);
  });

  test('rejects legacy JWT-in-Sec-WebSocket-Protocol handshakes with HTTP 400 before upgrading', () => {
    const { upgrade } = mount();
    const rawSocket = upgrade('/ws?csrf=valid', {
      cookie: '_csrf=csrf-cookie',
      'sec-websocket-protocol': 'graphql, json, my-jwt-token-here',
    });

    expect(rawSocket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 400'));
    expect(rawSocket.destroy).toHaveBeenCalledTimes(1);
    expect(mockVerifyToken).not.toHaveBeenCalled();
    expect(createdConnections).toHaveLength(0);
  });

  test('rejects unauthenticated handshakes lacking both ?ticket= and accessToken cookie', async () => {
    const { upgrade } = mount();
    upgrade('/ws?csrf=valid', { cookie: '_csrf=csrf-cookie' });
    await flushMicrotasks();

    const ws = createdConnections[0]!;
    expect(ws.closeArgs).toEqual({
      code: WS_CLOSE_POLICY_VIOLATION,
      reason: 'Authentication required',
    });
  });

  test('accepts a valid single-use WS ticket once and rejects replay or forgery with HTTP 403 before upgrading', async () => {
    const ctx = createMockCtx();
    const { gateway, upgrade } = mount(ctx);
    const issued = gateway.ticketStore.issueTicket(JWT_SECRET, {
      userId: 'user-ticket-1',
      role: 'user',
      sessionId: 'sess-ticket-1',
      orgId: null,
    });

    // First use succeeds
    upgrade(`/ws?ticket=${encodeURIComponent(issued.ticket)}`);
    await flushMicrotasks();
    expect(createdConnections).toHaveLength(1);
    expect(createdConnections[0]?.closeArgs).toBeNull();

    // Replay of the exact same ticket MUST fail closed before upgrade
    const replaySocket = upgrade(`/ws?ticket=${encodeURIComponent(issued.ticket)}`);
    await flushMicrotasks();
    expect(replaySocket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 403'));
    expect(replaySocket.destroy).toHaveBeenCalledTimes(1);
    expect(createdConnections).toHaveLength(1);

    // Forged signature MUST fail closed before upgrade
    const forgedSocket = upgrade('/ws?ticket=forged.signature');
    await flushMicrotasks();
    expect(forgedSocket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 403'));
    expect(forgedSocket.destroy).toHaveBeenCalledTimes(1);
    expect(createdConnections).toHaveLength(1);
  });

  test('rejects HttpOnly cookie handshake with HTTP 403 before upgrading when CSRF validation fails', async () => {
    mockValidateCsrfToken.mockReturnValue(false);
    const { upgrade } = mount();

    const rawSocket = upgrade('/ws?csrf=bad', {
      cookie: '_csrf=csrf-cookie; accessToken=cookie-jwt-token',
    });
    await flushMicrotasks();

    expect(rawSocket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 403'));
    expect(rawSocket.destroy).toHaveBeenCalledTimes(1);
    expect(createdConnections).toHaveLength(0);
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  test('rejects HttpOnly cookie handshake when verifySession rejects revoked/locked user', async () => {
    mockVerifySession.mockRejectedValueOnce(new Error('Account locked'));
    const { upgrade } = mount();

    upgrade('/ws?csrf=valid', {
      cookie: '_csrf=csrf-cookie; accessToken=cookie-jwt-token',
    });
    await flushMicrotasks();

    expect(createdConnections[0]?.closeArgs).toEqual({
      code: WS_CLOSE_POLICY_VIOLATION,
      reason: 'Invalid token',
    });
  });

  test('accepts HttpOnly accessToken cookie + valid CSRF token and authorizes own user channel', async () => {
    const ctx = createMockCtx();
    const { upgrade } = mount(ctx);

    upgrade('/ws?csrf=valid', {
      cookie: '_csrf=csrf-cookie; accessToken=cookie-jwt-token',
    });
    await flushMicrotasks();

    const ws = createdConnections[0]!;
    expect(ws.closeArgs).toBeNull();
    expect(mockVerifyToken).toHaveBeenCalledWith('cookie-jwt-token', JWT_SECRET);

    const ownKey = 'record:notifications:auth-test-user';
    const grant = signChannelGrant(JWT_SECRET, {
      viewerKey: 'user:auth-test-user',
      channel: ownKey,
      expiresAtMs: Date.now() + 60_000,
    });
    ws.emit('message', JSON.stringify({ type: 'subscribe', key: ownKey, grant }), false);
    await flushMicrotasks();
    expect(ctx.pubsub.handleMessage).toHaveBeenCalledTimes(1);
  });

  test('restricts ?anonymous=1 sockets to anonymous-read channels and blocks user channels', async () => {
    const ctx = createMockCtx();
    const { upgrade } = mount(ctx);

    upgrade('/ws?anonymous=1');
    await flushMicrotasks();

    const ws = createdConnections[0]!;
    expect(ws.closeArgs).toBeNull();

    // Private channel denied
    ws.emit(
      'message',
      JSON.stringify({ type: 'subscribe', key: 'record:notifications:auth-test-user' }),
      false,
    );
    await flushMicrotasks();
    expect(ctx.pubsub.handleMessage).not.toHaveBeenCalled();

    // Public status channel allowed
    ws.emit('message', JSON.stringify({ type: 'subscribe', key: 'public:status' }), false);
    await flushMicrotasks();
    expect(ctx.pubsub.handleMessage).toHaveBeenCalledTimes(1);
  });

  test('immediately closes matching open sockets with 1008 when revokeUserSessions fires', async () => {
    const ctx = createMockCtx();
    const { gateway, upgrade } = mount(ctx);

    const t1 = gateway.ticketStore.issueTicket(JWT_SECRET, {
      userId: 'revoked-user',
      role: 'user',
      sessionId: 'sess-a',
      orgId: null,
    });
    const t2 = gateway.ticketStore.issueTicket(JWT_SECRET, {
      userId: 'other-user',
      role: 'user',
      sessionId: 'sess-b',
      orgId: null,
    });

    upgrade(`/ws?ticket=${encodeURIComponent(t1.ticket)}`);
    upgrade(`/ws?ticket=${encodeURIComponent(t2.ticket)}`);
    await flushMicrotasks();

    const closedCount = gateway.revokeUserSessions('revoked-user');
    expect(closedCount).toBe(1);
    expect(createdConnections[0]?.closeArgs).toEqual({
      code: WS_CLOSE_POLICY_VIOLATION,
      reason: 'Session revoked',
    });
    expect(createdConnections[1]?.closeArgs).toBeNull();
  });
});
