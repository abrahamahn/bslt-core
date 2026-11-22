// main/kernel/realtime/src/hub.ts
/**
 * Realtime Hub (restructure plan §8.6):
 * - Two message classes: invalidation `{ type: 'update', key, version }` and
 *   sequenced payload frames `{ type: 'frame', channel, seq, payload }` with
 *   bounded per-channel history.
 * - Generic channel presence (`joinPresence`, `leavePresence`, `getPresence`).
 * - Slow-consumer policy (`bufferedAmount > maxBufferedBytes` -> close 1008)
 *   and per-socket subscription + inbound message rate caps.
 */

export interface HubSocket {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type SequencedFrame<TPayload = unknown> = {
  readonly type: 'frame';
  readonly channel: string;
  readonly seq: number;
  readonly payload: TPayload;
  readonly timestamp: number;
};

type PresenceMember = {
  readonly id: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

interface RateState {
  windowStartMs: number;
  count: number;
}

interface RealtimeHubOptions {
  readonly maxBufferedBytes?: number;
  readonly maxSubscriptionsPerSocket?: number;
  readonly maxHistoryPerChannel?: number;
  readonly maxMessagesPerWindow?: number;
  readonly rateLimitWindowMs?: number;
}

export interface RealtimeHub {
  subscribe(channel: string, socket: HubSocket): boolean;
  unsubscribe(channel: string, socket: HubSocket): void;
  cleanupSocket(socket: HubSocket): void;
  allowInboundMessage(socket: HubSocket, nowMs?: number): boolean;
  publishInvalidation(key: string, version: number, timestamp?: number): void;
  publishFrame<TPayload>(
    channel: string,
    payload: TPayload,
    options?: { seq?: number; timestamp?: number },
  ): SequencedFrame<TPayload>;
  replayFrames(channel: string, afterSeq: number): readonly SequencedFrame[];
  joinPresence(channel: string, socket: HubSocket, member: PresenceMember): void;
  leavePresence(channel: string, socket: HubSocket): void;
  getPresence(channel: string): readonly PresenceMember[];
}

const DEFAULT_MAX_BUFFERED_BYTES = 512 * 1024;
const DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET = 64;
const DEFAULT_MAX_HISTORY_PER_CHANNEL = 100;
const DEFAULT_MAX_MESSAGES_PER_WINDOW = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10_000;
const WS_CLOSE_POLICY_VIOLATION = 1008;

export function createRealtimeHub(options: RealtimeHubOptions = {}): RealtimeHub {
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const maxSubscriptionsPerSocket =
    options.maxSubscriptionsPerSocket ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET;
  const maxHistoryPerChannel = options.maxHistoryPerChannel ?? DEFAULT_MAX_HISTORY_PER_CHANNEL;
  const maxMessagesPerWindow = options.maxMessagesPerWindow ?? DEFAULT_MAX_MESSAGES_PER_WINDOW;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;

  const channelSubscribers = new Map<string, Set<HubSocket>>();
  const socketChannels = new WeakMap<HubSocket, Set<string>>();
  const socketRates = new WeakMap<HubSocket, RateState>();

  const channelSeq = new Map<string, number>();
  const channelHistory = new Map<string, SequencedFrame[]>();
  const channelPresence = new Map<string, Map<HubSocket, PresenceMember>>();

  function broadcastRaw(channel: string, serialized: string): void {
    const subs = channelSubscribers.get(channel);
    if (subs === undefined || subs.size === 0) return;

    const toEvict: HubSocket[] = [];
    for (const sock of subs) {
      if (sock.readyState !== 1) {
        toEvict.push(sock);
        continue;
      }
      if ((sock.bufferedAmount ?? 0) > maxBufferedBytes) {
        toEvict.push(sock);
        sock.close(WS_CLOSE_POLICY_VIOLATION, 'Slow consumer');
        continue;
      }
      try {
        sock.send(serialized);
      } catch {
        toEvict.push(sock);
      }
    }

    for (const sock of toEvict) {
      cleanupSocket(sock);
    }
  }

  function broadcastPresence(channel: string): void {
    const map = channelPresence.get(channel);
    const members = map !== undefined ? [...map.values()] : [];
    broadcastRaw(channel, JSON.stringify({ type: 'presence', channel, members }));
  }

  function cleanupSocket(socket: HubSocket): void {
    const joinedChannels = socketChannels.get(socket);
    if (joinedChannels !== undefined) {
      for (const ch of joinedChannels) {
        const subs = channelSubscribers.get(ch);
        subs?.delete(socket);
        if (subs?.size === 0) {
          channelSubscribers.delete(ch);
        }
        const presenceMap = channelPresence.get(ch);
        if (presenceMap !== undefined && presenceMap.delete(socket)) {
          if (presenceMap.size === 0) {
            channelPresence.delete(ch);
          }
          broadcastPresence(ch);
        }
      }
      socketChannels.delete(socket);
    }
  }

  return {
    subscribe(channel: string, socket: HubSocket): boolean {
      let socketSet = socketChannels.get(socket);
      if (socketSet === undefined) {
        socketSet = new Set();
        socketChannels.set(socket, socketSet);
      }
      if (!socketSet.has(channel) && socketSet.size >= maxSubscriptionsPerSocket) {
        return false;
      }
      socketSet.add(channel);

      let subs = channelSubscribers.get(channel);
      if (subs === undefined) {
        subs = new Set();
        channelSubscribers.set(channel, subs);
      }
      subs.add(socket);
      return true;
    },

    unsubscribe(channel: string, socket: HubSocket): void {
      channelSubscribers.get(channel)?.delete(socket);
      if (channelSubscribers.get(channel)?.size === 0) {
        channelSubscribers.delete(channel);
      }
      socketChannels.get(socket)?.delete(channel);

      const presenceMap = channelPresence.get(channel);
      if (presenceMap !== undefined && presenceMap.delete(socket)) {
        if (presenceMap.size === 0) {
          channelPresence.delete(channel);
        }
        broadcastPresence(channel);
      }
    },

    cleanupSocket,

    allowInboundMessage(socket: HubSocket, nowMs: number = Date.now()): boolean {
      let state = socketRates.get(socket);
      if (state === undefined || nowMs - state.windowStartMs >= rateLimitWindowMs) {
        state = { windowStartMs: nowMs, count: 1 };
        socketRates.set(socket, state);
        return true;
      }
      state.count += 1;
      if (state.count > maxMessagesPerWindow) {
        socket.close(WS_CLOSE_POLICY_VIOLATION, 'Rate limit exceeded');
        cleanupSocket(socket);
        return false;
      }
      return true;
    },

    publishInvalidation(key: string, version: number, timestamp: number = Date.now()): void {
      broadcastRaw(key, JSON.stringify({ type: 'update', key, version, timestamp }));
    },

    publishFrame<TPayload>(
      channel: string,
      payload: TPayload,
      frameOpts?: { seq?: number; timestamp?: number },
    ): SequencedFrame<TPayload> {
      const nextSeq = frameOpts?.seq ?? (channelSeq.get(channel) ?? 0) + 1;
      channelSeq.set(channel, Math.max(channelSeq.get(channel) ?? 0, nextSeq));
      const timestamp = frameOpts?.timestamp ?? Date.now();

      const frame: SequencedFrame<TPayload> = {
        type: 'frame',
        channel,
        seq: nextSeq,
        payload,
        timestamp,
      };

      if (maxHistoryPerChannel > 0) {
        let history = channelHistory.get(channel);
        if (history === undefined) {
          history = [];
          channelHistory.set(channel, history);
        }
        history.push(frame);
        if (history.length > maxHistoryPerChannel) {
          history.splice(0, history.length - maxHistoryPerChannel);
        }
      }

      broadcastRaw(channel, JSON.stringify(frame));
      return frame;
    },

    replayFrames(channel: string, afterSeq: number): readonly SequencedFrame[] {
      const history = channelHistory.get(channel);
      if (history === undefined) return [];
      return history.filter((entry) => entry.seq > afterSeq);
    },

    joinPresence(channel: string, socket: HubSocket, member: PresenceMember): void {
      let map = channelPresence.get(channel);
      if (map === undefined) {
        map = new Map();
        channelPresence.set(channel, map);
      }
      map.set(socket, member);
      broadcastPresence(channel);
    },

    leavePresence(channel: string, socket: HubSocket): void {
      const map = channelPresence.get(channel);
      if (map !== undefined && map.delete(socket)) {
        if (map.size === 0) {
          channelPresence.delete(channel);
        }
        broadcastPresence(channel);
      }
    },

    getPresence(channel: string): readonly PresenceMember[] {
      const map = channelPresence.get(channel);
      return map !== undefined ? [...map.values()] : [];
    },
  };
}
