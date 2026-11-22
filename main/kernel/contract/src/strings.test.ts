// main/kernel/contract/src/strings.test.ts
import { describe, expect, it } from 'vitest';

import {
  camelToSnake,
  camelizeKeys,
  canonicalizeEmail,
  capitalize,
  delay,
  escapeHtml,
  generateSecureId,
  snakeToCamel,
  snakeifyKeys,
  trimTrailingSlashes,
} from './strings';

describe('contract string and isomorphic helpers', () => {
  it('handles empty, all-caps, acronym, and cyclic inputs in camelToSnake / snakeToCamel / key mappers', () => {
    expect(camelToSnake('')).toBe('');
    expect(camelToSnake('API')).toBe('api');
    expect(camelToSnake('ownerUserId')).toBe('owner_user_id');
    expect(snakeToCamel('owner_user_id')).toBe('ownerUserId');
    expect(snakeToCamel('API_KEY')).toBe('apiKey');

    const cyclic: Record<string, unknown> = { firstName: 'Ada' };
    cyclic['selfRef'] = cyclic;
    const snaked = snakeifyKeys(cyclic) as Record<string, unknown>;
    expect(snaked['first_name']).toBe('Ada');
    expect(snaked['self_ref']).toBe(snaked);

    const camelized = camelizeKeys({ user_profile: { last_login_at: new Date(0) } }) as {
      userProfile: { lastLoginAt: Date };
    };
    expect(camelized.userProfile.lastLoginAt).toBeInstanceOf(Date);
  });

  it('strips Gmail dots and plus aliases in canonicalizeEmail while preserving non-Gmail dots and malformed strings', () => {
    expect(canonicalizeEmail('  First.Last+tag@GMAIL.com ')).toBe('firstlast@gmail.com');
    expect(canonicalizeEmail('First.Last+tag@example.com')).toBe('first.last@example.com');
    expect(canonicalizeEmail('not-an-email')).toBe('not-an-email');
  });

  it('escapes XSS characters in escapeHtml and handles nullish inputs in trimTrailingSlashes', () => {
    expect(escapeHtml('<script>alert("x" & \'y\')</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#x27;y&#x27;)&lt;/script&gt;',
    );
    expect(escapeHtml('')).toBe('');
    expect(trimTrailingSlashes(null)).toBe('');
    expect(trimTrailingSlashes(undefined)).toBe('');
    expect(trimTrailingSlashes('///')).toBe('');
    expect(trimTrailingSlashes('https://app.bslt.dev///')).toBe('https://app.bslt.dev');
    expect(capitalize('')).toBe('');
    expect(capitalize('aDMIN')).toBe('Admin');
  });

  it('generates unbiased alphanumeric IDs of exact requested length and resolves delay', async () => {
    const id = generateSecureId(24);
    expect(id).toHaveLength(24);
    expect(id).toMatch(/^[A-Za-z0-9]{24}$/u);
    expect(generateSecureId(0)).toBe('');
    await expect(delay(1)).resolves.toBeUndefined();
  });
});
