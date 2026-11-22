// main/testing/src/config.test.ts
import { describe, expect, it } from 'vitest';

import { createTestConfig, mergeConfig, TEST_JWT_SECRET } from './config';

describe('mergeConfig', () => {
  it('merges objects key by key and replaces arrays and scalars', () => {
    const base = { a: { b: 1, c: [1, 2], d: { e: 'x' } }, f: 'keep' };
    expect(mergeConfig(base, { a: { c: [9], d: { e: 'y' } } })).toEqual({
      a: { b: 1, c: [9], d: { e: 'y' } },
      f: 'keep',
    });
    // The base is not written to.
    expect(base.a.c).toEqual([1, 2]);
  });

  it('ignores undefined overrides', () => {
    expect(mergeConfig({ a: 1, b: 2 }, { a: undefined })).toEqual({ a: 1, b: 2 });
    expect(mergeConfig({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});

describe('createTestConfig', () => {
  it('is the loader config with the test values on top', () => {
    const config = createTestConfig();

    expect(config.env).toBe('test');
    expect(config.auth.jwt.secret).toBe(TEST_JWT_SECRET);
    expect(config.auth.argon2.memoryCost).toBe(1024);
    expect(config.auth.strategies).toEqual(['local']);
    expect(config.storage.provider).toBe('local');
    // Sections no test value names come from the loader, whole and typed:
    // the production phases read them (billing URLs, cache provider, search).
    expect(typeof config.billing.enabled).toBe('boolean');
    expect(config.billing.urls).toBeDefined();
    expect(typeof config.cache.useExternalProvider).toBe('boolean');
    expect(config.search).toBeDefined();
  });

  it('merges a suite override into its section without dropping the rest', () => {
    const config = createTestConfig({
      auth: { strategies: ['local', 'webauthn'], refreshToken: { gracePeriodSeconds: 0 } },
      server: { rateLimit: { max: 100 } },
    });

    expect(config.auth.strategies).toEqual(['local', 'webauthn']);
    expect(config.auth.refreshToken).toEqual({ expiryDays: 7, gracePeriodSeconds: 0 });
    expect(config.auth.jwt.secret).toBe(TEST_JWT_SECRET);
    expect(config.server.rateLimit).toEqual({ windowMs: 60000, max: 100 });
  });

  it('gives every caller its own object', () => {
    expect(createTestConfig()).not.toBe(createTestConfig());
  });
});
