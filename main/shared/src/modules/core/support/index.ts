// main/shared/src/modules/core/support/index.ts

export {
  SUPPORT_CATEGORIES,
  SUPPORT_REQUESTS_DEFAULT_LIMIT,
  SUPPORT_REQUESTS_MAX_LIMIT,
  SUPPORT_STATUSES,
  contactRequestSchema,
  contactResponseSchema,
  supportRequestResponseSchema,
  supportRequestSchema,
  supportRequestsListResponseSchema,
  supportRequestsQuerySchema,
  updateSupportStatusRequestSchema,
} from './support.schemas';
export type {
  ContactRequest,
  ContactResponse,
  SupportCategory,
  SupportRequest,
  SupportRequestResponse,
  SupportRequestsListResponse,
  SupportRequestsQuery,
  SupportStatus,
  UpdateSupportStatusRequest,
} from './support.schemas';
