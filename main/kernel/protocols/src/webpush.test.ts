// main/kernel/protocols/src/webpush.test.ts
import { spawnSync } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createVapidAuthorizationHeader,
  decryptWebPushPayload,
  encryptWebPushPayload,
  generateVapidKeys,
  sendWebPushNotification,
  WebPushProtocolError,
} from './webpush';

// Official RFC 8291 Section 5 & Appendix A test vector ("When I grow up, I want to be a watermelon")
const RFC8291_PLAINTEXT = 'When I grow up, I want to be a watermelon';
const RFC8291_AUTH_SECRET = 'BTBZMqHH6r4Tts7J_aSIgg';
const RFC8291_SALT = 'DGv6ra1nlYgDCS1FRnbzlw';
const RFC8291_UA_PRIVATE = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
const RFC8291_UA_PUBLIC =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const RFC8291_AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
const RFC8291_AS_PUBLIC =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const RFC8291_EXPECTED_BODY_B64URL =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
  'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RFC 8291 aes128gcm encryption and decryption', () => {
  it('reproduces the exact RFC 8291 Appendix A test vector byte-for-byte', () => {
    const encrypted = encryptWebPushPayload(
      RFC8291_PLAINTEXT,
      {
        p256dh: RFC8291_UA_PUBLIC,
        auth: RFC8291_AUTH_SECRET,
      },
      {
        salt: Buffer.from(RFC8291_SALT, 'base64url'),
        senderPrivateKey: Buffer.from(RFC8291_AS_PRIVATE, 'base64url'),
      },
    );

    expect(encrypted.senderPublicKey.toString('base64url')).toBe(RFC8291_AS_PUBLIC);
    expect(encrypted.body.toString('base64url')).toBe(RFC8291_EXPECTED_BODY_B64URL);

    const decrypted = decryptWebPushPayload(encrypted.body, {
      receiverPrivateKey: Buffer.from(RFC8291_UA_PRIVATE, 'base64url'),
      receiverPublicKey: Buffer.from(RFC8291_UA_PUBLIC, 'base64url'),
      authSecret: Buffer.from(RFC8291_AUTH_SECRET, 'base64url'),
    });
    expect(decrypted.toString('utf8')).toBe(RFC8291_PLAINTEXT);
  });

  it('encrypts with fresh ephemeral ECDH keys and round-trips arbitrary UTF-8 JSON payloads', () => {
    const payload = JSON.stringify({ title: 'Alert 🔔', body: 'New sign-in detected' });
    const first = encryptWebPushPayload(payload, {
      p256dh: RFC8291_UA_PUBLIC,
      auth: RFC8291_AUTH_SECRET,
    });
    const second = encryptWebPushPayload(payload, {
      p256dh: RFC8291_UA_PUBLIC,
      auth: RFC8291_AUTH_SECRET,
    });

    expect(first.body.equals(second.body)).toBe(false);
    expect(
      decryptWebPushPayload(first.body, {
        receiverPrivateKey: Buffer.from(RFC8291_UA_PRIVATE, 'base64url'),
        receiverPublicKey: Buffer.from(RFC8291_UA_PUBLIC, 'base64url'),
        authSecret: Buffer.from(RFC8291_AUTH_SECRET, 'base64url'),
      }).toString('utf8'),
    ).toBe(payload);
  });

  it.each([
    [
      'invalid base64url in p256dh',
      { p256dh: 'not valid base64url!!!', auth: RFC8291_AUTH_SECRET },
    ],
    ['short p256dh key (32 bytes)', { p256dh: RFC8291_UA_PRIVATE, auth: RFC8291_AUTH_SECRET }],
    [
      'compressed point prefix in p256dh',
      {
        p256dh: Buffer.concat([Buffer.from([0x02]), Buffer.alloc(64, 1)]).toString('base64url'),
        auth: RFC8291_AUTH_SECRET,
      },
    ],
    [
      'off-curve p256dh point',
      {
        p256dh: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0xff)]).toString('base64url'),
        auth: RFC8291_AUTH_SECRET,
      },
    ],
    ['short auth secret (8 bytes)', { p256dh: RFC8291_UA_PUBLIC, auth: 'AAAAAAAAAAE' }],
    [
      'long auth secret (24 bytes)',
      { p256dh: RFC8291_UA_PUBLIC, auth: Buffer.alloc(24, 7).toString('base64url') },
    ],
  ])('rejects invalid subscription keys (%s)', (_label, keys) => {
    expect(() => encryptWebPushPayload('hello', keys)).toThrow();
  });

  it('rejects payloads exceeding the RFC 8291 4096-byte encrypted record limit', () => {
    const oversized = Buffer.alloc(3994, 0x61);
    expect(() =>
      encryptWebPushPayload(oversized, {
        p256dh: RFC8291_UA_PUBLIC,
        auth: RFC8291_AUTH_SECRET,
      }),
    ).toThrow(RangeError);
  });

  it('fails closed on tampered ciphertext, wrong auth secret, or truncated aes128gcm header', () => {
    const { body } = encryptWebPushPayload(RFC8291_PLAINTEXT, {
      p256dh: RFC8291_UA_PUBLIC,
      auth: RFC8291_AUTH_SECRET,
    });

    const tampered = Buffer.from(body);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() =>
      decryptWebPushPayload(tampered, {
        receiverPrivateKey: Buffer.from(RFC8291_UA_PRIVATE, 'base64url'),
        receiverPublicKey: Buffer.from(RFC8291_UA_PUBLIC, 'base64url'),
        authSecret: Buffer.from(RFC8291_AUTH_SECRET, 'base64url'),
      }),
    ).toThrow();

    expect(() =>
      decryptWebPushPayload(body, {
        receiverPrivateKey: Buffer.from(RFC8291_UA_PRIVATE, 'base64url'),
        receiverPublicKey: Buffer.from(RFC8291_UA_PUBLIC, 'base64url'),
        authSecret: Buffer.alloc(16, 0x42),
      }),
    ).toThrow();

    expect(() =>
      decryptWebPushPayload(body.subarray(0, 40), {
        receiverPrivateKey: Buffer.from(RFC8291_UA_PRIVATE, 'base64url'),
        receiverPublicKey: Buffer.from(RFC8291_UA_PUBLIC, 'base64url'),
        authSecret: Buffer.from(RFC8291_AUTH_SECRET, 'base64url'),
      }),
    ).toThrow();
  });
});

