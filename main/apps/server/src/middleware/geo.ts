// main/apps/server/src/middleware/geo.ts
/**
 * Geo Blocking Middleware
 *
 * The edge half of the jurisdiction gate: adapters that read a location off a
 * CDN header, and the hook that turns a blocked location into a 403.
 *
 * The rule itself is not here — it lives in `@bslt/shared/core/geo`, which knows
 * nothing about HTTP. This file only knows how to find a location; it does not
 * decide what a location means.
 *
 * **The honest limit:** without a CDN in front of the app supplying a location
 * header, every request resolves to an unknown location, and an unknown location
 * is never blocked. Geoblocking is therefore only as real as the deployment's
 * CDN configuration.
 */

import { HTTP_STATUS } from '@bslt/shared/constants';
import {
  createJurisdictionBlockedBody,
  evaluateGeoAccess,
  isGeoExemptPath,
  normalizeCountry,
  normalizeRegion,
  parseBlockedRegions,
} from '@bslt/shared/core/geo';

import type { GeoHeaders, GeoLocation, GeoProvider } from '@bslt/shared/core/geo';
import type { HttpReply, HttpRequest } from '@bslt/shared/system';

// ============================================================================
// Adapters (edge — these know the transport, and nothing else)
// ============================================================================

export interface HeaderGeoAdapterOptions {
  /** Header carrying the ISO 3166-1 alpha-2 country (e.g. `cf-ipcountry`). */
  countryHeader: string;
  /** Headers that may carry the subdivision, in priority order. */
  regionHeaders: readonly string[];
}

/**
 * Collapse headers into a case-insensitive lookup, taking the first value of a
 * repeated header. Inbound header names are lowercased by Node, but a
 * hand-configured name (`CF-IPCountry`) and a hand-written test are not, and a
 * gate that silently misses because of letter case is a gate that does nothing.
 *
 * @complexity O(h) where h = number of headers
 */
function toLookup(headers: GeoHeaders): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const [key, raw] of Object.entries(headers)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined) lookup.set(key.toLowerCase(), value);
  }

  return lookup;
}

/**
 * Reads the location from CDN headers.
 *
 * Cloudflare supplies `cf-ipcountry` (`US`) and, with the visitor-location
 * managed transform enabled, `cf-region-code` (`WA`) / `cf-region`
 * (`Washington`). Any CDN that can be told to set `x-geo-region` works too.
 */
export class HeaderGeoAdapter implements GeoProvider {
  readonly name = 'header';

  private readonly countryHeader: string;
  private readonly regionHeaders: readonly string[];

  constructor(options: HeaderGeoAdapterOptions) {
    this.countryHeader = options.countryHeader.toLowerCase();
    this.regionHeaders = options.regionHeaders.map((header) => header.toLowerCase());
  }

  /**
   * Resolve a location. Total by contract: a missing, malformed, or
   * "I don't know" header (Cloudflare's `XX`/`T1`) yields an unknown location
   * rather than an error or a guess.
   *
   * @complexity O(h + r) where h = headers, r = configured region headers
   */
  resolve(headers: GeoHeaders): GeoLocation {
    const lookup = toLookup(headers);

    const country = normalizeCountry(lookup.get(this.countryHeader));
    if (country === undefined) {
      // Without a country there is no jurisdiction to name, so a region on its
      // own is not worth carrying.
      return {};
    }

    // First header that actually yields a region wins — a present-but-empty
    // header is not an answer.
    let region: string | undefined;
    for (const header of this.regionHeaders) {
      region = normalizeRegion(lookup.get(header));
      if (region !== undefined) break;
    }

    return { country, region };
  }
}

/**
 * Reports an unknown location, always.
 *
 * This is what a deployment with no CDN geo source gets. It exists so that
 * "we cannot see where this request came from" is an explicit, configured,
 * testable state — not an accident of a header nobody remembered to set.
 */
export class NullGeoAdapter implements GeoProvider {
  readonly name = 'null';

  /** @complexity O(1) */
  resolve(): GeoLocation {
    return {};
  }
}

/**
 * Pick the adapter the configuration describes. An empty country header means
 * the deployment has declared it has no location source.
 */
export function createGeoProvider(options: HeaderGeoAdapterOptions): GeoProvider {
  return options.countryHeader.trim() === '' ? new NullGeoAdapter() : new HeaderGeoAdapter(options);
}

// ============================================================================
// Middleware
// ============================================================================

export interface GeoBlockOptions {
  /** Configured jurisdictions (`US-WA`). Empty leaves the gate inert. */
  blockedRegions: readonly string[];
  /** Resolves the location of a request. */
  provider: GeoProvider;
  /** Called when a request is rejected. Useful for logging/alerting. */
  onBlocked?: (jurisdiction: string, request: HttpRequest) => void;
}

/**
 * Create the jurisdiction gate: a framework-agnostic hook that rejects a
 * request from a blocked region with 403 and a machine-readable body.
 *
 * Unknown locations pass. Health probes pass. Everything else is measured
 * against the configured list.
 *
 * @param options - Blocked jurisdictions and the provider that resolves location
 * @returns A hook returning `true` when it has answered the request (403), so the
 *   caller knows not to continue the lifecycle
 *
 * @example
 * ```typescript
 * const geoBlock = createGeoBlockMiddleware({
 *   blockedRegions: config.server.geo.blockedRegions,
 *   provider: createGeoProvider(config.server.geo),
 * });
 * server.addHook('onRequest', (req, res, done) => {
 *   const blocked = geoBlock(req as unknown as HttpRequest, res as unknown as HttpReply);
 *   if (!blocked) done();
 * });
 * ```
 */
export function createGeoBlockMiddleware(
  options: GeoBlockOptions,
): (request: HttpRequest, reply: HttpReply) => boolean {
  // Normalized once at startup: the hot path should not re-parse config.
  const blockedRegions = parseBlockedRegions(options.blockedRegions);

  return (request: HttpRequest, reply: HttpReply): boolean => {
    if (blockedRegions.length === 0) return false;
    if (isGeoExemptPath(request.url)) return false;

    const decision = evaluateGeoAccess(options.provider.resolve(request.headers), blockedRegions);
    if (decision.allowed) return false;

    options.onBlocked?.(decision.jurisdiction, request);
    void reply
      .status(HTTP_STATUS.FORBIDDEN)
      .send(createJurisdictionBlockedBody(decision.jurisdiction));

    return true;
  };
}
