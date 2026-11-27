// main/kernel/comms/src/sms/twilio.test.ts
import { describe, expect, it, vi } from 'vitest';

import { TwilioSmsProvider } from './twilio';

const VALID_CONFIG = {
  accountSid: 'AC1234567890abcdef',
  authToken: 'secret-token',
  fromNumber: '+15550001111',
};

describe('TwilioSmsProvider', () => {
  it('rejects missing required constructor configuration fields', () => {
    expect(() => new TwilioSmsProvider({ ...VALID_CONFIG, accountSid: '' })).toThrow(
      'Twilio accountSid is required',
    );
    expect(() => new TwilioSmsProvider({ ...VALID_CONFIG, authToken: '' })).toThrow(
      'Twilio authToken is required',
    );
    expect(() => new TwilioSmsProvider({ ...VALID_CONFIG, fromNumber: '' })).toThrow(
      'Twilio fromNumber is required',
    );
  });

  it('posts Basic-authenticated form payload and returns messageId on success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sid: 'SM999',
          status: 'queued',
          error_code: null,
          error_message: null,
        }),
        { status: 201 },
      ),
    );
    const provider = new TwilioSmsProvider(VALID_CONFIG, fetchMock);

    const result = await provider.send({ to: '+15552223333', body: 'Your code is 123456' });

    expect(result).toEqual({ success: true, messageId: 'SM999' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1234567890abcdef/Messages.json');
    expect(init?.method).toBe('POST');
    const expectedAuth = `Basic ${Buffer.from('AC1234567890abcdef:secret-token').toString('base64')}`;
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(expectedAuth);
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const parsedBody = new URLSearchParams(String(init?.body));
    expect(parsedBody.get('To')).toBe('+15552223333');
    expect(parsedBody.get('From')).toBe('+15550001111');
    expect(parsedBody.get('Body')).toBe('Your code is 123456');
  });

  it('returns failure when Twilio responds with a non-OK HTTP status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Invalid phone number', { status: 400 }));
    const provider = new TwilioSmsProvider(VALID_CONFIG, fetchMock);

    const result = await provider.send({ to: 'bad-number', body: 'hi' });

    expect(result).toEqual({
      success: false,
      error: 'Twilio API error (400): Invalid phone number',
    });
  });

  it('returns failure when Twilio JSON response contains a non-null error_code', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sid: 'SM000',
          status: 'failed',
          error_code: 21211,
          error_message: 'Invalid To Phone Number',
        }),
        { status: 200 },
      ),
    );
    const provider = new TwilioSmsProvider(VALID_CONFIG, fetchMock);

    const result = await provider.send({ to: '+1000', body: 'hi' });

    expect(result).toEqual({
      success: false,
      error: 'Twilio error 21211: Invalid To Phone Number',
    });
  });

  it('falls back to Unknown error when Twilio error_message is null', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sid: 'SM001',
          status: 'failed',
          error_code: 30007,
          error_message: null,
        }),
        { status: 200 },
      ),
    );
    const provider = new TwilioSmsProvider(VALID_CONFIG, fetchMock);

    const result = await provider.send({ to: '+1555', body: 'hi' });

    expect(result).toEqual({
      success: false,
      error: 'Twilio error 30007: Unknown error',
    });
  });

  it('catches network errors and non-Error rejections safely', async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket hang up'));
    const provider1 = new TwilioSmsProvider(VALID_CONFIG, networkFetch);
    expect(await provider1.send({ to: '+1555', body: 'hi' })).toEqual({
      success: false,
      error: 'socket hang up',
    });

    const nonErrorFetch = vi.fn<typeof fetch>().mockRejectedValue('unexpected string throw');
    const provider2 = new TwilioSmsProvider(VALID_CONFIG, nonErrorFetch);
    expect(await provider2.send({ to: '+1555', body: 'hi' })).toEqual({
      success: false,
      error: 'Unknown error sending SMS',
    });
  });
});
