// main/shared/src/modules/core/billing/billing.admin.schemas.ts

/**
 * @file Billing Admin Schemas
 * @description Admin-specific schemas for plan management and billing stats.
 * @module Core/Billing
 */

import { PLAN_INTERVALS } from '../../../constants/core';
import {
  createEnumSchema,
  createSchema,
  parseBoolean,
  parseNullable,
  parseNumber,
  parseOptional,
  parseString,
  withDefault,
} from '../../../schema';
import { isoDateTimeSchema } from '../schemas';

import { planFeatureSchema, planSchema } from './billing.schemas';

import type { Plan, PlanFeature, PlanInterval } from './billing.schemas';
import type { Schema } from '../../../schema';

// ============================================================================
// Types
// ============================================================================

/** Admin plan entity (extends Plan with provider-specific fields) */
export interface AdminPlan extends Plan {
  stripePriceId: string | null;
  stripeProductId: string | null;
  paypalPlanId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPlansListResponse {
  plans: AdminPlan[];
}

export interface CreatePlanRequest {
  name: string;
  description?: string | undefined;
  interval: PlanInterval;
  priceInCents: number;
  currency?: string | undefined;
  features: PlanFeature[];
  trialDays: number;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

/** Admin grant/override: create a real subscription for a user on a plan. */
export interface GrantSubscriptionRequest {
  planId: string;
  /** Trial length in days; omit to use the plan/default trial. */
  trialDays?: number | undefined;
}

/** Result of an admin grant-subscription. */
export interface GrantSubscriptionResponse {
  success: true;
  subscriptionId: string;
  status: string;
  message: string;
}

export interface UpdatePlanRequest {
  name?: string | undefined;
  description?: string | null | undefined;
  interval?: PlanInterval | undefined;
  priceInCents?: number | undefined;
  currency?: string | undefined;
  features?: PlanFeature[] | undefined;
  trialDays?: number | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

/** Admin request to delete a plan. `force` removes referencing subscriptions too. */
export interface DeletePlanRequest {
  force?: boolean | undefined;
}

export interface AdminPlanResponse {
  plan: AdminPlan;
}

export interface SyncStripeResponse {
  success: boolean;
  stripePriceId: string;
  stripeProductId: string;
}

export interface AdminBillingStats {
  totalRevenue: number;
  activeSubscriptions: number;
  churnRate: number;
  mrr: number;
}

/** A configured credential, masked for display (never the raw value). */
export interface MaskedCredential {
  configured: boolean;
  /** e.g. `sk_test_••••UyC`, or null when not configured */
  masked: string | null;
}

/** Read-only view of the Stripe configuration for the admin panel. */
export interface AdminStripeStatus {
  enabled: boolean;
  provider: 'stripe' | 'paypal';
  /** Derived from the secret/publishable key prefix. */
  mode: 'test' | 'live' | 'unknown';
  currency: string;
  publishableKey: MaskedCredential;
  secretKey: MaskedCredential;
  webhookSecret: MaskedCredential;
}

/** Result of a live Stripe connectivity check (server-side only). */
export interface StripeConnectionTestResult {
  connected: boolean;
  accountId?: string | undefined;
  country?: string | undefined;
  chargesEnabled?: boolean | undefined;
  message?: string | undefined;
}

// ============================================================================
// Schemas
// ============================================================================

/** Plan interval enum schema */
const planIntervalSchema = createEnumSchema(PLAN_INTERVALS, 'plan interval');

export const adminPlanSchema: Schema<AdminPlan> = createSchema((data: unknown) => {
  const basePlan = planSchema.parse(data);
  const obj = data as Record<string, unknown>;

  return {
    ...basePlan,
    stripePriceId: parseNullable(obj['stripePriceId'], (v) => parseString(v, 'stripePriceId')),
    stripeProductId: parseNullable(obj['stripeProductId'], (v) =>
      parseString(v, 'stripeProductId'),
    ),
    paypalPlanId: parseNullable(obj['paypalPlanId'], (v) => parseString(v, 'paypalPlanId')),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
});

export const adminPlansListResponseSchema: Schema<AdminPlansListResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (!Array.isArray(obj['plans'])) {
      throw new Error('plans must be an array');
    }
    return {
      plans: obj['plans'].map((item: unknown) => adminPlanSchema.parse(item)),
    };
  },
);

export const createPlanRequestSchema: Schema<CreatePlanRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const rawFeatures = withDefault(obj['features'], []);
  if (!Array.isArray(rawFeatures)) {
    throw new Error('features must be an array');
  }

