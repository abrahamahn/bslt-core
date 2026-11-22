// main/kernel/server/src/module/sealed.test.ts
import { array, nullable, object, optional, record, sealed, string } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import { OutboxSealError, sealEventPayload, unsealEventPayload } from './sealed';

const SECRET_KEY = 'test-outbox-seal-secret-key-0001';
const AAD = 'identity.user.registered:v1';

const eventSchema = object({
  userId: string({ min: 1 }),
  token: sealed(string({ min: 8 })),
  nested: object({
    backupSecret: nullable(sealed(string({ min: 4 }))),
    optionalPin: optional(sealed(string({ min: 4 }))),
  }),
  items: array(object({ label: string(), apiKey: sealed(string({ min: 6 })) })),
  headers: record(sealed(string({ min: 1 }))),
});

describe('outbox sealed() AES-256-GCM encryption and decryption', () => {
  it('returns null sealed bytes when schema contains no sealed values', () => {
    const plainSchema = object({ id: string({ min: 1 }), title: string({ min: 1 }) });
    const input = { id: '1', title: 'plain event' };
    const result = sealEventPayload(plainSchema, input, SECRET_KEY, AAD);
    expect(result.sealed).toBeNull();
    expect(result.payload).toEqual(input);
    expect(unsealEventPayload(plainSchema, result.payload, null, SECRET_KEY, AAD)).toEqual(input);
  });

  it('redacts every sealed field in payload JSON and decrypts back for subscribers without mutating input', () => {
    const original = {
      userId: 'u-123',
      token: 'super-secret-token',
      nested: {
        backupSecret: 'bkp-9999',
        optionalPin: '1234',
      },
      items: [{ label: 'primary', apiKey: 'sk_live_abcdef' }],
      headers: { authorization: 'Bearer xyz' },
    };

    const { payload, sealed: sealedBytes } = sealEventPayload(
      eventSchema,
      original,
      SECRET_KEY,
      AAD,
    );

    expect(original.token).toBe('super-secret-token');
    expect(sealedBytes).toBeInstanceOf(Buffer);
    expect(JSON.stringify(payload)).not.toContain('super-secret-token');
    expect(JSON.stringify(payload)).not.toContain('bkp-9999');
    expect(JSON.stringify(payload)).not.toContain('sk_live_abcdef');
    expect(JSON.stringify(payload)).not.toContain('Bearer xyz');
    expect(payload).toEqual({
      userId: 'u-123',
      token: '[REDACTED]',
      nested: {
        backupSecret: '[REDACTED]',
        optionalPin: '[REDACTED]',
      },
      items: [{ label: 'primary', apiKey: '[REDACTED]' }],
      headers: { authorization: '[REDACTED]' },
    });

    const restored = unsealEventPayload(eventSchema, payload, sealedBytes, SECRET_KEY, AAD);
    expect(restored).toEqual(original);
  });

  it('preserves null on nullable(sealed(...)) and undefined on optional(sealed(...))', () => {
    const original = {
      userId: 'u-456',
      token: 'another-secret-value',
      nested: {
        backupSecret: null,
      },
      items: [],
      headers: {},
    };

    const { payload, sealed: sealedBytes } = sealEventPayload(
      eventSchema,
      original,
      SECRET_KEY,
      AAD,
    );
    expect((payload as { nested: { backupSecret: unknown } }).nested.backupSecret).toBeNull();
    const restored = unsealEventPayload(eventSchema, payload, sealedBytes, SECRET_KEY, AAD);
    expect(restored).toEqual(original);
  });

  it('rejects decryption when secret key is wrong', () => {
    const simple = object({ secret: sealed(string({ min: 8 })) });
    const { payload, sealed: sealedBytes } = sealEventPayload(
      simple,
      { secret: 'top-secret-123' },
      SECRET_KEY,
      AAD,
    );
    expect(() => unsealEventPayload(simple, payload, sealedBytes, 'wrong-secret-key', AAD)).toThrow(
      OutboxSealError,
    );
  });

  it('rejects decryption when event name or version AAD mismatches (cross-event replay)', () => {
    const simple = object({ secret: sealed(string({ min: 8 })) });
    const { payload, sealed: sealedBytes } = sealEventPayload(
      simple,
      { secret: 'top-secret-123' },
      SECRET_KEY,
      AAD,
    );
    expect(() =>
      unsealEventPayload(simple, payload, sealedBytes, SECRET_KEY, 'identity.user.registered:v2'),
    ).toThrow(OutboxSealError);
  });

  it('rejects tampered ciphertext bytes', () => {
    const simple = object({ secret: sealed(string({ min: 8 })) });
    const { payload, sealed: sealedBytes } = sealEventPayload(
      simple,
      { secret: 'top-secret-123' },
      SECRET_KEY,
      AAD,
    );
    const tampered = Buffer.from(sealedBytes!);
    const lastIdx = tampered.length - 1;
    tampered[lastIdx] = (tampered[lastIdx] ?? 0) ^ 0xff;
    expect(() => unsealEventPayload(simple, payload, tampered, SECRET_KEY, AAD)).toThrow(
      OutboxSealError,
    );
  });

  it('rejects tampered GCM authentication tag bytes', () => {
    const simple = object({ secret: sealed(string({ min: 8 })) });
    const { payload, sealed: sealedBytes } = sealEventPayload(
      simple,
      { secret: 'top-secret-123' },
      SECRET_KEY,
      AAD,
    );
    const tampered = Buffer.from(sealedBytes!);
    tampered[15] = (tampered[15] ?? 0) ^ 0x55;
    expect(() => unsealEventPayload(simple, payload, tampered, SECRET_KEY, AAD)).toThrow(
      OutboxSealError,
    );
  });

  it('rejects truncated sealed bytea buffers', () => {
    const simple = object({ secret: sealed(string({ min: 8 })) });
    expect(() =>
      unsealEventPayload(simple, { secret: '[REDACTED]' }, Buffer.alloc(10), SECRET_KEY, AAD),
    ).toThrow(OutboxSealError);
  });

  it('rejects unsealing when schema requires a sealed field but sealed bytes are null', () => {
    const simple = object({ secret: sealed(string({ min: 8 })) });
    expect(() =>
      unsealEventPayload(simple, { secret: '[REDACTED]' }, null, SECRET_KEY, AAD),
    ).toThrow(OutboxSealError);
  });

  it('rejects empty secret keys on both seal and unseal', () => {
    const simple = object({ secret: sealed(string({ min: 8 })) });
    expect(() => sealEventPayload(simple, { secret: 'top-secret-123' }, '', AAD)).toThrow(
      OutboxSealError,
    );
    expect(() =>
      unsealEventPayload(simple, { secret: '[REDACTED]' }, Buffer.alloc(32), '', AAD),
    ).toThrow(OutboxSealError);
  });
});
