// main/shared/src/modules/system/config/env.webhooks.ts
/**
 * Webhook Delivery Environment Configuration
 *
 * Tuning knobs for outbound webhook delivery. Both keys are optional — the
 * dispatcher falls back to the shared defaults (`DEFAULT_WEBHOOK_DELIVERY_TIMEOUT_MS`
 * and `MAX_DELIVERY_ATTEMPTS`) when they are absent.
 *
 * @module config/env.webhooks
 */

import { RETRY_DELAYS_MINUTES } from '../../../constants/system/limits';
import { coerceNumber, createSchema, parseObject, parseOptional } from '../../../schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '../../../schema';

// ============================================================================
// Types
// ============================================================================

/** Validated webhook delivery configuration. */
export interface WebhookConfig {
  /** Per-attempt HTTP timeout in milliseconds. */
  deliveryTimeoutMs: number;
  /** Maximum delivery attempts before a delivery is marked dead. */
  maxAttempts: number;
  /**
   * Whether webhook targets may point at private/internal addresses.
   * Absent or false, create/update reject non-public targets (the hosted-safe
   * default); a self-hosted deployment that legitimately webhooks internal
   * services sets WEBHOOK_ALLOW_PRIVATE_TARGETS=true. The cloud metadata
   * endpoint is refused regardless of this flag.
   */
  allowPrivateTargets?: boolean | undefined;
}

/** Parsed webhook environment variables. */
export interface WebhookEnv {
  WEBHOOK_DELIVERY_TIMEOUT_MS?: number | undefined;
  WEBHOOK_MAX_ATTEMPTS?: number | undefined;
  WEBHOOK_ALLOW_PRIVATE_TARGETS?: 'true' | 'false' | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const WebhookEnvSchema: Schema<WebhookEnv> = createSchema<WebhookEnv>((data: unknown) => {
  const obj = parseObject(data, 'WebhookEnv');
  return {
    WEBHOOK_DELIVERY_TIMEOUT_MS: parseOptional(obj['WEBHOOK_DELIVERY_TIMEOUT_MS'], (v: unknown) =>
      coerceNumber(v, 'WEBHOOK_DELIVERY_TIMEOUT_MS', { int: true, min: 1000, max: 60_000 }),
    ),
    // Bounded by the fixed backoff schedule length so every retry has a delay.
    WEBHOOK_MAX_ATTEMPTS: parseOptional(obj['WEBHOOK_MAX_ATTEMPTS'], (v: unknown) =>
      coerceNumber(v, 'WEBHOOK_MAX_ATTEMPTS', {
        int: true,
        min: 1,
        max: RETRY_DELAYS_MINUTES.length,
      }),
    ),
    WEBHOOK_ALLOW_PRIVATE_TARGETS: parseOptional(
      obj['WEBHOOK_ALLOW_PRIVATE_TARGETS'],
      (v: unknown) => trueFalseSchema.parse(v),
    ),
  };
});
