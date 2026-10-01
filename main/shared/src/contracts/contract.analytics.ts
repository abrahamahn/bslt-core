// main/shared/src/contracts/contract.analytics.ts
/**
 * Analytics Contracts
 *
 * Authenticated batched event ingest. Events are built client-side with the
 * shared `track()` helper; sampling and PII redaction happen server-side in
 * the dispatch layer before persistence.
 */

import { trackEventsRequestSchema, trackEventsResponseSchema } from '../modules/core/analytics';
import { errorResponseSchema } from '../modules/system';

import type { Contract } from '../api/api';

export const analyticsContract = {
  trackEvents: {
    method: 'POST' as const,
    path: '/api/analytics/events',
    body: trackEventsRequestSchema,
    responses: {
      200: trackEventsResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
    },
    summary: 'Ingest a batch of analytics events (authenticated)',
  },
} satisfies Contract;
