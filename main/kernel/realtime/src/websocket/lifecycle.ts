// main/kernel/realtime/src/websocket/lifecycle.ts
/**
 * WebSocket Lifecycle Management (restructure plan §8.6).
 *
 * Built on the owned RFC 6455 implementation (`@bslt/protocols/ws`) attached
 * directly to `node:http`'s `upgrade` event:
 * - Authenticates via single-use WS tickets (`?ticket=`), HttpOnly cookie + CSRF,
 *   or explicit `?anonymous=1` read-only mode.
 * - Rejects the retired JWT-in-Sec-WebSocket-Protocol workaround.
 * - Enforces deny-by-default `ChannelRegistry` + server-signed channel grants.
 * - Immediately closes sockets on `identity.session.revoked` (`revokeUserSessions`).
 */

import { upgradeWebSocket, WS_READY_STATES, type WsConnection } from '@bslt/protocols/ws';
import { validateCsrfToken } from '@bslt/server-system/security';

import { defaultChannelRegistry, type ChannelRegistry, type ChannelViewer } from '../channels';
import { createRealtimeHub, type RealtimeHub } from '../hub';
import { createTicketStore, verifyChannelGrant, type WsTicketStore } from '../tickets';

import { decrementConnections, incrementConnections, markPluginRegistered } from './stats';

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const WS_MAX_PAYLOAD_BYTES = 64 * 1024;
const WS_HEARTBEAT_MS = 30_000;
const WS_SESSION_RECHECK_MS = 30_000;
const ACCESS_TOKEN_COOKIE_NAME = 'accessToken';
const CSRF_COOKIE_NAME = '_csrf';
const WEBSOCKET_PATH = '/ws';
const ALLOWED_SUBPROTOCOL = 'bslt.realtime.v1';

const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_SERVICE_RESTART = 1012;
const AUTHENTICATION_REQUIRED_MESSAGE = 'Authentication required';
const INVALID_TOKEN_MESSAGE = 'Invalid token';
const SESSION_REVOKED_MESSAGE = 'Session revoked';
const SERVICE_RESTART_MESSAGE = 'Service restarting';
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

interface WebSocketDbClient {
  queryOne<T>(query: { text: string; values?: readonly unknown[] }): Promise<T | null | undefined>;
}

interface PubSubWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
}

interface SubscriptionManagerLike {
  handleMessage(
    socket: PubSubWebSocketLike,
    message: string,
    onSubscribe?: (key: unknown) => void,
    canSubscribe?: (key: string) => boolean,
  ): void;
  cleanup(socket: PubSubWebSocketLike): void;
}

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface UpgradeServerLike {
  server: {
    on(
      event: 'upgrade',
      listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
    ): void;
  };
}

export interface WebSocketDeps {
  readonly db: WebSocketDbClient;
  readonly pubsub: SubscriptionManagerLike;
  readonly log: LoggerLike;
  readonly config: {
    readonly env: string;
    readonly auth: {
      readonly cookie: {
        readonly secret: string;
      };
      readonly jwt: {
        readonly secret: string;
      };
    };
  };
  readonly resolveTableName?: (logicalName: string) => string | undefined;
  readonly ticketStore?: WsTicketStore;
  readonly channelRegistry?: ChannelRegistry;
  readonly hub?: RealtimeHub;
}

export interface TokenClaims {
  readonly userId: string;
  readonly role?: string;
  readonly sessionId?: string;
  readonly [claim: string]: unknown;
}

type TokenVerifier = (token: string, secret: string) => TokenClaims;
type SessionVerifier = (claims: TokenClaims) => Promise<void>;

type WebSocketRegistrationOptions = {
  verifyToken: TokenVerifier;
  verifySession: SessionVerifier;
  upgradeImpl?: typeof upgradeWebSocket;
};

type WebSocketGateway = {
  drain(timeoutMs?: number): Promise<void>;
  revokeUserSessions(userId: string, sessionId?: string): number;
  readonly ticketStore: WsTicketStore;
  readonly hub: RealtimeHub;
  readonly channelRegistry: ChannelRegistry;
};

