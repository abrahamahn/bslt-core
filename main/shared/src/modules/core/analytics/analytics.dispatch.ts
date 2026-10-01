// main/shared/src/modules/core/analytics/analytics.dispatch.ts
/**
 * Analytics dispatch layer — sampling and PII redaction.
 *
 * Pure functions applied by the server BEFORE any event is persisted:
 * `prepareEventsForDispatch` samples deterministically, then redacts PII from
 * every surviving event, so nothing that reaches storage can carry redactable
 * keys or email-shaped string values.
 */

import { ANALYTICS_MAX_PROPS_DEPTH } from './analytics.schemas';

import type { AnalyticsPropValue, AnalyticsProps, TrackEvent } from './analytics.schemas';

// ============================================================================
// Sampling
// ============================================================================

export const DEFAULT_ANALYTICS_SAMPLE_RATE = 1;

/** Coerce an env-sourced rate into a usable [0, 1] value (default keeps everything). */
export function clampSampleRate(rate: number | undefined): number {
  if (rate === undefined || Number.isNaN(rate)) return DEFAULT_ANALYTICS_SAMPLE_RATE;
  return Math.min(1, Math.max(0, rate));
}

/** FNV-1a 32-bit hash; stable across processes so sampling is deterministic. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic sampling decision: the same key and rate always agree, so
 * retried batches neither double-sample nor flip-flop.
 */
export function shouldSample(key: string, rate: number): boolean {
  const clamped = clampSampleRate(rate);
  if (clamped >= 1) return true;
  if (clamped <= 0) return false;
  return fnv1a(key) / 0x1_0000_0000 < clamped;
}

// ============================================================================
// PII redaction
// ============================================================================

/**
 * Key fragments that mark a property as PII. Matched against lowercased keys,
 * so `Email`, `user_PHONE`, and `AccessToken` are all caught.
 */
const PII_KEY_PATTERN =
  /e[-_]?mail|phone|mobile|telephone|password|passwd|pwd|token|secret|api[-_]?key|authorization|cookie|ssn|social[-_]?security|card[-_]?number|cvv|iban/;

export function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERN.test(key.toLowerCase());
}

const REDACTED_VALUE = '[redacted]';

/** Unanchored email matcher: catches addresses embedded in longer strings. */
const EMAIL_IN_TEXT_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/gu;

function redactValue(value: AnalyticsPropValue, depth: number): AnalyticsPropValue {
  if (typeof value === 'string') {
    return value.replace(EMAIL_IN_TEXT_REGEX, REDACTED_VALUE);
  }
  if (value === null || typeof value !== 'object' || depth > ANALYTICS_MAX_PROPS_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return (value as readonly AnalyticsPropValue[]).map((item) => redactValue(item, depth + 1));
  }
  return redactProps(value as AnalyticsProps, depth + 1);
}

function redactProps(props: AnalyticsProps, depth: number): AnalyticsProps {
  return Object.fromEntries(
    Object.entries(props)
      .filter(([key]) => !isPiiKey(key))
      .map(([key, value]) => [key, redactValue(value, depth)]),
  );
}

/**
 * Strip PII from event props: keys matching email/phone/password/token/secret
 * patterns (any casing, any nesting depth) are removed, and string values that
 * look like email addresses are replaced with `[redacted]`.
 */
export function redactPii(props: AnalyticsProps): AnalyticsProps {
  return redactProps(props, 0);
}

// ============================================================================
// Dispatch pipeline
// ============================================================================

export interface DispatchResult {
  /** Sampled-in events with PII already redacted — the only events safe to persist. */
  readonly events: readonly TrackEvent[];
  /** Events dropped by the sampling decision. */
  readonly dropped: number;
}

/**
 * Apply the full dispatch pipeline: deterministic sampling followed by PII
 * redaction of every surviving event. Persistence layers must only ever see
 * the output of this function.
 */
export function prepareEventsForDispatch(
  events: readonly TrackEvent[],
  sampleRate: number,
  samplingKey: (event: TrackEvent, index: number) => string,
): DispatchResult {
  const sampled = events.filter((event, index) =>
    shouldSample(samplingKey(event, index), sampleRate),
  );
  return {
    events: sampled.map((event) => ({ ...event, props: redactPii(event.props) })),
    dropped: events.length - sampled.length,
  };
}
