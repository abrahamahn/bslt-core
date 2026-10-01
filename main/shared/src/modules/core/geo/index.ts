// main/shared/src/modules/core/geo/index.ts

/**
 * @file Geo Module Index
 * @description Barrel exports for the geo domain: the `GeoProvider` port and the
 * blocked-jurisdiction rule. Adapters that read headers live at the edge.
 * @module Core/Geo
 */

// --- geo.logic ---
export {
  createJurisdictionBlockedBody,
  evaluateGeoAccess,
  isGeoExemptPath,
  jurisdictionsFor,
  normalizeBlockedRegion,
  normalizeCountry,
  normalizeRegion,
  parseBlockedRegions,
} from './geo.logic';

// --- geo.schemas ---
export {
  JURISDICTION_BLOCKED,
  jurisdictionBlockedBodySchema,
  UNAVAILABLE_PATH,
} from './geo.schemas';

export type {
  GeoAccessDecision,
  GeoHeaders,
  GeoLocation,
  GeoProvider,
  JurisdictionBlockedBody,
} from './geo.schemas';
