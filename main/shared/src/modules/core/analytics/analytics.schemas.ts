// main/shared/src/modules/core/analytics/analytics.schemas.ts
/**
 * Analytics / event tracking — shared contract schemas and the typed
 * `track(event, props)` API.
 *
 * Events are a product-analytics pipeline distinct from audit logs: callers
 * build events with `track()`, the server ingests small authenticated batches,
 * and the dispatch layer (see analytics.dispatch.ts) applies sampling and PII
 * redaction before anything is persisted.
 */

import {
  createArraySchema,
  createSchema,
  isoDateTimeSchema,
  parseNumber,
  parseObject,
  parseString,
} from '../../../schema';

import type { Schema } from '../../../schema';

// ============================================================================
// Limits
// ============================================================================

/** Event names: dot-separated lowercase segments, e.g. `checkout.completed`. */
export const ANALYTICS_EVENT_NAME_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const ANALYTICS_MAX_EVENT_NAME_LENGTH = 100;
export const ANALYTICS_MAX_BATCH_SIZE = 50;
export const ANALYTICS_MAX_PROPS_DEPTH = 4;
export const ANALYTICS_MAX_PROPS_BYTES = 8192;

// ============================================================================
// Types
// ============================================================================

/** JSON-safe property value; enforced recursively at parse time. */
export type AnalyticsPropValue =
  | string
  | number
  | boolean
  | null
  | readonly AnalyticsPropValue[]
  | { readonly [key: string]: AnalyticsPropValue };

export type AnalyticsProps = Readonly<Record<string, AnalyticsPropValue>>;

export interface TrackEvent {
  readonly name: string;
  readonly props: AnalyticsProps;
  readonly occurredAt: string;
}

export interface TrackEventsRequest {
  readonly events: readonly TrackEvent[];
}

export interface TrackEventsResponse {
  /** Events persisted after sampling. */
  readonly accepted: number;
  /** Events dropped by the sampling decision. */
  readonly dropped: number;
}

// ============================================================================
// Parsers
// ============================================================================

function parseEventName(data: unknown): string {
  const name = parseString(data, 'name', { min: 1, max: ANALYTICS_MAX_EVENT_NAME_LENGTH });
  if (!ANALYTICS_EVENT_NAME_REGEX.test(name)) {
    throw new Error('name must be dot-separated lowercase segments (letters, digits, underscores)');
  }
  return name;
}

function parsePropValue(data: unknown, depth: number): AnalyticsPropValue {
  if (data === null) return null;
  const type = typeof data;
  if (type === 'string' || type === 'boolean') return data as AnalyticsPropValue;
  if (type === 'number') {
    const num = parseNumber(data, 'props value');
    if (!Number.isFinite(num)) throw new Error('props numbers must be finite');
    return num;
  }
  if (depth >= ANALYTICS_MAX_PROPS_DEPTH) {
    throw new Error(`props exceed the maximum depth of ${String(ANALYTICS_MAX_PROPS_DEPTH)}`);
  }
  if (Array.isArray(data)) {
    return data.map((item) => parsePropValue(item, depth + 1));
  }
  if (type === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => [
        key,
        parsePropValue(value, depth + 1),
      ]),
    );
  }
  throw new Error('props values must be JSON-safe (string, number, boolean, null, array, object)');
}

function parseProps(data: unknown): AnalyticsProps {
  const obj = parseObject(data ?? {}, 'props');
  const props = parsePropValue(obj, 0) as AnalyticsProps;
  const serialized = JSON.stringify(props);
  if (serialized.length > ANALYTICS_MAX_PROPS_BYTES) {
    throw new Error(
      `props exceed the maximum serialized size of ${String(ANALYTICS_MAX_PROPS_BYTES)} bytes`,
    );
  }
  return props;
}

// ============================================================================
// Schemas
// ============================================================================

export const trackEventSchema: Schema<TrackEvent> = createSchema((data: unknown) => {
  const obj = parseObject(data, 'TrackEvent');
  return {
    name: parseEventName(obj['name']),
    props: parseProps(obj['props']),
    occurredAt: isoDateTimeSchema.parse(obj['occurredAt']),
  };
});

export const trackEventsRequestSchema: Schema<TrackEventsRequest> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'TrackEventsRequest');
    const events = createArraySchema((item: unknown) => trackEventSchema.parse(item)).parse(
      obj['events'],
    );
    if (events.length === 0) throw new Error('events must contain at least one event');
    if (events.length > ANALYTICS_MAX_BATCH_SIZE) {
      throw new Error(`events must contain at most ${String(ANALYTICS_MAX_BATCH_SIZE)} events`);
    }
    return { events };
  },
);

export const trackEventsResponseSchema: Schema<TrackEventsResponse> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'TrackEventsResponse');
    return {
      accepted: parseNumber(obj['accepted'], 'accepted', { int: true, min: 0 }),
      dropped: parseNumber(obj['dropped'], 'dropped', { int: true, min: 0 }),
    };
  },
);

// ============================================================================
// track() — typed event builder
// ============================================================================

/**
 * Build a validated analytics event ready for `POST /api/analytics/events`.
 *
 * Throws when the event name or props violate the shared schema, so invalid
 * events fail at the call site instead of at the API boundary.
 */
export function track(event: string, props: AnalyticsProps = {}): TrackEvent {
  return trackEventSchema.parse({
    name: event,
    props,
    occurredAt: new Date().toISOString(),
  });
}
