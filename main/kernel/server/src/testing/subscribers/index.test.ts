// main/kernel/server/src/testing/subscribers/index.test.ts
import { describe, expect, it } from 'vitest';

import { runSubscriberTwice } from './index';

const sampleEvent = {
  eventId: '42',
  name: 'orgs.member.added',
  version: 1,
  payload: { orgId: 'org-1', userId: 'user-1', nested: { role: 'member' } },
  actorUserId: 'actor-1',
  orgId: 'org-1',
  occurredAt: '2026-11-14T00:00:00.000Z',
};

describe('runSubscriberTwice', () => {
  it('passes for an idempotent Subscription object with service and state snapshot', async () => {
    const processed = new Set<string>();
    const sideEffects: string[] = [];
    const subscriber = {
      id: 'fanout',
      handle: async (
        ev: typeof sampleEvent,
        svc: { readonly record: (entry: string) => void },
      ): Promise<number> => {
        await Promise.resolve();
        if (!processed.has(ev.eventId)) {
          processed.add(ev.eventId);
          svc.record(`${ev.name}:${ev.payload.userId}`);
        }
        return sideEffects.length;
      },
    };

    const result = await runSubscriberTwice(
      subscriber,
      sampleEvent,
      { record: (entry) => sideEffects.push(entry) },
      { snapshot: () => [...sideEffects] },
    );

    expect(result).toEqual({ first: 1, second: 1 });
    expect(sideEffects).toEqual(['orgs.member.added:user-1']);
  });

  it('passes for an idempotent standalone subscriber function', async () => {
    const seen = new Map<string, string>();
    await runSubscriberTwice(async (ev: typeof sampleEvent) => {
      await Promise.resolve();
      seen.set(ev.eventId, ev.payload.orgId);
    }, sampleEvent);

    expect([...seen.entries()]).toEqual([['42', 'org-1']]);
  });

  it('fails when a non-idempotent subscriber produces duplicate side effects on replay', async () => {
    const rows: string[] = [];
    const buggySubscriber = {
      id: 'buggy-append',
      handle: async (ev: typeof sampleEvent): Promise<void> => {
        await Promise.resolve();
        rows.push(ev.eventId);
      },
    };

    await expect(
      runSubscriberTwice(buggySubscriber, sampleEvent, undefined, {
        snapshot: () => [...rows],
      }),
    ).rejects.toThrow(/idempotent|snapshot/iu);
  });

  it('fails when the second execution returns a different value than the first', async () => {
    let count = 0;
    await expect(
      runSubscriberTwice(async () => {
        await Promise.resolve();
        count += 1;
        return count;
      }, sampleEvent),
    ).rejects.toThrow(/idempotent|return/iu);
  });

  it('fails when a subscriber attempts to mutate the delivered event payload', async () => {
    await expect(
      runSubscriberTwice(async (ev: typeof sampleEvent) => {
        await Promise.resolve();
        (ev.payload.nested as { role: string }).role = 'admin';
      }, sampleEvent),
    ).rejects.toThrow(TypeError);
  });

  it('propagates errors thrown on either subscriber invocation', async () => {
    let calls = 0;
    await expect(
      runSubscriberTwice(async () => {
        await Promise.resolve();
        calls += 1;
        if (calls === 2) {
          throw new Error('boom on replay');
        }
      }, sampleEvent),
    ).rejects.toThrow('boom on replay');
  });
});
