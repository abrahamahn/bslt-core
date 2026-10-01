// main/shared/src/modules/core/support/support.schemas.ts
/**
 * Support / contact — shared contract schemas.
 *
 * The contact endpoint is public (logged-out users must be able to reach support),
 * so the request carries an explicit `email`. Admin endpoints list and resolve
 * submissions.
 */

import {
  coerceNumber,
  createArraySchema,
  createEnumSchema,
  createSchema,
  emailSchema,
  isoDateTimeSchema,
  parseNullable,
  parseObject,
  parseString,
  uuidSchema,
} from '../../../schema';

import type { Schema } from '../../../schema';

export const SUPPORT_CATEGORIES = [
  'general',
  'billing',
  'technical',
  'account',
  'feedback',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = ['open', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export interface ContactRequest {
  readonly email: string;
  readonly subject: string;
  readonly message: string;
  readonly category: SupportCategory;
}

export interface ContactResponse {
  readonly success: boolean;
}

export interface SupportRequest {
  readonly id: string;
  readonly userId: string | null;
  readonly email: string;
  readonly subject: string;
  readonly message: string;
  readonly category: string;
  readonly status: SupportStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Default page size for the support inbox. */
export const SUPPORT_REQUESTS_DEFAULT_LIMIT = 100;

/** Hard ceiling for the support inbox. */
export const SUPPORT_REQUESTS_MAX_LIMIT = 500;

/**
 * Query for the support inbox.
 *
 * The status filter is applied by the DATABASE. Filtering the fetched page in
 * the browser searched only the newest `limit` rows, so an inbox with more
 * requests than the cap showed "no open requests" while open ones sat past the
 * bound.
 */
export interface SupportRequestsQuery {
  readonly status?: SupportStatus | undefined;
  readonly limit: number;
}

export interface SupportRequestsListResponse {
  readonly requests: readonly SupportRequest[];
  /** The bound actually applied, so the UI can state it. */
  readonly limit: number;
  /** True when more requests match than were returned. */
  readonly truncated: boolean;
}

export interface UpdateSupportStatusRequest {
  readonly status: SupportStatus;
}

export interface SupportRequestResponse {
  readonly request: SupportRequest;
}

const categorySchema = createEnumSchema(SUPPORT_CATEGORIES, 'category');
const statusSchema = createEnumSchema(SUPPORT_STATUSES, 'status');

function parseSubject(data: unknown): string {
  const subject = parseString(data, 'subject').trim();
  if (subject.length === 0) throw new Error('subject is required');
  if (subject.length > 200) throw new Error('subject must be at most 200 characters');
  return subject;
}

function parseMessage(data: unknown): string {
  const message = parseString(data, 'message').trim();
  if (message.length === 0) throw new Error('message is required');
  if (message.length > 5000) throw new Error('message must be at most 5000 characters');
  return message;
}

export const contactRequestSchema: Schema<ContactRequest> = createSchema((data: unknown) => {
  const obj = parseObject(data, 'ContactRequest');
  return {
    email: emailSchema.parse(obj['email']),
    subject: parseSubject(obj['subject']),
    message: parseMessage(obj['message']),
    category: categorySchema.parse(obj['category']),
  };
});

export const contactResponseSchema: Schema<ContactResponse> = createSchema((data: unknown) => {
  const obj = parseObject(data, 'ContactResponse');
  return { success: obj['success'] === true };
});

export const supportRequestSchema: Schema<SupportRequest> = createSchema((data: unknown) => {
  const obj = parseObject(data, 'SupportRequest');
  return {
    id: uuidSchema.parse(obj['id']),
    userId: parseNullable(obj['userId'], (v) => uuidSchema.parse(v)),
    email: parseString(obj['email'], 'email'),
    subject: parseString(obj['subject'], 'subject'),
    message: parseString(obj['message'], 'message'),
    category: parseString(obj['category'], 'category'),
    status: statusSchema.parse(obj['status']),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
});

export const supportRequestsQuerySchema: Schema<SupportRequestsQuery> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      status: obj['status'] === undefined ? undefined : statusSchema.parse(obj['status']),
      // Rejected rather than clamped: a nonsense limit is a mistake worth
      // reporting, not one to paper over with the default.
      limit:
        obj['limit'] === undefined
          ? SUPPORT_REQUESTS_DEFAULT_LIMIT
          : coerceNumber(obj['limit'], 'limit', {
              int: true,
              min: 1,
              max: SUPPORT_REQUESTS_MAX_LIMIT,
            }),
    };
  },
);

export const supportRequestsListResponseSchema: Schema<SupportRequestsListResponse> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'SupportRequestsListResponse');
    return {
      requests: createArraySchema((item: unknown) => supportRequestSchema.parse(item)).parse(
        obj['requests'],
      ),
      limit: coerceNumber(obj['limit'] ?? SUPPORT_REQUESTS_DEFAULT_LIMIT, 'limit', { int: true }),
      truncated: obj['truncated'] === true,
    };
  },
);

export const updateSupportStatusRequestSchema: Schema<UpdateSupportStatusRequest> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'UpdateSupportStatusRequest');
    return { status: statusSchema.parse(obj['status']) };
  },
);

export const supportRequestResponseSchema: Schema<SupportRequestResponse> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'SupportRequestResponse');
    return { request: supportRequestSchema.parse(obj['request']) };
  },
);
