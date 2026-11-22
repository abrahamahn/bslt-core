// main/kernel/protocols/src/cose.test.ts
import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { encodeCbor } from './cbor';
import {
  COSE_ALGORITHMS,
  parseCosePublicKey,
  parseCosePublicKeyPrefix,
  verifyCoseSignature,
} from './cose';

const b64uDecode = (s: string): Buffer => Buffer.from(s, 'base64url');

function buildEs256Fixture(): {
  readonly coseKey: Buffer;
  readonly signPayload: (msg: Uint8Array) => Buffer;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const coseKey = encodeCbor(
    new Map<number | string, unknown>([
      [1, 2], // kty: EC2
      [3, COSE_ALGORITHMS.ES256], // alg: -7
      [-1, 1], // crv: P-256
      [-2, b64uDecode(jwk.x)],
      [-3, b64uDecode(jwk.y)],
    ]),
  );
  return {
    coseKey,
    signPayload: (msg) => sign('sha256', msg, privateKey),
  };
}

function buildEdDsaFixture(): {
  readonly coseKey: Buffer;
  readonly signPayload: (msg: Uint8Array) => Buffer;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const coseKey = encodeCbor(
    new Map<number | string, unknown>([
      [1, 1], // kty: OKP
      [3, COSE_ALGORITHMS.EdDSA], // alg: -8
      [-1, 6], // crv: Ed25519
      [-2, b64uDecode(jwk.x)],
    ]),
  );
  return {
    coseKey,
    signPayload: (msg) => sign(null, msg, privateKey),
  };
}

function buildRs256Fixture(): {
  readonly coseKey: Buffer;
  readonly signPayload: (msg: Uint8Array) => Buffer;
} {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const coseKey = encodeCbor(
    new Map<number | string, unknown>([
      [1, 3], // kty: RSA
      [3, COSE_ALGORITHMS.RS256], // alg: -257
      [-1, b64uDecode(jwk.n)],
      [-2, b64uDecode(jwk.e)],
    ]),
  );
  return {
    coseKey,
    signPayload: (msg) => sign('sha256', msg, privateKey),
  };
}

describe('@bslt/protocols/cose (RFC 9052 / RFC 9053)', () => {
  it('parses and verifies valid ES256 (-7), EdDSA (-8), and RS256 (-257) COSE_Key signatures', () => {
    const message = Buffer.from('webauthn-signed-authenticator-and-clientdata-hash');

    const es256 = buildEs256Fixture();
    const parsedEs = parseCosePublicKeyPrefix(
      Buffer.concat([es256.coseKey, encodeCbor(new Map([['ext', true]]))]),
    );
    expect(parsedEs.key.alg).toBe(COSE_ALGORITHMS.ES256);
    expect(parsedEs.bytesRead).toBe(es256.coseKey.length);
    expect(verifyCoseSignature(es256.coseKey, message, es256.signPayload(message))).toBe(true);

    const eddsa = buildEdDsaFixture();
    expect(parseCosePublicKey(eddsa.coseKey).alg).toBe(COSE_ALGORITHMS.EdDSA);
    expect(verifyCoseSignature(eddsa.coseKey, message, eddsa.signPayload(message))).toBe(true);

    const rs256 = buildRs256Fixture();
    expect(parseCosePublicKey(rs256.coseKey).alg).toBe(COSE_ALGORITHMS.RS256);
    expect(verifyCoseSignature(rs256.coseKey, message, rs256.signPayload(message))).toBe(true);
  });

  it('rejects non-map CBOR payloads and unsupported COSE algorithms', () => {
    expect(() => parseCosePublicKey(encodeCbor([1, 2, 3]))).toThrow(/map/iu);
    expect(() =>
      parseCosePublicKey(
        encodeCbor(
          new Map<number | string, unknown>([
            [1, 2],
            [3, -35], // ES384 not enabled
          ]),
        ),
      ),
    ).toThrow(/algorithm/iu);
  });

  it('rejects mismatched kty/alg, invalid curves, wrong coordinate lengths, and off-curve EC points', () => {
    // ES256 with kty=1 (OKP instead of EC2)
    expect(() =>
      parseCosePublicKey(
        encodeCbor(
          new Map<number | string, unknown>([
            [1, 1],
            [3, -7],
            [-1, 1],
            [-2, Buffer.alloc(32, 1)],
            [-3, Buffer.alloc(32, 2)],
          ]),
        ),
      ),
    ).toThrow(/kty|key type/iu);

    // ES256 with wrong crv=2 (P-384 instead of P-256)
    expect(() =>
      parseCosePublicKey(
        encodeCbor(
          new Map<number | string, unknown>([
            [1, 2],
            [3, -7],
            [-1, 2],
            [-2, Buffer.alloc(32, 1)],
            [-3, Buffer.alloc(32, 2)],
          ]),
        ),
      ),
    ).toThrow(/curve/iu);

    // ES256 with off-curve (x=1, y=1) point on P-256
    const offCurve = encodeCbor(
      new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.alloc(32, 1)],
        [-3, Buffer.alloc(32, 1)],
      ]),
    );
    expect(() => parseCosePublicKey(offCurve)).toThrow();

    // EdDSA with 31-byte public key
    expect(() =>
      parseCosePublicKey(
        encodeCbor(
          new Map<number | string, unknown>([
            [1, 1],
            [3, -8],
            [-1, 6],
            [-2, Buffer.alloc(31, 5)],
          ]),
        ),
      ),
    ).toThrow(/32 bytes|length/iu);
  });

  it('rejects weak (< 2048-bit) RSA keys and invalid RSA exponents', () => {
    expect(() =>
      parseCosePublicKey(
        encodeCbor(
          new Map<number | string, unknown>([
            [1, 3],
            [3, -257],
            [-1, Buffer.alloc(128, 0xff)], // 1024-bit modulus -> rejected
            [-2, Buffer.from([1, 0, 1])],
          ]),
        ),
      ),
    ).toThrow(/2048|modulus/iu);

    expect(() =>
      parseCosePublicKey(
        encodeCbor(
          new Map<number | string, unknown>([
            [1, 3],
            [3, -257],
            [-1, Buffer.alloc(256, 0xff)],
            [-2, Buffer.from([0, 0, 2])], // even exponent -> rejected
          ]),
        ),
      ),
    ).toThrow(/exponent/iu);
  });

  it('returns false on tampered message bytes, tampered signatures, cross-key replay, and trailing DER bytes', () => {
    const message = Buffer.from('original-assertion-payload');
    const es256 = buildEs256Fixture();
    const otherEs256 = buildEs256Fixture();
    const sig = es256.signPayload(message);

    // Tampered message
    expect(verifyCoseSignature(es256.coseKey, Buffer.from('tampered-assertion-payload'), sig)).toBe(
      false,
    );

    // Tampered signature byte
    const flipped = Buffer.from(sig);
    const lastIdx = flipped.length - 1;
    flipped[lastIdx] = (flipped[lastIdx] ?? 0) ^ 0xff;
    expect(verifyCoseSignature(es256.coseKey, message, flipped)).toBe(false);

    // Different P-256 key
    expect(verifyCoseSignature(otherEs256.coseKey, message, sig)).toBe(false);

    // Trailing garbage appended to DER signature
    expect(
      verifyCoseSignature(es256.coseKey, message, Buffer.concat([sig, Buffer.from([0x00])])),
    ).toBe(false);

    // EdDSA wrong signature length
    const eddsa = buildEdDsaFixture();
    expect(verifyCoseSignature(eddsa.coseKey, message, Buffer.alloc(63, 1))).toBe(false);
  });
});
