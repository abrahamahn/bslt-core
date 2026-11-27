// main/kernel/comms/src/email/smtp.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SmtpEmailService } from './smtp';
import { SmtpClient } from './smtp.client';

import type { EmailConfig } from '@bslt/contract';

const BASE_CONFIG: EmailConfig = {
  provider: 'smtp',
  from: {
    name: 'BSLT Platform',
    address: 'noreply@example.com',
  },
  replyTo: 'support@example.com',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    connectionTimeout: 5000,
    socketTimeout: 10000,
    auth: {
      user: 'smtp-user',
      pass: 'smtp-pass',
    },
  },
};

describe('SmtpEmailService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports healthy when SmtpClient.verify succeeds and unhealthy when it rejects', async () => {
    const verifySpy = vi.spyOn(SmtpClient.prototype, 'verify').mockResolvedValue(undefined);
    const service = new SmtpEmailService(BASE_CONFIG);

    expect(await service.healthCheck()).toBe(true);
    expect(verifySpy).toHaveBeenCalledTimes(1);

    verifySpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await service.healthCheck()).toBe(false);
  });

  it('formats sender identity, forwards optional fields, and returns messageId on success', async () => {
    const sendSpy = vi
      .spyOn(SmtpClient.prototype, 'send')
      .mockResolvedValue({ success: true, messageId: '<msg-1@smtp.example.com>' });
    const service = new SmtpEmailService(BASE_CONFIG);

    const result = await service.send({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hello Alice</p>',
      headers: { 'X-Trace': 'trace-1' },
    });

    expect(result).toEqual({
      success: true,
      messageId: '<msg-1@smtp.example.com>',
    });
    expect(sendSpy).toHaveBeenCalledWith({
      from: '"BSLT Platform" <noreply@example.com>',
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hello Alice</p>',
      headers: { 'X-Trace': 'trace-1' },
    });
  });

  it('omits undefined optional fields and propagates SMTP failure details cleanly', async () => {
    const sendSpy = vi
      .spyOn(SmtpClient.prototype, 'send')
      .mockResolvedValue({ success: false, error: '550 Rejected' });
    const configWithoutAuth: EmailConfig = {
      ...BASE_CONFIG,
      smtp: {
        host: BASE_CONFIG.smtp.host,
        port: BASE_CONFIG.smtp.port,
        secure: BASE_CONFIG.smtp.secure,
        connectionTimeout: BASE_CONFIG.smtp.connectionTimeout,
        socketTimeout: BASE_CONFIG.smtp.socketTimeout,
      },
    };
    const service = new SmtpEmailService(configWithoutAuth);

    const result = await service.send({
      to: 'bob@example.com',
      subject: 'Alert',
    });

    expect(result).toEqual({
      success: false,
      error: '550 Rejected',
    });
    expect(sendSpy).toHaveBeenCalledWith({
      from: '"BSLT Platform" <noreply@example.com>',
      to: 'bob@example.com',
      subject: 'Alert',
    });
  });
});
