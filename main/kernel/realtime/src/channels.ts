// main/kernel/realtime/src/channels.ts
/**
 * Deny-by-default Realtime Channel Registry (restructure plan §8.6).
 *
 * Only channels declared with `defineChannel` exist. Each channel specifies
 * `auth: 'user' | 'admin' | 'anonymous-read'` and an `authorize(viewer, params)`
 * predicate over extracted `{param}` segments.
 */

type ChannelAuthMode = 'user' | 'admin' | 'anonymous-read';

export interface ChannelViewer {
  readonly userId: string;
  readonly role: string;
  readonly orgId?: string | null;
}

type ChannelDef = {
  readonly pattern: string;
  readonly segments: readonly string[];
  readonly auth: ChannelAuthMode;
  readonly authorize: (
    viewer: ChannelViewer | null,
    params: Readonly<Record<string, string>>,
  ) => boolean | Promise<boolean>;
};

type ChannelAuthorizationResult = {
  readonly allowed: boolean;
  readonly mode?: ChannelAuthMode;
  readonly reason?: string;
};

export interface ChannelRegistry {
  readonly definitions: readonly ChannelDef[];
  authorize(viewer: ChannelViewer | null, channel: string): Promise<ChannelAuthorizationResult>;
}

const FORBIDDEN_SEGMENT_VALUES = new Set(['__proto__', 'constructor', 'prototype']);

export function defineChannel(
  pattern: string,
  config: {
    readonly auth: ChannelAuthMode;
    readonly authorize: (
      viewer: ChannelViewer | null,
      params: Readonly<Record<string, string>>,
    ) => boolean | Promise<boolean>;
  },
): ChannelDef {
  const trimmed = pattern.trim();
  if (trimmed === '') {
    throw new TypeError('Channel pattern must not be empty');
  }
  const segments = trimmed.split(':');
  if (segments.some((seg) => seg === '')) {
    throw new TypeError(`Invalid channel pattern "${pattern}": empty segment`);
  }
  return Object.freeze({
    pattern: trimmed,
    segments: Object.freeze(segments),
    auth: config.auth,
    authorize: config.authorize,
  });
}

function matchPattern(
  def: ChannelDef,
  channelSegments: readonly string[],
): Record<string, string> | null {
  if (def.segments.length !== channelSegments.length) {
    return null;
  }
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 0; i < def.segments.length; i += 1) {
    const pat = def.segments[i] ?? '';
    const actual = channelSegments[i] ?? '';
    if (actual === '' || FORBIDDEN_SEGMENT_VALUES.has(actual)) {
      return null;
    }
    if (pat.startsWith('{') && pat.endsWith('}') && pat.length > 2) {
      const paramName = pat.slice(1, -1);
      params[paramName] = actual;
    } else if (pat !== actual) {
      return null;
    }
  }
  return params;
}

export function createChannelRegistry(definitions: readonly ChannelDef[]): ChannelRegistry {
  const seen = new Set<string>();
  for (const def of definitions) {
    if (seen.has(def.pattern)) {
      throw new Error(`Duplicate realtime channel pattern "${def.pattern}"`);
    }
    seen.add(def.pattern);
  }

  const list = [...definitions];

  return {
    definitions: list,
    async authorize(
      viewer: ChannelViewer | null,
      channel: string,
    ): Promise<ChannelAuthorizationResult> {
      if (channel === '') {
        return { allowed: false, reason: 'empty_channel' };
      }
      const channelSegments = channel.split(':');
      if (channelSegments.some((seg) => seg === '' || FORBIDDEN_SEGMENT_VALUES.has(seg))) {
        return { allowed: false, reason: 'invalid_channel_format' };
      }

      for (const def of list) {
        const params = matchPattern(def, channelSegments);
        if (params === null) continue;

        if (def.auth === 'user') {
          if (viewer === null || viewer.userId === '') {
            return { allowed: false, reason: 'unauthenticated' };
          }
        } else if (def.auth === 'admin') {
          if (viewer === null || viewer.role !== 'admin') {
            return { allowed: false, reason: 'insufficient_role' };
          }
        }

        const ok = await def.authorize(viewer, params);
        if (!ok) {
          return { allowed: false, reason: 'forbidden' };
        }
        return { allowed: true, mode: def.auth };
      }

      return { allowed: false, reason: 'undeclared_channel' };
    },
  };
}

const userRealtimeChannel = defineChannel('user:{userId}', {
  auth: 'user',
  authorize: (viewer, params) => viewer !== null && viewer.userId === params['userId'],
});

const notificationsRealtimeChannel = defineChannel('record:notifications:{userId}', {
  auth: 'user',
  authorize: (viewer, params) => viewer !== null && viewer.userId === params['userId'],
});

const publicStatusRealtimeChannel = defineChannel('public:status', {
  auth: 'anonymous-read',
  authorize: () => true,
});

export const defaultChannelRegistry: ChannelRegistry = createChannelRegistry([
  userRealtimeChannel,
  notificationsRealtimeChannel,
  publicStatusRealtimeChannel,
]);
