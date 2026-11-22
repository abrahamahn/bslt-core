// main/apps/server/src/bootstrap/phases/comms.test.ts
/**
 * The comms phase and the ports a caller of `buildApp` may replace: a port that
 * is named wins over the composed one, `undefined` included, and what is not
 * named is composed as in production.
 */

import { describe, expect, it, vi } from 'vitest';

import { bootstrapCommsPhase, createFallbackCommsState } from './comms';

import type { DataContext } from '../context';
import type { AppConfig } from '@bslt/server-system/config';

const config = {
  app: { name: 'Comms Test' },
  auth: { jwt: { secret: 'comms-test-jwt-secret-0123456789-abcdef' } },
  email: { provider: 'console' },
  storage: {
    provider: 'local',
    rootPath: './comms-test-uploads',
    signingSecret: 'comms-test-storage-signing-secret-0123456789',
  },
  billing: {
    urls: {
      portalReturnUrl: 'https://app.test/billing',
      checkoutCancelUrl: 'https://app.test/pricing',
    },
  },
} as unknown as AppConfig;

function dataContext(): DataContext {
  return {
    config,
    db: {},
    repos: { users: {} },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as DataContext;
}

const fakeEmail = { send: vi.fn(), healthCheck: vi.fn() };
const fakeStorage = { getSignedUrl: vi.fn() };
const fakeSms = { send: vi.fn() };
const fakeNotifications = { kind: 'push' };
const fakeTemplates = { kind: 'templates' };

describe('bootstrapCommsPhase', () => {
  it('composes every outbound service when no port is given', async () => {
    const { context } = await bootstrapCommsPhase(config, dataContext());

    expect(context.email).toBeDefined();
    expect(context.storage).toBeDefined();
    expect(context.sms).toBeDefined();
    expect(context.notifications).toBeDefined();
    expect(typeof context.emailTemplates.passwordReset).toBe('function');
  });

  it('uses the ports a caller names in place of the composed ones', async () => {
    const { context } = await bootstrapCommsPhase(config, dataContext(), {
      email: fakeEmail as never,
      storage: fakeStorage as never,
      sms: fakeSms as never,
      notifications: fakeNotifications as never,
      emailTemplates: fakeTemplates as never,
    });

    expect(context.email).toBe(fakeEmail);
    expect(context.storage).toBe(fakeStorage);
    expect(context.sms).toBe(fakeSms);
    expect(context.notifications).toBe(fakeNotifications);
    expect(context.emailTemplates).toBe(fakeTemplates);
  });

  it('runs without a port the caller sets to undefined', async () => {
    const { context } = await bootstrapCommsPhase(config, dataContext(), {
      email: undefined,
      storage: undefined,
      sms: undefined,
      notifications: undefined,
    });

    expect(context.email).toBeUndefined();
    expect(context.storage).toBeUndefined();
    expect(context.sms).toBeUndefined();
    expect(context.notifications).toBeUndefined();
  });
});

describe('createFallbackCommsState', () => {
  it('composes email, templates and storage when no port is given', () => {
    const { context } = createFallbackCommsState(config, { context: dataContext() });

    expect(context.email).toBeDefined();
    expect(context.storage).toBeDefined();
    expect('sms' in context).toBe(false);
    expect('notifications' in context).toBe(false);
  });

  it('uses the ports a caller names, undefined included', () => {
    const { context } = createFallbackCommsState(
      config,
      { context: dataContext() },
      { email: fakeEmail as never, storage: undefined, sms: fakeSms as never },
    );

    expect(context.email).toBe(fakeEmail);
    expect(context.storage).toBeUndefined();
    expect(context.sms).toBe(fakeSms);
  });
});
