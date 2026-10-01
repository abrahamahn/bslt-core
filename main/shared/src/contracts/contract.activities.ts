// main/shared/src/contracts/contract.activities.ts
/**
 * Activities Contracts
 *
 * API contract definitions for the authenticated user's activity feed.
 * @module Contracts/Activities
 */

import { activitiesListFiltersSchema, activitySchema } from '../modules/core';
import { cursorPaginatedResultSchema } from '../modules/db';
import { errorResponseSchema, successResponseSchema } from '../modules/system';

import type { Contract } from '../api/api';

// ============================================================================
// Response Schemas
// ============================================================================

const activitiesListResponseSchema = cursorPaginatedResultSchema(activitySchema);

// ============================================================================
// Contract Definition
// ============================================================================

export const activitiesContract = {
  listForUser: {
    method: 'GET' as const,
    path: '/api/activities',
    query: activitiesListFiltersSchema,
    responses: {
      200: successResponseSchema(activitiesListResponseSchema),
      401: errorResponseSchema,
    },
    summary: 'List activities for the authenticated user (cursor-paginated)',
  },
} satisfies Contract;
