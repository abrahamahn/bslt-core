// main/kernel/protocols/src/cose.ts
/**
 * CBOR Object Signing and Encryption `COSE_Key` public-key parsing and signature
 * verification (RFC 9052 / RFC 9053) over `node:crypto` for WebAuthn passkeys:
 * - ES256 (`alg = -7`, `kty = 2` EC2, `crv = 1` P-256, ASN.1 DER signature)
 * - EdDSA (`alg = -8`, `kty = 1` OKP, `crv = 6` Ed25519, 64-byte signature)
 * - RS256 (`alg = -257`, `kty = 3` RSA, >= 2048-bit modulus, odd exponent >= 65537)
 */
import { createPublicKey, type KeyObject, verify } from 'node:crypto';

import { type CborMap, type CborValue, decodeCbor, decodeCborPrefix } from './cbor';

export const COSE_ALGORITHMS = {
  ES256: -7,
  EdDSA: -8,
  RS256: -257,
} as const;

type CoseAlgorithm = (typeof COSE_ALGORITHMS)[keyof typeof COSE_ALGORITHMS];

interface ParsedCosePublicKey {
  readonly alg: CoseAlgorithm;
  readonly publicKey: KeyObject;
}

interface ParsedCosePublicKeyPrefix {
  readonly key: ParsedCosePublicKey;
  readonly bytesRead: number;
}

// NIST P-256 (`secp256r1` / `prime256v1`) prime field parameters for explicit
// affine curve-membership verification (`y^2 === x^3 - 3x + b (mod p)`).
const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_A = P256_P - 3n;
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (const byte of bytes) {
    acc = (acc << 8n) | BigInt(byte);
  }
  return acc;
}

function mod(n: bigint, m: bigint): bigint {
  const r = n % m;
  return r < 0n ? r + m : r;
}

function isValidP256Point(xBytes: Uint8Array, yBytes: Uint8Array): boolean {
  const x = bytesToBigInt(xBytes);
  const y = bytesToBigInt(yBytes);
  if (x >= P256_P || y >= P256_P) return false;
  if (x === 0n && y === 0n) return false;
  const lhs = mod(y * y, P256_P);
  const rhs = mod(mod(x * x, P256_P) * x + P256_A * x + P256_B, P256_P);
  return lhs === rhs;
}

function stripLeadingZeroBytes(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.byteLength - 1 && bytes[start] === 0) {
    start += 1;
  }
  return bytes.subarray(start);
}

function bitLength(bytes: Uint8Array): number {
  const trimmed = stripLeadingZeroBytes(bytes);
  const first = trimmed[0] ?? 0;
  if (first === 0) return 0;
  const leadingZeros = Math.clz32(first) - 24;
  return (trimmed.byteLength - 1) * 8 + (8 - leadingZeros);
}

/**
 * Validate strict ASN.1 DER `SEQUENCE { r INTEGER, s INTEGER }` framing so
 * OpenSSL never silently ignores trailing bytes or non-DER padding on ES256.
 */
function isStrictDerEcdsaSignature(sig: Uint8Array): boolean {
  if (sig.byteLength < 8 || sig.byteLength > 72) return false;
  if (sig[0] !== 0x30) return false;
  const seqLen = sig[1] ?? 0;
  if ((seqLen & 0x80) !== 0 || 2 + seqLen !== sig.byteLength) return false;

  const readDerPositiveInt = (offset: number): number => {
    if (offset + 2 > sig.byteLength) return -1;
    if (sig[offset] !== 0x02) return -1;
    const len = sig[offset + 1] ?? 0;
    if (len < 1 || len > 33 || offset + 2 + len > sig.byteLength) return -1;
    const first = sig[offset + 2] ?? 0;
    if ((first & 0x80) !== 0) return -1;
    if (first === 0x00 && (len === 1 || ((sig[offset + 3] ?? 0) & 0x80) === 0)) {
      return -1;
    }
    return offset + 2 + len;
  };

  const afterR = readDerPositiveInt(2);
  if (afterR === -1) return false;
  const afterS = readDerPositiveInt(afterR);
  return afterS === sig.byteLength;
}

function isByteArray(val: unknown): val is Uint8Array {
  return (
    val instanceof Uint8Array ||
    Buffer.isBuffer(val) ||
    Object.prototype.toString.call(val) === '[object Uint8Array]'
  );
}

function expectBytes(val: CborValue | undefined, label: string): Uint8Array {
  if (!isByteArray(val) || val.byteLength === 0) {
    throw new TypeError(`COSE_Key ${label} must be a non-empty byte string`);
  }
  return val;
}

function describeCborScalar(val: CborValue | undefined): string {
  if (typeof val === 'number' || typeof val === 'bigint' || typeof val === 'string') {
    return String(val);
  }
  if (typeof val === 'boolean') return String(val);
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  return typeof val;
}

