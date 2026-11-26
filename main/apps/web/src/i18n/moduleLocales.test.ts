// main/apps/web/src/i18n/moduleLocales.test.ts
import { describe, expect, it } from 'vitest';

import { loadInstalledModuleLocaleMessages } from './moduleLocales';

import type { WebModule } from '@bslt/web-platform';

describe('loadInstalledModuleLocaleMessages', () => {
  it('merges loaded locale bundles and tolerates null modules or rejected loaders', async () => {
    const okMod = {
      locales: {
        'ko-KR': () => Promise.resolve({ default: { 'ai.title': 'AI 어시스턴트' } }),
      },
    } as unknown as WebModule;
    const failingMod = {
      locales: {
        'ko-KR': () => Promise.reject(new Error('chunk failed')),
      },
    } as unknown as WebModule;
    const missingLocaleMod = {
      locales: {},
    } as unknown as WebModule;

    const merged = await loadInstalledModuleLocaleMessages('ko-KR', [
      null,
      okMod,
      failingMod,
      missingLocaleMod,
    ]);
    expect(merged).toEqual({ 'ai.title': 'AI 어시스턴트' });

    const empty = await loadInstalledModuleLocaleMessages('en-US', [okMod]);
    expect(empty).toEqual({});
  });
});