type ValidateCsrfTokenFn = (
  cookieToken: string | undefined,
  requestToken: string | undefined,
  options: { secret: string; encrypted: boolean; signed: boolean },
) => boolean;

const validateCsrfTokenTyped = validateCsrfToken as unknown as ValidateCsrfTokenFn;

/** Shared default ticket store used when callers do not inject a custom store. */
export const defaultGatewayTicketStore: WsTicketStore = createTicketStore();

function parseCookiesSafe(cookieHeader: string | undefined): Record<string, string> {
  if (cookieHeader === undefined || cookieHeader.trim() === '') return {};
  const cookies: Record<string, string> = {};
  for (const segment of cookieHeader.split(';')) {
    const [rawName, ...valueParts] = segment.split('=');
    const name = rawName?.trim();
    const value = valueParts.join('=').trim();
    if (name === undefined || name === '' || value === '') continue;
    cookies[name] = value;
  }
  return cookies;
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  const response = [
    `HTTP/1.1 ${String(statusCode)} ${message}`,
    'Content-Type: text/plain; charset=utf-8',
    'Connection: close',
    `Content-Length: ${String(Buffer.byteLength(message))}`,
    '',
    message,
  ].join('\r\n');
  socket.write(response);
  socket.destroy();
}

function parseRecordSubscriptionKey(key: string): { table: string; id: string } | null {
  const [prefix, table, id] = key.split(':');
  if (prefix !== 'record' || table === undefined || id === undefined || table === '' || id === '') {
    return null;
  }
  return { table, id };
}

async function getRecordVersion(
  ctx: WebSocketDeps,
  table: string,
  id: string,
): Promise<number | undefined> {
  const resolve = ctx.resolveTableName;
  if (resolve === undefined) return undefined;
  const actualTable = resolve(table);
  if (actualTable === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(actualTable)) {
    return undefined;
  }
  const row = await ctx.db.queryOne<{ version: number }>({
    text: `select version from "${actualTable}" where id = $1 limit 1`,
    values: [id],
  });
  return row?.version;
}

async function sendInitialData(
  ctx: WebSocketDeps,
  socket: WsConnection,
  key: string,
): Promise<void> {
  const parsed = parseRecordSubscriptionKey(key);
  if (parsed === null) return;
  try {
    const version = await getRecordVersion(ctx, parsed.table, parsed.id);
    if (version !== undefined && socket.readyState === WS_READY_STATES.OPEN) {
      socket.send(JSON.stringify({ type: 'update', key, version }));
    }
  } catch (err) {
    ctx.log.warn('Failed to fetch initial data for subscription', { err, key });
  }
}

function hasDisallowedSubprotocol(rawHeader: string | string[] | undefined): boolean {
  if (rawHeader === undefined) return false;
  const text = Array.isArray(rawHeader) ? rawHeader.join(',') : rawHeader;
  const tokens = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return tokens.some((token) => token !== ALLOWED_SUBPROTOCOL);
}

interface TrackedUserSocket {
  readonly ws: WsConnection;
  readonly sessionId: string | null;
}

