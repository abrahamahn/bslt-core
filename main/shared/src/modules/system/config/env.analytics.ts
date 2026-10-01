// main/shared/src/modules/system/config/env.analytics.ts
/**
 * Analytics Environment Configuration
 *
 * Sampling rate for the analytics dispatch layer. Optional — the pipeline
 * defaults to keeping every event (rate 1.0).
 *
 * @module config/env.analytics
 */

import { coerceNumber, createSchema, parseObject, parseOptional } from '../../../schema';

import type { Schema } from '../../../schema';

// ============================================================================
// Types
// ============================================================================

/** Validated analytics configuration. */
export interface AnalyticsConfig {
  /** Fraction of events kept by the dispatch layer, in [0, 1]. */
  sampleRate: number;
}

/** Parsed analytics environment variables. */
export interface AnalyticsEnv {
  ANALYTICS_SAMPLE_RATE?: number | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const AnalyticsEnvSchema: Schema<AnalyticsEnv> = createSchema<AnalyticsEnv>(
  (data: unknown) => {
    const obj = parseObject(data, 'AnalyticsEnv');
    return {
      ANALYTICS_SAMPLE_RATE: parseOptional(obj['ANALYTICS_SAMPLE_RATE'], (v: unknown) =>
        coerceNumber(v, 'ANALYTICS_SAMPLE_RATE', { min: 0, max: 1 }),
      ),
    };
  },
);
