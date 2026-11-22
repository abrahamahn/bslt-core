// main/apps/web/src/lib/realtime.ts
/**
 * Browser end of the realtime invalidation bus (restructure plan §8.6).
 *
 * Authenticates via single-use WebSocket tickets (`POST /api/realtime/ticket`
 * through `@bslt/client-engine`'s `requestRealtimeTicket`) and subscribes with
 * server-signed channel grants — never passing JWTs in `Sec-WebSocket-Protocol`.
 */

import { requestRealtimeTicket } from '@bslt/client-engine';

import type { ServerMessage, SubscriptionKey } from '@bslt/contract';

import { getAccessToken } from '#app/app/authToken';
import { clientConfig } from '#app/config';
import { reportError } from '#app/lib/errorReporter';

/** Called when the server says a subscribed key changed. */
type InvalidationHandler = (key: SubscriptionKey, version: number) => void;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const CONNECTION_STABLE_MS = 5_000;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/u;

interface Channel {
  readonly handlers: Set<InvalidationHandler>;
}

const channels = new Map<SubscriptionKey, Channel>();
const channelGrants = new Map<SubscriptionKey, string>();

let socket: WebSocket | null = null;
let connecting = false;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;
let rejectedToken: string | null = null;

function isJwtLike(token: string): boolean {
  const segments = token.split('.');
  return (
    segments.length === 3 &&
    segments.every((segment) => segment.length > 0 && JWT_SEGMENT_PATTERN.test(segment))
  );
}

function clearStableConnectionTimer(): void {
  if (stableConnectionTimer === null) return;
  clearTimeout(stableConnectionTimer);
  stableConnectionTimer = null;
}

/** Exponential backoff with a ceiling, so a dead server is not hammered. */
function reconnectDelayMs(): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
}

function socketUrl(ticket: string): string {
  const { protocol, host } = window.location;
  const scheme = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${host}/ws?ticket=${encodeURIComponent(ticket)}`;
}

function send(message: { type: string; key: SubscriptionKey; grant?: string | undefined }): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function sendSubscribe(key: SubscriptionKey): void {
  const grant = channelGrants.get(key);
  send({
    type: 'subscribe',
    key,
    ...(grant !== undefined ? { grant } : {}),
  });
}

/** Re-subscribe everything after a reconnect: the server keeps no memory of us. */
function resubscribeAll(): void {
  for (const key of channels.keys()) {
    sendSubscribe(key);
  }
}

function handleFrame(raw: string): void {
  let message: ServerMessage;
  try {
    message = JSON.parse(raw) as ServerMessage;
  } catch {
    return;
  }

  const updates =
    message.type === 'update' ? [{ key: message.key, version: message.version }] : message.messages;

  for (const update of updates) {
    const channel = channels.get(update.key);
    if (channel === undefined) continue;
    for (const handler of channel.handlers) {
      try {
        handler(update.key, update.version);
      } catch (error) {
        reportError(error, 'error');
      }
    }
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || channels.size === 0) return;
  const delay = reconnectDelayMs();
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

function scheduleTokenRecheck(): void {
  attempt = Math.max(attempt, Math.ceil(Math.log2(RECONNECT_MAX_MS / RECONNECT_BASE_MS)));
  scheduleReconnect();
}

async function connect(): Promise<void> {
  if (connecting || socket !== null || channels.size === 0) return;
  const accessToken = getAccessToken();
  if (typeof accessToken !== 'string' || !isJwtLike(accessToken)) {
    rejectedToken = accessToken;
    scheduleTokenRecheck();
    return;
  }
  if (rejectedToken === accessToken) {
    scheduleTokenRecheck();
    return;
  }
  if (rejectedToken !== null) {
    rejectedToken = null;
    attempt = 0;
  }
  connecting = true;

  try {
    const requestedKeys = [...channels.keys()];
    const issued = await requestRealtimeTicket({
      baseUrl: clientConfig.apiUrl,
      getToken: () => accessToken,
      channels: requestedKeys,
    });
    if (channels.size === 0) return;
    if (issued.ticket === null || issued.ticket === '') {
      rejectedToken = accessToken;
      scheduleTokenRecheck();
      return;
    }
    for (const [ch, grant] of Object.entries(issued.grants)) {
      channelGrants.set(ch as SubscriptionKey, grant);
    }

    const next = new WebSocket(socketUrl(issued.ticket));
    socket = next;

    next.addEventListener('open', () => {
      resubscribeAll();
      clearStableConnectionTimer();
      stableConnectionTimer = setTimeout(() => {
        if (socket === next && next.readyState === WebSocket.OPEN) attempt = 0;
        stableConnectionTimer = null;
      }, CONNECTION_STABLE_MS);
    });

    next.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') {
        attempt = 0;
        handleFrame(event.data);
      }
    });

    const drop = (event: Event): void => {
      clearStableConnectionTimer();
      if (socket === next) socket = null;
      if (
        event instanceof CloseEvent &&
        event.code === 1008 &&
        /(?:invalid token|authentication required|session revoked)/iu.test(event.reason)
      ) {
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        rejectedToken = accessToken;
        scheduleTokenRecheck();
        return;
      }
      scheduleReconnect();
    };
    next.addEventListener('close', drop);
    next.addEventListener('error', drop);
  } catch {
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

/**
 * Listen for invalidations on `key`.
 *
 * @param key - Subscription key, e.g. `record:notifications:{userId}`
 * @param handler - Called when the server reports a new version
 * @returns Unsubscribe function
 * @complexity O(1)
 */
export function subscribeToKey(key: SubscriptionKey, handler: InvalidationHandler): () => void {
  const existing = channels.get(key);
  const channel = existing ?? { handlers: new Set<InvalidationHandler>() };
  channel.handlers.add(handler);

  if (existing === undefined) {
    channels.set(key, channel);
    sendSubscribe(key);
  }
  void connect();

  return () => {
    channel.handlers.delete(handler);
    if (channel.handlers.size > 0) return;

    channels.delete(key);
    channelGrants.delete(key);
    send({ type: 'unsubscribe', key });

    if (channels.size === 0) {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      socket = null;
      attempt = 0;
      rejectedToken = null;
      clearStableConnectionTimer();
    }
  };
}

/** Test-only: drop all state so suites cannot leak sockets into each other. */
export function resetRealtimeForTests(): void {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearStableConnectionTimer();
  socket?.close();
  socket = null;
  connecting = false;
  attempt = 0;
  rejectedToken = null;
  channels.clear();
  channelGrants.clear();
}

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    resetRealtimeForTests();
  });
}
