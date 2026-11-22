// main/kernel/realtime/src/channels.test.ts
import { describe, expect, it } from 'vitest';

import {
  createChannelRegistry,
  defaultChannelRegistry,
  defineChannel,
  type ChannelViewer,
} from './channels';

const USER_A: ChannelViewer = { userId: 'user-a', role: 'user', orgId: 'org-1' };
const USER_B: ChannelViewer = { userId: 'user-b', role: 'user', orgId: 'org-2' };
const ADMIN_VIEWER: ChannelViewer = { userId: 'admin-1', role: 'admin', orgId: null };

describe('defineChannel and ChannelRegistry (deny-by-default)', () => {
  it('authorizes owners on declared user channels and anonymous viewers on anonymous-read channels', async () => {
    expect(await defaultChannelRegistry.authorize(USER_A, 'user:user-a')).toEqual({
      allowed: true,
      mode: 'user',
    });
    expect(await defaultChannelRegistry.authorize(USER_A, 'record:notifications:user-a')).toEqual({
      allowed: true,
      mode: 'user',
    });
    expect(await defaultChannelRegistry.authorize(null, 'public:status')).toEqual({
      allowed: true,
      mode: 'anonymous-read',
    });
    expect(await defaultChannelRegistry.authorize(USER_B, 'public:status')).toEqual({
      allowed: true,
      mode: 'anonymous-read',
    });
  });

  it.each([
    ['undeclared namespace', USER_A, 'secret:internal:feed'],
    ['undeclared list channel', USER_A, 'list:tasks:user-a'],
    ['undeclared users record channel', USER_A, 'record:users:user-a'],
    ['cross-user user:{userId} channel', USER_B, 'user:user-a'],
    ['cross-user notifications channel', USER_B, 'record:notifications:user-a'],
    ['anonymous viewer on user:{userId}', null, 'user:user-a'],
    ['anonymous viewer on notifications channel', null, 'record:notifications:user-a'],
    ['empty channel string', USER_A, ''],
    ['extra trailing segment on user channel', USER_A, 'user:user-a:extra'],
    ['empty parameter value on user channel', USER_A, 'user:'],
    ['prototype-pollution segment', USER_A, 'record:__proto__:user-a'],
  ])('denies %s by default', async (_label, viewer, channel) => {
    const decision = await defaultChannelRegistry.authorize(viewer, channel);
    expect(decision.allowed).toBe(false);
  });

  it('enforces admin-only channels and custom org authorizers', async () => {
    const adminOps = defineChannel('admin:ops', {
      auth: 'admin',
      authorize: () => true,
    });
    const orgFeed = defineChannel('org:{orgId}:feed', {
      auth: 'user',
      authorize: (viewer, params) => viewer !== null && viewer.orgId === params['orgId'],
    });
    const registry = createChannelRegistry([adminOps, orgFeed]);

    expect((await registry.authorize(null, 'admin:ops')).allowed).toBe(false);
    expect((await registry.authorize(USER_A, 'admin:ops')).allowed).toBe(false);
    expect((await registry.authorize(ADMIN_VIEWER, 'admin:ops')).allowed).toBe(true);

    expect((await registry.authorize(USER_A, 'org:org-1:feed')).allowed).toBe(true);
    expect((await registry.authorize(USER_B, 'org:org-1:feed')).allowed).toBe(false);
    expect((await registry.authorize(null, 'org:org-1:feed')).allowed).toBe(false);
  });

  it('rejects duplicate channel patterns or invalid empty patterns at registration time', () => {
    expect(() => defineChannel('', { auth: 'user', authorize: () => false })).toThrow();
    const ch = defineChannel('org:{orgId}:live', { auth: 'user', authorize: () => true });
    expect(() => createChannelRegistry([ch, ch])).toThrow(/duplicate/iu);
  });
});