function parseFromMap(decoded: CborValue): ParsedCosePublicKey {
  if (!(decoded instanceof Map) && Object.prototype.toString.call(decoded) !== '[object Map]') {
    throw new TypeError('COSE_Key payload must be a CBOR map');
  }
  const map = decoded as CborMap;
  const kty = map.get(1);
  const alg = map.get(3);

  if (
    alg !== COSE_ALGORITHMS.ES256 &&
    alg !== COSE_ALGORITHMS.EdDSA &&
    alg !== COSE_ALGORITHMS.RS256
  ) {
    throw new TypeError(`Unsupported COSE algorithm: ${describeCborScalar(alg)}`);
  }

  if (alg === COSE_ALGORITHMS.ES256) {
    if (kty !== 2) {
      throw new TypeError(
        `ES256 COSE_Key requires key type kty=2 (EC2), received ${describeCborScalar(kty)}`,
      );
    }
    const crv = map.get(-1);
    if (crv !== 1) {
      throw new TypeError(
        `ES256 COSE_Key requires P-256 curve (crv=1), received ${describeCborScalar(crv)}`,
      );
    }
    const x = expectBytes(map.get(-2), 'x coordinate');
    const y = expectBytes(map.get(-3), 'y coordinate');
    if (x.byteLength !== 32 || y.byteLength !== 32) {
      throw new TypeError('ES256 P-256 coordinates must each be 32 bytes');
    }
    if (!isValidP256Point(x, y)) {
      throw new TypeError('ES256 coordinates do not lie on the P-256 curve');
    }
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: Buffer.from(x).toString('base64url'),
        y: Buffer.from(y).toString('base64url'),
      },
      format: 'jwk',
    });
    return { alg, publicKey };
  }

  if (alg === COSE_ALGORITHMS.EdDSA) {
    if (kty !== 1) {
      throw new TypeError(
        `EdDSA COSE_Key requires key type kty=1 (OKP), received ${describeCborScalar(kty)}`,
      );
    }
    const crv = map.get(-1);
    if (crv !== 6) {
      throw new TypeError(
        `EdDSA COSE_Key requires Ed25519 curve (crv=6), received ${describeCborScalar(crv)}`,
      );
    }
    const x = expectBytes(map.get(-2), 'Ed25519 public key');
    if (x.byteLength !== 32) {
      throw new TypeError('Ed25519 public key coordinate must be 32 bytes in length');
    }
    const publicKey = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: Buffer.from(x).toString('base64url'),
      },
      format: 'jwk',
    });
    return { alg, publicKey };
  }

  // RS256 (`alg === -257`)
  if (kty !== 3) {
    throw new TypeError(
      `RS256 COSE_Key requires key type kty=3 (RSA), received ${describeCborScalar(kty)}`,
    );
  }
  const nRaw = expectBytes(map.get(-1), 'RSA modulus');
  const eRaw = expectBytes(map.get(-2), 'RSA exponent');
  if (bitLength(nRaw) < 2048) {
    throw new TypeError('RSA modulus must be at least 2048 bits');
  }
  const nTrimmed = stripLeadingZeroBytes(nRaw);
  const eTrimmed = stripLeadingZeroBytes(eRaw);
  const exponentValue = bytesToBigInt(eTrimmed);
  if (exponentValue < 65537n || (exponentValue & 1n) === 0n) {
    throw new TypeError('RSA public exponent must be an odd integer >= 65537');
  }
  const publicKey = createPublicKey({
    key: {
      kty: 'RSA',
      n: Buffer.from(nTrimmed).toString('base64url'),
      e: Buffer.from(eTrimmed).toString('base64url'),
    },
    format: 'jwk',
  });
  return { alg, publicKey };
}

/** Parse a `COSE_Key` prefix from `coseBytes` starting at `offset`. */
export function parseCosePublicKeyPrefix(
  coseBytes: Uint8Array,
  offset = 0,
): ParsedCosePublicKeyPrefix {
  const { value, bytesRead } = decodeCborPrefix(coseBytes, offset);
  return { key: parseFromMap(value), bytesRead };
}

/** Parse an exact `COSE_Key` byte buffer, rejecting trailing bytes. */
export function parseCosePublicKey(coseBytes: Uint8Array): ParsedCosePublicKey {
  return parseFromMap(decodeCbor(coseBytes));
}

/**
 * Verify `signature` over `message` against a `COSE_Key` (raw CBOR bytes or an
 * already-parsed `ParsedCosePublicKey`).
 */
export function verifyCoseSignature(
  cosePublicKey: Uint8Array | ParsedCosePublicKey,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  const parsed = isByteArray(cosePublicKey) ? parseCosePublicKey(cosePublicKey) : cosePublicKey;

  if (parsed.alg === COSE_ALGORITHMS.ES256) {
    if (!isStrictDerEcdsaSignature(signature)) return false;
    return verify('sha256', message, parsed.publicKey, signature);
  }
  if (parsed.alg === COSE_ALGORITHMS.EdDSA) {
    if (signature.byteLength !== 64) return false;
    return verify(null, message, parsed.publicKey, signature);
  }
  return verify('sha256', message, parsed.publicKey, signature);
}