export function registerWebSocket(
  server: UpgradeServerLike,
  ctx: WebSocketDeps,
  options: WebSocketRegistrationOptions,
): WebSocketGateway {
  markPluginRegistered();

  const upgradeFn = options.upgradeImpl ?? upgradeWebSocket;
  const ticketStore = ctx.ticketStore ?? defaultGatewayTicketStore;
  const channelRegistry = ctx.channelRegistry ?? defaultChannelRegistry;
  const hub = ctx.hub ?? createRealtimeHub();

  const clients = new Set<WsConnection>();
  const liveSockets = new WeakSet<WsConnection>();
  const userSockets = new Map<string, Set<TrackedUserSocket>>();

  let draining = false;
  let drainPromise: Promise<void> | undefined;

  const heartbeat = setInterval(() => {
    for (const client of [...clients]) {
      if (!liveSockets.has(client)) {
        client.terminate();
        clients.delete(client);
        continue;
      }
      liveSockets.delete(client);
      client.ping();
    }
  }, WS_HEARTBEAT_MS);
  heartbeat.unref();

  const isProd = ctx.config.env === 'production';
  const jwtSecret = ctx.config.auth.jwt.secret;

  function trackUserSocket(
    userId: string,
    sessionId: string | null,
    ws: WsConnection,
  ): TrackedUserSocket {
    let set = userSockets.get(userId);
    if (set === undefined) {
      set = new Set();
      userSockets.set(userId, set);
    }
    const entry: TrackedUserSocket = { ws, sessionId };
    set.add(entry);
    return entry;
  }

  function untrackUserSocket(userId: string, entry: TrackedUserSocket): void {
    const set = userSockets.get(userId);
    if (set === undefined) return;
    set.delete(entry);
    if (set.size === 0) {
      userSockets.delete(userId);
    }
  }

  function revokeUserSessions(userId: string, sessionId?: string): number {
    const set = userSockets.get(userId);
    if (set === undefined || set.size === 0) return 0;
    let closedCount = 0;
    for (const entry of [...set]) {
      if (sessionId === undefined || entry.sessionId === null || entry.sessionId === sessionId) {
        entry.ws.close(WS_CLOSE_POLICY_VIOLATION, SESSION_REVOKED_MESSAGE);
        set.delete(entry);
        closedCount += 1;
      }
    }
    if (set.size === 0) {
      userSockets.delete(userId);
    }
    return closedCount;
  }

  server.server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== WEBSOCKET_PATH) {
      socket.destroy();
      return;
    }

    if (draining) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    // Retired JWT-in-Sec-WebSocket-Protocol workaround is rejected unconditionally.
    if (hasDisallowedSubprotocol(request.headers['sec-websocket-protocol'])) {
      ctx.log.warn('WebSocket upgrade rejected: disallowed Sec-WebSocket-Protocol token');
      rejectUpgrade(socket, 400, 'Bad Request: Subprotocol authentication is not supported');
      return;
    }

    const ticketParam = url.searchParams.get('ticket');
    const anonymousParam = url.searchParams.get('anonymous') === '1';

    let viewer: ChannelViewer | null = null;
    let verifyClaimsFn: (() => TokenClaims) | null = null;
    let sessionId: string | null = null;

    if (ticketParam !== null && ticketParam !== '') {
      const redeemed = ticketStore.redeemTicket(jwtSecret, ticketParam);
      if (redeemed === null) {
        ctx.log.warn('WebSocket upgrade rejected: invalid or replayed ticket');
        rejectUpgrade(socket, 403, 'Forbidden: Invalid or expired realtime ticket');
        return;
      }
      viewer = {
        userId: redeemed.userId,
        role: redeemed.role,
        orgId: redeemed.orgId,
      };
      sessionId = redeemed.sessionId;
      const staticClaims: TokenClaims = {
        userId: redeemed.userId,
        role: redeemed.role,
        ...(redeemed.sessionId !== null ? { sessionId: redeemed.sessionId } : {}),
      };
      verifyClaimsFn = () => staticClaims;
    } else if (!anonymousParam) {
      const cookies = parseCookiesSafe(request.headers.cookie);
      const csrfCookie = cookies[CSRF_COOKIE_NAME];
      const csrfToken = url.searchParams.get('csrf') ?? undefined;
      const csrfValid = validateCsrfTokenTyped(csrfCookie, csrfToken, {
        secret: ctx.config.auth.cookie.secret,
        encrypted: isProd,
        signed: true,
      });

      if (!csrfValid) {
        ctx.log.warn('WebSocket upgrade rejected: invalid CSRF token');
        rejectUpgrade(socket, 403, 'Forbidden: Invalid CSRF token');
        return;
      }

      const cookieAccessToken = cookies[ACCESS_TOKEN_COOKIE_NAME];
      if (cookieAccessToken !== undefined && cookieAccessToken !== '') {
        try {
          const initialClaims = options.verifyToken(cookieAccessToken, jwtSecret);
          viewer = {
            userId: initialClaims.userId,
            role: typeof initialClaims.role === 'string' ? initialClaims.role : 'user',
            orgId: null,
          };
          sessionId = typeof initialClaims.sessionId === 'string' ? initialClaims.sessionId : null;
          verifyClaimsFn = () => options.verifyToken(cookieAccessToken, jwtSecret);
        } catch (err) {
          ctx.log.warn('WebSocket cookie token verification failed', { err });
          const wsInvalid = upgradeFn(request, socket, head, {
            maxPayloadBytes: WS_MAX_PAYLOAD_BYTES,
            selectProtocol: (protocols) =>
              protocols.includes(ALLOWED_SUBPROTOCOL) ? ALLOWED_SUBPROTOCOL : null,
          });
          wsInvalid?.close(WS_CLOSE_POLICY_VIOLATION, INVALID_TOKEN_MESSAGE);
          return;
        }
      }
    }

    const ws = upgradeFn(request, socket, head, {
      maxPayloadBytes: WS_MAX_PAYLOAD_BYTES,
      selectProtocol: (protocols) =>
        protocols.includes(ALLOWED_SUBPROTOCOL) ? ALLOWED_SUBPROTOCOL : null,
    });
    if (ws === null) {
      return;
    }

    if (viewer === null && !anonymousParam) {
      ws.close(WS_CLOSE_POLICY_VIOLATION, AUTHENTICATION_REQUIRED_MESSAGE);
      return;
    }

    clients.add(ws);
    liveSockets.add(ws);
    ws.on('pong', () => {
      liveSockets.add(ws);
    });

    const connCount = incrementConnections();
    const userId = viewer?.userId ?? 'anonymous';
    const trackedEntry = viewer !== null ? trackUserSocket(viewer.userId, sessionId, ws) : null;
    ctx.log.debug('WebSocket client connected', { userId, activeConnections: connCount });

    let torndown = false;
    let revoked = false;
    let recheck: ReturnType<typeof setInterval> | null = null;

    const revalidate = async (getClaims: () => TokenClaims): Promise<boolean> => {
      try {
        await options.verifySession(getClaims());
        return true;
      } catch (err) {
        revoked = true;
        if (recheck !== null) clearInterval(recheck);
        if (!torndown) {
          ctx.log.warn('WebSocket session no longer valid', { err, userId });
          ws.close(WS_CLOSE_POLICY_VIOLATION, INVALID_TOKEN_MESSAGE);
        }
        return false;
      }
    };

    const sessionLive: Promise<boolean> =
      verifyClaimsFn !== null
        ? (() => {
            const fn = verifyClaimsFn;
            recheck = setInterval(() => {
              void revalidate(fn);
            }, WS_SESSION_RECHECK_MS);
            recheck.unref();
            return revalidate(fn);
          })()
        : Promise.resolve(true);

    const viewerKey = viewer !== null ? `user:${viewer.userId}` : 'anonymous';

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const rawText = typeof data === 'string' ? data : data.toString('utf8');
      if (!hub.allowInboundMessage(ws)) {
        return;
      }

      void sessionLive.then(async (live) => {
        if (!live || torndown || revoked) return;

        let parsed: Record<string, unknown>;
        try {
          const decoded: unknown = JSON.parse(rawText);
          if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return;
          parsed = decoded as Record<string, unknown>;
        } catch {
          return;
        }

        const msgType = parsed['type'];
        if (typeof msgType !== 'string') return;

        if (msgType === 'subscribe') {
          const key = typeof parsed['key'] === 'string' ? parsed['key'] : '';
          if (key === '') return;

          const grant = typeof parsed['grant'] === 'string' ? parsed['grant'] : '';
          const allowedByGrant =
            grant !== '' && verifyChannelGrant(jwtSecret, grant, { viewerKey, channel: key });
          const allowed = allowedByGrant
            ? true
            : (await channelRegistry.authorize(viewer, key)).allowed;

          if (!allowed) {
            return;
          }
          if (!hub.subscribe(key, ws)) {
            return;
          }

          ctx.pubsub.handleMessage(
            ws,
            JSON.stringify({ type: 'subscribe', key }),
            (subKey: unknown) => {
              if (typeof subKey === 'string') {
                void sendInitialData(ctx, ws, subKey);
              }
            },
            () => true,
          );

          if (typeof parsed['afterSeq'] === 'number') {
            for (const frame of hub.replayFrames(key, parsed['afterSeq'])) {
              ws.send(JSON.stringify(frame));
            }
          }
          return;
        }

        if (msgType === 'unsubscribe') {
          const key = typeof parsed['key'] === 'string' ? parsed['key'] : '';
          if (key === '') return;
          hub.unsubscribe(key, ws);
          ctx.pubsub.handleMessage(ws, JSON.stringify({ type: 'unsubscribe', key }));
          return;
        }

        if (msgType === 'sync_request') {
          const rawKeys = Array.isArray(parsed['keys']) ? parsed['keys'] : [];
          const authorizedKeys = new Set<string>();
          for (const candidate of rawKeys) {
            if (typeof candidate !== 'string') continue;
            if ((await channelRegistry.authorize(viewer, candidate)).allowed) {
              authorizedKeys.add(candidate);
            }
          }
          ctx.pubsub.handleMessage(ws, rawText, undefined, (k) => authorizedKeys.has(k));
          return;
        }

        if (msgType === 'presence_join' && viewer !== null) {
          const channel = typeof parsed['channel'] === 'string' ? parsed['channel'] : '';
          if (channel === '') return;
          const decision = await channelRegistry.authorize(viewer, channel);
          if (!decision.allowed || decision.mode === 'anonymous-read') return;
          const metadata =
            parsed['metadata'] !== null &&
            typeof parsed['metadata'] === 'object' &&
            !Array.isArray(parsed['metadata'])
              ? (parsed['metadata'] as Record<string, unknown>)
              : undefined;
          hub.joinPresence(channel, ws, {
            id: viewer.userId,
            ...(metadata !== undefined ? { metadata } : {}),
          });
          return;
        }

        if (msgType === 'presence_leave') {
          const channel = typeof parsed['channel'] === 'string' ? parsed['channel'] : '';
          if (channel !== '') {
            hub.leavePresence(channel, ws);
          }
        }
      });
    });

    const teardown = (): number | null => {
      if (torndown) return null;
      torndown = true;
      if (recheck !== null) clearInterval(recheck);
      clients.delete(ws);
      if (viewer !== null && trackedEntry !== null) {
        untrackUserSocket(viewer.userId, trackedEntry);
      }
      hub.cleanupSocket(ws);
      ctx.pubsub.cleanup(ws);
      return decrementConnections();
    };

    ws.on('close', () => {
      const remaining = teardown();
      if (remaining !== null) {
        ctx.log.debug('WebSocket client disconnected', { userId, activeConnections: remaining });
      }
    });

    ws.on('error', (err: Error) => {
      const remaining = teardown();
      ctx.log.error('WebSocket error', { err, userId, activeConnections: remaining });
    });
  });

  ctx.log.info(`WebSocket support registered on ${WEBSOCKET_PATH}`);

  const runDrain = async (timeoutMs: number): Promise<void> => {
    draining = true;
    clearInterval(heartbeat);

    const openClients = [...clients];
    if (openClients.length > 0) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const checkEmpty = (): void => {
          if (clients.size === 0) finish();
        };
        const timer = setTimeout(
          () => {
            for (const client of [...clients]) {
              client.terminate();
              clients.delete(client);
            }
            finish();
          },
          Math.max(0, timeoutMs),
        );
        timer.unref();

        for (const client of openClients) {
          client.once('close', checkEmpty);
        }
        for (const client of openClients) {
          client.close(WS_CLOSE_SERVICE_RESTART, SERVICE_RESTART_MESSAGE);
        }
        checkEmpty();
      });
    }
  };

  return {
    drain: (timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> => {
      drainPromise ??= runDrain(timeoutMs);
      return drainPromise;
    },
    revokeUserSessions,
    ticketStore,
    hub,
    channelRegistry,
  };
}
