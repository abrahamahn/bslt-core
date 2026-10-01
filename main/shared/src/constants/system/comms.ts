// main/shared/src/constants/system/comms.ts
/**
 * Communication constants — email and webhook delivery.
 */

export const EMAIL_STATUSES = ['queued', 'sent', 'delivered', 'bounced', 'failed'] as const;
export const EMAIL_PROVIDERS = ['smtp', 'ses', 'sendgrid', 'console'] as const;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'dead'] as const;
export const TERMINAL_DELIVERY_STATUSES: ReadonlySet<string> = new Set(['delivered', 'dead']);

export const WEBHOOK_EVENT_TYPES = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  TENANT_DELETED: 'tenant.deleted',
  MEMBER_ADDED: 'member.added',
  MEMBER_REMOVED: 'member.removed',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_FAILED: 'invoice.failed',
} as const;

export const SUBSCRIBABLE_EVENT_TYPES = Object.values(WEBHOOK_EVENT_TYPES);
