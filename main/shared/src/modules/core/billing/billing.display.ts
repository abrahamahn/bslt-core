// main/shared/src/modules/core/billing/billing.display.ts

/**
 * @file Billing Display
 * @description Formatting and display helpers for billing entities: prices, statuses, labels.
 * @module Core/Billing
 */

import type {
  InvoiceStatus,
  PaymentMethodType,
  PlanInterval,
  SubscriptionStatus,
} from './billing.schemas';

// ============================================================================
// Types
// ============================================================================

export type StatusVariant = 'success' | 'warning' | 'error' | 'neutral';

// ============================================================================
// Constants
// ============================================================================

const CENTS_PER_DOLLAR = 100;

// ============================================================================
// Currency Formatting
// ============================================================================

/**
 * Format a price from cents to a display string (e.g. "$29.00").
 */
export function formatPrice(priceInCents: number, currency: string): string {
  const amount = priceInCents / CENTS_PER_DOLLAR;
  const currencySymbol = currency.toUpperCase() === 'USD' ? '$' : currency.toUpperCase();
  return `${currencySymbol}${amount.toFixed(2)}`;
}

/**
 * Format a price with its billing interval (e.g. "$29.00/mo").
 */
export function formatPriceWithInterval(
  priceInCents: number,
  currency: string,
  interval: PlanInterval,
): string {
  return `${formatPrice(priceInCents, currency)}/${formatPlanInterval(interval)}`;
}

// ============================================================================
// Invoice Status
// ============================================================================

/**
 * Get a human-readable label for an invoice status.
 */
export function getInvoiceStatusLabel(status: InvoiceStatus): string {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'open':
      return 'Open';
    case 'draft':
      return 'Draft';
    case 'past_due':
      return 'Past Due';
    case 'void':
      return 'Void';
    case 'uncollectible':
      return 'Uncollectible';
  }
}

/**
 * Get the semantic variant for an invoice status.
 */
export function getInvoiceStatusVariant(status: InvoiceStatus): StatusVariant {
  switch (status) {
    case 'paid':
      return 'success';
    case 'open':
      return 'warning';
    case 'draft':
      return 'neutral';
    case 'past_due':
      return 'warning';
    case 'void':
      return 'neutral';
    case 'uncollectible':
      return 'error';
  }
}

// ============================================================================
// Subscription Status
// ============================================================================

/**
 * Get a human-readable label for a subscription status.
 */
export function getSubscriptionStatusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trial';
    case 'past_due':
      return 'Past Due';
    case 'canceled':
      return 'Canceled';
    case 'incomplete':
      return 'Incomplete';
    case 'incomplete_expired':
      return 'Expired';
    case 'paused':
      return 'Paused';
    case 'unpaid':
      return 'Unpaid';
  }
}

/**
 * Get the semantic variant for a subscription status.
 */
export function getSubscriptionStatusVariant(status: SubscriptionStatus): StatusVariant {
  switch (status) {
    case 'active':
      return 'success';
    case 'trialing':
      return 'success';
    case 'past_due':
      return 'warning';
    case 'unpaid':
      return 'warning';
    case 'canceled':
      return 'neutral';
    case 'incomplete':
      return 'warning';
    case 'incomplete_expired':
      return 'error';
    case 'paused':
      return 'neutral';
  }
}

// ============================================================================
// Plan Interval
// ============================================================================

/**
 * Format a plan interval as an abbreviation (e.g. 'month' → 'mo', 'year' → 'yr').
 */
export function formatPlanInterval(interval: PlanInterval): string {
  switch (interval) {
    case 'month':
      return 'mo';
    case 'year':
      return 'yr';
  }
}

// ============================================================================
// Card Brands
// ============================================================================

/**
 * Get a short display label for a card brand (e.g. 'visa' → 'Visa', 'mastercard' → 'MC').
 */
export function getCardBrandLabel(brand: string): string {
  const brandLower = brand.toLowerCase();
  const labels: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'MC',
    amex: 'Amex',
    american_express: 'Amex',
    discover: 'Disc',
    diners: 'DC',
    diners_club: 'DC',
    jcb: 'JCB',
    unionpay: 'UP',
  };
  return labels[brandLower] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

// ============================================================================
// Payment Methods
// ============================================================================

/**
 * Get a human-readable label for a payment method type (e.g. 'bank_account' → 'Bank Account').
 */
export function getPaymentMethodLabel(type: PaymentMethodType): string {
  switch (type) {
    case 'card':
      return 'Card';
    case 'bank_account':
      return 'Bank Account';
    case 'paypal':
      return 'PayPal';
  }
}

/**
 * Get an icon/emoji for a payment method type.
 */
export function getPaymentMethodIcon(type: PaymentMethodType): string {
  switch (type) {
    case 'card':
      return '\u{1F4B3}';
    case 'bank_account':
      return '\u{1F3E6}';
    case 'paypal':
      return 'PP';
  }
}
