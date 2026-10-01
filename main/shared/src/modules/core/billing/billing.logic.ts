// main/shared/src/modules/core/billing/billing.logic.ts

/**
 * @file Billing Logic
 * @description Pure functions for subscription status checks, entitlements, proration, and usage limits.
 * @module Core/Billing
 */

import { FEATURE_KEYS, PLAN_FEES } from '../../../constants/core/billing';

import type { Plan, PlanChangeDirection, ProrationBehavior, Subscription } from './billing.schemas';

// ============================================================================
// Constants
// ============================================================================

// Re-exported, not redeclared: single source is `constants/core/billing`.
export { PLAN_FEES };

// ============================================================================
// Entitlements Logic
// ============================================================================

/**
 * Get a specific feature value from a plan.
 */
export function getFeatureValue<T>(
  plan: Plan,
  featureKey: string,
  defaultValue: T,
): T | boolean | number {
  const feature = plan.features.find((f) => f.key === featureKey);
  if (feature?.included !== true) return defaultValue;
  return feature.value ?? true;
}

/**
 * Check if a plan has a specific feature enabled.
 */
export function hasFeature(plan: Plan, featureKey: string): boolean {
  const feature = plan.features.find(
    (f) => f.key === featureKey || f.name.toUpperCase() === featureKey.toUpperCase(),
  );
  return feature?.included === true;
}

/**
 * Resolve high-level entitlements from a plan.
 */
export function getEntitlements(plan: Plan): {
  maxProjects: number;
  maxStorageGb: number;
  canRemoveBranding: boolean;
  canInviteMembers: boolean;
  canUseApi: boolean;
} {
  return {
    maxProjects: getFeatureValue(plan, FEATURE_KEYS.PROJECTS, 3) as number,
    maxStorageGb: getFeatureValue(plan, FEATURE_KEYS.STORAGE, 10) as number,
    canRemoveBranding: getFeatureValue(plan, FEATURE_KEYS.CUSTOM_BRANDING, false) as boolean,
    canInviteMembers: getFeatureValue(plan, FEATURE_KEYS.TEAM_MEMBERS, false) as boolean,
    canUseApi: getFeatureValue(plan, FEATURE_KEYS.API_ACCESS, false) as boolean,
  };
}

// ============================================================================
// Usage Limits
// ============================================================================

/**
 * Check if current usage exceeds a limit.
 */
export function isOverLimit(usage: number, limit: number): boolean {
  if (limit === -1 || limit === Infinity) return false;
  return usage >= limit;
}

/**
 * Calculate usage percentage (0-100).
 */
export function getLimitUsagePercentage(usage: number, limit: number): number {
  if (limit <= 0 || limit === Infinity || limit === -1) return 0;
  return Math.min(100, Math.round((usage / limit) * 100));
}

// ============================================================================
// Subscription Status Helpers
// ============================================================================

/**
 * Check if a subscription is currently active or trialing.
 */
export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (subscription === null) return false;
  return subscription.status === 'active' || subscription.status === 'trialing';
}

/**
 * Check if a subscription is past due.
 */
export function isSubscriptionPastDue(subscription: Subscription | null): boolean {
  if (subscription === null) return false;
  return subscription.status === 'past_due';
}

/**
 * Check if a subscription is inactive (canceled or unpaid).
 */
export function isSubscriptionInactive(subscription: Subscription | null): boolean {
  if (subscription === null) return true;
  return (
    subscription.status === 'canceled' ||
    subscription.status === 'unpaid' ||
    subscription.status === 'incomplete_expired'
  );
}

/**
 * Check if the user has an active subscription for a specific plan.
 */
export function hasActiveSubscription(subscription: Subscription | null, planId: string): boolean {
  if (subscription === null || !isSubscriptionActive(subscription)) return false;
  return subscription.planId === planId;
}

/**
 * Get the active plan from a list of plans.
 */
export function getEffectivePlan(
  subscription: Subscription | null,
  plans: Plan[],
): Plan | undefined {
  if (subscription === null || !isSubscriptionActive(subscription)) return undefined;
  return plans.find((p) => p.id === subscription.planId);
}

// ============================================================================
// Lifecycle Transitions
// ============================================================================

/**
 * Check if a subscription can be canceled.
 */
export function canCancelSubscription(subscription: Subscription | null): boolean {
  if (subscription === null || !isSubscriptionActive(subscription)) return false;
  return !subscription.cancelAtPeriodEnd;
}

/**
 * Check if a canceled subscription can be resumed.
 */
export function canResumeSubscription(subscription: Subscription | null): boolean {
  if (subscription === null || subscription.status === 'canceled') return false;
  return subscription.cancelAtPeriodEnd;
}

/**
 * Check if a subscription plan can be changed.
 */
export function canChangePlan(subscription: Subscription | null): boolean {
  if (subscription === null) return true;
  return isSubscriptionActive(subscription) || isSubscriptionPastDue(subscription);
}

// ============================================================================
// Proration & Math
// ============================================================================

/**
 * Calculate proration amount for plan changes.
 */
export function calculateProration(
  oldPrice: number,
  newPrice: number,
  remainingDays: number,
  totalDays: number,
): number {
  if (totalDays <= 0) return newPrice;
  if (remainingDays <= 0) return 0;
  if (oldPrice === newPrice) return 0;

  const unusedAmount = (oldPrice * remainingDays) / totalDays;
  const newAmount = (newPrice * remainingDays) / totalDays;

  return Math.round(newAmount - unusedAmount);
}

// ============================================================================
// Plan Change Direction & Proration Policy
// ============================================================================

/**
 * Determine the direction of a plan change by comparing plan prices.
 *
 * @param currentPriceInCents - Price of the current plan.
 * @param newPriceInCents - Price of the target plan.
 * @returns `'upgrade'` when the new plan is more expensive, `'downgrade'` when
 *   cheaper, and `'lateral'` when the prices are equal.
 */
export function determinePlanChangeDirection(
  currentPriceInCents: number,
  newPriceInCents: number,
): PlanChangeDirection {
  if (newPriceInCents > currentPriceInCents) return 'upgrade';
  if (newPriceInCents < currentPriceInCents) return 'downgrade';
  return 'lateral';
}

/**
 * Map a plan-change direction to its proration policy.
 *
 * Upgrades and laterals apply immediately (the customer is charged the prorated
 * difference now); downgrades are deferred to the end of the billing period so
 * the customer keeps the plan they already paid for — the standard, safer SaaS
 * default that avoids issuing mid-cycle credits or refunds.
 */
export function prorationBehaviorForDirection(direction: PlanChangeDirection): ProrationBehavior {
  return direction === 'downgrade' ? 'at_period_end' : 'immediate';
}

// ============================================================================
// Types
// ============================================================================

/**
 * Outcome of a self-service plan change, returned by the billing service so the
 * handler can tell the caller what happened and when it takes effect.
 */
export interface PlanChangeResult {
  /** Direction of the change, by price comparison. */
  readonly direction: PlanChangeDirection;
  /** Plan the subscription was on before the change. */
  readonly previousPlanId: string;
  /** Plan the subscription is (or will be) moving to. */
  readonly newPlanId: string;
  /** Whether the change took effect immediately (false for scheduled downgrades). */
  readonly appliedImmediately: boolean;
  /** Moment the change takes effect (now for immediate, period end for downgrades). */
  readonly effectiveAt: Date;
}

export interface BillingStats {
  subscriptionCount: number;
  activeRevenue: number;
  mrr: number;
}

export type Entitlements = ReturnType<typeof getEntitlements>;
