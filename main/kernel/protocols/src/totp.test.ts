// main/kernel/protocols/src/totp.test.ts
import { spawnSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTotpSecret, totpCode, totpUri, verifyTotp } from './totp';

vi.mock('node:crypto', async (importOriginal) => {
  const actual: Record<string, unknown> & { timingSafeEqual: typeof timingSafeEqual } =
    await importOriginal();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

// The RFC seeds are the ASCII digits "1234567890" repeated to the key length of
// each hash: 20 bytes (SHA-1), 32 bytes (SHA-256) and 64 bytes (SHA-512).
const SEED_SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SEED_SHA256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const SEED_SHA512 =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

/** RFC 6238 Appendix B test times, in seconds. */
const RFC6238_TIMES = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];

const SECRET = 'JBSWY3DPEHPK3PXP';
const STEP_MS = 30_000;
/** Fifteen seconds into a step, so a step either side is a whole step away. */
const NOW = 1_234_567_905_000;

describe('totpCode', () => {
  it('reproduces the RFC 4226 Appendix D HOTP values for counters 0 to 9', () => {
    const codes = Array.from({ length: 10 }, (_, counter) =>
      totpCode(SEED_SHA1, { timestamp: counter * STEP_MS }),
    );
    expect(codes).toEqual([
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ]);
  });

  it('reproduces the RFC 6238 Appendix B SHA-1 values', () => {
    const codes = RFC6238_TIMES.map((seconds) =>
      totpCode(SEED_SHA1, { digits: 8, timestamp: seconds * 1000 }),
    );
    expect(codes).toEqual(['94287082', '07081804', '14050471', '89005924', '69279037', '65353130']);
  });

  it('reproduces the RFC 6238 Appendix B SHA-256 values', () => {
    const codes = RFC6238_TIMES.map((seconds) =>
      totpCode(SEED_SHA256, { algorithm: 'SHA256', digits: 8, timestamp: seconds * 1000 }),
    );
    expect(codes).toEqual(['46119246', '68084774', '67062674', '91819424', '90698825', '77737706']);
  });

  it('reproduces the RFC 6238 Appendix B SHA-512 values', () => {
    const codes = RFC6238_TIMES.map((seconds) =>
      totpCode(SEED_SHA512, { algorithm: 'SHA512', digits: 8, timestamp: seconds * 1000 }),
    );
    expect(codes).toEqual(['90693936', '25091201', '99943326', '93441116', '38618901', '47863826']);
  });

  it('decodes a secret as leniently as otpauth: any case, trailing padding, spaces, leftover bits', () => {
    const code = totpCode(SECRET, { timestamp: NOW });
    expect(totpCode('jbswy3dpehpk3pxp', { timestamp: NOW })).toBe(code);
    expect(totpCode(`${SECRET}====`, { timestamp: NOW })).toBe(code);
    expect(totpCode('JBSW Y3DP EHPK 3PXP', { timestamp: NOW })).toBe(code);
    // 15 symbols are 75 bits: nine whole bytes, and the three bits left over are dropped.
    expect(totpCode('JBSWY3DPEHPK3PX', { timestamp: NOW })).toMatch(/^[0-9]{6}$/);
  });

  it.each([
    ['a hyphen', 'totp-secret-of-alice'],
    ['the digit 1', 'JBSWY3DPEHPK3PX1'],
    ['the digit 8', 'JBSWY3DPEHPK3PX8'],
    ['padding before the end', 'JBSW=Y3DPEHPK3PXP'],
  ])('throws a TypeError for a secret containing %s', (_name, secret) => {
    expect(() => totpCode(secret, { timestamp: NOW })).toThrow(TypeError);
  });
});

describe('verifyTotp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const codeAt = (steps: number, secret = SECRET): string =>
    totpCode(secret, { timestamp: NOW + steps * STEP_MS });

  it('accepts the current step and one step either side with window 1', () => {
    expect(verifyTotp(SECRET, codeAt(0), 1)).toBe(true);
    expect(verifyTotp(SECRET, codeAt(-1), 1)).toBe(true);
    expect(verifyTotp(SECRET, codeAt(1), 1)).toBe(true);
  });

  it('rejects two steps either side with window 1', () => {
    expect(verifyTotp(SECRET, codeAt(-2), 1)).toBe(false);
    expect(verifyTotp(SECRET, codeAt(2), 1)).toBe(false);
  });

  it('accepts only the current step with window 0', () => {
    expect(verifyTotp(SECRET, codeAt(0), 0)).toBe(true);
    expect(verifyTotp(SECRET, codeAt(-1), 0)).toBe(false);
    expect(verifyTotp(SECRET, codeAt(1), 0)).toBe(false);
  });

  it('counts whole steps of a fractional window and treats a negative window as 0', () => {
    expect(verifyTotp(SECRET, codeAt(-1), 1.5)).toBe(true);
    expect(verifyTotp(SECRET, codeAt(-2), 1.5)).toBe(false);
    expect(verifyTotp(SECRET, codeAt(-1), 0.5)).toBe(false);
    expect(verifyTotp(SECRET, codeAt(0), -1)).toBe(true);
    expect(verifyTotp(SECRET, codeAt(-1), -1)).toBe(false);
  });

  it('compares every candidate step in constant time, without stopping at a match', () => {
    const compare = vi.mocked(timingSafeEqual);
    for (const [token, valid] of [
      [codeAt(0), true],
      [codeAt(5), false],
    ] as const) {
      compare.mockClear();
      expect(verifyTotp(SECRET, token, 1)).toBe(valid);
      expect(compare).toHaveBeenCalledTimes(3);
      for (const [given, expected] of compare.mock.calls) {
        expect([given.byteLength, expected.byteLength]).toEqual([6, 6]);
      }
    }
  });

  it('rejects the code of another secret', () => {
    expect(verifyTotp(SECRET, codeAt(0, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), 1)).toBe(false);
  });

  it.each([
    ['five digits', '28708'],
    ['seven digits', '2870820'],
    ['a letter', '28708a'],
    ['a leading space', ' 287082'],
    ['a backup code', 'ABCD-1234'],
    ['nothing', ''],
    ['Arabic-Indic digits', '٠١٢٣٤٥'],
    ['full-width digits', '０１２３４５'],
  ])('returns false without throwing for a token of %s', (_name, token) => {
    expect(verifyTotp(SECRET, token, 1)).toBe(false);
  });

  it('decodes the secret before it looks at the token, so a corrupt seed always throws', () => {
    expect(() => verifyTotp('totp-secret-of-alice', 'ABCD-1234', 1)).toThrow(TypeError);
    expect(() => verifyTotp('totp-secret-of-alice', '123456', 1)).toThrow(TypeError);
  });

  it('skips the step before the epoch instead of throwing', () => {
    vi.setSystemTime(0);
    const atEpoch = totpCode(SECRET, { timestamp: 0 });
    expect(verifyTotp(SECRET, atEpoch, 1)).toBe(true);
    expect(verifyTotp(SECRET, totpCode(SECRET, { timestamp: STEP_MS }), 1)).toBe(true);
    expect(verifyTotp(SECRET, totpCode(SECRET, { timestamp: 2 * STEP_MS }), 1)).toBe(false);
  });
});

