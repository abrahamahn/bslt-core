// main/kernel/server/src/config/env/env.notification.test.ts
import { describe, expect, it, test } from 'vitest';

import {
  BrazeSchema,
  CourierSchema,
  KnockSchema,
  NotificationConfigSchema,
  NotificationEnvSchema,
  NotificationProviderSchema,
  OneSignalSchema,
  SnsSchema,
} from './env.notification';

describe('provider config schemas', () => {
  test.each([
    [
      'OneSignalSchema',
      OneSignalSchema,
      { restApiKey: 'rk', userAuthKey: 'uk', appId: 'app' },
      { restApiKey: '', userAuthKey: 'uk', appId: 'app' },
    ],
    ['CourierSchema', CourierSchema, { apiKey: 'k' }, { apiKey: '' }],
    ['KnockSchema', KnockSchema, { secretKey: 's' }, {}],
    [
      'SnsSchema',
      SnsSchema,
      { accessKeyId: 'a', secretAccessKey: 's' },
      { accessKeyId: 'a', secretAccessKey: '' },
    ],
    ['BrazeSchema', BrazeSchema, { apiKey: 'k', apiUrl: 'https://api' }, { apiKey: 'k' }],
  ] as const)(
    '%s accepts minimal valid config and rejects invalid',
    (_l, schema, valid, invalid) => {
      expect(() => schema.parse(valid)).not.toThrow();
      expect(() => schema.parse(invalid)).toThrow();
    },
  );

  it('SnsSchema defaults region to us-east-1', () => {
    expect(SnsSchema.parse({ accessKeyId: 'a', secretAccessKey: 's' }).region).toBe('us-east-1');
  });

  it('nested settings.enableLogging must be boolean when present', () => {
    expect(() =>
      OneSignalSchema.parse({
        restApiKey: 'rk',
        userAuthKey: 'uk',
        appId: 'app',
        settings: { enableLogging: 'yes' },
      }),
    ).toThrow();
  });
});

describe('NotificationProviderSchema / NotificationConfigSchema', () => {
  test.each(['onesignal', 'courier', 'generic'])('accepts provider %s', (p) => {
    expect(NotificationProviderSchema.parse(p)).toBe(p);
  });

  it('rejects env-only providers at the schema level', () => {
    expect(() => NotificationProviderSchema.parse('sns')).toThrow();
    expect(() => NotificationProviderSchema.parse('braze')).toThrow();
  });

  it('rejects the removed fcm provider', () => {
    expect(() => NotificationProviderSchema.parse('fcm')).toThrow();
  });

  it('NotificationConfigSchema requires enabled boolean and valid provider', () => {
    expect(() =>
      NotificationConfigSchema.parse({ enabled: true, provider: 'courier', config: {} }),
    ).not.toThrow();
    expect(() =>
      NotificationConfigSchema.parse({ enabled: 'on', provider: 'courier', config: {} }),
    ).toThrow();
    expect(() =>
      NotificationConfigSchema.parse({ enabled: true, provider: 'smoke-signals', config: {} }),
    ).toThrow();
  });
});

describe('NotificationEnvSchema', () => {
  it('accepts an empty env (notifications are opt-in)', () => {
    const parsed = NotificationEnvSchema.parse({});
    expect(parsed.NOTIFICATIONS_PROVIDER).toBeUndefined();
    expect(parsed.VAPID_PUBLIC_KEY).toBeUndefined();
  });

  test.each(['onesignal', 'courier', 'knock', 'sns', 'braze', 'generic'])(
    'accepts NOTIFICATIONS_PROVIDER=%s',
    (provider) => {
      expect(
        NotificationEnvSchema.parse({ NOTIFICATIONS_PROVIDER: provider }).NOTIFICATIONS_PROVIDER,
      ).toBe(provider);
    },
  );

  test.each([
    ['unknown provider', { NOTIFICATIONS_PROVIDER: 'pigeon' }],
    ['invalid logging flag', { ONESIGNAL_ENABLE_LOGGING: '1' }],
    ['non-string key', { BRAZE_API_KEY: 42 }],
  ])('rejects %s', (_label, input) => {
    expect(() => NotificationEnvSchema.parse(input)).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => NotificationEnvSchema.parse(null)).toThrow();
  });
});
