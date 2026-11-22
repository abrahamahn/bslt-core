// main/kernel/db/src/pubsub/postgres-pubsub.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubKeys, type SubscriptionKey } from '@bslt/contract';
import { createPgPool } from '@bslt/protocols/pg';

import { PostgresPubSub, type PostgresPubSubOptions } from './postgres-pubsub';

const { sharedListeners, triggerNotification } = vi.hoisted(() => {
  const listeners = new Map<string, (payload: string) => void>();
  return {
    sharedListeners: listeners,
    triggerNotification: (channel: string, payload: string): void => {
      const listener = listeners.get(channel);
      if (listener !== undefined) listener(payload);
    },
  };
});

vi.mock('@bslt/protocols/pg', () => ({
  createPgPool: vi.fn(() => ({
    listen: vi.fn((channel: string, callback: (payload: string) => void) => {
      sharedListeners.set(channel, callback);
      return Promise.resolve({ unlisten: () => Promise.resolve() });
    }),
    notify: vi.fn((channel: string, payload: string) => {
      const listener = sharedListeners.get(channel);
      if (listener !== undefined) {
        setTimeout(() => {
          listener(payload);
        }, 0);
      }
      return Promise.resolve();
    }),
    end: vi.fn(() => {
      sharedListeners.clear();
      return Promise.resolve();
    }),
  })),
}));

