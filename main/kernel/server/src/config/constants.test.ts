// main/kernel/server/src/config/constants.test.ts
import { describe, expect, it } from 'vitest';

import {
  ARGON2_DEFAULTS,
  DB_DEFAULTS,
  DEFAULT_BLOCKED_REGIONS,
  DEFAULT_SEARCH_SCHEMAS,
  getBool,
  getInt,
  getList,
  getRequired,
  REPEATING_SECRET_PATTERN,
  WEAK_SECRETS,
} from './constants';

describe('config constants & env parsers', () => {
  it('detects weak and repeating secrets', () => {
    expect(WEAK_SECRETS.has('secret')).toBe(true);
    expect(WEAK_SECRETS.has('strong-random-value')).toBe(false);
    expect(REPEATING_SECRET_PATTERN.test('a'.repeat(32))).toBe(true);
    expect(REPEATING_SECRET_PATTERN.test('a'.repeat(31))).toBe(false);
  });

  it('parses ints, booleans, lists, and required values with adversarial fallbacks', () => {
    expect(getInt('42', 10)).toBe(42);
    expect(getInt('not-a-number', 10)).toBe(10);
    expect(getInt(undefined, 10)).toBe(10);
    expect(getInt('', 10)).toBe(10);

    expect(getBool(' TRUE ')).toBe(true);
    expect(getBool('false')).toBe(false);
    expect(getBool(undefined)).toBe(false);
    expect(getBool('1')).toBe(false);

    expect(getList('a, b, ,c')).toEqual(['a', 'b', 'c']);
    expect(getList('')).toEqual([]);
    expect(getList(undefined)).toEqual([]);

    expect(getRequired('present', 'KEY')).toBe('present');
    expect(() => getRequired('', 'KEY')).toThrow('Missing required environment variable [KEY]');
    expect(() => getRequired(undefined, 'KEY')).toThrow(
      'Missing required environment variable [KEY]',
    );
  });

  it('exposes secure Argon2, DB, geo, and search defaults', () => {
    expect(ARGON2_DEFAULTS.TYPE).toBe(2);
    expect(DB_DEFAULTS.POSTGRES_PORT).toBe(5432);
    expect(DEFAULT_BLOCKED_REGIONS).toEqual([]);
    expect(DEFAULT_SEARCH_SCHEMAS['users']?.table).toBe('users');
  });
});
