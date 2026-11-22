// main/kernel/schema/src/regex.test.ts
import { describe, expect, it } from 'vitest';

import {
  EMAIL_REGEX,
  IP_V4_REGEX,
  IP_V6_REGEX,
  URL_REGEX,
  UUID_REGEX,
  isValidAbsoluteUrl,
} from './regex';

describe('isomorphic validation regexes and URL validator', () => {
  describe('valid inputs', () => {
    it('matches valid emails, UUIDs, HTTP URLs, IPv4, and IPv6', () => {
      expect(EMAIL_REGEX.test('alice@example.com')).toBe(true);
      expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(URL_REGEX.test('https://example.com/path')).toBe(true);
      expect(IP_V4_REGEX.test('192.168.1.1')).toBe(true);
      expect(IP_V6_REGEX.test('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    });

    it('isValidAbsoluteUrl accepts valid hierarchical and non-hierarchical URLs', () => {
      expect(isValidAbsoluteUrl('https://fcm.googleapis.com/fcm/send/token')).toBe(true);
      expect(isValidAbsoluteUrl('http://localhost:8080/callback?code=123#ok')).toBe(true);
      expect(isValidAbsoluteUrl('wss://realtime.example.com:443/ws')).toBe(true);
      expect(isValidAbsoluteUrl('mailto:support@example.com')).toBe(true);
    });
  });

  describe('failure states (adversarial)', () => {
    it('rejects empty strings across all validators', () => {
      expect(EMAIL_REGEX.test('')).toBe(false);
      expect(UUID_REGEX.test('')).toBe(false);
      expect(URL_REGEX.test('')).toBe(false);
      expect(IP_V4_REGEX.test('')).toBe(false);
      expect(IP_V6_REGEX.test('')).toBe(false);
      expect(isValidAbsoluteUrl('')).toBe(false);
    });

    it('isValidAbsoluteUrl rejects root-relative paths and bare hostnames', () => {
      expect(isValidAbsoluteUrl('/dashboard')).toBe(false);
      expect(isValidAbsoluteUrl('/a?b=1#c')).toBe(false);
      expect(isValidAbsoluteUrl('example.com/path')).toBe(false);
    });

    it('isValidAbsoluteUrl rejects missing or malformed schemes', () => {
      expect(isValidAbsoluteUrl('://example.com')).toBe(false);
      expect(isValidAbsoluteUrl('1http://example.com')).toBe(false);
      expect(isValidAbsoluteUrl('ht!tp://example.com')).toBe(false);
    });

    it('isValidAbsoluteUrl rejects http/https/ws/wss/ftp without // or with empty host', () => {
      expect(isValidAbsoluteUrl('http:example.com')).toBe(false);
      expect(isValidAbsoluteUrl('https://')).toBe(false);
      expect(isValidAbsoluteUrl('https:///path-only')).toBe(false);
      expect(isValidAbsoluteUrl('ws://:8080/ws')).toBe(false);
    });

    it('isValidAbsoluteUrl rejects out-of-range or non-numeric ports', () => {
      expect(isValidAbsoluteUrl('https://example.com:65536/x')).toBe(false);
      expect(isValidAbsoluteUrl('https://example.com:abc/x')).toBe(false);
    });

    it('isValidAbsoluteUrl rejects strings with whitespace or control characters', () => {
      expect(isValidAbsoluteUrl('https://example.com/with space')).toBe(false);
      expect(isValidAbsoluteUrl('https://example.com/\nnewline')).toBe(false);
      expect(isValidAbsoluteUrl('   ')).toBe(false);
    });
  });
});
