// main/kernel/server/src/config/env/env.billing.ts
/**
 * Billing Environment Configuration
 *
 * Billing types, env interface, and validation schema.
 * Merged from config/types/services.ts (billing section) and config/env.ts.
 *
 * @module config/env.billing
 */

import { defaulted, enumOf, object, optional, string } from '@bslt/schema';

import { httpUrlSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

/** Supported payment providers */
export type BillingProvider = 'stripe' | 'paypal';

/** Stripe provider configuration. */
interface StripeProviderConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
}

/** PayPal provider configuration. */
interface PayPalProviderConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  sandbox: boolean;
  brandName: string;
}

/** Billing plan price ID mapping. */
export interface BillingPlansConfig {
  free?: string;
  pro?: string;
  enterprise?: string;
}

/** Billing URL configuration. */
interface BillingUrlsConfig {
  portalReturnUrl: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
}

/** Billing and subscription configuration. */
export interface BillingConfig {
  enabled: boolean;
  provider: BillingProvider;
  currency: string;
  stripe: StripeProviderConfig;
  paypal: PayPalProviderConfig;
  plans: BillingPlansConfig;
  urls: BillingUrlsConfig;
}

// ============================================================================
// Env Interface
// ============================================================================

/** Billing environment variables */
export interface BillingEnv {
  BILLING_PROVIDER?: 'stripe' | 'paypal' | undefined;
  STRIPE_SECRET_KEY?: string | undefined;
  STRIPE_PUBLISHABLE_KEY?: string | undefined;
  STRIPE_WEBHOOK_SECRET?: string | undefined;
  PAYPAL_CLIENT_ID?: string | undefined;
  PAYPAL_CLIENT_SECRET?: string | undefined;
  PAYPAL_WEBHOOK_ID?: string | undefined;
  PAYPAL_MODE?: 'sandbox' | 'production' | undefined;
  PAYPAL_BRAND_NAME?: string | undefined;
  BILLING_CURRENCY: string;
  PLAN_FREE_ID?: string | undefined;
  PLAN_PRO_ID?: string | undefined;
  PLAN_ENTERPRISE_ID?: string | undefined;
  BILLING_PORTAL_RETURN_URL?: string | undefined;
  BILLING_CHECKOUT_SUCCESS_URL?: string | undefined;
  BILLING_CHECKOUT_CANCEL_URL?: string | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const BillingEnvSchema: Schema<BillingEnv> = object(
  {
    BILLING_PROVIDER: optional(enumOf(['stripe', 'paypal'] as const, 'BILLING_PROVIDER')),
    STRIPE_SECRET_KEY: optional(string({ label: 'STRIPE_SECRET_KEY' })),
    STRIPE_PUBLISHABLE_KEY: optional(string({ label: 'STRIPE_PUBLISHABLE_KEY' })),
    STRIPE_WEBHOOK_SECRET: optional(string({ label: 'STRIPE_WEBHOOK_SECRET' })),
    PAYPAL_CLIENT_ID: optional(string({ label: 'PAYPAL_CLIENT_ID' })),
    PAYPAL_CLIENT_SECRET: optional(string({ label: 'PAYPAL_CLIENT_SECRET' })),
    PAYPAL_WEBHOOK_ID: optional(string({ label: 'PAYPAL_WEBHOOK_ID' })),
    PAYPAL_MODE: optional(enumOf(['sandbox', 'production'] as const, 'PAYPAL_MODE')),
    PAYPAL_BRAND_NAME: optional(string({ label: 'PAYPAL_BRAND_NAME' })),
    BILLING_CURRENCY: defaulted(string({ label: 'BILLING_CURRENCY' }), 'usd'),
    PLAN_FREE_ID: optional(string({ label: 'PLAN_FREE_ID' })),
    PLAN_PRO_ID: optional(string({ label: 'PLAN_PRO_ID' })),
    PLAN_ENTERPRISE_ID: optional(string({ label: 'PLAN_ENTERPRISE_ID' })),
    BILLING_PORTAL_RETURN_URL: optional(httpUrlSchema('BILLING_PORTAL_RETURN_URL')),
    BILLING_CHECKOUT_SUCCESS_URL: optional(httpUrlSchema('BILLING_CHECKOUT_SUCCESS_URL')),
    BILLING_CHECKOUT_CANCEL_URL: optional(httpUrlSchema('BILLING_CHECKOUT_CANCEL_URL')),
  },
  { unknownKeys: 'strip' },
);