describe('totpUri', () => {
  it('writes the otpauth key URI exactly as otpauth 9.6.0 did, with and without an issuer', () => {
    expect(totpUri({ issuer: 'Your App', label: 'user+tag@example.com', secret: SECRET })).toBe(
      'otpauth://totp/Your%20App:user%2Btag%40example.com?issuer=Your%20App&secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30',
    );
    expect(totpUri({ issuer: '', label: 'a b', secret: SECRET })).toBe(
      'otpauth://totp/a%20b?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('escapes a colon, ampersand and question mark in the issuer and label', () => {
    expect(totpUri({ issuer: 'A:B&C', label: 'x?y=z', secret: SECRET })).toBe(
      'otpauth://totp/A%3AB%26C:x%3Fy%3Dz?issuer=A%3AB%26C&secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('createTotpSecret', () => {
  it('returns 20 random bytes as 32 unpadded upper-case base32 symbols', () => {
    const first = createTotpSecret();
    const second = createTotpSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(second).toMatch(/^[A-Z2-7]{32}$/);
    expect(first).not.toBe(second);
  });
});

describe('the ./totp export', () => {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));

  /** Node's own exports resolution of the subpath under `conditions`. */
  const resolveTotp = (conditions: readonly string[]): string =>
    spawnSync(
      process.execPath,
      [
        ...conditions.map((condition) => `--conditions=${condition}`),
        '--input-type=module',
        '--eval',
        "console.log(import.meta.resolve('@bslt/protocols/totp'))",
      ],
      { cwd: packageRoot, encoding: 'utf8', env: {} },
    ).stdout.trim();

  it('is reachable only through `types` and `node`, which a browser build never sets', () => {
    // A resolver takes the first key it knows. Vite's client build knows `source`
    // (first), `module`, `browser`, `development` or `production`, `import` and
    // `default`, so any of those here would hand it node:crypto. Node always knows
    // `node`, so the map is read here rather than resolved.
    const { exports } = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8')) as {
      readonly exports: Record<string, object>;
    };
    expect(Object.keys(exports['./totp'] ?? {})).toEqual(['types', 'node']);
  });

  it('resolves to source for Node tools that read it and to dist for plain Node', () => {
    expect(resolveTotp(['source'])).toMatch(/\/main\/kernel\/protocols\/src\/totp\.ts$/u);
    expect(resolveTotp([])).toMatch(/\/main\/kernel\/protocols\/dist\/totp\.js$/u);
  });
});
