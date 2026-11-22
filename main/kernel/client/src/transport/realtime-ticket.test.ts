// main/kernel/client/src/transport/realtime-ticket.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestRealtimeTicket } from './realtime-ticket';
import { clearCsrfTokenCache } from './transport';

describe('requestRealtimeTicket', () => {
  afterEach(() => {
    clearCsrfTokenCache();
    vi.restoreAllMocks();
  });

  it('rejects HTTP 401 responses from /api/realtime/ticket', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      requestRealtimeTicket({
        baseUrl: 'http://localhost:3001',
        getToken: () => 'bad.jwt.token',
        fetchImpl,
      }),
    ).rejects.toThrow(/Unauthorized/i);
  });

  it('rejects malformed server payloads that violate the response schema', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ticket: '', grants: null, expiresAt: 'invalid' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      requestRealtimeTicket({
        baseUrl: 'http://localhost:3001',
        getToken: () => 'aaa.bbb.ccc',
        fetchImpl,
      }),
    ).rejects.toThrow();
  });

  it('rejects network transport errors cleanly', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));

    await expect(
      requestRealtimeTicket({
        baseUrl: 'http://localhost:3001',
        fetchImpl,
      }),
    ).rejects.toThrow(/Failed to fetch POST \/realtime\/ticket/i);
  });

  it('requests a signed single-use WS ticket and channel grants via POST /api/realtime/ticket', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ticket: 'ticket-id.sig',
          grants: { 'record:notifications:u-1': 'grant-sig' },
          expiresAt: 1_700_000_030_000,
          anonymous: false,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const res = await requestRealtimeTicket({
      baseUrl: 'http://localhost:3001',
      getToken: () => 'aaa.bbb.ccc',
      channels: ['record:notifications:u-1'],
      fetchImpl,
    });

    expect(res).toEqual({
      ticket: 'ticket-id.sig',
      grants: { 'record:notifications:u-1': 'grant-sig' },
      expiresAt: 1_700_000_030_000,
      anonymous: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:3001/api/realtime/ticket');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer aaa.bbb.ccc');
    expect(JSON.parse(String(init?.body))).toEqual({
      channels: ['record:notifications:u-1'],
    });
  });

  it('supports anonymous-read grant responses where ticket is null', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ticket: null,
          grants: { 'public:status': 'anon-grant' },
          expiresAt: 1_700_000_030_000,
          anonymous: true,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const res = await requestRealtimeTicket({
      baseUrl: 'http://localhost:3001',
      channels: ['public:status'],
      fetchImpl,
    });

    expect(res.ticket).toBeNull();
    expect(res.anonymous).toBe(true);
    expect(res.grants['public:status']).toBe('anon-grant');
  });
});
