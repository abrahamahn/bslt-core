// main/kernel/comms/src/notifications/providers/web-push-provider.test.ts
/**
 * Tests for the Web Push (VAPID) provider over `@bslt/protocols/webpush`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebPushProvider, WebPushProvider } from './web-push-provider';

import type { NotificationPayload, PushSubscription, SubscriptionWithId } from './types';

const { sendWebPushNotification, MockWebPushProtocolError } = vi.hoisted(() => {
  class HoistedWebPushProtocolError extends Error {
    readonly statusCode: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'WebPushProtocolError';
      this.statusCode = statusCode;
      this.headers = {};
      this.body = message;
    }
  }
  return {
    sendWebPushNotification: vi.fn(),
    MockWebPushProtocolError: HoistedWebPushProtocolError,
  };
});

vi.mock('@bslt/protocols/webpush', () => ({
  sendWebPushNotification,
  WebPushProtocolError: MockWebPushProtocolError,
}));

const VAPID = {
  publicKey: 'pub-key',
  privateKey: 'priv-key',
  subject: 'mailto:ops@example.com',
};

const subscription: PushSubscription = {
  endpoint: 'https://push.example.com/sub-1',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};

const payload: NotificationPayload = {
  title: 'Hello',
  body: 'You have a new message',
  url: 'https://app.example.com/inbox',
  data: { messageId: 'm-1' },
};

function subWithId(id: string, endpoint: string): SubscriptionWithId {
  return { id, subscription: { ...subscription, endpoint } };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendWebPushNotification.mockResolvedValue({ statusCode: 201, headers: {}, body: '' });
});

describe('WebPushProvider — configuration', () => {
  it('is unconfigured (and refuses to send) without VAPID keys', async () => {
    const provider = createWebPushProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.getPublicKey()).toBeUndefined();

    const result = await provider.send(subscription, payload);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not configured/iu);
    expect(sendWebPushNotification).not.toHaveBeenCalled();
  });

  it('treats partially-filled VAPID config as unconfigured', () => {
    expect(
      new WebPushProvider({ publicKey: 'x', privateKey: '', subject: 'm' }).isConfigured(),
    ).toBe(false);
    expect(
      new WebPushProvider({ publicKey: '', privateKey: 'y', subject: 'm' }).isConfigured(),
    ).toBe(false);
    expect(
      new WebPushProvider({ publicKey: 'x', privateKey: 'y', subject: '' }).isConfigured(),
    ).toBe(false);
  });

  it('exposes the public key when configured', () => {
    const provider = createWebPushProvider(VAPID);
    expect(provider.isConfigured()).toBe(true);
    expect(provider.getPublicKey()).toBe('pub-key');
  });
});

describe('WebPushProvider — send', () => {
  it('maps subscription, payload, VAPID details, and options onto @bslt/protocols/webpush', async () => {
    const provider = createWebPushProvider(VAPID);
    const result = await provider.send(subscription, payload, {
      ttl: 60,
      urgency: 'high',
      topic: 'inbox',
    });

    expect(result).toMatchObject({
      success: true,
      subscriptionId: subscription.endpoint,
      statusCode: 201,
    });

    const [sentSub, sentBody, sentVapid, sentOptions] = sendWebPushNotification.mock.calls[0] as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
      { publicKey: string; privateKey: string; subject: string },
      { ttl?: number; urgency?: string; topic?: string },
    ];
    expect(sentSub).toEqual({
      endpoint: subscription.endpoint,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    });
    expect(sentVapid).toEqual(VAPID);
    const decoded = JSON.parse(sentBody) as {
      title: string;
      data: { url: string; messageId: string };
    };
    expect(decoded.title).toBe('Hello');
    expect(decoded.data.url).toBe('https://app.example.com/inbox');
    expect(decoded.data.messageId).toBe('m-1');
    expect(sentOptions).toMatchObject({ ttl: 60, urgency: 'high', topic: 'inbox' });
  });

  it('reports a non-expiry HTTP failure with its status code and handles network errors', async () => {
    sendWebPushNotification
      .mockRejectedValueOnce(new MockWebPushProtocolError('Payload too large', 413))
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const provider = createWebPushProvider(VAPID);

    const httpFail = await provider.send(subscription, payload);
    expect(httpFail).toMatchObject({ success: false, statusCode: 413 });

    const netFail = await provider.send(subscription, payload);
    expect(netFail).toMatchObject({ success: false, error: 'ECONNRESET' });
  });
});

describe('WebPushProvider — sendBatch and expiry', () => {
  it('flags 404/410 subscriptions as expired and tallies results', async () => {
    sendWebPushNotification
      .mockResolvedValueOnce({ statusCode: 201, headers: {}, body: '' })
      .mockRejectedValueOnce(new MockWebPushProtocolError('Gone', 410))
      .mockRejectedValueOnce(new MockWebPushProtocolError('Not found', 404))
      .mockRejectedValueOnce(new MockWebPushProtocolError('Server error', 500));

    const provider = createWebPushProvider(VAPID);
    const result = await provider.sendBatch(
      [
        subWithId('sub-ok', 'https://push.example.com/ok'),
        subWithId('sub-gone', 'https://push.example.com/gone'),
        subWithId('sub-missing', 'https://push.example.com/missing'),
        subWithId('sub-error', 'https://push.example.com/error'),
      ],
      payload,
    );

    expect(result.total).toBe(4);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(3);
    expect(result.expiredSubscriptions).toEqual(['sub-gone', 'sub-missing']);
  });
});
