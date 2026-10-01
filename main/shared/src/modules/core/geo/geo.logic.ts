// main/shared/src/modules/core/geo/geo.logic.ts

/**
 * @file Geo Logic
 * @description The blocked-jurisdiction rule: pure, total, and the single place
 * that decides whether a location may use the service.
 * @module Core/Geo
 */

import { GEO_EXEMPT_PATH_PREFIXES, UNKNOWN_COUNTRY_CODES } from '../../../constants/core/geo';

import { JURISDICTION_BLOCKED, UNAVAILABLE_PATH } from './geo.schemas';

import type { GeoAccessDecision, GeoLocation, JurisdictionBlockedBody } from './geo.schemas';

// ============================================================================
// Normalization
// ============================================================================

/**
 * Reduce a CDN value or a configured entry to a comparable token: uppercase,
 * with everything that is not a letter or a digit removed. This is what makes
 * `wa`, `WA`, and ` Wa ` the same place — and what makes a CDN that reports
 * `New York` line up with a config that says `US-NEW YORK`.
 *
 * @complexity O(n) in the length of the value
 */
function normalizeToken(value: string): string {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '');
}

/**
 * Normalize a country to ISO 3166-1 alpha-2, or `undefined` when the value is
 * not a country we can act on.
 *
 * Cloudflare's `XX` (no location) and `T1` (Tor) are explicitly unknown: they
 * are the CDN saying it does not know, and we do not guess on its behalf.
 *
 * @complexity O(1)
 */
export function normalizeCountry(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const token = normalizeToken(value);

  // The CDN's explicit "I don't know" sentinels first — `T1` is not a country
  // code at all, so this check must precede the shape check to stay meaningful.
  if ((UNKNOWN_COUNTRY_CODES as readonly string[]).includes(token)) return undefined;

  return /^[A-Z]{2}$/u.test(token) ? token : undefined;
}

/**
 * Normalize a subdivision. The value is whatever the CDN reports — an ISO code
 * (`WA`) or a name (`Washington`) — so this only makes it comparable; it does
 * not claim to translate one into the other.
 *
 * @complexity O(n) in the length of the value
 */
export function normalizeRegion(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const token = normalizeToken(value);
  return token === '' ? undefined : token;
}

/**
 * Normalize one configured `BLOCKED_REGIONS` entry (`us-wa` → `US-WA`).
 * Entries are `COUNTRY` or `COUNTRY-REGION`; empty segments are dropped.
 *
 * @complexity O(n) in the length of the entry
 */
export function normalizeBlockedRegion(entry: string): string {
  return entry
    .split('-')
    .map(normalizeToken)
    .filter((segment) => segment !== '')
    .join('-');
}

/**
 * Normalize and de-duplicate a configured blocked list. Invalid entries are
 * dropped rather than thrown on: a typo in one entry must not take the process
 * down and thereby unblock every jurisdiction at once.
 *
 * @complexity O(n) in the number of entries
 */
export function parseBlockedRegions(entries: readonly string[]): string[] {
  const normalized = entries.map(normalizeBlockedRegion).filter((entry) => entry !== '');
  return [...new Set(normalized)];
}

// ============================================================================
// The Rule
// ============================================================================

/**
 * The jurisdictions a location belongs to, most specific first (`US-WA`, then
 * `US`) — so a blocked list may name either a whole country or one subdivision.
 *
 * A location with no country yields nothing: a region without a country cannot
 * be attributed to a jurisdiction, and a guess is not a finding.
 *
 * @complexity O(1)
 */
export function jurisdictionsFor(location: GeoLocation): string[] {
  const country = normalizeCountry(location.country);
  if (country === undefined) return [];

  const region = normalizeRegion(location.region);
  return region === undefined ? [country] : [`${country}-${region}`, country];
}

/**
 * Decide whether a location may use the service.
 *
 * **An unknown location is allowed.** We cannot know where an unproxied request
 * comes from, and blocking everyone we cannot place would block nearly everyone.
 * A deployment that must enforce a hard territorial boundary needs a control
 * beyond this gate (e.g. an attestation at signup) — this gate only sees what
 * the CDN tells it.
 *
 * @param location - Where the request appears to come from
 * @param blockedRegions - Configured entries, raw or normalized
 * @returns Allowed, or blocked with the jurisdiction that matched
 * @complexity O(b) where b = number of blocked entries
 */
export function evaluateGeoAccess(
  location: GeoLocation,
  blockedRegions: readonly string[],
): GeoAccessDecision {
  const blocked = new Set(parseBlockedRegions(blockedRegions));

  for (const jurisdiction of jurisdictionsFor(location)) {
    if (blocked.has(jurisdiction)) {
      return { allowed: false, jurisdiction };
    }
  }

  return { allowed: true };
}

// ============================================================================
// Edge Helpers
// ============================================================================

/**
 * Whether a request is exempt from the geo gate. Health probes are: one routed
 * through the CDN from a blocked region would otherwise 403, and the deployment
 * would read as dead when it was only unwelcome.
 *
 * Takes a URL, not a path — the transport hands over `/health?deep=1` — and
 * matches a whole segment, so `/health-club` is not exempt by accident.
 *
 * @complexity O(p) where p = number of exempt prefixes
 */
export function isGeoExemptPath(url: string): boolean {
  const path = url.split(/[?#]/u)[0] ?? '';
  return GEO_EXEMPT_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Build the 403 body. It names the jurisdiction we matched and points at the
 * page that explains the block.
 *
 * @complexity O(1)
 */
export function createJurisdictionBlockedBody(jurisdiction: string): JurisdictionBlockedBody {
  return {
    code: JURISDICTION_BLOCKED,
    message: `This service is not offered in your region (${jurisdiction}).`,
    jurisdiction,
    unavailablePath: UNAVAILABLE_PATH,
  };
}
