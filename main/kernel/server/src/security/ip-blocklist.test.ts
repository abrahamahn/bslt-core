// main/kernel/server/src/security/ip-blocklist.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createIpBlocklist, createIpBlocklistMiddleware } from './ip-blocklist';

import type { HttpReply, HttpRequest } from '../http/http';

describe('IpBlocklist', () => {
  it('enforces exact, CIDR, strict/permissive policies, allowlist priority, and reputation providers', async () => {
    const provider = {
      name: 'mock-rep',
      check: vi.fn(async (ip: string) => {
        if (ip === '8.8.8.8') return { blocked: true, reason: 'known bot' };
        if (ip === '9.9.9.9') throw new Error('provider timeout');
        return { blocked: false };
      }),
    };

    const blocklist = createIpBlocklist({
      globalBlocklist: ['1.2.3.4', '10.0.0.0/8'],
      strictBlocklist: ['5.6.7.8'],
      allowlist: ['10.0.0.1'],
      reputationProviders: [provider],
    });

    // Global exact & CIDR blocks
    expect(await blocklist.check('1.2.3.4')).toMatch(/global blocklist/u);
    expect(await blocklist.check('10.20.30.40')).toMatch(/global blocklist/u);

    // Allowlist overrides CIDR block
    expect(await blocklist.check('10.0.0.1')).toBeNull();

    // Permissive bypasses blocklist
    expect(await blocklist.check('1.2.3.4', 'permissive')).toBeNull();

    // Strict-only IP blocked only under strict policy
    expect(await blocklist.check('5.6.7.8', 'standard')).toBeNull();
    expect(await blocklist.check('5.6.7.8', 'strict')).toMatch(/strict blocklist/u);

    // Runtime mutations
    blocklist.add('2.2.2.2', 'global');
    expect(await blocklist.check('2.2.2.2')).toMatch(/global/u);
    blocklist.remove('2.2.2.2', 'global');
    expect(await blocklist.check('2.2.2.2')).toBeNull();

    // Async reputation provider blocks and survives errors gracefully
    expect(await blocklist.check('8.8.8.8')).toMatch(/known bot/u);
    expect(await blocklist.check('9.9.9.9')).toBeNull();
    expect(blocklist.getStats().globalCidrCount).toBe(1);
  });

  it('sends configured HTTP 403 reply via middleware when blocked', async () => {
    const onBlocked = vi.fn();
    const middleware = createIpBlocklistMiddleware({
      globalBlocklist: ['203.0.113.5'],
      blockStatusCode: 403,
      blockResponseBody: { error: 'Blocked' },
      onBlocked,
    });

    const send = vi.fn();
    const status = vi.fn().mockReturnValue({ send });
    const reply = { status } as unknown as HttpReply;

    await middleware({ ip: '203.0.113.5' } as unknown as HttpRequest, reply);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(403);
    expect(send).toHaveBeenCalledWith({ error: 'Blocked' });

    status.mockClear();
    await middleware({ ip: '198.51.100.1' } as unknown as HttpRequest, reply);
    expect(status).not.toHaveBeenCalled();
  });
});
