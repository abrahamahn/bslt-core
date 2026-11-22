// main/kernel/protocols/src/cbor.ts
/**
 * Concise Binary Object Representation (RFC 8949) definite-length codec with
 * §4.2 deterministic encoding and prefix-decoding support for WebAuthn / COSE.
 *
 * Security hardening for untrusted authenticator payloads:
 * - Rejects indefinite-length items and break codes (`0xff`).
 * - Enforces strict UTF-8 decoding (`TextDecoder` with `fatal: true`).
 * - Rejects duplicate map keys and non-(integer | string) map keys.
 * - Caps container nesting depth to prevent stack exhaustion.
 */

type CborMapKey = number | bigint | string;
export type CborMap = Map<CborMapKey, CborValue>;
export type CborValue =
  number | bigint | string | boolean | null | Uint8Array | readonly CborValue[] | CborMap;

interface CborDecodePrefixResult {
  readonly value: CborValue;
  readonly bytesRead: number;
}

const MAX_CBOR_DEPTH = 32;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_UINT64 = 0xffffffffffffffffn;

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    Buffer.isBuffer(value) ||
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function isMapInstance(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map || Object.prototype.toString.call(value) === '[object Map]';
}

class CborReader {
  private pos: number;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    offset: number,
  ) {
    if (offset < 0 || offset >= bytes.byteLength) {
      throw new RangeError('CBOR input is empty or truncated');
    }
    this.pos = offset;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.pos;
  }

  readItem(depth: number): CborValue {
    if (depth > MAX_CBOR_DEPTH) {
      throw new RangeError(`CBOR nesting depth exceeds maximum (${String(MAX_CBOR_DEPTH)})`);
    }
    const initial = this.readUint8();
    const major = initial >>> 5;
    const ai = initial & 0x1f;

    if (ai === 31) {
      if (major === 7) {
        throw new TypeError('Indefinite-length CBOR break code is unsupported');
      }
      throw new TypeError('Indefinite-length CBOR items are not permitted');
    }

    switch (major) {
      case 0:
        return this.readArgument(ai);
      case 1: {
        const arg = this.readArgument(ai);
        const negative = -1n - BigInt(arg);
        return negative >= MIN_SAFE_BIGINT ? Number(negative) : negative;
      }
      case 2: {
        const len = this.readSliceLength(ai);
        const slice = this.bytes.slice(this.pos, this.pos + len);
        this.pos += len;
        return slice;
      }
      case 3: {
        const len = this.readSliceLength(ai);
        const raw = this.bytes.subarray(this.pos, this.pos + len);
        this.pos += len;
        try {
          return strictUtf8Decoder.decode(raw);
        } catch {
          throw new TypeError('Malformed UTF-8 byte sequence in CBOR text string');
        }
      }
      case 4: {
        const count = this.readContainerCount(ai, 1);
        const items: CborValue[] = [];
        for (let i = 0; i < count; i += 1) {
          items.push(this.readItem(depth + 1));
        }
        return items;
      }
      case 5: {
        const count = this.readContainerCount(ai, 2);
        const map: CborMap = new Map<CborMapKey, CborValue>();
        for (let i = 0; i < count; i += 1) {
          const rawKey = this.readItem(depth + 1);
          if (
            typeof rawKey !== 'number' &&
            typeof rawKey !== 'bigint' &&
            typeof rawKey !== 'string'
          ) {
            throw new TypeError('Unsupported CBOR map key type; expected integer or text string');
          }
          if (map.has(rawKey)) {
            throw new TypeError(`Duplicate CBOR map key: ${String(rawKey)}`);
          }
          const val = this.readItem(depth + 1);
          map.set(rawKey, val);
        }
        return map;
      }
      case 6:
        throw new TypeError('CBOR semantic tags (major type 6) are unsupported');
      case 7: {
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        throw new TypeError(`Unsupported CBOR simple or floating-point value (ai=${String(ai)})`);
      }
      default:
        throw new TypeError(`Unreachable CBOR major type ${String(major)}`);
    }
  }

  private ensureAvailable(count: number): void {
    if (count < 0 || this.pos + count > this.bytes.byteLength) {
      throw new RangeError('Unexpected end of truncated CBOR input');
    }
  }

  private readUint8(): number {
    this.ensureAvailable(1);
    const value = this.view.getUint8(this.pos);
    this.pos += 1;
    return value;
  }

  private readArgument(ai: number): number | bigint {
    if (ai < 24) {
      return ai;
    }
    if (ai === 24) {
      return this.readUint8();
    }
    if (ai === 25) {
      this.ensureAvailable(2);
      const val = this.view.getUint16(this.pos, false);
      this.pos += 2;
      return val;
    }
    if (ai === 26) {
      this.ensureAvailable(4);
      const val = this.view.getUint32(this.pos, false);
      this.pos += 4;
      return val;
    }
    if (ai === 27) {
      this.ensureAvailable(8);
      const val = this.view.getBigUint64(this.pos, false);
      this.pos += 8;
      return val <= MAX_SAFE_BIGINT ? Number(val) : val;
    }
    throw new TypeError(`Reserved CBOR additional information (${String(ai)})`);
  }

  private readSliceLength(ai: number): number {
    const raw = this.readArgument(ai);
    if (typeof raw === 'bigint' || raw > this.bytes.byteLength - this.pos) {
      throw new RangeError('Truncated CBOR byte/text string payload');
    }
    return raw;
  }

  private readContainerCount(ai: number, minBytesPerEntry: number): number {
    const raw = this.readArgument(ai);
    const remaining = this.bytes.byteLength - this.pos;
    if (typeof raw === 'bigint' || raw * minBytesPerEntry > remaining) {
      throw new RangeError('Truncated CBOR array or map container');
    }
    return raw;
  }
}

