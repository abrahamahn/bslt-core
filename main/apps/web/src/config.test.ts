// main/apps/web/src/config.test.ts
import { describe, expect, it } from 'vitest';

import { clientConfig, DEFAULT_APP_NAME } from './config';

describe('clientConfig', () => {
  it('exposes non-empty app branding, bounded refresh interval, and query persistence windows', () => {
    expect(DEFAULT_APP_NAME.trim().length).toBeGreaterThan(0);
    expect(clientConfig.appName.trim().length).toBeGreaterThan(0);
    expect(clientConfig.tokenRefreshInterval).toBeGreaterThan(0);
    expect(clientConfig.queryPersistence.maxAge).toBeGreaterThan(
      clientConfig.queryPersistence.throttleTime,
    );
    expect(clientConfig.apiUrl).not.toMatch(/\/$/u);
  });
});
