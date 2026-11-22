// main/kernel/server/src/testing/subscribers/index.ts
/**
 * Subscriber idempotency test harness (`runSubscriberTwice`, Plan §8.5, §15).
 *
 * Outbox delivery is at-least-once. Every module subscriber must be idempotent
 * on replay of the same `eventId`. `runSubscriberTwice` deep-freezes the event,
 * invokes the subscriber twice with identical inputs, and verifies that both
 * return values and any optional side-effect state snapshot match.
 */
import { isDeepStrictEqual } from 'node:util';

interface HandleObject<E, S, R> {
  readonly id?: string | undefined;
  handle(event: E, service: S): Promise<R>;
}

interface RunSubscriberTwiceOptions {
  readonly snapshot?: (() => unknown) | undefined;
}

function deepFreezeClone<T>(value: T): T {
  if (Array.isArray(value)) {
    const cloned = value.map((item: unknown) => deepFreezeClone(item));
    return Object.freeze(cloned) as unknown as T;
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        Object.defineProperty(out, key, {
          value: deepFreezeClone(record[key]),
          enumerable: true,
          writable: false,
          configurable: false,
        });
      }
      return Object.freeze(out) as unknown as T;
    }
  }
  return value;
}

export async function runSubscriberTwice<E, S = undefined, R = void>(
  subscriber: HandleObject<E, S, R> | ((event: E, service: S) => Promise<R>),
  event: E,
  service?: S,
  options?: RunSubscriberTwiceOptions,
): Promise<{ readonly first: R; readonly second: R }> {
  const frozenEvent = deepFreezeClone(event);
  const resolvedService = service as S;
  const invoke =
    typeof subscriber === 'function'
      ? (ev: E): Promise<R> => subscriber(ev, resolvedService)
      : (ev: E): Promise<R> => subscriber.handle(ev, resolvedService);
  const label =
    typeof subscriber === 'function'
      ? subscriber.name || 'subscriber'
      : (subscriber.id ?? 'subscriber');

  const first = await invoke(frozenEvent);
  const snapshotAfterFirst = options?.snapshot !== undefined ? await options.snapshot() : undefined;

  const second = await invoke(frozenEvent);
  const snapshotAfterSecond =
    options?.snapshot !== undefined ? await options.snapshot() : undefined;

  if (!isDeepStrictEqual(second, first)) {
    throw new Error(
      `Subscriber "${label}" is not idempotent: second execution return value differed from first`,
    );
  }

  if (
    options?.snapshot !== undefined &&
    !isDeepStrictEqual(snapshotAfterSecond, snapshotAfterFirst)
  ) {
    throw new Error(
      `Subscriber "${label}" is not idempotent: state snapshot changed on duplicate event delivery`,
    );
  }

  return { first, second };
}
