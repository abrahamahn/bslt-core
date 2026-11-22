// main/build-config/src/vite.test.ts
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { describe, expect, it } from 'vitest';

import { defineViteConfig, SOURCE_CONDITION } from './vite';

describe('defineViteConfig', () => {
  it('puts the source condition first for the client and the server', () => {
    const config = defineViteConfig({});

    expect(config.resolve?.conditions).toEqual([SOURCE_CONDITION, ...defaultClientConditions]);
    expect(config.ssr?.resolve?.conditions).toEqual([SOURCE_CONDITION, ...defaultServerConditions]);
  });

  it('keeps the settings it is given', () => {
    const config = defineViteConfig({ base: '/app/', resolve: { dedupe: ['react'] } });

    expect(config.base).toBe('/app/');
    expect(config.resolve?.dedupe).toEqual(['react']);
    expect(config.resolve?.conditions?.[0]).toBe(SOURCE_CONDITION);
  });
});
