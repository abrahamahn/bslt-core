// main/kernel/comms/src/notifications/providers/factory.test.ts
/**
 * Tests for the notification provider factory's Web Push wiring.
 */

import { generateVapidKeys } from '@bslt/protocols/webpush';
import { describe, expect, it } from 'vitest';

import {
  createNotificationProviderService,
  createNotificationProviderServiceFromEnv,
} from './factory';

const KEYS = generateVapidKeys();
const VAPID = {
  publicKey: KEYS.publicKey,
  privateKey: KEYS.privateKey,
  subject: 'mailto:ops@example.com',
};

describe('notification provider factory — Web Push', () => {
  it('exposes the Web Push provider when VAPID options are given', () => {
    const service = createNotificationProviderService({ vapid: VAPID });
    expect(service.getWebPushProvider()).toBeDefined();
    expect(service.isConfigured()).toBe(true);
  });

  it('has no Web Push provider without VAPID options', () => {
    const service = createNotificationProviderService({});
    expect(service.getWebPushProvider()).toBeUndefined();
    expect(service.isConfigured()).toBe(false);
  });

  it('reads VAPID from the environment', () => {
    const service = createNotificationProviderServiceFromEnv({
      VAPID_PUBLIC_KEY: KEYS.publicKey,
      VAPID_PRIVATE_KEY: KEYS.privateKey,
      VAPID_SUBJECT: 'mailto:ops@example.com',
    } as NodeJS.ProcessEnv);
    expect(service.getWebPushProvider()).toBeDefined();
  });

  it('leaves Web Push unconfigured when the env subject or private key is missing', () => {
    expect(
      createNotificationProviderServiceFromEnv({
        VAPID_PUBLIC_KEY: KEYS.publicKey,
        VAPID_PRIVATE_KEY: KEYS.privateKey,
      } as NodeJS.ProcessEnv).getWebPushProvider(),
    ).toBeUndefined();
    expect(
      createNotificationProviderServiceFromEnv({
        VAPID_PUBLIC_KEY: KEYS.publicKey,
        VAPID_SUBJECT: 'mailto:ops@example.com',
      } as NodeJS.ProcessEnv).getWebPushProvider(),
    ).toBeUndefined();
  });
});
