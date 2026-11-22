// main/kernel/server/src/security/geo.logic.test.ts

import { describe, expect, it } from 'vitest';

import { DEFAULT_BLOCKED_REGIONS } from '../config/constants';

import {
  createJurisdictionBlockedBody,
  evaluateGeoAccess,
  isGeoExemptPath,
  jurisdictionsFor,
  normalizeBlockedRegion,
  normalizeCountry,
  normalizeRegion,
  parseBlockedRegions,
} from './geo.logic';
import { JURISDICTION_BLOCKED, jurisdictionBlockedBodySchema } from './geo.schemas';

const WA = ['US-WA'] as const;

describe('normalizeCountry', () => {
  it('uppercases and trims a country code', () => {
    expect(normalizeCountry('us')).toBe('US');
    expect(normalizeCountry(' Us ')).toBe('US');
    expect(normalizeCountry('US')).toBe('US');
  });

  it('treats a CDN "I do not know" as unknown', () => {
    // Cloudflare sends XX when it cannot place the IP, and T1 for Tor.
    expect(normalizeCountry('XX')).toBeUndefined();
    expect(normalizeCountry('xx')).toBeUndefined();
    expect(normalizeCountry('T1')).toBeUndefined();
  });

  it('rejects anything that is not a 2-letter code', () => {
    expect(normalizeCountry('USA')).toBeUndefined();
    expect(normalizeCountry('U')).toBeUndefined();
    expect(normalizeCountry('')).toBeUndefined();
    expect(normalizeCountry('   ')).toBeUndefined();
    expect(normalizeCountry('1S')).toBeUndefined();
    expect(normalizeCountry(undefined)).toBeUndefined();
  });
});

describe('normalizeRegion', () => {
  it('normalizes codes and names to a comparable token', () => {
    expect(normalizeRegion('wa')).toBe('WA');
    expect(normalizeRegion('Washington')).toBe('WASHINGTON');
    expect(normalizeRegion('New York')).toBe('NEWYORK');
  });

  it('returns undefined for an empty or punctuation-only value', () => {
    expect(normalizeRegion('')).toBeUndefined();
    expect(normalizeRegion('  ')).toBeUndefined();
    expect(normalizeRegion('--')).toBeUndefined();
    expect(normalizeRegion(undefined)).toBeUndefined();
  });
});

describe('normalizeBlockedRegion', () => {
  it('normalizes a configured entry', () => {
    expect(normalizeBlockedRegion('us-wa')).toBe('US-WA');
    expect(normalizeBlockedRegion('US - WA')).toBe('US-WA');
    expect(normalizeBlockedRegion('us')).toBe('US');
    expect(normalizeBlockedRegion('US-WASHINGTON')).toBe('US-WASHINGTON');
  });

  it('collapses an unusable entry to the empty string', () => {
    expect(normalizeBlockedRegion('')).toBe('');
    expect(normalizeBlockedRegion('-')).toBe('');
    expect(normalizeBlockedRegion('   ')).toBe('');
  });
});

describe('parseBlockedRegions', () => {
  it('normalizes, drops unusable entries, and de-duplicates', () => {
    expect(parseBlockedRegions(['us-wa', 'US-WA', '', '-', ' nv '])).toEqual(['US-WA', 'NV']);
  });

  it('is empty for an empty list', () => {
    expect(parseBlockedRegions([])).toEqual([]);
  });
});

describe('jurisdictionsFor', () => {
  it('lists the most specific jurisdiction first', () => {
    expect(jurisdictionsFor({ country: 'US', region: 'WA' })).toEqual(['US-WA', 'US']);
  });

  it('lists only the country when the region is unknown', () => {
    expect(jurisdictionsFor({ country: 'US' })).toEqual(['US']);
  });

  it('yields nothing without a country — a region alone is not a jurisdiction', () => {
    expect(jurisdictionsFor({})).toEqual([]);
    expect(jurisdictionsFor({ region: 'WA' })).toEqual([]);
    expect(jurisdictionsFor({ country: 'XX', region: 'WA' })).toEqual([]);
  });
});