describe('PostgresPubSub', () => {
  let pubsub: PostgresPubSub | undefined;
  let onMessageMock: ReturnType<typeof vi.fn<(key: SubscriptionKey, version: number) => void>>;
  let onErrorMock: ReturnType<typeof vi.fn<(error: Error) => void>>;

  const defaultOptions: PostgresPubSubOptions = {
    connectionString: 'postgres://localhost:5432/test',
    channel: 'test_channel',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sharedListeners.clear();
    onMessageMock = vi.fn();
    onErrorMock = vi.fn();
  });

  afterEach(async () => {
    if (pubsub !== undefined) {
      await pubsub.stop();
    }
  });

  describe('Connection options', () => {
    it("gives the driver its timeouts in seconds, the driver's unit", async () => {
      pubsub = new PostgresPubSub(defaultOptions);

      await pubsub.start();

      const [listenOptions, notifyOptions] = vi
        .mocked(createPgPool)
        .mock.calls.map((call) => call[1] as unknown as Record<string, unknown>);
      expect(listenOptions).toMatchObject({ max: 1, idle_timeout: 0, connect_timeout: 10 });
      expect(notifyOptions).toMatchObject({ max: 3, idle_timeout: 30 });
    });
  });

  describe('Initialization', () => {
    it('should create instance with default channel', () => {
      pubsub = new PostgresPubSub({
        connectionString: defaultOptions.connectionString,
      });

      expect(pubsub).toBeDefined();
      expect(pubsub.isActive).toBe(false);
    });

    it('should create instance with custom channel', () => {
      pubsub = new PostgresPubSub(defaultOptions);

      expect(pubsub).toBeDefined();
      expect(pubsub.id).toBeTruthy();
    });

    it('should generate unique instance IDs', () => {
      const pubsub1 = new PostgresPubSub(defaultOptions);
      const pubsub2 = new PostgresPubSub(defaultOptions);

      expect(pubsub1.id).not.toBe(pubsub2.id);
    });
  });

  describe('Lifecycle', () => {
    it('should start listening', async () => {
      pubsub = new PostgresPubSub({
        ...defaultOptions,
        onMessage: onMessageMock,
        onError: onErrorMock,
      });

      await pubsub.start();

      expect(pubsub.isActive).toBe(true);
    });

    it('should pass SSL options to listen and notify clients', async () => {
      pubsub = new PostgresPubSub({
        ...defaultOptions,
        ssl: true,
      });

      await pubsub.start();

      expect(createPgPool).toHaveBeenNthCalledWith(
        1,
        defaultOptions.connectionString,
        expect.objectContaining({ ssl: true }),
      );
      expect(createPgPool).toHaveBeenNthCalledWith(
        2,
        defaultOptions.connectionString,
        expect.objectContaining({ ssl: true }),
      );
    });

    it('should not start twice', async () => {
      pubsub = new PostgresPubSub(defaultOptions);

      await pubsub.start();
      await pubsub.start();

      expect(pubsub.isActive).toBe(true);
    });

    it('should stop listening', async () => {
      pubsub = new PostgresPubSub(defaultOptions);

      await pubsub.start();
      expect(pubsub.isActive).toBe(true);

      await pubsub.stop();
      expect(pubsub.isActive).toBe(false);
    });

    it('should handle stop when not started', async () => {
      pubsub = new PostgresPubSub(defaultOptions);

      await expect(pubsub.stop()).resolves.not.toThrow();
    });
  });

  describe('Publishing', () => {
    beforeEach(async () => {
      pubsub = new PostgresPubSub({
        ...defaultOptions,
        onMessage: onMessageMock,
        onError: onErrorMock,
      });
      await pubsub.start();
    });

    it('should publish messages', async () => {
      const key = SubKeys.record('users', '123');
      const version = 1;

      await expect(pubsub!.publish(key, version)).resolves.not.toThrow();
    });

    it('should throw if not started', async () => {
      const notStartedPubsub = new PostgresPubSub(defaultOptions);
      const key = SubKeys.record('users', '123');

      await expect(notStartedPubsub.publish(key, 1)).rejects.toThrow('PostgresPubSub not started');
    });

    it('should include instance ID in published messages', async () => {
      const key = SubKeys.record('users', '123');
      const version = 1;

      await pubsub!.publish(key, version);

      expect(pubsub!.id).toBeTruthy();
    });
  });

  describe('Message Handling', () => {
    it('should receive messages from other instances', async () => {
      pubsub = new PostgresPubSub({
        ...defaultOptions,
        onMessage: onMessageMock,
        onError: onErrorMock,
      });

      await pubsub.start();

      const message = {
        key: 'record:users:123',
        version: 1,
        instanceId: 'different-instance-id',
      };

      triggerNotification('test_channel', JSON.stringify(message));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onMessageMock).toHaveBeenCalledWith(message.key, message.version);
    });

    it('should ignore messages from self', async () => {
      pubsub = new PostgresPubSub({
        ...defaultOptions,
        onMessage: onMessageMock,
        onError: onErrorMock,
      });

      await pubsub.start();

      const message = {
        key: 'record:users:123',
        version: 1,
        instanceId: pubsub.id,
      };

      triggerNotification('test_channel', JSON.stringify(message));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onMessageMock).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON payloads', async () => {
      pubsub = new PostgresPubSub({
        ...defaultOptions,
        onMessage: onMessageMock,
        onError: onErrorMock,
      });

      await pubsub.start();

      triggerNotification('test_channel', 'invalid json');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onErrorMock).toHaveBeenCalled();
      expect(onMessageMock).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should call onError callback on errors', async () => {
      pubsub = new PostgresPubSub({
        ...defaultOptions,
        onMessage: onMessageMock,
        onError: onErrorMock,
      });

      await pubsub.start();

      triggerNotification('test_channel', '{invalid}');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onErrorMock).toHaveBeenCalled();
    });

    it('should use default no-op callbacks if not provided', async () => {
      pubsub = new PostgresPubSub({
        connectionString: defaultOptions.connectionString,
      });

      await expect(pubsub.start()).resolves.not.toThrow();
    });
  });

  describe('Multiple Instances', () => {
    it('should support multiple instances with different channels', async () => {
      const pubsub1 = new PostgresPubSub({
        ...defaultOptions,
        channel: 'channel1',
        onMessage: vi.fn(),
      });

      const pubsub2 = new PostgresPubSub({
        ...defaultOptions,
        channel: 'channel2',
        onMessage: vi.fn(),
      });

      await pubsub1.start();
      await pubsub2.start();

      expect(pubsub1.isActive).toBe(true);
      expect(pubsub2.isActive).toBe(true);
      expect(pubsub1.id).not.toBe(pubsub2.id);

      await pubsub1.stop();
      await pubsub2.stop();
    });
  });
});
