// main/testing/src/fakes/fakes.test.ts
import { describe, expect, it } from 'vitest';

import { createMockLogger } from './logger';
import {
  createFakeEmailService,
  createFakeNotificationService,
  createFakeSmsProvider,
  createFakeStorage,
  FAKE_STORAGE_ORIGIN,
} from './ports';

describe('createMockLogger', () => {
  it('records every level and hands itself out as its own child', () => {
    const log = createMockLogger();

    log.child({ module: 'auth' }).warn('careful');
    log.error(new Error('boom'), 'failed');

    expect(log.child({})).toBe(log);
    expect(log.warn).toHaveBeenCalledWith('careful');
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(createMockLogger()).not.toBe(log);
  });
});

describe('port fakes', () => {
  it('email and SMS resolve as delivered and record what was sent', async () => {
    const email = createFakeEmailService();
    const sms = createFakeSmsProvider();

    await expect(email.send({ to: 'a@example.com', subject: 's' })).resolves.toMatchObject({
      success: true,
    });
    await expect(sms.send({ to: '+15550000001', body: 'code' })).resolves.toMatchObject({
      success: true,
    });
    await expect(email.healthCheck()).resolves.toBe(true);
    expect(email.send).toHaveBeenCalledWith({ to: 'a@example.com', subject: 's' });
  });

  it('storage keeps objects in memory and signs absolute URLs', async () => {
    const storage = createFakeStorage();

    await expect(storage.upload('avatars/u1/a.png', 'bytes', 'image/png')).resolves.toBe(
      'avatars/u1/a.png',
    );
    expect(new TextDecoder().decode(await storage.download('avatars/u1/a.png'))).toBe('bytes');
    await expect(storage.getSignedUrl('avatars/u1/a.png')).resolves.toBe(
      `${FAKE_STORAGE_ORIGIN}/avatars/u1/a.png`,
    );

    const stream = await storage.downloadStream('avatars/u1/a.png');
    const reader = stream.getReader();
    expect((await reader.read()).done).toBe(false);
    expect((await reader.read()).done).toBe(true);

    await storage.delete('avatars/u1/a.png');
    expect(storage.objects.size).toBe(0);
    await expect(storage.download('avatars/u1/a.png')).rejects.toThrow(/no object/u);
  });

  it('the push service is not configured', () => {
    expect(createFakeNotificationService().isConfigured()).toBe(false);
  });
});
