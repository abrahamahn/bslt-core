// main/kernel/server/src/testing/database/lifecycle.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase } from './lifecycle';

const mocks = vi.hoisted(() => ({
  bootstrapClusterRoles: vi.fn(),
  createRawDb: vi.fn(),
  initEnv: vi.fn(),
  inspectDatabaseRole: vi.fn(),
  migrationSources: vi.fn(() => []),
  runMigrations: vi.fn(),
}));

vi.mock('@bslt/db', async () => {
  const actual = await vi.importActual<typeof import('@bslt/db')>('@bslt/db');
  return {
    ...actual,
    bootstrapClusterRoles: mocks.bootstrapClusterRoles,
    buildConnectionString: () => 'postgresql://postgres:pw@127.0.0.1:5432/postgres',
    createRawDb: mocks.createRawDb,
    inspectDatabaseRole: mocks.inspectDatabaseRole,
    migrationSources: mocks.migrationSources,
    runMigrations: mocks.runMigrations,
  };
});

vi.mock('../../config/factory', () => ({
  initEnv: mocks.initEnv,
}));

interface FakeClient {
  readonly raw: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
}

function makeFakeClient(url: string): FakeClient {
  const client = {
    url,
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    transaction: vi.fn(),
    withSession: vi.fn(),
    raw: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return client as unknown as FakeClient;
}

describe('createTestDatabase', () => {
  const clientsByUrl = new Map<string, FakeClient[]>();

  beforeEach(() => {
    clientsByUrl.clear();
    mocks.initEnv.mockReset().mockResolvedValue(undefined);
    mocks.bootstrapClusterRoles.mockReset().mockResolvedValue(undefined);
    mocks.runMigrations.mockReset().mockResolvedValue(undefined);
    mocks.inspectDatabaseRole.mockReset().mockResolvedValue({
      name: 'postgres',
      superuser: true,
    });
    mocks.createRawDb.mockReset().mockImplementation((urlOrOpts: unknown) => {
      const url =
        typeof urlOrOpts === 'string'
          ? urlOrOpts
          : String((urlOrOpts as { connectionString?: string }).connectionString);
      const client = makeFakeClient(url);
      const list = clientsByUrl.get(url) ?? [];
      list.push(client);
      clientsByUrl.set(url, list);
      return client;
    });
  });

  it('closes the admin client and throws a descriptive error when inspectDatabaseRole rejects', async () => {
    mocks.inspectDatabaseRole.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(
      createTestDatabase({
        baseConnectionString: 'postgresql://postgres:secret@127.0.0.1:5432/postgres',
      }),
    ).rejects.toThrow(/real-DB harness could not use its admin connection.*ECONNREFUSED/iu);

    const adminClient = [...clientsByUrl.values()][0]?.[0];
    expect(adminClient?.close).toHaveBeenCalledTimes(1);
  });

  it('closes the admin client and rejects when the admin role is not a superuser', async () => {
    mocks.inspectDatabaseRole.mockResolvedValueOnce({
      name: 'limited_user',
      superuser: false,
    });

    await expect(
      createTestDatabase({
        baseConnectionString: 'postgresql://limited_user:pw@127.0.0.1:5432/bslt',
      }),
    ).rejects.toThrow(/not a superuser/iu);

    const adminClient = [...clientsByUrl.values()][0]?.[0];
    expect(adminClient?.close).toHaveBeenCalledTimes(1);
  });

  it('closes mainDb and rethrows when CREATE DATABASE fails during provisioning', async () => {
    mocks.createRawDb.mockImplementationOnce((url: string) => {
      const client = makeFakeClient(url);
      client.raw.mockRejectedValueOnce(new Error('disk full'));
      clientsByUrl.set(url, [client]);
      return client;
    });

    await expect(
      createTestDatabase({
        baseConnectionString: 'postgresql://postgres:pw@127.0.0.1:5432/postgres',
      }),
    ).rejects.toThrow('disk full');

    const adminClient = [...clientsByUrl.values()][0]?.[0];
    expect(adminClient?.close).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-deadlock errors from truncate immediately without retrying', async () => {
    const handle = await createTestDatabase({
      baseConnectionString: 'postgresql://postgres:pw@127.0.0.1:5432/postgres',
    });
    const ownerFake = handle.ownerDb as unknown as FakeClient;
    ownerFake.raw.mockRejectedValueOnce(
      Object.assign(new Error('permission denied for table users'), { code: '42501' }),
    );

    await expect(handle.truncate('users')).rejects.toThrow('permission denied for table users');
    expect(ownerFake.raw).toHaveBeenCalledTimes(1);
  });

  it('retries deadlocks (40P01) during truncate and rethrows once retries are exhausted', async () => {
    vi.useFakeTimers();
    try {
      const handle = await createTestDatabase({
        baseConnectionString: 'postgresql://postgres:pw@127.0.0.1:5432/postgres',
      });
      const ownerFake = handle.ownerDb as unknown as FakeClient;
      ownerFake.raw.mockRejectedValue(
        Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      );

      const assertion = expect(handle.truncate('tasks')).rejects.toThrow('deadlock detected');
      await vi.runAllTimersAsync();
      await assertion;
      expect(ownerFake.raw).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('provisions isolated role URLs, recovers from a single transient deadlock, migrates, and destroys cleanly', async () => {
    vi.useFakeTimers();
    try {
      const handle = await createTestDatabase({
        baseConnectionString: 'postgresql://postgres:pw@127.0.0.1:5432/postgres',
      });

      expect(handle.connectionString).toContain('bslt_worker:');
      expect(handle.appConnectionString).toContain('bslt_app:');
      expect(handle.ownerConnectionString).toContain('bslt_owner:');

      const ownerFake = handle.ownerDb as unknown as FakeClient;
      ownerFake.raw
        .mockRejectedValueOnce(Object.assign(new Error('deadlock detected'), { code: '40P01' }))
        .mockResolvedValueOnce([]);

      const truncatePromise = handle.truncate('tasks CASCADE');
      await vi.runAllTimersAsync();
      await truncatePromise;
      expect(ownerFake.raw).toHaveBeenCalledTimes(2);

      await handle.migrate();
      expect(mocks.runMigrations).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: handle.ownerConnectionString,
        }),
      );

      // Touch lazy adminDb getter so destroy closes it too
      expect(handle.adminDb).toBeDefined();
      await handle.destroy();
      expect((handle.db as unknown as FakeClient).close).toHaveBeenCalledTimes(1);
      expect((handle.appDb as unknown as FakeClient).close).toHaveBeenCalledTimes(1);
      expect(ownerFake.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
