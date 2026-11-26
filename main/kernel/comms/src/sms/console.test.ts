// main/kernel/comms/src/sms/console.test.ts
import { describe, expect, it, vi } from 'vitest';

import { ConsoleSmsProvider } from './console';

describe('ConsoleSmsProvider', () => {
  it('logs development SMS payload and returns a generated messageId', async () => {
    const log = vi.fn();
    const provider = new ConsoleSmsProvider(log);

    const result = await provider.send({
      to: '+15550100',
      body: 'Your BSLT verification code is 123456',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^sms-dev-/u);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('+15550100'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('123456'));
  });
});
