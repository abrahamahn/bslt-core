// main/kernel/schema/src/index.ts
/**
 * `@bslt/schema` — Zero-dependency isomorphic validation, combinators, AST introspection,
 * and Standard Schema v1 support.
 */

export type {
  BigIntStringOptions,
  BigIntStringSchema,
  DefaultedSchema,
  Infer,
  NumberSchemaOptions,
  ObjectSchemaOptions,
  OptionalSchema,
  SafeParseResult,
  Schema,
  SchemaNode,
  SealedSchema,
  StandardSchemaV1,
  StandardSchemaV1Issue,
  StringFormat,
  StringSchemaOptions,
} from './types';

export { createSchema, makeSchema, SchemaValidationError } from './factory';

export {
  array,
  bigintString,
  boolean,
  brand,
  defaulted,
  discriminated,
  enumOf,
  json,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  refine,
  sealed,
  string,
  transform,
  union,
  unknown,
  type InferObject,
  type JsonValue,
} from './combinators';

export { describe, redactSealed } from './describe';

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
  type PlanId,
  type SubscriptionId,
  type UserId,
} from './ids';