describe('evaluateGeoAccess', () => {
  it('blocks a blocked region and names the jurisdiction that matched', () => {
    expect(evaluateGeoAccess({ country: 'US', region: 'WA' }, WA)).toEqual({
      allowed: false,
      jurisdiction: 'US-WA',
    });
  });

  it('allows an UNKNOWN location — we cannot know, and blocking everyone is worse', () => {
    expect(evaluateGeoAccess({}, WA)).toEqual({ allowed: true });
    expect(evaluateGeoAccess({ country: undefined, region: undefined }, WA)).toEqual({
      allowed: true,
    });
    // A CDN that says "I could not place this" is unknown, not blocked.
    expect(evaluateGeoAccess({ country: 'XX', region: 'WA' }, WA)).toEqual({ allowed: true });
    // A region with no country cannot be attributed to a jurisdiction.
    expect(evaluateGeoAccess({ region: 'WA' }, WA)).toEqual({ allowed: true });
  });

  it('allows a non-blocked region', () => {
    expect(evaluateGeoAccess({ country: 'US', region: 'CA' }, WA)).toEqual({ allowed: true });
    expect(evaluateGeoAccess({ country: 'GB' }, WA)).toEqual({ allowed: true });
    // The country alone is not blocked — only the subdivision is.
    expect(evaluateGeoAccess({ country: 'US' }, WA)).toEqual({ allowed: true });
  });

  it('matches case-insensitively on both sides', () => {
    expect(evaluateGeoAccess({ country: 'us', region: 'wa' }, ['us-wa'])).toEqual({
      allowed: false,
      jurisdiction: 'US-WA',
    });
  });

  it('blocks an entire country when the entry names one', () => {
    expect(evaluateGeoAccess({ country: 'US', region: 'CA' }, ['US'])).toEqual({
      allowed: false,
      jurisdiction: 'US',
    });
  });

  it('prefers the most specific jurisdiction when both match', () => {
    expect(evaluateGeoAccess({ country: 'US', region: 'WA' }, ['US', 'US-WA'])).toEqual({
      allowed: false,
      jurisdiction: 'US-WA',
    });
  });

  it('blocks nothing when the configured list is empty', () => {
    expect(evaluateGeoAccess({ country: 'US', region: 'WA' }, [])).toEqual({ allowed: true });
  });

  it('changes behaviour with the configured list — a new jurisdiction is config, not code', () => {
    const location = { country: 'CA', region: 'ON' };
    expect(evaluateGeoAccess(location, WA)).toEqual({ allowed: true });
    expect(evaluateGeoAccess(location, ['US-WA', 'CA-ON'])).toEqual({
      allowed: false,
      jurisdiction: 'CA-ON',
    });
  });

  describe('the shipped default', () => {
    it('is empty — a neutral starter blocks nowhere until configured', () => {
      expect(DEFAULT_BLOCKED_REGIONS).toEqual([]);
    });

    it('allows everywhere out of the box — blocking is a deployment decision', () => {
      for (const location of [
        { country: 'US', region: 'WA' },
        { country: 'GB' },
        { country: 'SG' },
        {},
      ]) {
        expect(evaluateGeoAccess(location, DEFAULT_BLOCKED_REGIONS)).toEqual({ allowed: true });
      }
    });
  });

  it('does NOT match a region name against a code-only entry', () => {
    // Documented sharp edge: `cf-region` sends "Washington", not "WA". A list of
    // only ['US-WA'] does not catch it — which is why a deployment blocking a
    // subdivision should list both spellings (US-WA and US-WASHINGTON).
    expect(evaluateGeoAccess({ country: 'US', region: 'Washington' }, WA)).toEqual({
      allowed: true,
    });
  });
});

describe('isGeoExemptPath', () => {
  it('exempts health probes, including with a query string', () => {
    expect(isGeoExemptPath('/health')).toBe(true);
    expect(isGeoExemptPath('/health/live')).toBe(true);
    expect(isGeoExemptPath('/health/ready')).toBe(true);
    expect(isGeoExemptPath('/health/detailed')).toBe(true);
    expect(isGeoExemptPath('/health?deep=1')).toBe(true);
  });

  it('exempts nothing else — a whole segment must match', () => {
    expect(isGeoExemptPath('/api/users')).toBe(false);
    expect(isGeoExemptPath('/health-club')).toBe(false);
    // Health routes are mounted unprefixed in this app; /api/health is not one.
    expect(isGeoExemptPath('/api/health')).toBe(false);
    expect(isGeoExemptPath('/metrics')).toBe(false);
    expect(isGeoExemptPath('/')).toBe(false);
    expect(isGeoExemptPath('')).toBe(false);
  });
});

describe('createJurisdictionBlockedBody', () => {
  it('is machine-readable, names the jurisdiction, and satisfies its own schema', () => {
    const body = createJurisdictionBlockedBody('US-WA');

    expect(body.code).toBe(JURISDICTION_BLOCKED);
    expect(body.jurisdiction).toBe('US-WA');
    expect(body.unavailablePath).toBe('/unavailable');
    expect(() => jurisdictionBlockedBodySchema.parse(body)).not.toThrow();
  });

  it('names the jurisdiction in the message, so a wrong answer is arguable', () => {
    expect(createJurisdictionBlockedBody('US-WA').message).toContain('US-WA');
  });
});