  return {
    name: parseString(obj['name'], 'name', { min: 1 }),
    description: parseOptional(obj['description'], (v) => parseString(v, 'description')),
    interval: planIntervalSchema.parse(obj['interval']),
    priceInCents: parseNumber(obj['priceInCents'], 'priceInCents', { min: 0 }),
    currency: parseOptional(obj['currency'], (v) => parseString(v, 'currency', { length: 3 })),
    features: (rawFeatures as unknown[]).map((item: unknown) => planFeatureSchema.parse(item)),
    trialDays: parseNumber(withDefault(obj['trialDays'], 0), 'trialDays'),
    isActive: parseOptional(obj['isActive'], (v) => parseBoolean(v, 'isActive')),
    sortOrder: parseOptional(obj['sortOrder'], (v) => parseNumber(v, 'sortOrder')),
  };
});

export const grantSubscriptionRequestSchema: Schema<GrantSubscriptionRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      planId: parseString(obj['planId'], 'planId', { min: 1 }),
      trialDays: parseOptional(obj['trialDays'], (v) => parseNumber(v, 'trialDays', { min: 0 })),
    };
  },
);

export const grantSubscriptionResponseSchema: Schema<GrantSubscriptionResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      success: true,
      subscriptionId: parseString(obj['subscriptionId'], 'subscriptionId', { min: 1 }),
      status: parseString(obj['status'], 'status', { min: 1 }),
      message: parseString(obj['message'], 'message'),
    };
  },
);

export const updatePlanRequestSchema: Schema<UpdatePlanRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  let features: PlanFeature[] | undefined;
  if (obj['features'] !== undefined) {
    if (!Array.isArray(obj['features'])) {
      throw new Error('features must be an array');
    }
    features = obj['features'].map((item: unknown) => planFeatureSchema.parse(item));
  }

  return {
    name: parseOptional(obj['name'], (v) => parseString(v, 'name', { min: 1 })),
    description:
      obj['description'] === undefined
        ? undefined
        : parseNullable(obj['description'], (v) => parseString(v, 'description')),
    interval: parseOptional(obj['interval'], (v) => planIntervalSchema.parse(v)),
    priceInCents: parseOptional(obj['priceInCents'], (v) =>
      parseNumber(v, 'priceInCents', { min: 0 }),
    ),
    currency: parseOptional(obj['currency'], (v) => parseString(v, 'currency', { length: 3 })),
    features,
    trialDays: parseOptional(obj['trialDays'], (v) => parseNumber(v, 'trialDays')),
    isActive: parseOptional(obj['isActive'], (v) => parseBoolean(v, 'isActive')),
    sortOrder: parseOptional(obj['sortOrder'], (v) => parseNumber(v, 'sortOrder')),
  };
});

export const deletePlanRequestSchema: Schema<DeletePlanRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    force: parseOptional(obj['force'], (v) => parseBoolean(v, 'force')),
  };
});

export const adminPlanResponseSchema: Schema<AdminPlanResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { plan: adminPlanSchema.parse(obj['plan']) };
});

export const syncStripeResponseSchema: Schema<SyncStripeResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      success: parseBoolean(obj['success'], 'success'),
      stripePriceId: parseString(obj['stripePriceId'], 'stripePriceId'),
      stripeProductId: parseString(obj['stripeProductId'], 'stripeProductId'),
    };
  },
);

export const adminBillingStatsSchema: Schema<AdminBillingStats> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    totalRevenue: parseNumber(obj['totalRevenue'], 'totalRevenue'),
    activeSubscriptions: parseNumber(obj['activeSubscriptions'], 'activeSubscriptions'),
    churnRate: parseNumber(obj['churnRate'], 'churnRate'),
    mrr: parseNumber(obj['mrr'], 'mrr'),
  };
});

function parseMaskedCredential(value: unknown): MaskedCredential {
  const obj = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    configured: parseBoolean(obj['configured'], 'configured'),
    masked: obj['masked'] === null ? null : parseString(obj['masked'], 'masked'),
  };
}

export const adminStripeStatusSchema: Schema<AdminStripeStatus> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    enabled: parseBoolean(obj['enabled'], 'enabled'),
    provider: createEnumSchema(['stripe', 'paypal'] as const, 'provider').parse(obj['provider']),
    mode: createEnumSchema(['test', 'live', 'unknown'] as const, 'mode').parse(obj['mode']),
    currency: parseString(obj['currency'], 'currency'),
    publishableKey: parseMaskedCredential(obj['publishableKey']),
    secretKey: parseMaskedCredential(obj['secretKey']),
    webhookSecret: parseMaskedCredential(obj['webhookSecret']),
  };
});

export const stripeConnectionTestResultSchema: Schema<StripeConnectionTestResult> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      connected: parseBoolean(obj['connected'], 'connected'),
      accountId: parseOptional(obj['accountId'], (v) => parseString(v, 'accountId')),
      country: parseOptional(obj['country'], (v) => parseString(v, 'country')),
      chargesEnabled: parseOptional(obj['chargesEnabled'], (v) =>
        parseBoolean(v, 'chargesEnabled'),
      ),
      message: parseOptional(obj['message'], (v) => parseString(v, 'message')),
    };
  },
);
