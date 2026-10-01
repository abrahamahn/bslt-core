// main/shared/src/constants/core/geo.ts

/**
 * @file Geo / Jurisdiction Constants
 * @description Defaults for the jurisdiction gate: which regions are blocked
 * out of the box (none), and the CDN headers a deployment reads a location from.
 * @module Core/Constants/Geo
 */

/**
 * Jurisdictions blocked when `BLOCKED_REGIONS` is not set. Entries are
 * `COUNTRY` (ISO 3166-1 alpha-2) or `COUNTRY-REGION` (ISO 3166-2 subdivision),
 * e.g. `US` or `US-WA`.
 *
 * A neutral starter blocks nowhere by default: which jurisdictions a product
 * may not serve is a legal decision about that product, not a template
 * default. The machinery ships ready; the policy does not. Geo blocking
 * activates only when a deployment sets `BLOCKED_REGIONS`.
 *
 * When listing a subdivision, list both spellings the CDN may report — the
 * ISO code (`US-WA`, from `cf-region-code`) and the name (`US-WASHINGTON`,
 * from `cf-region`) — because a code-only entry does not match a name.
 */
export const DEFAULT_BLOCKED_REGIONS: readonly string[] = [];

/** Header carrying the ISO 3166-1 alpha-2 country code. Cloudflare sets this. */
export const DEFAULT_GEO_COUNTRY_HEADER = 'cf-ipcountry';

/**
 * Headers that may carry the subdivision, in priority order — the first header
 * present on the request wins. `cf-region-code` leads because it carries the
 * ISO code (`WA`); `cf-region` carries the human name (`Washington`).
 */
export const DEFAULT_GEO_REGION_HEADERS = ['cf-region-code', 'x-geo-region', 'cf-region'] as const;

/**
 * Country values that mean "the CDN could not place this request". Cloudflare
 * sends `XX` when it has no location for the IP and `T1` for Tor exit nodes.
 * Both are unknown — and an unknown location never blocks.
 */
export const UNKNOWN_COUNTRY_CODES = ['XX', 'T1'] as const;

/**
 * Paths exempt from the geo gate. A liveness probe routed through the CDN from
 * a blocked region would otherwise 403, and the deployment would read as dead
 * while it was merely unwelcome. The system routes mount health checks
 * unprefixed at `/health` (`/health/live`, `/health/ready`, `/health/detailed`).
 */
export const GEO_EXEMPT_PATH_PREFIXES = ['/health'] as const;
