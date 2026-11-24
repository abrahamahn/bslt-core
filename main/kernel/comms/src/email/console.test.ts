// main/kernel/comms/src/email/console.test.ts
import { clearCapturedDevEmails, listCapturedDevEmails } from '@bslt/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleEmailService } from './console';

describe('ConsoleEmailService', () => {
  beforeEach(() => {
    clearCapturedDevEmails();
  });

  it('logs and captures outbound emails with extracted links in the dev inbox', async () => {
    const logSpy = vi.fn();
    const service = new ConsoleEmailService(logSpy);

    expect(await service.healthCheck()).toBe(true);

    const result = await service.send({
      to: 'founder@acme.dev',
      subject: 'Verify your account',
      text: 'Click https://localhost:5173/verify?token=tok123',
      html: '<a href="https://localhost:5173/verify?token=tok123">Verify</a>',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^dev-/u);
    expect(logSpy).toHaveBeenCalled();

    const captured = listCapturedDevEmails();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      id: result.messageId,
      to: ['founder@acme.dev'],
      subject: 'Verify your account',
      links: ['https://localhost:5173/verify?token=tok123'],
    });
  });
});
