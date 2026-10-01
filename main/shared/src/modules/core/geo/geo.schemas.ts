// main/shared/src/modules/core/geo/geo.schemas.ts

/**
 * @file Geo Schemas & Port
 * @description The location type, the `GeoProvider` port, and the
 * machine-readable body returned to a request from a blocked jurisdiction.
 * @module Core/Geo
 */

import { createSchema, parseObject, parseOptional, parseString } from '../../../schema';

import type { Schema } from '../../../schema';

// ============================================================================
// Location
// ============================================================================

/**
 * Where a request appears to come from.
 *
 * **Both fields may be undefined, and that is a legitimate state, not an
 * error.** A request that arrives without a CDN in front of it — or through a
 * CDN that supplies no location — has no location, and the rule below must
 * decide what to do about that rather than pretend it knows.
 */
export interface GeoLocation {
  /** ISO 3166-1 alpha-2, uppercase (`US`). Undefined when unknown. */
  country?: string | undefined;
  /**
   * Subdivision as the CDN reports it, normalized (`WA`, or `WASHINGTON` from a
   * CDN that emits region names). Undefined when unknown.
   */
  region?: string | undefined;
}

/** Inbound headers exactly as a transport hands them over. */
export type GeoHeaders = Record<string, string | string[] | undefined>;

// ============================================================================
// Port
// ============================================================================

/**
 * PORT — resolves the location of an inbound request.
 *
 * The rule depends on this interface; it never reads a header. Adapters live at
 * the edge, because only the edge knows the transport. An implementation must
 * be total: it reports an unknown location, it never throws.
 */
export interface GeoProvider {
  /** Adapter name, for logs. */
  readonly name: string;
  /** Resolve a location from request headers. Unknown location is `{}`. */
  resolve(headers: GeoHeaders): GeoLocation;
}

// ============================================================================
// Decision
// ============================================================================

/**
 * The outcome of applying the blocked-jurisdiction rule to a location.
 * `jurisdiction` is the entry that matched — carried so the log and the
 * response can name it instead of asserting a bare "forbidden".
 */
export type GeoAccessDecision = { allowed: true } | { allowed: false; jurisdiction: string };

// ============================================================================
// Blocked Response Body
// ============================================================================

/** Machine-readable error code on the 403. Clients branch on this, not on prose. */
export const JURISDICTION_BLOCKED = 'JURISDICTION_BLOCKED';

/** Where the web app sends a blocked visitor. */
export const UNAVAILABLE_PATH = '/unavailable';

/**
 * The 403 body. `code` is the contract; `jurisdiction` tells the visitor which
 * place we think they are in, so a wrong answer is arguable rather than opaque.
 */
export interface JurisdictionBlockedBody {
  code: typeof JURISDICTION_BLOCKED;
  message: string;
  jurisdiction: string;
  /** Path of the page that explains the block. */
  unavailablePath: string;
}

export const jurisdictionBlockedBodySchema: Schema<JurisdictionBlockedBody> =
  createSchema<JurisdictionBlockedBody>((data: unknown) => {
    const obj = parseObject(data, 'JurisdictionBlockedBody');
    const code = parseString(obj['code'], 'code');

    if (code !== JURISDICTION_BLOCKED) {
      throw new Error(`code must be ${JURISDICTION_BLOCKED}`);
    }

    return {
      code,
      message: parseString(obj['message'], 'message'),
      jurisdiction: parseString(obj['jurisdiction'], 'jurisdiction'),
      unavailablePath:
        parseOptional(obj['unavailablePath'], (v: unknown) => parseString(v, 'unavailablePath')) ??
        UNAVAILABLE_PATH,
    };
  });
