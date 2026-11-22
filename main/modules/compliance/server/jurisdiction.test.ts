// main/modules/compliance/server/jurisdiction.test.ts
import { describe, expect, it } from 'vitest';

import { createDefaultJurisdictionResolver } from './jurisdiction';

describe('createDefaultJurisdictionResolver', () => {
  it('returns null and rejects malformed/sentinel geo codes (XX, T1, whitespace, injection)', () => {
    const resolver = createDefaultJurisdictionResolver();

    expect(resolver.resolve({})).toBeNull();
    expect(resolver.resolve({ headers: { 'cf-ipcountry': 'XX' } })).toBeNull();
    expect(resolver.resolve({ headers: { 'cf-ipcountry': 'T1' } })).toBeNull();
    expect(resolver.resolve({ headers: { 'cf-ipcountry': '   ' } })).toBeNull();
    expect(resolver.resolve({ headers: { 'cf-ipcountry': 'US; DROP TABLE' } })).toBeNull();
    expect(resolver.resolve({ declaredCountry: '123' })).toBeNull();
  });

  it('prefers edge geo headers over declaredCountry and falls back to configured default', () => {
    const resolver = createDefaultJurisdictionResolver('us');

    expect(
      resolver.resolve({
        headers: { 'cf-ipcountry': 'gb', 'x-country-code': 'fr' },
        declaredCountry: 'DE',
      }),
    ).toBe('GB');

    expect(
      resolver.resolve({
        headers: { 'x-bslt-jurisdiction': 'us-tx' },
      }),
    ).toBe('US-TX');

    expect(
      resolver.resolve({
        headers: {},
        declaredCountry: 'kr',
      }),
    ).toBe('KR');

    expect(resolver.resolve({ headers: {} })).toBe('US');
  });
});