describe('RFC 8292 VAPID ES256 signing and sendWebPushNotification', () => {
  it('generates valid P-256 VAPID keypairs and signs RFC 8292 Authorization headers verifiable by node:crypto', () => {
    const vapidKeys = generateVapidKeys();
    const nowSeconds = 1_700_000_000;
    const header = createVapidAuthorizationHeader(
      'https://fcm.googleapis.com/fcm/send/abc-123',
      {
        subject: 'mailto:ops@bslt.dev',
        publicKey: vapidKeys.publicKey,
        privateKey: vapidKeys.privateKey,
      },
      { nowSeconds, expirationSeconds: 3600 },
    );

    expect(header).toMatch(/^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=/u);
    const match = /^vapid t=([^,]+), k=(.+)$/u.exec(header);
    expect(match).not.toBeNull();
    const token = match?.[1] ?? '';
    const kParam = match?.[2] ?? '';
    expect(kParam).toBe(vapidKeys.publicKey);

    const [encodedHeader, encodedClaims, encodedSig] = token.split('.');
    expect(JSON.parse(Buffer.from(encodedHeader ?? '', 'base64url').toString('utf8'))).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    expect(JSON.parse(Buffer.from(encodedClaims ?? '', 'base64url').toString('utf8'))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: nowSeconds + 3600,
      sub: 'mailto:ops@bslt.dev',
    });

    const pubBytes = Buffer.from(vapidKeys.publicKey, 'base64url');
    const pubKeyObj = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pubBytes.subarray(1, 33).toString('base64url'),
        y: pubBytes.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });
    const sigOk = verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`, 'ascii'),
      { key: pubKeyObj, dsaEncoding: 'ieee-p1363' },
      Buffer.from(encodedSig ?? '', 'base64url'),
    );
    expect(sigOk).toBe(true);
  });

  it.each([
    [
      'mismatched VAPID public and private keypair',
      'https://push.example.com/send/1',
      {
        subject: 'mailto:ops@bslt.dev',
        publicKey: RFC8291_UA_PUBLIC,
        privateKey: RFC8291_AS_PRIVATE,
      },
    ],
    [
      'insecure http:// VAPID subject',
      'https://push.example.com/send/1',
      {
        subject: 'http://bslt.dev',
        publicKey: RFC8291_UA_PUBLIC,
        privateKey: RFC8291_UA_PRIVATE,
      },
    ],
    [
      'empty VAPID subject',
      'https://push.example.com/send/1',
      {
        subject: '',
        publicKey: RFC8291_UA_PUBLIC,
        privateKey: RFC8291_UA_PRIVATE,
      },
    ],
    [
      'non-HTTPS push endpoint',
      'http://evil.example.com/push',
      {
        subject: 'mailto:ops@bslt.dev',
        publicKey: RFC8291_UA_PUBLIC,
        privateKey: RFC8291_UA_PRIVATE,
      },
    ],
    [
      'malformed push endpoint URL',
      'not-a-url',
      {
        subject: 'mailto:ops@bslt.dev',
        publicKey: RFC8291_UA_PUBLIC,
        privateKey: RFC8291_UA_PRIVATE,
      },
    ],
    [
      'expiration exceeding 24 hours per RFC 8292 section 2',
      'https://push.example.com/send/1',
      {
        subject: 'https://bslt.dev/contact',
        publicKey: RFC8291_UA_PUBLIC,
        privateKey: RFC8291_UA_PRIVATE,
      },
      { expirationSeconds: 90_000 },
    ],
  ])('rejects invalid VAPID inputs (%s)', (_label, endpoint, vapid, opts?) => {
    expect(() => createVapidAuthorizationHeader(endpoint, vapid, opts)).toThrow();
  });

  it('sends encrypted Web Push HTTP requests with RFC 8291/8292 headers and maps non-2xx responses to WebPushProtocolError', async () => {
    const vapid = {
      ...generateVapidKeys(),
      subject: 'mailto:ops@bslt.dev',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 201, headers: { location: 'https://push.example.com/m/1' } }),
      )
      .mockResolvedValueOnce(new Response('Subscription expired', { status: 410 }));

    const okRes = await sendWebPushNotification(
      {
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: RFC8291_UA_PUBLIC, auth: RFC8291_AUTH_SECRET },
      },
      JSON.stringify({ title: 'Ping' }),
      vapid,
      {
        ttl: 120,
        urgency: 'high',
        topic: 'alerts',
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(okRes.statusCode).toBe(201);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://push.example.com/sub/1');
    expect(calledInit.method).toBe('POST');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['TTL']).toBe('120');
    expect(headers['Urgency']).toBe('high');
    expect(headers['Topic']).toBe('alerts');
    expect(headers['Authorization']).toMatch(/^vapid t=/u);

    await expect(
      sendWebPushNotification(
        {
          endpoint: 'https://push.example.com/sub/gone',
          keys: { p256dh: RFC8291_UA_PUBLIC, auth: RFC8291_AUTH_SECRET },
        },
        'bye',
        vapid,
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({
      name: 'WebPushProtocolError',
      statusCode: 410,
      body: 'Subscription expired',
    } satisfies Partial<WebPushProtocolError>);
  });
});

describe('the ./webpush export', () => {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));

  const resolveWebPush = (conditions: readonly string[]): string =>
    spawnSync(
      process.execPath,
      [
        ...conditions.map((condition) => `--conditions=${condition}`),
        '--input-type=module',
        '--eval',
        "console.log(import.meta.resolve('@bslt/protocols/webpush'))",
      ],
      { cwd: packageRoot, encoding: 'utf8', env: {} },
    ).stdout.trim();

  it('exposes only `types` and `node` conditions in package.json', () => {
    const { exports } = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8')) as {
      readonly exports: Record<string, object>;
    };
    expect(Object.keys(exports['./webpush'] ?? {})).toEqual(['types', 'node']);
    expect(resolveWebPush(['source'])).toMatch(/\/main\/kernel\/protocols\/src\/webpush\.ts$/u);
  });
});
