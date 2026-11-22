// main/modules/devtools/module.test.ts
import { describe, expect, it } from 'vitest';

import { validateModules } from '@bslt/contract';

import { devtoolsModule } from './module';

describe('devtoolsModule manifest', () => {
  it('declares canonical module metadata with zero tables and zero dependencies', () => {
    expect(devtoolsModule.id).toBe('devtools');
    expect(devtoolsModule.dependsOn).toEqual([]);
    expect(devtoolsModule.tables).toEqual([]);
    expect('web' in devtoolsModule).toBe(false);
    expect(() => validateModules([devtoolsModule])).not.toThrow();
  });

  it('rejects duplicate devtoolsModule registration in validateModules', () => {
    expect(() => validateModules([devtoolsModule, devtoolsModule])).toThrow(/duplicate/i);
  });

  it('rejects unauthenticated access metadata by enforcing admin auth on getRouteManifest', () => {
    expect(devtoolsModule.endpoints.getRouteManifest.auth).not.toBe('public');
    expect(devtoolsModule.endpoints.getRouteManifest.auth).not.toBe('user');
  });
});