/**
 * Decode a single CBOR data item starting at `offset` and return both the value
 * and `bytesRead` (used when trailing concatenated structures follow, such as
 * WebAuthn `credentialPublicKey` followed by authenticator `extensions`).
 */
export function decodeCborPrefix(input: Uint8Array, offset = 0): CborDecodePrefixResult {
  const reader = new CborReader(input, offset);
  const value = reader.readItem(0);
  return { value, bytesRead: reader.position - offset };
}

/** Decode a single complete CBOR data item, rejecting any unconsumed trailing bytes. */
export function decodeCbor(input: Uint8Array): CborValue {
  const { value, bytesRead } = decodeCborPrefix(input, 0);
  if (bytesRead !== input.byteLength) {
    throw new TypeError(
      `Trailing unconsumed bytes after CBOR item (${String(input.byteLength - bytesRead)} extra)`,
    );
  }
  return value;
}

function encodeHeader(major: number, argument: bigint): Buffer {
  if (argument < 0n || argument > MAX_UINT64) {
    throw new RangeError('CBOR integer header out of uint64 range');
  }
  const prefix = major << 5;
  if (argument < 24n) {
    return Buffer.from([prefix | Number(argument)]);
  }
  if (argument <= 0xffn) {
    return Buffer.from([prefix | 24, Number(argument)]);
  }
  if (argument <= 0xffffn) {
    const buf = Buffer.allocUnsafe(3);
    buf[0] = prefix | 25;
    buf.writeUInt16BE(Number(argument), 1);
    return buf;
  }
  if (argument <= 0xffffffffn) {
    const buf = Buffer.allocUnsafe(5);
    buf[0] = prefix | 26;
    buf.writeUInt32BE(Number(argument), 1);
    return buf;
  }
  const buf = Buffer.allocUnsafe(9);
  buf[0] = prefix | 27;
  buf.writeBigUInt64BE(argument, 1);
  return buf;
}

/** Deterministically encode a value as CBOR per RFC 8949 §4.2. */
export function encodeCbor(value: unknown): Buffer {
  if (value === null) {
    return Buffer.from([0xf6]);
  }
  if (typeof value === 'boolean') {
    return Buffer.from([value ? 0xf5 : 0xf4]);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('CBOR encoder requires safe integers (floating-point disallowed)');
    }
    return value >= 0 ? encodeHeader(0, BigInt(value)) : encodeHeader(1, -1n - BigInt(value));
  }
  if (typeof value === 'bigint') {
    return value >= 0n ? encodeHeader(0, value) : encodeHeader(1, -1n - value);
  }
  if (isUint8Array(value)) {
    return Buffer.concat([encodeHeader(2, BigInt(value.byteLength)), value]);
  }
  if (typeof value === 'string') {
    const utf8 = Buffer.from(value, 'utf8');
    return Buffer.concat([encodeHeader(3, BigInt(utf8.byteLength)), utf8]);
  }
  if (Array.isArray(value)) {
    const parts: Buffer[] = [encodeHeader(4, BigInt(value.length))];
    for (const item of value) {
      parts.push(encodeCbor(item));
    }
    return Buffer.concat(parts);
  }
  if (isMapInstance(value)) {
    const encodedEntries: { readonly keyBytes: Buffer; readonly valueBytes: Buffer }[] = [];
    for (const [k, v] of value.entries()) {
      if (typeof k !== 'number' && typeof k !== 'bigint' && typeof k !== 'string') {
        throw new TypeError('CBOR map keys must be integers or strings');
      }
      encodedEntries.push({ keyBytes: encodeCbor(k), valueBytes: encodeCbor(v) });
    }
    encodedEntries.sort((a, b) => Buffer.compare(a.keyBytes, b.keyBytes));
    for (let i = 1; i < encodedEntries.length; i += 1) {
      const prev = encodedEntries[i - 1];
      const curr = encodedEntries[i];
      if (prev !== undefined && curr !== undefined && prev.keyBytes.equals(curr.keyBytes)) {
        throw new TypeError('Duplicate canonical CBOR map key');
      }
    }
    const parts: Buffer[] = [encodeHeader(5, BigInt(encodedEntries.length))];
    for (const entry of encodedEntries) {
      parts.push(entry.keyBytes, entry.valueBytes);
    }
    return Buffer.concat(parts);
  }
  throw new TypeError(`Unsupported value for CBOR encoding: ${typeof value}`);
}
