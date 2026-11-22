// main/kernel/protocols/src/cbor.test.ts
import { describe, expect, it } from 'vitest';

import { type CborMap, decodeCbor, decodeCborPrefix, encodeCbor } from './cbor';

const hex = (h: string): Buffer => Buffer.from(h, 'hex');

describe('@bslt/protocols/cbor (RFC 8949)', () => {
  it('decodes and deterministically encodes RFC 8949 Appendix A vectors (integers, bytes, UTF-8, arrays, maps, booleans, null)', () => {
    // Unsigned & negative integers (RFC 8949 Appendix A)
    expect(decodeCbor(hex('00'))).toBe(0);
    expect(decodeCbor(hex('17'))).toBe(23);
    expect(decodeCbor(hex('1818'))).toBe(24);
    expect(decodeCbor(hex('1903e8'))).toBe(1000);
    expect(decodeCbor(hex('1a000f4240'))).toBe(1_000_000);
    expect(decodeCbor(hex('1b000000e8d4a51000'))).toBe(1_000_000_000_000);
    expect(decodeCbor(hex('1bffffffffffffffff'))).toBe(18446744073709551615n);
    expect(decodeCbor(hex('20'))).toBe(-1);
    expect(decodeCbor(hex('3818'))).toBe(-25);
    expect(decodeCbor(hex('3903e7'))).toBe(-1000);
    expect(decodeCbor(hex('3a00010000'))).toBe(-65537); // COSE RS256 = -257 is 390100:
    expect(decodeCbor(hex('390100'))).toBe(-257);

    // Simple values
    expect(decodeCbor(hex('f4'))).toBe(false);
    expect(decodeCbor(hex('f5'))).toBe(true);
    expect(decodeCbor(hex('f6'))).toBeNull();

    // Byte string & text string
    expect(Buffer.from(decodeCbor(hex('4401020304')) as Uint8Array)).toEqual(hex('01020304'));
    expect(decodeCbor(hex('6449455446'))).toBe('IETF');
    expect(decodeCbor(hex('6b68656c6c6f20776f726c64'))).toBe('hello world');

    // Nested array + map round-trip with canonical RFC 8949 §4.2 key ordering
    const encoded = encodeCbor(
      new Map<number | string, unknown>([
        [-2, hex('abcd')],
        [1, 2],
        [3, -7],
        ['fmt', 'none'],
        ['flags', [true, false, null]],
      ]),
    );
    const decoded = decodeCbor(encoded) as CborMap;
    expect(decoded).toBeInstanceOf(Map);
    expect(decoded.get(1)).toBe(2);
    expect(decoded.get(3)).toBe(-7);
    expect(decoded.get('fmt')).toBe('none');
    expect(decoded.get('flags')).toEqual([true, false, null]);
    expect(Buffer.from(decoded.get(-2) as Uint8Array)).toEqual(hex('abcd'));
  });

  it('supports prefix decoding for concatenated CBOR items (WebAuthn credentialPublicKey + extensions)', () => {
    const first = encodeCbor(
      new Map<number | string, unknown>([
        [1, 2],
        [3, -7],
      ]),
    );
    const second = encodeCbor(new Map<number | string, unknown>([['credProps', true]]));
    const combined = Buffer.concat([first, second]);

    const r1 = decodeCborPrefix(combined, 0);
    expect(r1.bytesRead).toBe(first.length);
    expect((r1.value as CborMap).get(3)).toBe(-7);

    const r2 = decodeCborPrefix(combined, r1.bytesRead);
    expect(r2.bytesRead).toBe(second.length);
    expect((r2.value as CborMap).get('credProps')).toBe(true);
  });

  it('rejects empty input and truncated integers, byte strings, text strings, arrays, and maps', () => {
    expect(() => decodeCbor(new Uint8Array(0))).toThrow(/empty|truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('18'))).toThrow(/truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('1901'))).toThrow(/truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('1a0001'))).toThrow(/truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('1b00010203'))).toThrow(/truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('440102'))).toThrow(/truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('644142'))).toThrow(/truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('830102'))).toThrow(/truncated|unexpected end/iu);
    expect(() => decodeCbor(hex('a2010203'))).toThrow(/truncated|unexpected end/iu);
  });

  it('rejects indefinite-length byte strings, text strings, arrays, maps, and break codes', () => {
    expect(() => decodeCbor(hex('5f420102ff'))).toThrow(/indefinite/iu);
    expect(() => decodeCbor(hex('7f6161ff'))).toThrow(/indefinite/iu);
    expect(() => decodeCbor(hex('9f0102ff'))).toThrow(/indefinite/iu);
    expect(() => decodeCbor(hex('bf616101ff'))).toThrow(/indefinite/iu);
    expect(() => decodeCbor(hex('ff'))).toThrow(/indefinite|break|unsupported/iu);
  });

  it('rejects trailing unconsumed bytes in decodeCbor', () => {
    expect(() => decodeCbor(hex('0102'))).toThrow(/trailing/iu);
  });

  it('rejects malformed UTF-8 text strings', () => {
    // 2-byte text string containing lone continuation / invalid UTF-8 bytes 0xc3 0x28
    expect(() => decodeCbor(hex('62c328'))).toThrow(/utf-8/iu);
  });

  it('rejects duplicate map keys and non-integer/string map keys (COSE parameter smuggling protection)', () => {
    // Map of 2 pairs with duplicate integer key 1 -> 2, 1 -> 3: a2 01 02 01 03
    expect(() => decodeCbor(hex('a201020103'))).toThrow(/duplicate/iu);
    // Map of 2 pairs with duplicate string key "a": a2 61 61 01 61 61 02
    expect(() => decodeCbor(hex('a2616101616102'))).toThrow(/duplicate/iu);
    // Map with byte-string key: a1 41 01 02
    expect(() => decodeCbor(hex('a1410102'))).toThrow(/map key/iu);
  });

  it('rejects deeply nested arrays/maps exceeding maximum recursion depth', () => {
    // 40 nested 1-element arrays: 0x81 repeated 40 times followed by 0x00
    const deep = Buffer.alloc(41, 0x81);
    deep[40] = 0x00;
    expect(() => decodeCbor(deep)).toThrow(/depth/iu);
  });
});
