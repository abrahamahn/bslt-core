// main/kernel/db/src/pubsub/postgres-listener.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPgPool } from '@bslt/protocols/pg';

import { createPostgresChannelListener } from './postgres-listener';

const mockListeners = new Map<string, (payload: string) => void>();
let lastOpts: Record<string, unknown> | undefined;
let failListen = false;
const mockEnd = vi.fn(() => Promise.resolve());

vi.mock('@bslt/protocols/pg', () => ({
  createPgPool: vi.fn((_dsn: string, opts: Record<string, unknown>) => {
    lastOpts = opts;
    return {
      listen: vi.fn((channel: string, cb: (payload: string) => void) => {
        if (failListen) {
          return Promise.reject(new Error('listen refused'));
        }
        mockListeners.set(channel, cb);
        return Promise.resolve({ unlisten: () => Promise.resolve() });
      }),
      end: mockEnd,
    };
  }),
}));

describe('createPostgresChannelListener', () => {
  beforeEach(() => {
    mockListeners.clear();
    lastOpts = undefined;
    failListen = false;
    mockEnd.mockClear();
    vi.mocked(createPgPool).mockClear();
  });

  it('opens a dedicated max=1 idle_timeout=0 LISTEN session and forwards notifications', async () => {
    const received: string[] = [];
    const listener = createPostgresChannelListener({
      connectionString: 'postgresql://bslt_worker:pw@127.0.0.1:5432/app',
      channel: 'bslt_outbox',
      ssl: false,
      onNotify: (payload) => {
        received.push(payload);
      },
    });

    await listener.start();
    await listener.start();
    expect(vi.mocked(createPgPool)).toHaveBeenCalledTimes(1);
    expect(lastOpts?.['max']).toBe(1);
    expect(lastOpts?.['idle_timeout']).toBe(0);
    expect(listener.isActive).toBe(true);

    mockListeners.get('bslt_outbox')?.('wake');
    expect(received).toEqual(['wake']);

    await listener.stop();
    await listener.stop();
    expect(listener.isActive).toBe(false);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('rejects empty connectionString before opening a socket', () => {
    expect(() =>
      createPostgresChannelListener({
        connectionString: '',
        channel: 'bslt_outbox',
        onNotify: () => {},
      }),
    ).toThrow(/connectionString/i);
  });

  it('rejects unsafe channel identifiers', () => {
    expect(() =>
      createPostgresChannelListener({
        connectionString: 'postgresql://bslt_worker:pw@127.0.0.1:5432/app',
        channel: 'bslt_outbox; DROP TABLE sys_outbox',
        onNotify: () => {},
      }),
    ).toThrow(/channel/i);
  });

  it('closes client and rethrows when initial LISTEN fails', async () => {
    failListen = true;
    const errors: Error[] = [];
    const listener = createPostgresChannelListener({
      connectionString: 'postgresql://bslt_worker:pw@127.0.0.1:5432/app',
      channel: 'bslt_outbox',
      onNotify: () => {},
      onError: (err) => errors.push(err),
    });

    await expect(listener.start()).rejects.toThrow('listen refused');
    expect(errors).toHaveLength(1);
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(listener.isActive).toBe(false);
  });

  it('reports connection close events through onError', async () => {
    const errors: Error[] = [];
    const listener = createPostgresChannelListener({
      connectionString: 'postgresql://bslt_worker:pw@127.0.0.1:5432/app',
      channel: 'bslt_outbox',
      onNotify: () => {},
      onError: (err) => errors.push(err),
    });

    await listener.start();
    const onclose = lastOpts?.['onclose'] as (() => void) | undefined;
    onclose?.();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/bslt_outbox/i);
    await listener.stop();
  });
});
