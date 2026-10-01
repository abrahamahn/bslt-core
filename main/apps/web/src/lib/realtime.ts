// main/apps/web/src/lib/realtime.ts
/**
 * The browser end of the invalidation bus.
 *
 * One socket for the whole tab, shared by every subscriber. The server sends
 * `{ type: 'update', key, version }` and nothing else — no payload — so this
 * module's entire job is to turn a frame into "that key changed" and let the
 * caller refetch over the authenticated HTTP route it already uses. Nothing
 * here holds application state, which is what keeps a dropped socket from
 * being a correctness problem rather than a latency one.
 *
 * Deliberately NOT a replacement for polling. Callers keep their poll as a
 * fallback: sockets drop, proxies close idle connections, and a notification
 * that only ever arrives over a live socket is one that silently never
 * arrives.
 *
 * CSRF: the token travels in the URL, because browsers cannot set headers on a
 * WebSocket handshake. It comes from `@bslt/api`'s `getCsrfToken` rather than a
 * local fetch, so the endpoint path is defined in exactly one place — a
 * hand-written `/csrf-token` is how the upstream version of this file spent a
 * long time never connecting in any environment while looking, from the
 * outside, like a working poll.
 */

import { getCsrfToken } from '@bslt/api';

import type { ServerMessage, SubscriptionKey } from '@bslt/shared/db';

import { getAccessToken } from '@/app/authToken';
import { clientConfig } from '@/config';

/** Called when the server says a subscribed key changed. */
export type InvalidationHandler = (key: SubscriptionKey, version: number) => void;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const CONNECTION_STABLE_MS = 5_000;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/u;

interface Channel {
  readonly handlers: Set<InvalidationHandler>;
}

const channels = new Map<SubscriptionKey, Channel>();

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

function socketUrl(token: string): string {
  const { protocol, host } = window.location;
  const scheme = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${host}/ws?csrf=${encodeURIComponent(token)}`;
}

function send(message: { type: string; key: SubscriptionKey }): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

/** Re-subscribe everything after a reconnect: the server keeps no memory of us. */
function resubscribeAll(): void {
  for (const key of channels.keys()) {
    send({ type: 'subscribe', key });
  }
}

function handleFrame(raw: string): void {
  let message: ServerMessage;
  try {
    message = JSON.parse(raw) as ServerMessage;
  } catch {
    return;
  }

  // Two frame shapes, and the union has no third — a live update, or the
  // replay a reconnecting client asked for.
  const updates =
    message.type === 'update' ? [{ key: message.key, version: message.version }] : message.messages;

  for (const update of updates) {
    const channel = channels.get(update.key);
    if (channel === undefined) continue;
    for (const handler of channel.handlers) {
      // One bad handler must not stop the others, or a single buggy consumer
      // silently disables realtime for the whole tab.
      try {
        handler(update.key, update.version);
      } catch {
        /* consumer's problem, not the transport's */
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
    const token = await getCsrfToken({ baseUrl: clientConfig.apiUrl });
    if (channels.size === 0) return;
    const next = new WebSocket(socketUrl(token), [accessToken]);
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
        /(?:invalid token|authentication required)/iu.test(event.reason)
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
    // Auth not ready, offline, server down — retry on the backoff. The caller's
    // poll keeps working throughout, which is why this can stay silent.
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
    send({ type: 'subscribe', key });
  }
  void connect();

  return () => {
    channel.handlers.delete(handler);
    if (channel.handlers.size > 0) return;

    channels.delete(key);
    send({ type: 'unsubscribe', key });

    // Nothing left to listen for: drop the socket rather than hold one open
    // for a tab that stopped caring.
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
}

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    resetRealtimeForTests();
  });
}
