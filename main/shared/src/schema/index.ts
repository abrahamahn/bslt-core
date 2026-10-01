// main/shared/src/schema/index.ts
/**
 * Schema Validation Framework
 *
 * This module provides a lightweight, type-safe schema validation framework
 * for parsing environment variables, API requests, and domain objects.
 *
 * @module Schema
 */

export type { InferSchema, SafeParseResult, Schema } from './types';

export { createSchema } from './factory';

export {
  coerceDate,
  coerceNumber,
  parseBoolean,
  parseNullable,
  parseNullableOptional,
  parseNumber,
  parseObject,
  parseOptional,
  parseRecord,
  parseString,
  parseTypedRecord,
  withDefault,
  type ParseNumberOptions,
  type ParseStringOptions,
} from './parsers';

export {
  createArraySchema,
  createBrandedStringSchema,
  createBrandedUuidSchema,
  createEnumSchema,
  createLiteralSchema,
  createUnionSchema,
} from './composite';

export { emailSchema, isoDateTimeSchema, passwordSchema, urlSchema, uuidSchema } from './scalars';

export {
  activityIdSchema,
  auditEventIdSchema,
  consentRecordIdSchema,
  emailLogIdSchema,
  emailTemplateKeySchema,
  fileIdSchema,
  inviteIdSchema,
  jobIdSchema,
  legalDocumentIdSchema,
  membershipIdSchema,
  notificationIdSchema,
  organizationIdSchema,
  parsePlanId,
  parseTenantId,
  parseUserId,
  planIdSchema,
  sessionIdSchema,
  subscriptionIdSchema,
  tenantIdSchema,
  userIdSchema,
  webhookDeliveryIdSchema,
  webhookIdSchema,
  type ActivityId,
  type AuditEventId,
  type ConsentRecordId,
  type EmailLogId,
  type EmailTemplateKey,
  type FileId,
  type InviteId,
  type JobId,
  type LegalDocumentId,
  type MembershipId,
  type NotificationId,
  type OrganizationId,
  type PlanId,
  type SessionId,
  type SubscriptionId,
  type TenantId,
  type UserId,
  type WebhookDeliveryId,
  type WebhookId,
} from './ids';
