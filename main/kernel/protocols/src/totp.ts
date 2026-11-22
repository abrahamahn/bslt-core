// main/kernel/protocols/src/totp.ts
/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), with RFC 4648 base32 secrets and the
 * `otpauth://` key URI that authenticator apps scan.
 *
 * Verification uses what every authenticator app assumes: HMAC-SHA-1, six
 * digits and a 30-second step. `totpCode` also takes SHA-256, SHA-512 and other
 * lengths, because the RFC 6238 vectors use them.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type Algorithm = 'SHA1' | 'SHA256' | 'SHA512';

interface CodeOptions {
  readonly algorithm?: Algorithm;
  readonly digits?: number;
  /** Milliseconds since the epoch; now when absent. */
  readonly timestamp?: number;
}

interface KeyUri {
  readonly issuer: string;
  readonly label: string;
  /** Base32. */
  readonly secret: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20;

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += BASE32_ALPHABET.charAt((value >>> bits) & 31);
    }
  }
  return bits > 0 ? text + BASE32_ALPHABET.charAt((value << (5 - bits)) & 31) : text;
}

/**
 * As lenient as otpauth, so every secret it accepted still works: spaces are
 * dropped, case is ignored, trailing padding is stripped, and bits left over
 * after the last whole byte are discarded. Any other symbol throws.
 */
function base32Decode(text: string): Buffer {
  const symbols = text.replaceAll(' ', '').toUpperCase().replace(/=+$/u, '');
  const bytes = Buffer.alloc(Math.floor((symbols.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const symbol of symbols) {
    const digit = BASE32_ALPHABET.indexOf(symbol);
    // The symbol is part of a secret, so the message does not name it.
    if (digit === -1) throw new TypeError('A TOTP secret must be base32');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index] = (value >>> bits) & 0xff;
      index += 1;
    }
  }
  return bytes;
}

/** RFC 4226 section 5.3: HMAC over the big-endian counter, then dynamic truncation. */
function hotp(key: Buffer, counter: number, algorithm: Algorithm, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, key).update(message).digest();
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const counterAt = (timestamp: number): number => Math.floor(timestamp / 1000 / PERIOD_SECONDS);

/** A new secret: 20 random bytes as 32 upper-case base32 symbols without padding. */
export function createTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The code of `secret` (base32) at `timestamp`. */
export function totpCode(secret: string, options: CodeOptions = {}): string {
  const { algorithm = 'SHA1', digits = DIGITS, timestamp = Date.now() } = options;
  return hotp(base32Decode(secret), counterAt(timestamp), algorithm, digits);
}

/**
 * True when `token` is the code of the current step or of up to `window` steps
 * either side. The secret is decoded first, so a corrupt secret throws whatever
 * the token is. A token that is not exactly six ASCII digits is false. Steps
 * before the epoch are skipped, and every candidate is compared in constant time.
 */
export function verifyTotp(secret: string, token: string, window: number): boolean {
  const key = base32Decode(secret);
  if (token.length !== DIGITS || !/^[0-9]+$/u.test(token)) return false;
  const current = counterAt(Date.now());
  const counters = [current];
  for (let step = 1; step <= window; step += 1) counters.push(current - step, current + step);
  const expected = Buffer.from(token);
  return counters
    .filter((counter) => counter >= 0)
    .map((counter) => timingSafeEqual(Buffer.from(hotp(key, counter, 'SHA1', DIGITS)), expected))
    .includes(true);
}

/** The `otpauth://totp/` key URI an authenticator app scans. */
export function totpUri({ issuer, label, secret }: KeyUri): string {
  const encode = encodeURIComponent;
  const name = issuer === '' ? encode(label) : `${encode(issuer)}:${encode(label)}`;
  const issuerParameter = issuer === '' ? '' : `issuer=${encode(issuer)}&`;
  return `otpauth://totp/${name}?${issuerParameter}secret=${encode(secret)}&algorithm=SHA1&digits=6&period=30`;
}
