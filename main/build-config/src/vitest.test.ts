// main/build-config/src/vitest.test.ts
import { describe, expect, it } from 'vitest';

import { SOURCE_CONDITION } from './vite';
import { baseVitestConfig, defineVitestConfig, withSourceConditions } from './vitest';

describe('defineVitestConfig', () => {
  it('resolves workspace packages from source under Node', () => {
    expect(baseVitestConfig.ssr?.resolve?.conditions?.[0]).toBe(SOURCE_CONDITION);
    expect(baseVitestConfig.resolve?.conditions?.[0]).toBe(SOURCE_CONDITION);
  });

  it('merges the package settings over the base', () => {
    const config = defineVitestConfig({ test: { name: 'pkg', testTimeout: 60000 } });

    expect(config.test?.name).toBe('pkg');
    expect(config.test?.testTimeout).toBe(60000);
    expect(config.test?.clearMocks).toBe(true);
    expect(config.ssr?.resolve?.conditions?.[0]).toBe(SOURCE_CONDITION);
  });
});

describe('withSourceConditions', () => {
  it('adds the source condition and nothing from the base', () => {
    const config = withSourceConditions({ test: { name: 'pkg' } });

    expect(config.ssr?.resolve?.conditions).toEqual([SOURCE_CONDITION]);
    expect(config.resolve?.conditions).toEqual([SOURCE_CONDITION]);
    expect(config.test?.name).toBe('pkg');
    expect(config.test?.clearMocks).toBeUndefined();
  });
});

/**
 * This file itself is proof that the source condition works end to end: the
 * package's own config is built with `defineVitestConfig`, and this import
 * resolves `@bslt/build-config/vite` through the package `exports`.
 */
describe('self import through exports', () => {
  it('resolves the package by name', async () => {
    const viaName = await import('@bslt/build-config/vite');
    expect(viaName.SOURCE_CONDITION).toBe(SOURCE_CONDITION);
  });
});
