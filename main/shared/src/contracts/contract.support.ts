// main/shared/src/contracts/contract.support.ts
/**
 * Support / Contact Contracts
 *
 * Public contact submission + admin inbox (list, resolve).
 */

import {
  contactRequestSchema,
  contactResponseSchema,
  supportRequestResponseSchema,
  supportRequestsListResponseSchema,
  updateSupportStatusRequestSchema,
} from '../modules/core/support';
import { errorResponseSchema } from '../modules/system';
import { uuidSchema } from '../schema';

import type { Contract } from '../api/api';

export const supportContract = {
  contact: {
    method: 'POST' as const,
    path: '/api/support/contact',
    body: contactRequestSchema,
    responses: {
      200: contactResponseSchema,
      400: errorResponseSchema,
    },
    summary: 'Submit a support / contact request (public)',
  },

  adminList: {
    method: 'GET' as const,
    path: '/api/admin/support',
    responses: {
      200: supportRequestsListResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
    },
    summary: 'List support requests (admin)',
  },

  adminUpdateStatus: {
    method: 'POST' as const,
    path: '/api/admin/support/:id/status',
    pathParams: { id: uuidSchema },
    body: updateSupportStatusRequestSchema,
    responses: {
      200: supportRequestResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Resolve / reopen a support request (admin)',
  },
} satisfies Contract;
