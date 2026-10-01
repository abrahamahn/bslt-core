// main/shared/src/modules/core/billing/billing.form.ts

/**
 * @file Billing Form Helpers
 * @description Pure helpers for plan-editor form state: mapping to/from the
 * PlanFeature domain union and dollars <-> cents price-input conversion.
 * @module Core/Billing
 */

import { CENTS_PER_DOLLAR, LIMIT_FEATURE_KEYS } from '../../../constants/core';

import type { FeatureKey, PlanFeature } from './billing.schemas';

// ============================================================================
// Types
// ============================================================================

/** Feature key whose PlanFeature branch carries a numeric limit value. */
export type LimitFeatureKey = (typeof LIMIT_FEATURE_KEYS)[number];

/**
 * Simplified feature shape for plan-editor form state.
 * Mapped to the domain PlanFeature union at API call boundaries.
 */
export interface PlanFeatureFormValue {
  key: FeatureKey;
  name: string;
  included: boolean;
  /** Numeric limit, only meaningful for limit feature keys */
  value?: number;
}

// ============================================================================
// Feature Mapping
// ============================================================================

const LIMIT_KEY_SET: ReadonlySet<FeatureKey> = new Set<FeatureKey>(LIMIT_FEATURE_KEYS);

/**
 * Type guard: checks whether a FeatureKey is a limit feature key.
 */
export function isLimitFeatureKey(key: FeatureKey): key is LimitFeatureKey {
  return LIMIT_KEY_SET.has(key);
}

/**
 * Type guard: narrows a PlanFeature to its limit branch (numeric value).
 */
function isLimitFeature(feature: PlanFeature): feature is Extract<PlanFeature, { value: number }> {
  return isLimitFeatureKey(feature.key);
}

/**
 * Maps plan-editor form features to the domain PlanFeature union.
 *
 * Limit features default to a value of 0 when the form has not captured a
 * numeric limit; toggle features never carry the numeric form value.
 */
export function toPlanFeatures(features: readonly PlanFeatureFormValue[]): PlanFeature[] {
  return features.map((feature): PlanFeature => {
    const { key, name, included, value } = feature;
    if (isLimitFeatureKey(key)) {
      return { key, name, included, value: value ?? 0 };
    }
    return { key, name, included };
  });
}

/**
 * Maps the domain PlanFeature union to plan-editor form features.
 *
 * Only limit features carry their numeric value into the form; boolean values
 * on toggle features are dropped rather than coerced to numbers.
 */
export function toPlanFeatureFormValues(features: readonly PlanFeature[]): PlanFeatureFormValue[] {
  return features.map((feature): PlanFeatureFormValue => {
    const { key, name, included } = feature;
    if (isLimitFeature(feature)) {
      return { key, name, included, value: feature.value };
    }
    return { key, name, included };
  });
}

// ============================================================================
// Price Input Conversion
// ============================================================================

/**
 * Parse a dollars text input (e.g. "9.99") into integer cents.
 * Empty or non-numeric input parses to 0.
 */
export function parsePriceInput(raw: string): number {
  if (raw.trim() === '') return 0;
  const dollars = Number.parseFloat(raw);
  return Number.isNaN(dollars) ? 0 : Math.round(dollars * CENTS_PER_DOLLAR);
}

/**
 * Format integer cents as dollars text for a price input (e.g. 999 -> "9.99").
 * Zero formats as the empty string so the input placeholder shows.
 */
export function formatPriceInput(priceInCents: number): string {
  return priceInCents === 0 ? '' : (priceInCents / CENTS_PER_DOLLAR).toFixed(2);
}
