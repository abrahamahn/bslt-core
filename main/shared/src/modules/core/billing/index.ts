// main/shared/src/modules/core/billing/index.ts

/**
 * @file Billing Barrel
 * @description Public API for the billing domain: schemas, types, display helpers, errors, entitlements.
 * @module Core/Billing
 */

// --- billing.schemas ---
export {
  addPaymentMethodRequestSchema,
  cancelSubscriptionRequestSchema,
  cardDetailsSchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  invoiceResponseSchema,
  invoiceSchema,
  invoicesListResponseSchema,
  paymentMethodResponseSchema,
  paymentMethodSchema,
  paymentMethodsListResponseSchema,
  planFeatureSchema,
  planSchema,
  plansListResponseSchema,
  recordUsageRequestSchema,
  recordUsageResponseSchema,
  setupIntentResponseSchema,
  subscriptionActionResponseSchema,
  subscriptionResponseSchema,
  subscriptionSchema,
  updateSubscriptionRequestSchema,
  updateSubscriptionResponseSchema,
  type AddPaymentMethodRequest,
  type BillingEventType,
  type BillingProvider,
  type CancelSubscriptionRequest,
  type CardDetails,
  type CheckoutRequest,
  type CheckoutResponse,
  type FeatureKey,
  type Invoice,
  type InvoiceResponse,
  type InvoiceStatus,
  type InvoicesListResponse,
  type PaymentMethod,
  type PaymentMethodResponse,
  type PaymentMethodType,
  type PaymentMethodsListResponse,
  type Plan,
  type PlanChangeDirection,
  type PlanFeature,
  type PlanInterval,
  type PlansListResponse,
  type ProrationBehavior,
  type RecordUsageRequest,
  type RecordUsageResponse,
  type SetupIntentResponse,
  type Subscription,
  type SubscriptionActionResponse,
  type SubscriptionResponse,
  type SubscriptionStatus,
  type UpdateSubscriptionRequest,
  type UpdateSubscriptionResponse,
} from './billing.schemas';

// --- billing.admin.schemas ---
export {
  adminBillingStatsSchema,
  adminPlanResponseSchema,
  adminPlanSchema,
  adminPlansListResponseSchema,
  adminStripeStatusSchema,
  createPlanRequestSchema,
  deletePlanRequestSchema,
  grantSubscriptionRequestSchema,
  grantSubscriptionResponseSchema,
  stripeConnectionTestResultSchema,
  syncStripeResponseSchema,
  updatePlanRequestSchema,
  type AdminBillingStats,
  type AdminPlan,
  type AdminPlanResponse,
  type AdminPlansListResponse,
  type AdminStripeStatus,
  type CreatePlanRequest,
  type DeletePlanRequest,
  type GrantSubscriptionRequest,
  type GrantSubscriptionResponse,
  type MaskedCredential,
  type StripeConnectionTestResult,
  type SyncStripeResponse,
  type UpdatePlanRequest,
} from './billing.admin.schemas';

// --- billing.logic ---
export {
  calculateProration,
  canChangePlan,
  determinePlanChangeDirection,
  getEntitlements,
  getFeatureValue,
  getLimitUsagePercentage,
  isOverLimit,
  isSubscriptionActive,
  PLAN_FEES,
  prorationBehaviorForDirection,
  type BillingStats,
  type Entitlements,
  type PlanChangeResult,
} from './billing.logic';

// --- billing.display ---
export {
  formatPlanInterval,
  formatPrice,
  formatPriceWithInterval,
  getCardBrandLabel,
  getInvoiceStatusLabel,
  getInvoiceStatusVariant,
  getPaymentMethodIcon,
  getPaymentMethodLabel,
  getSubscriptionStatusLabel,
  getSubscriptionStatusVariant,
  type StatusVariant,
} from './billing.display';

// --- billing.form ---
export {
  formatPriceInput,
  isLimitFeatureKey,
  parsePriceInput,
  toPlanFeatureFormValues,
  toPlanFeatures,
  type LimitFeatureKey,
  type PlanFeatureFormValue,
} from './billing.form';

// --- billing.errors ---
export {
  BillingProviderError,
  BillingProviderNotConfiguredError,
  BillingSubscriptionExistsError,
  BillingSubscriptionNotFoundError,
  CannotDeactivatePlanWithActiveSubscriptionsError,
  CannotDeletePlanWithSubscriptionsError,
  CannotDowngradeInTrialError,
  CannotRemoveDefaultPaymentMethodError,
  CheckoutSessionError,
  CustomerNotFoundError,
  InvoiceNotFoundError,
  isBillingProviderError,
  isPlanError,
  isSubscriptionError,
  PaymentMethodNotFoundError,
  PaymentMethodValidationError,
  PlanHasActiveSubscriptionsError,
  PlanNotActiveError,
  PlanNotFoundError,
  PlanPriceMismatchError,
  SubscriptionAlreadyCanceledError,
  SubscriptionNotActiveError,
  SubscriptionNotCancelingError,
  WebhookEventAlreadyProcessedError,
  WebhookSignatureError,
} from './billing.errors';

// --- billing.entitlements ---
export {
  assertEntitled,
  assertWithinLimit,
  hasActiveSubscription,
  isEntitled,
  resolveEntitlements,
  type EntitlementInput,
  type FeatureEntitlement,
  type ResolvedEntitlements,
  type SubscriptionState,
} from './billing.entitlements';

// --- billing.service-types ---
export {
  type BillingService,
  type CheckoutParams,
  type CheckoutResult,
  type CreatePriceParams,
  type CreateProductParams,
  type CreateProductResult,
  type CreateSubscriptionParams,
  type CreateSubscriptionResult,
  type NormalizedEventType,
  type NormalizedWebhookEvent,
  type ProviderInvoice,
  type ProviderPaymentMethod,
  type ProviderPrice,
  type ProviderSubscription,
  type SetupIntentResult,
  type UpdateSubscriptionOptions,
} from './billing.service.types';
